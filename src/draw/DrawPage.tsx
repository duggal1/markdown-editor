import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react';
import { createImageZip, type ZipEntry } from './zip';
import { drawAnnotation, hitTestAnnotation, renderExport, type Annotation, type AnnotationHit, type ArrowAnnotation, type ArrowStyle, type OutputFormat, type Point, type TextAnnotation } from './annotations';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeft01Icon, ArrowRight01Icon, ArrowUpRight01Icon,
  Cursor01Icon, TextIcon, Download01Icon, Add01Icon,
  Delete02Icon, Undo02Icon, ImageAdd01Icon, Cancel01Icon,
} from '@hugeicons/core-free-icons';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { FlowMark } from '../components/Icons';
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

function point(event: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width),
    y: clamp((event.clientY - bounds.top) / bounds.height),
  };
}

function filename(project: string, item: ImageItem, index: number, format: OutputFormat) {
  const safe = (project.trim() ? project.trim() + ' ' + (index + 1) :
    item.name.replace(/\.[^.]+$/, '')).replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').slice(0, 90) || 'Image';
  return safe + (format === 'webp' ? '.webp' : '.jpg');
}

function moveAnnotation(
  item: Annotation, deltaX: number, deltaY: number,
  part: AnnotationHit['part'] = 'body',
): Annotation {
  if (item.kind === 'text') return { ...item,
    x: clamp(item.x + deltaX), y: clamp(item.y + deltaY) };
  if (part === 'start') return { ...item,
    x1: clamp(item.x1 + deltaX), y1: clamp(item.y1 + deltaY) };
  if (part === 'end') return { ...item,
    x2: clamp(item.x2 + deltaX), y2: clamp(item.y2 + deltaY) };
  const dx = Math.max(-Math.min(item.x1, item.x2),
    Math.min(1 - Math.max(item.x1, item.x2), deltaX));
  const dy = Math.max(-Math.min(item.y1, item.y2),
    Math.min(1 - Math.max(item.y1, item.y2), deltaY));
  return { ...item, x1: item.x1 + dx, y1: item.y1 + dy,
    x2: item.x2 + dx, y2: item.y2 + dy };
}

function initialName(): string { return ''; }

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

function ArrowStylePreview({ style }: { style: ArrowStyle }) {
  if (style === 'pixel') return <svg aria-hidden="true" viewBox="0 0 52 24" width="39" height="19"
    shapeRendering="crispEdges" fill="currentColor">
    <path d="M3 18h8v-3h8v-3h8V9h8V6h5V3l10 9-10 9v-3h-5v-3h-8v-3h-8v-3h-8z" />
  </svg>;
  if (style === 'line') return <svg aria-hidden="true" viewBox="0 0 52 24" width="39" height="19"
    fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="butt">
    <path d="M4 20 47 4M32 3l15 1-5 14" />
  </svg>;
  if (style === 'fine') return <svg aria-hidden="true" viewBox="0 0 52 24" width="39" height="19"
    fill="none" stroke="currentColor" strokeWidth="1.3">
    <path d="M4 20 45 5M37 4l8 1-3 8" />
  </svg>;
  return <svg aria-hidden="true" viewBox="0 0 52 24" width="39" height="19"
    fill="currentColor"><path d="M4 18 38 6l-3-5 14 2-9 12-1-6L5 21z" /></svg>;
}

export default function DrawPage() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [index, setIndex] = useState(0);
  const [annotations, setAnnotations] = useState<Record<string, Annotation[]>>({});
  const [tool, setTool] = useState<Tool>('arrow');
  const [arrowStyle, setArrowStyle] = useState<ArrowStyle>('pixel');
  const [styleOpen, setStyleOpen] = useState(false);
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
    if (!styleOpen) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.draw-style-picker')) setStyleOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setStyleOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [styleOpen]);
  useEffect(() => {
    const old = document.title;
    document.title = 'Draw · Flow';
    return () => { document.title = old; };
  }, []);
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
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey &&
        event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === 'Escape') {
        selectAnnotation(null);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedRef.current) {
          event.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (event.key === 'Enter' && selectedRef.current) {
        event.preventDefault();
        editSelectedText();
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const sel = selectedRef.current;
        const original = sel && annotationsRef.current[sel.imageId]?.[sel.index];
        if (sel && original) {
          event.preventDefault();
          const amount = event.shiftKey ? 10 : 1;
          const width = sourceImage.current?.naturalWidth || fitRef.current.width || 1;
          const height = sourceImage.current?.naturalHeight || fitRef.current.height || 1;
          const dx = event.key === 'ArrowLeft' ? -amount / width :
            event.key === 'ArrowRight' ? amount / width : 0;
          const dy = event.key === 'ArrowUp' ? -amount / height :
            event.key === 'ArrowDown' ? amount / height : 0;
          const changed = moveAnnotation(original, dx, dy);
          const existing = annotationsRef.current[sel.imageId];
          const updated = existing.slice();
          updated[sel.index] = changed;
          updateAnnotations({ ...annotationsRef.current, [sel.imageId]: updated });
        }
        return;
      }
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

  function chooseArrowStyle(style: ArrowStyle) {
    setArrowStyle(style);
    setStyleOpen(false);
    // The same control also edits a selected arrow, with undo history.
    const selection = selectedRef.current;
    if (!selection) return;
    const notes = annotationsRef.current[selection.imageId] || [];
    const current = notes[selection.index];
    if (!current || current.kind !== 'arrow' || current.style === style) return;
    const next = notes.slice();
    next[selection.index] = { ...current, style };
    updateAnnotations({ ...annotationsRef.current, [selection.imageId]: next });
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

  function removeImage(id: string) {
    if (busy || singleBusyId) return;
    const at = images.findIndex(item => item.id === id);
    if (at === -1) return;
    const removed = images[at];
    cancelText();
    if (selectedRef.current?.imageId === id) selectAnnotation(null);
    moveRef.current = null;
    drawn.current = null;
    draftArrow.current = null;
    delete annotationsRef.current[id];
    delete historyRef.current[id];
    exportCache.current.delete(id + ':webp');
    exportCache.current.delete(id + ':jpeg');
    setAnnotations({ ...annotationsRef.current });
    const remaining = images.filter(item => item.id !== id);
    const newIndex = at < index ? index - 1 : at === index
      ? Math.min(index, remaining.length - 1) : index;
    setImages(remaining);
    setIndex(Math.max(0, newIndex));
    zoomRef.current = 1;
    setZoom(1);
    fitRef.current = { width: 0, height: 0 };
    setFit(fitRef.current);
    if (stage.current) { stage.current.scrollLeft = 0; stage.current.scrollTop = 0; }
    urls.current = urls.current.filter(url => url !== removed.url);
    requestAnimationFrame(() => URL.revokeObjectURL(removed.url));
    downloaded.current = false;
    requestPaint();
  }

  async function getEncoded(item: ImageItem, as: OutputFormat): Promise<Blob> {
    const key = item.id + ':' + as;
    const previous = exportCache.current.get(key);
    if (previous) return previous;
    const file = await renderExport(item.url, annotationsRef.current[item.id] || [], as);
    exportCache.current.set(key, file);
    while (exportCache.current.size > 8) {
      const oldest = exportCache.current.keys().next().value;
      if (oldest) exportCache.current.delete(oldest);
      else break;
    }
    return file;
  }

  function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function downloadSingle(item: ImageItem) {
    if (busy || singleBusyId) return;
    commitText();
    setSingleBusyId(item.id);
    setError('');
    try {
      const file = await getEncoded(item, format);
      const at = images.findIndex(image => image.id === item.id);
      if (at === -1) return;
      saveBlob(file, filename(projectName, item, at, format));
      // A single download should not suppress the navigation warning for other
      // unsaved screenshots still in the batch.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not download the image.');
    } finally {
      setSingleBusyId(null);
    }
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
        moveRef.current = null;
        cancelText();
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
    if (textDraftRef.current) commitText();
    const rect = event.currentTarget.getBoundingClientRect();
    const hit = hitTestAnnotation(annotationsRef.current[item.id] || [],
      pos, rect.width / zoomRef.current, rect.height / zoomRef.current, zoomRef.current);
    if (hit) {
      const original = annotationsRef.current[item.id][hit.index];
      selectAnnotation({ imageId: item.id, index: hit.index });
      moveRef.current = { pointerId: event.pointerId, imageId: item.id,
        index: hit.index, part: hit.part, start: pos, original,
        current: original, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    selectAnnotation(null);
    if (tool === 'select') return;
    if (tool === 'text') {
      openText({ imageId: item.id, ...pos, color, value: '' });
      return;
    }
    const arrow: ArrowAnnotation = {
      kind: 'arrow', color, style: arrowStyle, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y,
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
    const moving = moveRef.current;
    if (moving?.pointerId === event.pointerId) {
      const pos = point(event);
      const dx = pos.x - moving.start.x;
      const dy = pos.y - moving.start.y;
      if (Math.hypot(dx * event.currentTarget.getBoundingClientRect().width,
        dy * event.currentTarget.getBoundingClientRect().height) > 2) {
        moving.moved = true;
      }
      if (moving.moved) {
        moving.current = moveAnnotation(moving.original, dx, dy, moving.part);
        requestPaint();
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
    const moving = moveRef.current;
    if (moving?.pointerId === event.pointerId) {
      moveRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!cancelled && moving.moved &&
        JSON.stringify(moving.current) !== JSON.stringify(moving.original)) {
        const original = annotationsRef.current[moving.imageId] || [];
        if (original[moving.index]) {
          const next = original.slice();
          next[moving.index] = moving.current;
          updateAnnotations({ ...annotationsRef.current, [moving.imageId]: next });
        }
      }
      requestPaint();
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
    const item = activeRef.current;
    if (!item) return;
    if (textDraftRef.current) { cancelText(); return; }
    const history = historyRef.current[item.id] || [];
    if (!history.length) return;
    const previous = history[history.length - 1];
    historyRef.current[item.id] = history.slice(0, -1);
    updateAnnotations({ ...annotationsRef.current, [item.id]: previous }, false);
    selectAnnotation(null);
  }

  function clear() {
    const item = activeRef.current;
    if (!item) return;
    cancelText();
    if (!(annotationsRef.current[item.id] || []).length) return;
    updateAnnotations({ ...annotationsRef.current, [item.id]: [] });
    selectAnnotation(null);
  }

  async function download() {
    if (!images.length || busy || singleBusyId) return;
    commitText();
    setBusy(true);
    setError('');
    try {
      // Two/three encoders in flight rather than forcing every image to wait for
      // the previous canvas to finish encoding. Keep ZIP entry order deterministic.
      const entries: ZipEntry[] = new Array(images.length);
      let nextIndex = 0;
      let completed = 0;
      const workerCount = Math.min(3, images.length);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < images.length) {
          const i = nextIndex++;
          const image = images[i];
          const blob = await getEncoded(image, format);
          entries[i] = { name: filename(projectName, item, i, format), file: blob };
          completed++;
          setProgress('Exporting ' + completed + ' / ' + images.length);
        }
      }));
      setProgress('Packing ZIP…');
      const zip = await packZip(entries);
      saveBlob(zip, (projectName.trim().replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').slice(0, 90) ||
        'Screenshots') + ' screenshots.zip');
      downloaded.current = true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export these screenshots.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  const count = active ? (annotations[active.id] || []).length : 0;
  const reducedMotion = useReducedMotion();
  const tap = reducedMotion ? undefined : { scale: 0.97 };
  return <div className="draw-page">
    <header className="draw-header">
      <div className="draw-heading">
        <a href="/" className="draw-back" aria-label="Back to Flow"><HugeiconsIcon icon={ArrowLeft01Icon} size={17} strokeWidth={1.7} /></a>
        <span className="draw-wordmark"><span className="draw-logo"><FlowMark size={22} /></span>Draw<span className="draw-wordmark-stop">.</span></span>
        <span className="draw-heading-separator" aria-hidden="true" />
        <label className="draw-project-label" htmlFor="draw-project">Project</label>
        <input id="draw-project" className="draw-project-input" value={projectName}
          maxLength={90} spellCheck={false} aria-label="Project name for screenshot export"
          onChange={event => { setProjectName(event.target.value); downloaded.current = false; }}
          placeholder="Project name" />
      </div>
      <div className="draw-header-actions">
        <input ref={input} className="draw-file-input" type="file"
          accept="image/*,.svg" multiple onChange={upload} aria-label="Upload images" />
        <button className="draw-button" type="button" onClick={() => input.current?.click()}>
          <HugeiconsIcon icon={ImageAdd01Icon} size={15} strokeWidth={1.7} /> Add images
        </button>
        <button className="draw-button draw-button-primary" type="button"
          disabled={!active || busy || !!singleBusyId}
          onClick={() => { if (active) void downloadSingle(active); }}>
          <HugeiconsIcon icon={Download01Icon} size={15} strokeWidth={1.7} /> {singleBusyId === active?.id ? 'Exporting…' : 'Export image'}
        </button>
        <button className="draw-button" type="button"
          disabled={!images.length || busy || !!singleBusyId}
          onClick={() => { void download(); }}>
          <HugeiconsIcon icon={Download01Icon} size={15} strokeWidth={1.7} /> {busy ? progress || 'Exporting…' : 'Export all'}
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
        <div className="draw-rail-heading"><span>Files</span> <span>{images.length}</span></div>
        <div className="draw-image-list">
          {images.map((item, i) => <div key={item.id}
            className={'draw-image-item' + (index === i ? ' is-selected' : '')}>
            <button type="button" className="draw-image-item-select"
              onClick={() => select(i)} aria-current={index === i ? 'true' : undefined}
              title={item.name} aria-label={'Open ' + filename(projectName, item, i, format)}>
              <img src={item.url} alt="" loading="lazy" />
              <span className="draw-image-item-info">
                <span className="draw-image-item-name">{item.name}</span>
                <span className="draw-image-item-count">{(annotations[item.id] || []).length} note{(annotations[item.id] || []).length === 1 ? '' : 's'}</span>
              </span>
            </button>
            <div className="draw-image-item-actions">
              <button type="button" className="draw-image-item-action"
                disabled={busy || !!singleBusyId}
                aria-label={'Download ' + filename(projectName, item, i, format)}
                title={'Download ' + filename(projectName, item, i, format)}
                onClick={() => { void downloadSingle(item); }}>
                {singleBusyId === item.id ? '…' : <HugeiconsIcon icon={Download01Icon} size={14} strokeWidth={1.6} />}
              </button>
              <button type="button" className="draw-image-item-action draw-image-remove"
                disabled={busy || !!singleBusyId}
                aria-label={'Remove ' + item.name} title={'Remove ' + item.name}
                onClick={() => removeImage(item.id)}><HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.6} /></button>
            </div>
          </div>)}
          {!images.length && <span className="draw-rail-empty">No screenshots yet.</span>}
        </div>
      </aside>

      <section className="draw-workspace" aria-label="Annotate screenshot">
        <div className="draw-toolbar">
          <div className="draw-tools" role="group" aria-label="Annotation tool">
            <motion.button whileTap={tap} type="button" className={'draw-tool' + (tool === 'select' ? ' is-active' : '')}
              aria-pressed={tool === 'select'}
              onClick={() => { commitText(); setTool('select'); }}><HugeiconsIcon icon={Cursor01Icon} size={15} strokeWidth={1.8} /> <span>Select</span></motion.button>
            <motion.button whileTap={tap} type="button" className={'draw-tool' + (tool === 'arrow' ? ' is-active' : '')}
              aria-pressed={tool === 'arrow'}
              onClick={() => { commitText(); setTool('arrow'); }}><HugeiconsIcon icon={ArrowUpRight01Icon} size={15} strokeWidth={1.8} /> <span>Arrow</span></motion.button>
            <motion.button whileTap={tap} type="button" className={'draw-tool' + (tool === 'text' ? ' is-active' : '')}
              aria-pressed={tool === 'text'} onClick={() => setTool('text')}>
              <HugeiconsIcon icon={TextIcon} size={15} strokeWidth={1.8} /> <span>Text</span></motion.button>
          </div>
          <div className="draw-style-picker">
            <button type="button" className="draw-style-trigger"
              aria-haspopup="menu" aria-expanded={styleOpen}
              aria-label={'Arrow style: ' + arrowStyle}
              onClick={() => { commitText(); setTool('arrow'); setStyleOpen(open => !open); }}>
              <ArrowStylePreview style={arrowStyle} />
              <span>{({ pixel: 'Pixel', solid: 'Solid', line: 'Open', fine: 'Fine' } as const)[arrowStyle]}</span>
              <span className="draw-style-chevron" aria-hidden="true">⌄</span>
            </button>
            <AnimatePresence>
              {styleOpen && <motion.div className="draw-style-menu" role="menu"
                initial={reducedMotion ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}
                transition={{ duration: reducedMotion ? 0 : 0.13, ease: [0.22, 1, 0.36, 1] }}>
                {(['pixel', 'solid', 'line', 'fine'] as ArrowStyle[]).map(style =>
                  <button key={style} type="button" role="menuitemradio"
                    aria-checked={arrowStyle === style}
                    className={arrowStyle === style ? 'is-selected' : ''}
                    onClick={() => chooseArrowStyle(style)}>
                    <ArrowStylePreview style={style} />
                    <span>{({ pixel: 'Pixel arrow', solid: 'Solid arrow', line: 'Open arrow', fine: 'Fine arrow' } as const)[style]}</span>
                  </button>)}
              </motion.div>}
            </AnimatePresence>
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
              onClick={() => select(index - 1)}><HugeiconsIcon icon={ArrowLeft01Icon} size={15} strokeWidth={1.7} /><span>Previous</span></button>
            <span className="draw-pagination">{images.length ? index + 1 : 0} / {images.length}</span>
            <button type="button" className="draw-button"
              disabled={!images.length || index === images.length - 1}
              onClick={() => select(index + 1)}><span>Next</span><HugeiconsIcon icon={ArrowRight01Icon} size={15} strokeWidth={1.7} /></button>
          </div>
          <div className="draw-edit-actions">
            <span className="draw-arrow-count">{count} note{count === 1 ? '' : 's'}</span>
            {active && selected && selected.imageId === active.id && (annotations[active.id]?.[selected.index]?.kind === 'text') &&
              <button type="button" className="draw-text-button" onClick={editSelectedText}>Edit text</button>}
            {active && selected && selected.imageId === active.id &&
              <button type="button" className="draw-text-button draw-remove-annotation"
                onClick={deleteSelected}><HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.7} /> Delete selected</button>}
            <button type="button" className="draw-text-button"
              disabled={!historyRef.current[active?.id || '']?.length && !textDraft}
              onClick={undo}><HugeiconsIcon icon={Undo02Icon} size={14} strokeWidth={1.7} /> Undo</button>
            <button type="button" className="draw-text-button"
              disabled={!count && !textDraft} onClick={clear}><HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.7} /> Clear</button>
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
            <canvas ref={canvas} className={tool === 'select' ? 'draw-select-canvas' : ''}
              aria-label={tool === 'arrow' ? 'Draw an arrow or move an existing annotation' :
                tool === 'text' ? 'Add text or move an existing annotation' :
                'Select, move or adjust an annotation'}
              onPointerDown={start} onPointerMove={move}
              onPointerUp={event => finish(event)}
              onPointerCancel={event => finish(event, true)}
              onDoubleClick={event => {
                const item = activeRef.current;
                if (!item) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const hit = hitTestAnnotation(annotationsRef.current[item.id] || [],
                  point(event), rect.width / zoomRef.current,
                  rect.height / zoomRef.current, zoomRef.current);
                if (hit && annotationsRef.current[item.id][hit.index]?.kind === 'text') {
                  selectAnnotation({ imageId: item.id, index: hit.index });
                  editSelectedText();
                }
              }} />
            {textDraft?.imageId === active.id && <textarea ref={textInput}
              className="draw-inline-text" aria-label="Screenshot annotation text"
              placeholder="Describe the issue…"
              maxLength={240} rows={2} value={textDraft.value}
              style={{ left: Math.min(70, textDraft.x * 100) + '%',
                top: Math.min(82, textDraft.y * 100) + '%',
                borderColor: textDraft.color }}
              onChange={event => {
                const previous = textDraftRef.current;
                if (!previous) return;
                const next = { ...previous, value: event.target.value };
                textDraftRef.current = next;
                setTextDraft(next);
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') { event.preventDefault(); cancelText(); }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault(); commitText();
                }
              }}
              onBlur={commitText} />}
            </div>
          </div> : <button type="button" className="draw-empty"
            onClick={() => input.current?.click()}>
            <span className="draw-empty-mark"><HugeiconsIcon icon={ImageAdd01Icon} size={36} strokeWidth={1.2} /></span>
            <span className="draw-empty-title">Your canvas is ready.</span><span className="draw-empty-action"><HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.7} /> Add screenshots</span>
            <span className="draw-empty-hint">
              Add an image, point to the detail, and export annotated screenshots.
            </span>
          </button>}
        </div>
        <footer className="draw-footer">
          <span>{active && selected && selected.imageId === active.id ?
            'Drag to move · Delete removes · Arrow keys nudge by 1 pixel · Enter edits text' :
            tool === 'arrow' ? 'Drag to draw · Select any annotation to move · Pinch / wheel to zoom' :
            tool === 'text' ? 'Tap to add text · Drag existing text to move · Pinch / wheel to zoom' :
            'Click to select · Drag to move · Double-click text to edit'}</span>
          <span>{format === 'webp' ? 'WebP' : 'JPEG'} · {images.length} image{images.length === 1 ? '' : 's'}</span>
        </footer>
        {error && <div className="draw-error" role="alert">{error}
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error"><HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={1.7} /></button>
        </div>}
      </section>
    </main>
  </div>;
}
