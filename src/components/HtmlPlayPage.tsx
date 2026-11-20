import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { htmlPreviewDocument } from '../lib/htmlPreview';
import { loadDoc } from '../lib/store';
import { isHtmlPage } from '../lib/siteHosting';

type Resolution = 'auto' | '1920x1080' | '1280x720' | '800x600';
type IPhoneModel = 'iphone16' | 'iphone16pro' | 'iphone17pro' | 'iphone17promax';
const IPHONES: Record<IPhoneModel, { name: string; width: number; height: number }> = {
  iphone16: { name: 'iPhone 16', width: 393, height: 852 },
  iphone16pro: { name: 'iPhone 16 Pro', width: 402, height: 874 },
  iphone17pro: { name: 'iPhone 17 Pro', width: 402, height: 874 },
  iphone17promax: { name: 'iPhone 17 Pro Max', width: 440, height: 956 },
};
const PRESETS: Record<Exclude<Resolution, 'auto'>, [number, number]> = {
  '1920x1080': [1920, 1080], '1280x720': [1280, 720], '800x600': [800, 600],
};
const PATH = window.location.pathname.split('/').filter(Boolean);
const LOCAL = PATH[0] === 'play' && PATH[1] === 'local';
const ID = LOCAL ? PATH[2] || '' : PATH[1] || '';
const FIRST_ROUTE = LOCAL ? '/' : '/' + PATH.slice(2).join('/');

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
function ScreenIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true"><rect x="2.5" y="3.5" width="19" height="14" rx="2.5" />
    <path d="M8 21h8M12 17.5V21" /></svg>;
}
function PhoneIcon() {
  // Matching the rounded rectangular frame of the supplied iPhone SVG.
  return <svg width="13" height="17" viewBox="0 0 20 28" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
    aria-hidden="true"><rect x="1.7" y="1.7" width="16.6" height="24.6" rx="4.1" />
    <rect x="7" y="3.3" width="6" height="2.4" rx="1.2" fill="currentColor" stroke="none" /></svg>;
}

export default function HtmlPlayPage() {
  const [source, setSource] = useState<string | null>(null);
  const [title, setTitle] = useState('HTML preview');
  const [error, setError] = useState('');
  const [routePath, setRoutePath] = useState(FIRST_ROUTE);
  const [frameRoute, setFrameRoute] = useState(FIRST_ROUTE);
  const [resolution, setResolution] = useState<Resolution>('auto');
  const [phone, setPhone] = useState<IPhoneModel | null>(null);
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
      if (event.data.type === 'flow-runtime-fps' && Number.isFinite(event.data.fps)) {
        setObservedFps(Math.min(1000, Math.max(0, Math.round(event.data.fps))));
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

  // Keep the HTML opaque-origin and outside the React tree. Device profiles
  // use actual iframe layout viewport widths; CSS media queries reflow at
  // 393/402/440px rather than stretching an image of a desktop page.
  const html = useMemo(() => source ? htmlPreviewDocument(source, {
    runtime: true, route: frameRoute,
  }) : null, [source, frameRoute]);
  const dimensions = phone ? [IPHONES[phone].width, IPHONES[phone].height]
    : resolution === 'auto' ? null : PRESETS[resolution];
  const selectedWidth = dimensions?.[0] || 0;
  const selectedHeight = dimensions?.[1] || 0;
  const bezel = 14;
  const shellWidth = selectedWidth + bezel * 2;
  const shellHeight = selectedHeight + bezel * 2;
  const scale = dimensions
    ? Math.min((viewport.width - (phone ? 24 : 0)) / (phone ? shellWidth : selectedWidth),
      (viewport.height - (phone ? 24 : 0)) / (phone ? shellHeight : selectedHeight), 1)
    : 1;
  const safeScale = Math.max(0.05, scale);
  const frameStyle: CSSProperties = dimensions
    ? {
      position: 'absolute', width: selectedWidth, height: selectedHeight,
      transformOrigin: 'top left', transform: 'scale(' + safeScale + ')',
      left: Math.max(0, (viewport.width - selectedWidth * safeScale) / 2),
      top: Math.max(0, (viewport.height - selectedHeight * safeScale) / 2),
    }
    : { width: '100%', height: '100%' };

  function sendSettings() {
    iframe.current?.contentWindow?.postMessage({ type: 'flow-runtime-settings', fps: fpsLimit }, '*');
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    dragging.current = { x: event.clientX, left };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging.current) return;
    const max = Math.max(8, window.innerWidth - (expanded ? 268 : 170) - 8);
    setLeft(Math.max(8, Math.min(max, dragging.current.left + event.clientX - dragging.current.x)));
  }
  function stopDrag() { dragging.current = null; }
  useEffect(() => { sendSettings(); }, [fpsLimit, html, phone, reload]);

  const frame = html && <iframe key={frameRoute + ':' + reload}
    ref={iframe} title={title} srcDoc={html}
    sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads allow-modals"
    referrerPolicy="no-referrer" style={phone
      ? { width: selectedWidth, height: selectedHeight }
      : frameStyle} onLoad={sendSettings} />;

  return <main className="html-play-page" aria-label="Full HTML preview">
    <div className="html-play-surface" ref={surface}>
      {error ? <div className="html-play-error" role="alert">
        <strong>Page unavailable</strong><span>{error}</span>
        <a href="/">Back to editor</a>
      </div> : !html ? <div className="html-play-loading" role="status">Opening HTML…</div>
        : phone
          ? <div className="html-play-phone">
              <div className="html-play-device" style={{
                width: shellWidth, height: shellHeight, transform: 'scale(' + safeScale + ')',
              }}>
                <div className="html-play-device-screen" style={{
                  left: bezel, top: bezel, width: selectedWidth, height: selectedHeight,
                }}>{frame}</div>
                <svg className="html-play-device-bezel"
                  width={shellWidth} height={shellHeight}
                  viewBox={'0 0 ' + shellWidth + ' ' + shellHeight}
                  aria-hidden="true">
                  <rect fill="transparent" x="3" y="3"
                    width={shellWidth - 6} height={shellHeight - 6}
                    rx="55" ry="55" stroke="#29292b" strokeWidth="5" />
                </svg>
                <div className="html-play-device-island" aria-hidden="true">
                  <i className="html-play-device-camera" />
                </div>
              </div>
            </div>
          : frame}
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
        <div className="html-play-device-switch" role="group" aria-label="Device preview">
          <button type="button" aria-pressed={!phone} onClick={() => setPhone(null)}>
            <ScreenIcon /> Desktop
          </button>
          <button type="button" aria-pressed={Boolean(phone)}
            onClick={() => setPhone(current => current || 'iphone17pro')}>
            <PhoneIcon /> iPhone
          </button>
        </div>
        {phone
          ? <label>iPhone model
              <select aria-label="iPhone model" value={phone}
                onChange={event => setPhone(event.target.value as IPhoneModel)}>
                {Object.entries(IPHONES).map(([id, profile]) => <option value={id} key={id}>
                  {profile.name} · {profile.width} × {profile.height}
                </option>)}
              </select>
            </label>
          : <label>Desktop resolution
              <select value={resolution} onChange={event => setResolution(event.target.value as Resolution)}>
                <option value="auto">Auto · Fill window</option>
                <option value="1920x1080">1920 × 1080</option>
                <option value="1280x720">1280 × 720</option>
                <option value="800x600">800 × 600</option>
              </select>
            </label>}
        <label>Frame rate cap
          <select value={fpsLimit} onChange={event => setFpsLimit(Number(event.target.value))}>
            <option value={0}>Auto · Display refresh</option>
            <option value={30}>30 FPS</option>
            <option value={60}>60 FPS</option>
            <option value={120}>120 FPS</option>
          </select>
        </label>
        <div className="html-play-caption">{phone
          ? 'CSS viewport is genuine. Safari engine, DPR, touch hardware and iOS APIs are not emulated.'
          : 'Measured animation callbacks. Actual GPU frame rate depends on device and browser.'}</div>
        <div className="html-play-panel-actions">
          <button type="button" onClick={() => { setObservedFps(null); setReload(value => value + 1); }}>Reload</button>
          <button type="button" onClick={() => void document.documentElement.requestFullscreen?.()}>Fullscreen</button>
          {LOCAL && <a href="/">Editor</a>}
        </div>
        <div className="html-play-caption">Ctrl/⌘ Shift H restores hidden controls.</div>
      </div>}
    </div>}
    <span className="html-play-accessible-route" aria-live="polite">{routePath === '/' ? '' : routePath}</span>
  </main>;
}
