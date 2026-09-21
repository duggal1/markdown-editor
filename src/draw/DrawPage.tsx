import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react';
import { createImageZip, type ZipEntry } from './zip';
import './draw.css';

type Arrow = { x1: number; y1: number; x2: number; y2: number };
type ImageItem = { id: string; name: string; file: File; url: string };
type Drawing = { pointerId: number; imageId: string; arrow: Arrow };

const RED = '#ef4444';
const clamp = (n: number) => Math.min(1, Math.max(0, n));

function drawArrow(ctx: CanvasRenderingContext2D, arrow: Arrow, width: number, height: number) {
  const x1 = arrow.x1 * width;
  const y1 = arrow.y1 * height;
  const x2 = arrow.x2 * width;
  const y2 = arrow.y2 * height;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.min(width, height);
  const thickness = Math.max(2.4, size * 0.004);
  const halo = Math.max(2, thickness * 0.72);
  const head = Math.max(10, size * 0.024);
  const leftX = x2 - head * Math.cos(angle - Math.PI / 6);
  const leftY = y2 - head * Math.sin(angle - Math.PI / 6);
  const rightX = x2 - head * Math.cos(angle + Math.PI / 6);
  const rightY = y2 - head * Math.sin(angle + Math.PI / 6);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = thickness + halo * 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.lineWidth = thickness;
  ctx.strokeStyle = RED;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fillStyle = RED;
  ctx.fill();
  ctx.lineWidth = halo;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

function pointerPoint(event: PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height) };
}

function imageName(file: File, index: number, annotated: boolean) {
  const safe = file.name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'image';
  const name = annotated ? safe.replace(/\.[^.]+$/, '') + '.png' : safe;
  return String(index + 1).padStart(3, '0') + '-' + name;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Image could not be decoded.');
  return image;
}

async function exportImage(item: ImageItem, arrows: Arrow[]): Promise<Blob> {
  if (!arrows.length) return item.file;
  const image = await loadImage(item.url);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not start the image exporter.');
  ctx.drawImage(image, 0, 0);
  for (const arrow of arrows) drawArrow(ctx, arrow, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) :
      reject(new Error('Could not export ' + item.name + '.')), 'image/png');
  });
  canvas.width = canvas.height = 0;
  return blob;
}

export default function DrawPage() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [index, setIndex] = useState(0);
  const [arrows, setArrows] = useState<Record<string, Arrow[]>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const allUrls = useRef<string[]>([]);
  const active = images[index] || null;
  const activeRef = useRef<ImageItem | null>(null);
  const arrowsRef = useRef(arrows);
  const draft = useRef<Arrow | null>(null);
  const drawing = useRef<Drawing | null>(null);
  const paintFrame = useRef<number | null>(null);
  const exported = useRef(false);
  activeRef.current = active;

  useEffect(() => {
    const previous = document.title;
    document.title = 'Draw · Flow';
    return () => { document.title = previous; };
  }, []);

  useEffect(() => () => {
    if (paintFrame.current !== null) cancelAnimationFrame(paintFrame.current);
    for (const url of allUrls.current) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (exported.current || !allUrls.current.length) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const paint = useCallback(() => {
    const element = canvas.current;
    const bounds = frame.current;
    if (!element || !bounds) return;
    const width = bounds.clientWidth;
    const height = bounds.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const physicalWidth = Math.max(1, Math.round(width * dpr));
    const physicalHeight = Math.max(1, Math.round(height * dpr));
    if (element.width !== physicalWidth || element.height !== physicalHeight) {
      element.width = physicalWidth;
      element.height = physicalHeight;
    }
    const ctx = element.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const item = activeRef.current;
    if (!item) return;
    for (const arrow of arrowsRef.current[item.id] || []) {
      drawArrow(ctx, arrow, width, height);
    }
    if (draft.current && drawing.current?.imageId === item.id) {
      drawArrow(ctx, draft.current, width, height);
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

  function resetDrawing() {
    drawing.current = null;
    draft.current = null;
  }

  function select(indexToOpen: number) {
    resetDrawing();
    setIndex(indexToOpen);
    requestPaint();
  }

  function addFiles(files: FileList | File[]) {
    const accepted = Array.from(files).filter(file =>
      file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(file.name));
    if (!accepted.length) { setError('Choose an image file to continue.'); return; }
    const next = accepted.map(file => {
      const url = URL.createObjectURL(file);
      allUrls.current.push(url);
      return { id: crypto.randomUUID(), name: file.name, file, url };
    });
    setImages(previous => [...previous, ...next]);
    setError('');
    exported.current = false;
  }

  function upload(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
  }

  function changeArrows(next: Record<string, Arrow[]>) {
    arrowsRef.current = next;
    setArrows(next);
    exported.current = false;
    requestPaint();
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    const item = activeRef.current;
    if (!item || drawing.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    const point = pointerPoint(event);
    const arrow = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    drawing.current = { pointerId: event.pointerId, imageId: item.id, arrow };
    draft.current = arrow;
    event.currentTarget.setPointerCapture(event.pointerId);
    requestPaint();
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    const current = drawing.current;
    if (!current || current.pointerId !== event.pointerId ||
      current.imageId !== activeRef.current?.id) return;
    const point = pointerPoint(event);
    draft.current = { ...current.arrow, x2: point.x, y2: point.y };
    requestPaint();
  }

  function finish(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
    const stroke = drawing.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    const element = event.currentTarget;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    const point = pointerPoint(event);
    const arrow = { ...stroke.arrow, x2: point.x, y2: point.y };
    resetDrawing();
    if (!cancelled && stroke.imageId === activeRef.current?.id) {
      const rect = element.getBoundingClientRect();
      const length = Math.hypot((arrow.x2 - arrow.x1) * rect.width,
        (arrow.y2 - arrow.y1) * rect.height);
      if (length >= 7) {
        changeArrows({
          ...arrowsRef.current,
          [stroke.imageId]: [...(arrowsRef.current[stroke.imageId] || []), arrow],
        });
      }
    }
    requestPaint();
  }

  function undo() {
    if (!active) return;
    const existing = arrowsRef.current[active.id] || [];
    if (existing.length) changeArrows({ ...arrowsRef.current, [active.id]: existing.slice(0, -1) });
  }

  function clear() {
    if (!active) return;
    changeArrows({ ...arrowsRef.current, [active.id]: [] });
  }

  async function download() {
    if (!images.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const entries: ZipEntry[] = [];
      for (let i = 0; i < images.length; i++) {
        const item = images[i];
        const onImage = arrowsRef.current[item.id] || [];
        setProgress('Rendering ' + (i + 1) + ' / ' + images.length);
        const file = await exportImage(item, onImage);
        entries.push({ name: imageName(item.file, i, onImage.length > 0), file });
      }
      setProgress('Creating ZIP…');
      const zip = await createImageZip(entries);
      const url = URL.createObjectURL(zip);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'draw-annotations.zip';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      exported.current = true;
      setProgress('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export this batch.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  const count = active ? (arrows[active.id] || []).length : 0;

  return <div className="draw-page">
    <header className="draw-header">
      <div className="draw-heading">
        <a href="/" className="draw-back" aria-label="Back to Flow">←</a>
        <span className="draw-wordmark">Draw</span>
        <span className="draw-heading-separator" aria-hidden="true" />
        <span className="draw-heading-note">Arrow annotations</span>
      </div>
      <div className="draw-header-actions">
        <input ref={fileInput} className="draw-file-input" type="file"
          accept="image/*,.svg" multiple onChange={upload} aria-label="Upload images" />
        <button className="draw-button" type="button"
          onClick={() => fileInput.current?.click()}>Add images</button>
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
      <aside className="draw-rail" aria-label="Uploaded images">
        <div className="draw-rail-heading">Images <span>{images.length}</span></div>
        <div className="draw-image-list">
          {images.map((item, itemIndex) =>
            <button type="button" key={item.id}
              className={'draw-image-item' + (index === itemIndex ? ' is-selected' : '')}
              onClick={() => select(itemIndex)} aria-current={index === itemIndex ? 'true' : undefined}
              title={item.name}>
              <img src={item.url} alt="" loading="lazy" />
              <span className="draw-image-item-info">
                <span className="draw-image-item-name">{item.name}</span>
                <span className="draw-image-item-count">
                  {(arrows[item.id] || []).length} arrow{(arrows[item.id] || []).length === 1 ? '' : 's'}
                </span>
              </span>
              <span className="draw-image-item-number">{String(itemIndex + 1).padStart(2, '0')}</span>
            </button>)}
          {!images.length && <span className="draw-rail-empty">No images yet.</span>}
        </div>
      </aside>

      <section className="draw-workspace" aria-label="Annotate image">
        <div className="draw-toolbar">
          <div className="draw-navigation">
            <button type="button" className="draw-button" disabled={index === 0 || !images.length}
              onClick={() => select(index - 1)}>Previous</button>
            <span className="draw-pagination">{images.length ? index + 1 : 0} / {images.length}</span>
            <button type="button" className="draw-button"
              disabled={!images.length || index === images.length - 1}
              onClick={() => select(index + 1)}>Next</button>
          </div>
          <div className="draw-edit-actions">
            <span className="draw-arrow-count">{count} arrow{count === 1 ? '' : 's'}</span>
            <button type="button" className="draw-text-button" disabled={!count} onClick={undo}>Undo</button>
            <button type="button" className="draw-text-button" disabled={!count} onClick={clear}>Clear</button>
          </div>
        </div>

        <div className={'draw-stage' + (over ? ' is-drop-target' : '')}>
          {active ? <div className="draw-image-frame" ref={frame} key={active.id}>
            <img src={active.url} alt={active.name} draggable={false} onLoad={requestPaint} />
            <canvas ref={canvas} aria-label="Draw an arrow on the image"
              onPointerDown={start} onPointerMove={move}
              onPointerUp={event => finish(event)}
              onPointerCancel={event => finish(event, true)} />
          </div> : <button type="button" className="draw-empty"
            onClick={() => fileInput.current?.click()}>
            <span className="draw-empty-mark">↗</span>
            <span>Drop images here, or select files</span>
            <span className="draw-empty-hint">Draw arrows. Move between images. Download everything as ZIP.</span>
          </button>}
        </div>
        <footer className="draw-footer">
          <span>Drag from the start of an arrow to its tip.</span>
          <span>Annotations stay with each image in this session.</span>
        </footer>
        {error && <div className="draw-error" role="alert">{error}
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button>
        </div>}
      </section>
    </main>
  </div>;
}
