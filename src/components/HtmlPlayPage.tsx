import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { htmlPreviewDocument } from '../lib/htmlPreview';
import { loadDoc } from '../lib/store';
import { isHtmlPage } from '../lib/siteHosting';

type Resolution = 'auto' | '1920x1080' | '1280x720' | '800x600' | '390x844';
const ROUTE = window.location.pathname.split('/').filter(Boolean);
const LOCAL = ROUTE[0] === 'play' && ROUTE[1] === 'local';
const ID = LOCAL ? ROUTE[2] || '' : ROUTE[1] || '';
const initialRoute = LOCAL ? '/' : '/' + ROUTE.slice(2).join('/');
const presets: Record<Exclude<Resolution, 'auto'>, [number, number]> = {
  '1920x1080': [1920, 1080], '1280x720': [1280, 720],
  '800x600': [800, 600], '390x844': [390, 844],
};
function currentRoute(): string {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return LOCAL ? '/' : '/' + parts.slice(2).join('/');
}
function safeRoute(value: string): string | null {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin || parsed.pathname.startsWith('/api/')) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return null; }
}

export default function HtmlPlayPage() {
  const [source, setSource] = useState<string | null>(null);
  const [title, setTitle] = useState('HTML preview');
  const [error, setError] = useState('');
  const [routePath, setRoutePath] = useState(initialRoute);
  const [frameRoute, setFrameRoute] = useState(initialRoute);
  const [resolution, setResolution] = useState<Resolution>('auto');
  const [fpsLimit, setFpsLimit] = useState(0);
  const [observedFps, setObservedFps] = useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [left, setLeft] = useState(14);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const iframe = useRef<HTMLIFrameElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ x: number; left: number } | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        if (LOCAL) {
          const document = await loadDoc(ID);
          if (!document || !isHtmlPage(document)) throw new Error('This HTML page is not available on this device.');
          if (active) {
            setSource(document.markdown);
            setTitle(document.title || 'HTML preview');
            window.document.title = (document.title || 'HTML preview') + ' · Flow';
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
      setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || !event.data) return;
      if (event.data.type === 'flow-runtime-fps' && Number.isFinite(event.data.fps)) {
        setObservedFps(Math.min(1000, Math.max(0, Math.round(event.data.fps))));
      } else if (event.data.type === 'flow-runtime-toggle') {
        setControlsVisible(previous => !previous);
      } else if (event.data.type === 'flow-runtime-route' && !LOCAL) {
        const route = safeRoute(event.data.path);
        if (!route) return;
        const next = '/slug/' + ID + (route === '/' ? '/' : route);
        if (next === window.location.pathname + window.location.search + window.location.hash) return;
        window.history.pushState(null, '', next);
        setRoutePath(route);
        if (!event.data.soft) setFrameRoute(route);
      }
    };
    const onPopState = () => {
      const route = currentRoute();
      setRoutePath(route);
      iframe.current?.contentWindow?.postMessage({
        type: 'flow-runtime-popstate', path: route,
      }, '*');
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

  // The source is not parsed into a React tree; browsers handle the HTML in an
  // isolated iframe and the browser controls GPU/VRAM allocation.
  const html = useMemo(() => source ? htmlPreviewDocument(source, {
    runtime: true, route: frameRoute,
  }) : null, [source, frameRoute]);
  const dimensions = resolution === 'auto' ? null : presets[resolution];
  const scale = dimensions
    ? Math.min(viewport.width / dimensions[0], viewport.height / dimensions[1], 1)
    : 1;
  const width = dimensions ? dimensions[0] * scale : viewport.width;
  const height = dimensions ? dimensions[1] * scale : viewport.height;
  const frameStyle: React.CSSProperties = dimensions
    ? {
      position: 'absolute', width: dimensions[0], height: dimensions[1],
      transformOrigin: 'top left',
      transform: 'scale(' + scale + ')',
      left: Math.max(0, (viewport.width - width) / 2),
      top: Math.max(0, (viewport.height - height) / 2),
    } : { width: '100%', height: '100%' };
  function settings() {
    iframe.current?.contentWindow?.postMessage({ type: 'flow-runtime-settings', fps: fpsLimit }, '*');
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    dragging.current = { x: event.clientX, left };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging.current) return;
    const max = Math.max(8, window.innerWidth - (expanded ? 266 : 170) - 8);
    setLeft(Math.max(8, Math.min(max, dragging.current.left + event.clientX - dragging.current.x)));
  }
  function stopDrag() { dragging.current = null; }
  useEffect(() => { settings(); }, [fpsLimit, html]);

  return <main className="html-play-page" aria-label="Full HTML preview">
    <div className="html-play-surface" ref={surface}>
      {error ? <div className="html-play-error" role="alert">
        <strong>Page unavailable</strong><span>{error}</span>
        <a href="/">Back to editor</a>
      </div> : !html ? <div className="html-play-loading" role="status">Opening HTML…</div>
        : <iframe key={frameRoute} ref={iframe} title={title} srcDoc={html}
            sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads allow-modals"
            referrerPolicy="no-referrer" style={frameStyle} onLoad={settings} />}
    </div>
    {controlsVisible && <div className="html-play-chrome" style={{ left }}>
      <div className="html-play-compact">
        <button type="button" className="html-play-drag" title="Drag controls horizontally"
          aria-label="Drag controls" onPointerDown={startDrag} onPointerMove={moveDrag}
          onPointerUp={stopDrag} onPointerCancel={stopDrag}>
          <span aria-hidden="true">⠿</span>
        </button>
        <button type="button" className="html-play-toggle"
          aria-label={expanded ? 'Collapse runtime controls' : 'Expand runtime controls'}
          aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          <span className="html-play-led" />
          <span>{observedFps === null ? 'HTML' : observedFps + ' FPS'}</span>
          <span className="html-play-chevron">{expanded ? '⌃' : '⌄'}</span>
        </button>
        <button type="button" className="html-play-hide" title="Hide all controls (Ctrl/⌘ Shift H)"
          aria-label="Hide runtime controls" onClick={() => setControlsVisible(false)}>×</button>
      </div>
      {expanded && <div className="html-play-panel">
        <div className="html-play-panel-heading">Runtime</div>
        <label>Resolution
          <select value={resolution} onChange={event => setResolution(event.target.value as Resolution)}>
            <option value="auto">Auto · Fill window</option>
            <option value="1920x1080">1920 × 1080</option>
            <option value="1280x720">1280 × 720</option>
            <option value="800x600">800 × 600</option>
            <option value="390x844">390 × 844</option>
          </select>
        </label>
        <label>Frame rate cap
          <select value={fpsLimit} onChange={event => setFpsLimit(Number(event.target.value))}>
            <option value={0}>Auto · Display refresh</option>
            <option value={30}>30 FPS</option>
            <option value={60}>60 FPS</option>
            <option value={120}>120 FPS</option>
          </select>
        </label>
        <div className="html-play-caption">Measured browser frames · actual rendering depends on your device.</div>
        <div className="html-play-panel-actions">
          <button type="button" onClick={() => iframe.current?.contentWindow?.location.reload()}>Reload</button>
          <button type="button" onClick={() => void document.documentElement.requestFullscreen?.()}>Fullscreen</button>
          {LOCAL && <a href="/">Editor</a>}
        </div>
        <div className="html-play-caption">Ctrl/⌘ Shift H toggles this panel when hidden.</div>
      </div>}
    </div>}
    <span className="html-play-accessible-route" aria-live="polite">{routePath === '/' ? '' : routePath}</span>
  </main>;
}
