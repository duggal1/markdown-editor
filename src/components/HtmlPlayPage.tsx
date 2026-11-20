import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ComputerIcon, SmartPhone01Icon, DragDropVerticalIcon, ArrowDown01Icon,
  Cancel01Icon, ReloadIcon, Maximize01Icon, ArrowLeft01Icon,
} from '@hugeicons/core-free-icons';
import RuntimeSelect, { type RuntimeOption } from './RuntimeSelect';
import IPhoneFrame from './IPhoneFrame';
import { htmlPreviewDocument } from '../lib/htmlPreview';
import { loadDoc } from '../lib/store';
import { isHtmlPage } from '../lib/siteHosting';

type Resolution = 'auto' | '1920x1080' | '1280x720' | '800x600';
const PRESETS: Record<Exclude<Resolution, 'auto'>, [number, number]> = {
  '1920x1080': [1920, 1080], '1280x720': [1280, 720], '800x600': [800, 600],
};
const PATH = window.location.pathname.split('/').filter(Boolean);
const LOCAL = PATH[0] === 'play' && PATH[1] === 'local';
const ID = LOCAL ? PATH[2] || '' : PATH[1] || '';
const FIRST_ROUTE = '/' + PATH.slice(LOCAL ? 3 : 2).join('/');

function currentRoute(): string {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return '/' + parts.slice(LOCAL ? 3 : 2).join('/');
}
function safeRoute(value: string): string | null {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin || parsed.pathname.startsWith('/api/')) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return null; }
}
const DESKTOP_OPTIONS: RuntimeOption<Resolution>[] = [
  { value: 'auto', label: 'Auto · Fill window' },
  { value: '1920x1080', label: '1920 × 1080' },
  { value: '1280x720', label: '1280 × 720' },
  { value: '800x600', label: '800 × 600' },
];
const FPS_OPTIONS: RuntimeOption<number>[] = [
  { value: 0, label: 'Auto' },
  { value: 30, label: '30 FPS' },
  { value: 60, label: '60 FPS' },
  { value: 120, label: '120 FPS' },
];
const spring = { type: 'spring' as const, stiffness: 475, damping: 33 };

export default function HtmlPlayPage() {
  const reduce = useReducedMotion();
  const [glass, setGlass] = useState<'dark' | 'light'>('dark');
  const [source, setSource] = useState<string | null>(null);
  const [title, setTitle] = useState('HTML preview');
  const [error, setError] = useState('');
  const [routePath, setRoutePath] = useState(FIRST_ROUTE);
  const [frameRoute, setFrameRoute] = useState(FIRST_ROUTE);
  const [resolution, setResolution] = useState<Resolution>('auto');
  const [phone, setPhone] = useState(false);
  const [fpsLimit, setFpsLimit] = useState(0);
  const [observedFps, setObservedFps] = useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [left, setLeft] = useState(14);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [reload, setReload] = useState(0);
  const iframe = useRef<HTMLIFrameElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ x: number; left: number } | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        if (LOCAL) {
          const doc = await loadDoc(ID);
          if (!doc || !isHtmlPage(doc)) throw new Error('This HTML page is not available on this device.');
          if (active) {
            setSource(doc.markdown);
            setTitle(doc.title || 'HTML preview');
            document.title = (doc.title || 'HTML preview') + ' · Flow';
          }
        } else {
          const response = await fetch('/api/site?id=' + encodeURIComponent(ID) + '&raw=1', {
            signal: controller.signal, cache: 'no-cache',
          });
          if (!response.ok) throw new Error(response.status === 404
            ? 'This site is unavailable or has not finished publishing.'
            : 'Could not load the hosted HTML.');
          const html = await response.text();
          if (active) {
            setSource(html);
            const match = html.slice(0, 20000).match(/<title[^>]*>([^<]+)<\/title>/i);
            const label = match?.[1]?.trim() || 'Shared HTML';
            setTitle(label);
            document.title = label;
          }
        }
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'HTML page unavailable.');
        }
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, []);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setViewport(current => current.width === rect.width && current.height === rect.height
        ? current : { width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || !event.data) return;
      if (event.data.type === 'flow-runtime-theme' &&
          (event.data.theme === 'dark' || event.data.theme === 'light')) {
        setGlass(event.data.theme);
      } else if (event.data.type === 'flow-runtime-fps' && Number.isFinite(event.data.fps)) {
        setObservedFps(Math.min(1000, Math.max(0, Math.round(event.data.fps))));
      } else if (event.data.type === 'flow-runtime-route') {
        const route = safeRoute(event.data.path);
        if (!route) return;
        const prefix = LOCAL ? '/play/local/' + ID : '/slug/' + ID;
        const next = prefix + (route === '/' ? '/' : route);
        if (next === window.location.pathname + window.location.search + window.location.hash) return;
        window.history.pushState(null, '', next);
        setRoutePath(route);
        if (!event.data.soft) setFrameRoute(route);
      }
    };
    const onPopState = () => {
      const route = currentRoute();
      setRoutePath(route);
      setFrameRoute(route);
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        setControlsVisible(current => !current);
      }
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // The original iPhone artboard is 340×700. Its iframe viewport is 306×623
  // after the supplied 44px top inset. Scale the entire artboard uniformly.
  const html = useMemo(() => source ? htmlPreviewDocument(source, {
    runtime: true, route: frameRoute,
  }) : null, [source, frameRoute]);
  const dimensions = resolution === 'auto' ? null : PRESETS[resolution];
  const selectedWidth = dimensions?.[0] || 0;
  const selectedHeight = dimensions?.[1] || 0;
  const scale = dimensions
    ? Math.min(viewport.width / selectedWidth, viewport.height / selectedHeight, 1)
    : 1;
  const safeScale = Math.max(0.05, scale);
  const phoneScale = Math.min(1,
    Math.max(.05, (viewport.width - 24) / 340),
    Math.max(.05, (viewport.height - 24) / 700));
  const frameStyle: CSSProperties = dimensions
    ? {
      position: 'absolute', width: selectedWidth, height: selectedHeight,
      transformOrigin: 'top left', transform: 'scale(' + safeScale + ')',
      left: Math.max(0, (viewport.width - selectedWidth * safeScale) / 2),
      top: Math.max(0, (viewport.height - selectedHeight * safeScale) / 2),
    }
    : { width: '100%', height: '100%' };

  function sendSettings() {
    iframe.current?.contentWindow?.postMessage({ type: 'flow-runtime-settings', fps: fpsLimit, phone }, '*');
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    dragging.current = { x: event.clientX, left };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging.current) return;
    const max = Math.max(8, window.innerWidth - (expanded ? 252 : 170) - 8);
    setLeft(Math.max(8, Math.min(max, dragging.current.left + event.clientX - dragging.current.x)));
  }
  function stopDrag() { dragging.current = null; }
  useEffect(() => { sendSettings(); }, [fpsLimit, html, phone, reload]);

  const frame = html && <iframe key={frameRoute + ':' + reload}
    ref={iframe} title={title} srcDoc={html}
    sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads allow-modals"
    referrerPolicy="no-referrer" style={phone
      ? { width: 306, height: 623 }
      : frameStyle} onLoad={sendSettings} />;

  return <main className="html-play-page" data-glass={glass} aria-label="Full HTML preview">
    <div className="html-play-surface" ref={surface}>
      {error ? <div className="html-play-error" role="alert">
        <strong>Page unavailable</strong><span>{error}</span>
        <a href="/">Back to editor</a>
      </div> : !html ? <div className="html-play-loading" role="status">Opening HTML…</div>
        : phone
          ? <div className="html-play-phone">
              <div className="html-iphone-stage" style={{
                width: 340 * phoneScale, height: 700 * phoneScale,
              }}>
                <div style={{ width: 340, height: 700, transformOrigin: 'top left',
                  transform: 'scale(' + phoneScale + ')' }}>
                  <IPhoneFrame isDark={glass === 'dark'}>{frame}</IPhoneFrame>
                </div>
              </div>
            </div>
          : frame}
    </div>
    {controlsVisible && <div className="html-play-chrome" style={{ left }}>
      <motion.div className="html-play-compact"
        initial={reduce ? false : { opacity: 0, y: -8, scale: .96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduce ? 0 : .25, ease: [0.22, 1, 0.36, 1] }}>
        <motion.button type="button" className="html-play-drag"
          title="Drag controls horizontally" aria-label="Drag controls"
          onPointerDown={startDrag} onPointerMove={moveDrag}
          onPointerUp={stopDrag} onPointerCancel={stopDrag}
          whileTap={reduce ? undefined : { scale: .92 }} transition={spring}>
          <HugeiconsIcon icon={DragDropVerticalIcon} size={16} strokeWidth={1.7} />
        </motion.button>
        <motion.button type="button" className="html-play-toggle"
          aria-label={expanded ? 'Collapse runtime controls' : 'Expand runtime controls'}
          aria-expanded={expanded} onClick={() => setExpanded(current => !current)}
          whileHover={reduce ? undefined : { scale: 1.025 }}
          whileTap={reduce ? undefined : { scale: .96 }} transition={spring}>
          <span className="html-play-led" />
          <span>{observedFps === null ? 'HTML' : observedFps + ' FPS'}</span>
          <motion.span className="html-play-chevron" animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: reduce ? 0 : .2, ease: [0.22, 1, 0.36, 1] }}>
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={1.7} />
          </motion.span>
        </motion.button>
        <motion.button type="button" className="html-play-hide"
          title="Hide controls (Ctrl/⌘ Shift H)" aria-label="Hide runtime controls"
          onClick={() => setControlsVisible(false)}
          whileHover={reduce ? undefined : { scale: 1.075 }}
          whileTap={reduce ? undefined : { scale: .9 }} transition={spring}>
          <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
        </motion.button>
      </motion.div>
      <AnimatePresence initial={false}>
        {expanded && <motion.div className="html-play-panel"
          initial={reduce ? false : { opacity: 0, y: -8, scale: .97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0, transition: { duration: 0 } } :
            { opacity: 0, y: -6, scale: .985 }}
          transition={{ duration: reduce ? 0 : .23, ease: [0.22, 1, 0.36, 1] }}>
          <div className="html-play-device-switch" role="group" aria-label="Device preview">
            <motion.button type="button" aria-pressed={!phone} onClick={() => setPhone(false)}
              whileTap={reduce ? undefined : { scale: .97 }}
              whileHover={reduce ? undefined : { y: -1 }} transition={spring}>
              <HugeiconsIcon icon={ComputerIcon} size={16} strokeWidth={1.6} /> Desktop
            </motion.button>
            <motion.button type="button" aria-pressed={Boolean(phone)}
              onClick={() => setPhone(true)}
              whileTap={reduce ? undefined : { scale: .97 }}
              whileHover={reduce ? undefined : { y: -1 }} transition={spring}>
              <HugeiconsIcon icon={SmartPhone01Icon} size={16} strokeWidth={1.6} /> iPhone
            </motion.button>
          </div>
          {!phone && <RuntimeSelect label="Resolution" value={resolution}
            options={DESKTOP_OPTIONS} onChange={setResolution} />}
          <RuntimeSelect label="Frame rate" value={fpsLimit} options={FPS_OPTIONS}
            onChange={setFpsLimit} />
          <div className="html-play-panel-actions">
            <motion.button type="button"
              onClick={() => { setObservedFps(null); setReload(value => value + 1); }}
              whileTap={reduce ? undefined : { scale: .95 }}
              whileHover={reduce ? undefined : { y: -1 }} transition={spring}>
              <HugeiconsIcon icon={ReloadIcon} size={15} strokeWidth={1.65} /> Reload
            </motion.button>
            <motion.button type="button"
              onClick={() => void document.documentElement.requestFullscreen?.()}
              whileTap={reduce ? undefined : { scale: .95 }}
              whileHover={reduce ? undefined : { y: -1 }} transition={spring}>
              <HugeiconsIcon icon={Maximize01Icon} size={15} strokeWidth={1.65} /> Fullscreen
            </motion.button>
            {LOCAL && <motion.a href="/"
              whileTap={reduce ? undefined : { scale: .95 }}
              whileHover={reduce ? undefined : { y: -1 }} transition={spring}>
              <HugeiconsIcon icon={ArrowLeft01Icon} size={15} strokeWidth={1.65} /> Editor
            </motion.a>}
          </div>
        </motion.div>}
      </AnimatePresence>
    </div>}
    <span className="html-play-accessible-route" aria-live="polite">{routePath === '/' ? '' : routePath}</span>
  </main>;
}
