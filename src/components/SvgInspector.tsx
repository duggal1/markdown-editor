import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons';
import { openColorPopover } from '../lib/colorPopover';
import { replaceSvgColor, svgPalette, type SvgColor } from '../lib/svgPalette';
import { exportSvgPng, svgArtworks, svgPreviewDocument, type SvgBackground } from '../lib/svgPreview';

const zoomLevels = [25, 50, 75, 100, 125, 150, 200, 300, 400];
export function SvgInspector({ source, theme, onEdit }: {
  source: string; theme: 'light' | 'dark'; onEdit?: (next: string) => boolean;
}) {
  const [zoom, setZoom] = useState(100);
  const [background, setBackground] = useState<SvgBackground>('auto');
  const [scale, setScale] = useState(1);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const effectiveTheme = background === 'white' ? 'light' : background === 'black' ? 'dark' : theme;
  const actual = draft ?? source;
  const art = useMemo(() => svgArtworks(source, effectiveTheme), [source, effectiveTheme]);
  const colors = useMemo(() => svgPalette(source), [source]);
  const documentHtml = useMemo(() => svgPreviewDocument(actual, effectiveTheme, zoom), [actual, effectiveTheme, zoom]);
  const width = art.reduce((max,a) => Math.max(max,a.width), 0);
  const height = art.reduce((sum,a) => sum + a.height, 0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; cleanup.current?.(); }; }, []);
  useEffect(() => { cleanup.current?.(); setDraft(null); setError(''); }, [source]);
  const adjust = (step: number) => setZoom(value => zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, zoomLevels.indexOf(value) + step))]);

  function pick(anchor: HTMLElement, color: SvgColor) {
    cleanup.current?.();
    setError('');
    let next = source;
    const close = (commit = false) => {
      panel.current?.remove(); panel.current = null;
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', cancel);
      cleanup.current = null;
      if (!alive.current) return;
      if (commit && next !== source && onEdit && !onEdit(next)) setError('Source changed. Reopen the color and try again.');
      setDraft(commit && !onEdit ? next : null);
    };
    const cancel = () => close();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target) && !anchor.contains(event.target)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); anchor.focus(); } };
    panel.current = openColorPopover(anchor, color.hex, {
      onChange: value => { next = replaceSvgColor(source, color, value); setDraft(next); return true; },
      onEnter: () => {}, onLeave: () => {}, onDone: () => { close(true); anchor.focus(); },
    });
    cleanup.current = cancel;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', cancel);
  }
  async function download() {
    if (busy || !art.length) return;
    setBusy(true); setError('');
    try {
      const blob = await exportSvgPng(actual, effectiveTheme, background, scale);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'svg-' + width * scale + 'x' + height * scale + '.png';
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'PNG export failed.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <div className="svg-preview">
    <div className="svg-inspector-toolbar">
      <span className="svg-inspector-dimensions" title="Intrinsic SVG size in pixels">{width && height ? width + ' × ' + height : 'SVG'}</span>
      <div className="svg-inspector-actions">
        <div className="svg-inspector-group" role="group" aria-label="Preview zoom">
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => adjust(-1)} disabled={zoom === 25}><Icon name="divider" size={14} /></button>
          <button type="button" className="svg-inspector-zoom" title="Reset zoom" aria-label={'Reset zoom, currently ' + zoom + '%'} onClick={() => setZoom(100)}>{zoom}%</button>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => adjust(1)} disabled={zoom === 400}><Icon name="plus" size={14} /></button>
        </div>
        <div className="svg-inspector-group" role="group" aria-label="Canvas background">
          {(['white','black','transparent'] as const).map(bg => <button key={bg} type="button" title={bg + ' background'} aria-label={bg + ' background'} aria-pressed={background === bg} onClick={() => setBackground(bg)}>
            <span className={'svg-background-chip is-' + bg} />
          </button>)}
          <button type="button" title="Match workspace" aria-label="Match workspace background" aria-pressed={background === 'auto'} onClick={() => setBackground('auto')}>A</button>
        </div>
        <div className="svg-inspector-group" role="group" aria-label="PNG export">
          <select aria-label="PNG resolution multiplier" title="PNG resolution multiplier" value={scale} onChange={e => setScale(Number(e.target.value))}>
            <option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option>
          </select>
          <button type="button" className="svg-inspector-download" title="Download PNG" aria-label="Download PNG" disabled={!art.length || busy} onClick={() => void download()}><Icon name="download" size={14} />{busy ? 'Exporting' : 'PNG'}</button>
        </div>
      </div>
    </div>
    {colors.length > 0 && <div className="svg-inspector-colors" aria-label="SVG colors">
      {colors.map(color => <button type="button" className="svg-inspector-swatch" key={color.hex} disabled={!onEdit} title={color.hex + ' · ' + color.count + ' declarations'} aria-label={'Edit color ' + color.hex} onClick={e => pick(e.currentTarget, color)}>
        <span style={{ backgroundColor: color.hex }} /><span>{color.hex}</span>
      </button>)}
    </div>}
    {error && <div className="svg-inspector-error" role="alert">{error}</div>}
    <div className="svg-inspector-stage" data-background={background}>
      <iframe title="SVG preview" sandbox="" referrerPolicy="no-referrer" srcDoc={documentHtml} />
    </div>
  </div>;
}
