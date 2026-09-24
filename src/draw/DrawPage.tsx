import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react';
import { createImageZip, type ZipEntry } from './zip';
import { drawAnnotation, hitTestAnnotation, renderExport, type Annotation, type AnnotationHit, type ArrowAnnotation, type OutputFormat, type Point, type TextAnnotation } from './annotations';
import './draw.css';

type ImageItem = { id: string; name: string; file: File; url: string };
type Drawing = { pointerId: number; imageId: string; arrow: ArrowAnnotation };
type TextDraft = { imageId: string; x: number; y: number; color: string; value: string; editIndex?: number };
type Selection = { imageId: string; index: number };
type Move = { pointerId: number; imageId: string; index: number; part: AnnotationHit['part']; start: Point; original: Annotation; current: Annotation; moved: boolean };
type Tool = 'select' | 'arrow' | 'text';
type Fit = { width: number; height: number };
type Pan = { pointerId: number; x: number; y: number; left: number; top: number };
type Pinch = { distance: number; x: number; y: number };

const COLORS = ['#ff0000', '#fbbf24', '#60a5fa', '#a3e635', '#c4b5fd', '#fafaf9'];
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

function packZip(entries: ZipEntry[]): Promise<Blob> {
  if (typeof Worker === 'undefined') return createImageZip(entries);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./zip.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      void createImageZip(entries).then(resolve, reject);
      return;
    }
    worker.onmessage = (event: MessageEvent<{ zip?: Blob; error?: string }>) => {
      worker.terminate();
      if (event.data.zip) resolve(event.data.zip);
      else reject(new Error(event.data.error || 'Could not create ZIP.'));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('The ZIP worker could not finish the export.'));
    };
    worker.postMessage({ entries });
  });
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
  const [selected, setSelected] = useState<Selection | null>(null);
  const [singleBusyId, setSingleBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState<Fit>({ width: 0, height: 0 });

  const input = useRef<HTMLInputElement>(null);
  const textDraftRef = useRef<TextDraft | null>(null);
  const selectedRef = useRef<Selection | null>(null);
  const moveRef = useRef<Move | null>(null);
  const historyRef = useRef<Record<string, Annotation[][]>>({});
  const textInput = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const sourceImage = useRef<HTMLImageElement>(null);
  const zoomRef = useRef(1);
  const fitRef = useRef<Fit>({ width: 0, height: 0 });
  const spaceDown = useRef(false);
  const pan = useRef<Pan | null>(null);
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<Pinch | null>(null);
  const suppressTouch = useRef(false);
  const zoomAdjust = useRef<number | null>(null);
  const exportCache = useRef(new Map<string, Blob>());
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
    if (zoomAdjust.current !== null) cancelAnimationFrame(zoomAdjust.current);
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
    // Retessellate the vector annotations at the *zoomed* display density.
    // Keep a hard pixel budget so huge screenshots do not exhaust GPU memory.
    const density = Math.min(3, devicePixelRatio || 1) * zoomRef.current;
    const rasterScale = Math.min(density, 8192 / width, 8192 / height,
      Math.sqrt(24_000_000 / (width * height)));
    const pixelWidth = Math.max(1, Math.round(width * rasterScale));
    const pixelHeight = Math.max(1, Math.round(height * rasterScale));
    if (element.width !== pixelWidth || element.height !== pixelHeight) {
      element.width = pixelWidth;
      element.height = pixelHeight;
    }
    const ctx = element.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(rasterScale, 0, 0, rasterScale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const image = activeRef.current;
    if (!image) return;
    const onImage = annotationsRef.current[image.id] || [];
    const moving = moveRef.current;
    for (let i = 0; i < onImage.length; i++) {
      drawAnnotation(ctx, moving?.imageId === image.id && moving.index === i
        ? moving.current : onImage[i], width, height);
    }
    const sel = selectedRef.current;
    if (sel?.imageId === image.id && onImage[sel.index]) {
      const shape = moving?.imageId === image.id && moving.index === sel.index
        ? moving.current : onImage[sel.index];
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      if (shape.kind === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(shape.x1 * width, shape.y1 * height);
        ctx.lineTo(shape.x2 * width, shape.y2 * height);
        ctx.stroke();
      } else {
        const scale = Math.min(width, height);
        const font = Math.max(14, Math.min(48, scale * 0.026));
        const lines = shape.text.split('\n').slice(0, 6);
        ctx.font = '500 ' + font + 'px -apple-system, BlinkMacSystemFont, Arial, sans-serif';
        const w = Math.min(width, Math.max(0, ...lines.map(line => ctx.measureText(line).width)) + font * 1.06);
        const h = lines.length * font * 1.35 + font * 0.76;
        const x = Math.max(0, Math.min(shape.x * width, width - w));
        const y = Math.max(0, Math.min(shape.y * height, height - h));
        ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      }
      ctx.restore();
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

  const measureFit = useCallback(() => {
    const viewport = stage.current;
    const picture = sourceImage.current;
    if (!viewport || !picture?.naturalWidth || !picture.naturalHeight) return;
    const padding = matchMedia('(max-width: 800px)').matches ? 20 : 40;
    const ratio = Math.min(1,
      Math.max(1, viewport.clientWidth - padding) / picture.naturalWidth,
      Math.max(1, viewport.clientHeight - padding) / picture.naturalHeight);
    const next: Fit = {
      width: Math.max(1, picture.naturalWidth * ratio),
      height: Math.max(1, picture.naturalHeight * ratio),
    };
    if (Math.abs(next.width - fitRef.current.width) < 0.5 &&
      Math.abs(next.height - fitRef.current.height) < 0.5) return;
    fitRef.current = next;
    setFit(next);
    requestPaint();
  }, [requestPaint]);

  useEffect(() => {
    if (!active) return;
    const viewport = stage.current;
    if (!viewport) return;
    const observer = new ResizeObserver(measureFit);
    observer.observe(viewport);
    measureFit();
    return () => observer.disconnect();
  }, [active?.id, measureFit]);

  useEffect(() => { requestPaint(); }, [zoom, fit, requestPaint]);

  const zoomAt = useCallback((requested: number, clientX: number, clientY: number) => {
    const viewport = stage.current;
    const element = frame.current;
    const measure = fitRef.current;
    if (!viewport || !element || !measure.width || !measure.height) return;
    const beforeZoom = zoomRef.current;
    const next = Math.min(10, Math.max(1, requested));
    if (Math.abs(beforeZoom - next) < 0.0001) return;
    const before = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(measure.width, (clientX - before.left) / beforeZoom));
    const y = Math.max(0, Math.min(measure.height, (clientY - before.top) / beforeZoom));
    zoomRef.current = next;
    setZoom(next);
    if (zoomAdjust.current !== null) cancelAnimationFrame(zoomAdjust.current);
    let attempts = 0;
    const adjust = () => {
      const current = frame.current;
      const host = stage.current;
      if (!current || !host) return;
      const after = current.getBoundingClientRect();
      if (Math.abs(after.width - measure.width * next) > 2 && attempts++ < 3) {
        zoomAdjust.current = requestAnimationFrame(adjust);
        return;
      }
      host.scrollLeft += after.left + x * next - clientX;
      host.scrollTop += after.top + y * next - clientY;
      zoomAdjust.current = null;
      requestPaint();
    };
    zoomAdjust.current = requestAnimationFrame(adjust);
  }, [requestPaint]);

  useEffect(() => {
    const viewport = stage.current;
    if (!viewport || !active) return;
    const wheel = (event: WheelEvent) => {
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      const strength = event.ctrlKey ? 0.012 : 0.003;
      zoomAt(zoomRef.current * Math.exp(-event.deltaY * unit * strength),
        event.clientX, event.clientY);
    };
    let gestureScale = 1;
    const startGesture = (event: Event) => { event.preventDefault(); gestureScale = 1; };
    const changeGesture = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      const scale = gesture.scale || 1;
      const rect = viewport.getBoundingClientRect();
      zoomAt(zoomRef.current * scale / gestureScale,
        gesture.clientX ?? rect.left + rect.width / 2,
        gesture.clientY ?? rect.top + rect.height / 2);
      gestureScale = scale;
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    viewport.addEventListener('gesturestart', startGesture, { passive: false });
    viewport.addEventListener('gesturechange', changeGesture, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('gesturestart', startGesture);
      viewport.removeEventListener('gesturechange', changeGesture);
    };
  }, [active?.id, zoomAt]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (!activeRef.current ||
        (event.target instanceof HTMLElement &&
          event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if (event.code === 'Space') {
        event.preventDefault();
        spaceDown.current = true;
        return;
      }
      if (event.altKey || event.shiftKey && event.key !== '+' && event.key !== '_') return;
      if (event.key !== '+' && event.key !== '=' && event.key !== '-' &&
        event.key !== '_' && event.key !== '0') return;
      event.preventDefault();
      const host = stage.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const next = event.key === '0' ? 1 : zoomRef.current *
        (event.key === '+' || event.key === '=' ? 1.25 : 0.8);
      zoomAt(next, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceDown.current = false;
    };
    const blur = () => { spaceDown.current = false; };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
    };
  }, [zoomAt]);

  function selectAnnotation(next: Selection | null) {
    selectedRef.current = next;
    setSelected(next);
    requestPaint();
  }

  function updateAnnotations(next: Record<string, Annotation[]>, recordHistory = true) {
    if (recordHistory) for (const id of Object.keys(next)) {
      if (next[id] !== annotationsRef.current[id]) {
        const history = historyRef.current[id] || [];
        historyRef.current[id] = [...history.slice(-39), annotationsRef.current[id] || []];
      }
    }
    for (const id of Object.keys(next)) {
      if (next[id] !== annotationsRef.current[id]) {
        exportCache.current.delete(id + ':webp');
        exportCache.current.delete(id + ':jpeg');
      }
    }
    annotationsRef.current = next;
    setAnnotations(next);
    downloaded.current = false;
    requestPaint();
  }

  function openText(draft: TextDraft) {
    textDraftRef.current = draft;
    setTextDraft(draft);
  }

  function commitText() {
    // A blur after Enter must not commit the same text twice.
    const item = textDraftRef.current;
    if (!item) return;
    textDraftRef.current = null;
    setTextDraft(null);
    const value = item.value.trim().slice(0, 240);
    if (!value) return;
    const annotation: TextAnnotation = {
      kind: 'text', color: item.color, x: item.x, y: item.y, text: value,
    };
    const existing = annotationsRef.current[item.imageId] || [];
    if (item.editIndex !== undefined) {
      if (!existing[item.editIndex] || existing[item.editIndex].kind !== 'text') return;
      const updated = existing.slice();
      updated[item.editIndex] = annotation;
      if (JSON.stringify(existing[item.editIndex]) !== JSON.stringify(annotation)) {
        updateAnnotations({ ...annotationsRef.current, [item.imageId]: updated });
      }
      selectAnnotation({ imageId: item.imageId, index: item.editIndex });
    } else {
      updateAnnotations({
        ...annotationsRef.current, [item.imageId]: [...existing, annotation],
      });
      selectAnnotation({ imageId: item.imageId, index: existing.length });
    }
  }

  function cancelText() {
    textDraftRef.current = null;
    setTextDraft(null);
  }

  function editSelectedText() {
    const sel = selectedRef.current;
    if (!sel) return;
    const original = annotationsRef.current[sel.imageId]?.[sel.index];
    if (!original || original.kind !== 'text') return;
    openText({ imageId: sel.imageId, x: original.x, y: original.y,
      color: original.color, value: original.text, editIndex: sel.index });
  }

  function deleteSelected() {
    const sel = selectedRef.current;
    if (!sel) return;
    const existing = annotationsRef.current[sel.imageId] || [];
    if (!existing[sel.index]) return;
    cancelText();
    updateAnnotations({ ...annotationsRef.current,
      [sel.imageId]: existing.filter((_, i) => i !== sel.index) });
    selectAnnotation(null);
  }

  function select(nextIndex: number) {
    commitText();
    drawn.current = null;
    draftArrow.current = null;
    moveRef.current = null;
    selectAnnotation(null);
    setIndex(nextIndex);
    zoomRef.current = 1;
    setZoom(1);
    fitRef.current = { width: 0, height: 0 };
    setFit(fitRef.current);
    touchPoints.current.clear();
    pinch.current = null;
    pan.current = null;
    suppressTouch.current = false;
    if (stage.current) { stage.current.scrollLeft = 0; stage.current.scrollTop = 0; }
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
    if (!item || (event.pointerType === 'mouse' && event.button !== 0 &&
      event.button !== 1)) return;
    if (event.pointerType === 'touch') {
      touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.current.size > 1) {
        suppressTouch.current = true;
        drawn.current = null;
        draftArrow.current = null;
        setTextDraft(null);
        const touches = Array.from(touchPoints.current.values());
        pinch.current = {
          distance: Math.max(1, Math.hypot(touches[1].x - touches[0].x,
            touches[1].y - touches[0].y)),
          x: (touches[0].x + touches[1].x) / 2,
          y: (touches[0].y + touches[1].y) / 2,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        requestPaint();
        return;
      }
    }
    if (suppressTouch.current || drawn.current || pan.current) return;
    event.preventDefault();
    if (spaceDown.current || event.button === 1) {
      const viewport = stage.current;
      if (!viewport) return;
      pan.current = { pointerId: event.pointerId, x: event.clientX,
        y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
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
    if (event.pointerType === 'touch' && touchPoints.current.has(event.pointerId)) {
      touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.current.size > 1) {
        event.preventDefault();
        const touches = Array.from(touchPoints.current.values());
        const distance = Math.max(1, Math.hypot(touches[1].x - touches[0].x,
          touches[1].y - touches[0].y));
        const x = (touches[0].x + touches[1].x) / 2;
        const y = (touches[0].y + touches[1].y) / 2;
        const previous = pinch.current;
        if (previous) {
          const viewport = stage.current;
          if (viewport) {
            viewport.scrollLeft -= x - previous.x;
            viewport.scrollTop -= y - previous.y;
          }
          zoomAt(zoomRef.current * distance / previous.distance, x, y);
        }
        pinch.current = { distance, x, y };
        return;
      }
      if (suppressTouch.current) return;
    }
    if (pan.current?.pointerId === event.pointerId) {
      event.preventDefault();
      const viewport = stage.current;
      if (viewport) {
        viewport.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
        viewport.scrollTop = pan.current.top - (event.clientY - pan.current.y);
      }
      return;
    }
    const current = drawn.current;
    if (!current || current.pointerId !== event.pointerId ||
      current.imageId !== activeRef.current?.id) return;
    const pos = point(event);
    draftArrow.current = { ...current.arrow, x2: pos.x, y2: pos.y };
    requestPaint();
  }

  function finish(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
    if (event.pointerType === 'touch') {
      touchPoints.current.delete(event.pointerId);
      if (touchPoints.current.size < 2) pinch.current = null;
      if (suppressTouch.current) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (touchPoints.current.size === 0) suppressTouch.current = false;
        requestPaint();
        return;
      }
    }
    if (pan.current?.pointerId === event.pointerId) {
      pan.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
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
      // Two/three encoders in flight rather than forcing every image to wait for
      // the previous canvas to finish encoding. Keep ZIP entry order deterministic.
      const entries: ZipEntry[] = new Array(images.length);
      const currentAnnotations = annotationsRef.current;
      let nextIndex = 0;
      let completed = 0;
      const workerCount = Math.min(3, images.length);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < images.length) {
          const i = nextIndex++;
          const image = images[i];
          const key = image.id + ':' + format;
          let blob = exportCache.current.get(key);
          if (!blob) {
            blob = await renderExport(image.url, currentAnnotations[image.id] || [], format);
            exportCache.current.set(key, blob);
            // Only keep a few recent outputs; large batches must not retain
            // two full-size encoded copies in memory indefinitely.
            while (exportCache.current.size > 8) {
              const oldest = exportCache.current.keys().next().value;
              if (oldest) exportCache.current.delete(oldest);
              else break;
            }
          }
          entries[i] = { name: filename(projectName, i, format), file: blob };
          completed++;
          setProgress('Exporting ' + completed + ' / ' + images.length);
        }
      }));
      setProgress('Packing ZIP…');
      const zip = await packZip(entries);
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

        <div ref={stage} className={'draw-stage' + (over ? ' is-drop-target' : '')}
          tabIndex={0} aria-label="Image canvas. Wheel or pinch to zoom, plus and minus to zoom, zero to fit. Hold Space and drag to pan.">
          {active ? <div className="draw-zoom-space" key={active.id}
            style={{ width: fit.width * zoom, height: fit.height * zoom }}>
            <div className="draw-image-frame" ref={frame}
              style={{ width: fit.width, height: fit.height,
                transform: 'scale(' + zoom + ')', transformOrigin: 'top left' }}>
            <img ref={sourceImage} src={active.url} alt={active.name}
              draggable={false} onLoad={() => { measureFit(); requestPaint(); }} />
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
            </div>
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
          <span>{tool === 'arrow' ? 'Wheel / pinch to zoom · Space + drag to pan · + / − / 0' :
            'Tap to place text · Wheel / pinch to zoom · Space + drag to pan'}</span>
          <span>{format === 'webp' ? 'WebP' : 'JPEG'} · {projectName.trim() || 'Screenshots'} 1–{images.length}</span>
        </footer>
        {error && <div className="draw-error" role="alert">{error}
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button>
        </div>}
      </section>
    </main>
  </div>;
}
