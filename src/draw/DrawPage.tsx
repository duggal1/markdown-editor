import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react';
import { createImageZip, type ZipEntry } from './zip';
import { drawAnnotation, renderExport, type Annotation, type ArrowAnnotation, type OutputFormat, type Point, type TextAnnotation } from './annotations';
import './draw.css';

type ImageItem = { id: string; name: string; file: File; url: string };
type Drawing = { pointerId: number; imageId: string; arrow: ArrowAnnotation };
type TextDraft = { imageId: string; x: number; y: number; color: string; value: string };
type Tool = 'arrow' | 'text';

const COLORS = ['#fb7185', '#fbbf24', '#60a5fa', '#a3e635', '#c4b5fd', '#fafaf9'];
const clamp = (n: number) => Math.max(0, Math.min(1, n));

function point(event: PointerEvent<HTMLCanvasElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width),
    y: clamp((event.clientY - bounds.top) / bounds.height),
  };
}

function filename(project: string, index: number, format: OutputFormat) {
  const safe = project.trim().replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').slice(0, 90) || 'Screenshots';
  return safe + ' ' + (index + 1) + (format === 'webp' ? '.webp' : '.jpg');
}

function initialName(): string {
  try { return localStorage.getItem('flow.draw.project.v1') || 'Flow'; }
  catch { return 'Flow'; }
}

export default function DrawPage() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [index, setIndex] = useState(0);
  const [annotations, setAnnotations] = useState<Record<string, Annotation[]>>({});
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState(COLORS[0]);
  const [format, setFormat] = useState<OutputFormat>('webp');
  const [projectName, setProjectName] = useState(initialName);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);

  const input = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const urls = useRef<string[]>([]);
  const paintFrame = useRef<number | null>(null);
  const drawn = useRef<Drawing | null>(null);
  const draftArrow = useRef<ArrowAnnotation | null>(null);
  const annotationsRef = useRef(annotations);
  const active = images[index] || null;
  const activeRef = useRef<ImageItem | null>(null);
  const downloaded = useRef(false);
  activeRef.current = active;

  useEffect(() => {
    const old = document.title;
    document.title = 'Draw · Flow';
    return () => { document.title = old; };
  }, []);
  useEffect(() => {
    try { localStorage.setItem('flow.draw.project.v1', projectName); }
    catch { /* storage is optional; naming still works within the session */ }
  }, [projectName]);
  useEffect(() => () => {
    if (paintFrame.current !== null) cancelAnimationFrame(paintFrame.current);
    urls.current.forEach(url => URL.revokeObjectURL(url));
  }, []);
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (downloaded.current || urls.current.length === 0) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    if (textDraft) textInput.current?.focus();
  }, [textDraft?.imageId, textDraft?.x, textDraft?.y]);

  const paint = useCallback(() => {
    const element = canvas.current;
    const bounds = frame.current;
    if (!element || !bounds) return;
    const width = bounds.clientWidth;
    const height = bounds.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (element.width !== pixelWidth || element.height !== pixelHeight) {
      element.width = pixelWidth;
      element.height = pixelHeight;
    }
    const ctx = element.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const image = activeRef.current;
    if (!image) return;
    for (const item of annotationsRef.current[image.id] || []) {
      drawAnnotation(ctx, item, width, height);
    }
    if (draftArrow.current && drawn.current?.imageId === image.id) {
      drawAnnotation(ctx, draftArrow.current, width, height);
    }
  }, []);

  const requestPaint = useCallback(() => {
    if (paintFrame.current !== null) return;
    paintFrame.current = requestAnimationFrame(() => {
      paintFrame.current = null;
      paint();
    });
  }, [paint]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(requestPaint);
    observer.observe(element);
    requestPaint();
    return () => observer.disconnect();
  }, [active?.id, requestPaint]);

  function updateAnnotations(next: Record<string, Annotation[]>) {
    annotationsRef.current = next;
    setAnnotations(next);
    downloaded.current = false;
    requestPaint();
  }

  function commitText() {
    const item = textDraft;
    if (!item) return;
    setTextDraft(null);
    const value = item.value.trim().slice(0, 240);
    if (!value) return;
    const annotation: TextAnnotation = {
      kind: 'text', color: item.color, x: item.x, y: item.y, text: value,
    };
    updateAnnotations({
      ...annotationsRef.current,
      [item.imageId]: [...(annotationsRef.current[item.imageId] || []), annotation],
    });
  }

  function select(nextIndex: number) {
    commitText();
    drawn.current = null;
    draftArrow.current = null;
    setIndex(nextIndex);
    requestPaint();
  }

  function addFiles(files: FileList | File[]) {
    const accepted = Array.from(files).filter(file =>
      file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(file.name));
    if (!accepted.length) { setError('Choose an image file to continue.'); return; }
    const next = accepted.map(file => {
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      return { id: crypto.randomUUID(), name: file.name, file, url };
    });
    setImages(existing => [...existing, ...next]);
    downloaded.current = false;
    setError('');
  }

  function upload(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    const item = activeRef.current;
    if (!item || drawn.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    const pos = point(event);
    if (tool === 'text') {
      if (textDraft) commitText();
      setTextDraft({ imageId: item.id, ...pos, color, value: '' });
      return;
    }
    if (textDraft) commitText();
    const arrow: ArrowAnnotation = {
      kind: 'arrow', color, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y,
    };
    drawn.current = { pointerId: event.pointerId, imageId: item.id, arrow };
    draftArrow.current = arrow;
    event.currentTarget.setPointerCapture(event.pointerId);
    requestPaint();
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    const current = drawn.current;
    if (!current || current.pointerId !== event.pointerId ||
      current.imageId !== activeRef.current?.id) return;
    const pos = point(event);
    draftArrow.current = { ...current.arrow, x2: pos.x, y2: pos.y };
    requestPaint();
  }

  function finish(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
    const current = drawn.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drawn.current = null;
    const pos = point(event);
    const arrow: ArrowAnnotation = { ...current.arrow, x2: pos.x, y2: pos.y };
    draftArrow.current = null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const length = Math.hypot((arrow.x2 - arrow.x1) * bounds.width,
      (arrow.y2 - arrow.y1) * bounds.height);
    if (!cancelled && length >= 7 && current.imageId === activeRef.current?.id) {
      updateAnnotations({
        ...annotationsRef.current,
        [current.imageId]: [...(annotationsRef.current[current.imageId] || []), arrow],
      });
    }
    requestPaint();
  }

  function undo() {
    if (!active) return;
    commitText();
    const existing = annotationsRef.current[active.id] || [];
    if (existing.length) updateAnnotations({
      ...annotationsRef.current, [active.id]: existing.slice(0, -1),
    });
  }

  function clear() {
    if (!active) return;
    setTextDraft(null);
    updateAnnotations({ ...annotationsRef.current, [active.id]: [] });
  }

  async function download() {
    if (!images.length || busy) return;
    commitText();
    setBusy(true);
    setError('');
    try {
      const entries: ZipEntry[] = [];
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        setProgress('Exporting ' + (i + 1) + ' / ' + images.length);
        const file = await renderExport(image.url, annotationsRef.current[image.id] || [], format);
        entries.push({ name: filename(projectName, i, format), file });
      }
      setProgress('Packing ZIP…');
      const zip = await createImageZip(entries);
      const url = URL.createObjectURL(zip);
      const link = document.createElement('a');
      link.href = url;
      link.download = (projectName.trim().replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').slice(0, 90) ||
        'Screenshots') + ' screenshots.zip';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      downloaded.current = true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export these screenshots.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  const count = active ? (annotations[active.id] || []).length : 0;
  return <div className="draw-page">
    <header className="draw-header">
      <div className="draw-heading">
        <a href="/" className="draw-back" aria-label="Back to Flow">←</a>
        <span className="draw-wordmark">Draw</span>
        <span className="draw-heading-separator" aria-hidden="true" />
        <label className="draw-project-label" htmlFor="draw-project">Project</label>
        <input id="draw-project" className="draw-project-input" value={projectName}
          maxLength={90} spellCheck={false} aria-label="Project name for screenshot export"
          onChange={event => { setProjectName(event.target.value); downloaded.current = false; }}
          placeholder="Flow" />
      </div>
      <div className="draw-header-actions">
        <input ref={input} className="draw-file-input" type="file"
          accept="image/*,.svg" multiple onChange={upload} aria-label="Upload images" />
        <button className="draw-button" type="button" onClick={() => input.current?.click()}>
          Add images
        </button>
        <button className="draw-button draw-button-primary" type="button"
          disabled={!images.length || busy} onClick={() => { void download(); }}>
          {busy ? progress || 'Exporting…' : 'Download ZIP'}
        </button>
      </div>
    </header>

    <main className="draw-layout" onDragOver={event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }} onDrop={(event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setOver(false);
      if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
    }} onDragEnter={event => {
      if (event.dataTransfer.types.includes('Files')) setOver(true);
    }} onDragLeave={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false);
    }}>
      <aside className="draw-rail" aria-label="Uploaded screenshots">
        <div className="draw-rail-heading">Screenshots <span>{images.length}</span></div>
        <div className="draw-image-list">
          {images.map((item, i) => <button type="button" key={item.id}
            className={'draw-image-item' + (index === i ? ' is-selected' : '')}
            onClick={() => select(i)} aria-current={index === i ? 'true' : undefined}
            title={item.name}>
            <img src={item.url} alt="" loading="lazy" />
            <span className="draw-image-item-info">
              <span className="draw-image-item-name">{projectName.trim() || 'Screenshots'} {i + 1}</span>
              <span className="draw-image-item-count">{(annotations[item.id] || []).length} note{(annotations[item.id] || []).length === 1 ? '' : 's'}</span>
            </span>
            <span className="draw-image-item-number">{String(i + 1).padStart(2, '0')}</span>
          </button>)}
          {!images.length && <span className="draw-rail-empty">No screenshots yet.</span>}
        </div>
      </aside>

      <section className="draw-workspace" aria-label="Annotate screenshot">
        <div className="draw-toolbar">
          <div className="draw-tools" role="group" aria-label="Annotation tool">
            <button type="button" className={'draw-tool' + (tool === 'arrow' ? ' is-active' : '')}
              aria-pressed={tool === 'arrow'}
              onClick={() => { commitText(); setTool('arrow'); }}>↗ <span>Arrow</span></button>
            <button type="button" className={'draw-tool' + (tool === 'text' ? ' is-active' : '')}
              aria-pressed={tool === 'text'} onClick={() => setTool('text')}>
              T <span>Text</span></button>
          </div>
          <div className="draw-swatches" role="group" aria-label="Annotation color">
            {COLORS.map(c => <button key={c} type="button"
              className={'draw-swatch' + (color === c ? ' is-active' : '')}
              style={{ background: c }} aria-label={'Use ' + c} aria-pressed={color === c}
              onClick={() => setColor(c)} />)}
            <label className="draw-custom-color" title="Custom annotation color">
              <input type="color" aria-label="Custom annotation color" value={color}
                onChange={event => setColor(event.target.value)} />
            </label>
          </div>
          <div className="draw-format" role="group" aria-label="Export format">
            <button type="button" aria-pressed={format === 'webp'}
              className={format === 'webp' ? 'is-active' : ''}
              onClick={() => setFormat('webp')}>WebP</button>
            <button type="button" aria-pressed={format === 'jpeg'}
              className={format === 'jpeg' ? 'is-active' : ''}
              onClick={() => setFormat('jpeg')}>JPEG</button>
          </div>
        </div>
        <div className="draw-subbar">
          <div className="draw-navigation">
            <button type="button" className="draw-button" disabled={index === 0 || !images.length}
              onClick={() => select(index - 1)}>Previous</button>
            <span className="draw-pagination">{images.length ? index + 1 : 0} / {images.length}</span>
            <button type="button" className="draw-button"
              disabled={!images.length || index === images.length - 1}
              onClick={() => select(index + 1)}>Next</button>
          </div>
          <div className="draw-edit-actions">
            <span className="draw-arrow-count">{count} note{count === 1 ? '' : 's'}</span>
            <button type="button" className="draw-text-button" disabled={!count}
              onClick={undo}>Undo</button>
            <button type="button" className="draw-text-button"
              disabled={!count && !textDraft} onClick={clear}>Clear</button>
          </div>
        </div>

        <div className={'draw-stage' + (over ? ' is-drop-target' : '')}>
          {active ? <div className="draw-image-frame" ref={frame} key={active.id}>
            <img src={active.url} alt={active.name} draggable={false} onLoad={requestPaint} />
            <canvas ref={canvas}
              aria-label={tool === 'arrow' ? 'Drag to draw an arrow' : 'Tap to add text'}
              onPointerDown={start} onPointerMove={move}
              onPointerUp={event => finish(event)}
              onPointerCancel={event => finish(event, true)} />
            {textDraft?.imageId === active.id && <textarea ref={textInput}
              className="draw-inline-text" aria-label="Screenshot annotation text"
              placeholder="Describe the issue…"
              maxLength={240} rows={2} value={textDraft.value}
              style={{ left: Math.min(70, textDraft.x * 100) + '%',
                top: Math.min(82, textDraft.y * 100) + '%',
                borderColor: textDraft.color }}
              onChange={event => setTextDraft(previous => previous
                ? { ...previous, value: event.target.value } : previous)}
              onKeyDown={event => {
                if (event.key === 'Escape') { event.preventDefault(); setTextDraft(null); }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault(); commitText();
                }
              }}
              onBlur={commitText} />}
          </div> : <button type="button" className="draw-empty"
            onClick={() => input.current?.click()}>
            <span className="draw-empty-mark">↗</span>
            <span>Drop screenshots here, or select files</span>
            <span className="draw-empty-hint">
              Point to a UI issue, describe it, and send the exported screenshots to your coding agent.
            </span>
          </button>}
        </div>
        <footer className="draw-footer">
          <span>{tool === 'arrow' ? 'Drag from an issue to the exact element.' :
            'Tap to place text. Enter saves; Shift+Enter adds a line.'}</span>
          <span>{format === 'webp' ? 'WebP' : 'JPEG'} · {projectName.trim() || 'Screenshots'} 1–{images.length}</span>
        </footer>
        {error && <div className="draw-error" role="alert">{error}
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button>
        </div>}
      </section>
    </main>
  </div>;
}
