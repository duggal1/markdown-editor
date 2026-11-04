export type Point = { x: number; y: number };
export type ArrowStyle = 'pixel' | 'solid' | 'line' | 'fine';
export type ArrowAnnotation = {
  kind: 'arrow'; color: string; x1: number; y1: number; x2: number; y2: number;
  style?: ArrowStyle;
};
export type TextAnnotation = {
  kind: 'text'; color: string; x: number; y: number; text: string;
};
export type Annotation = ArrowAnnotation | TextAnnotation;
export type OutputFormat = 'webp' | 'jpeg';

export function drawAnnotation(
  ctx: CanvasRenderingContext2D, annotation: Annotation, width: number, height: number,
) {
  const scale = Math.min(width, height);
  ctx.save();
  if (annotation.kind === 'arrow') {
    const x1 = annotation.x1 * width;
    const y1 = annotation.y1 * height;
    const x2 = annotation.x2 * width;
    const y2 = annotation.y2 * height;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length < 2) { ctx.restore(); return; }
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const widthPx = Math.max(2.6, Math.min(15, scale * 0.0045));
    const head = Math.min(length * 0.44, Math.max(13, Math.min(65, scale * 0.024)));
    // Export and preview call this same renderer at native image coordinates.
    // Existing arrows without a style retain the previous solid appearance.
    const style = annotation.style || 'solid';
    if (style === 'pixel') {
      // A real integer cell lattice, not a pixel filter over a smooth arrow.
      // Quantizing to full source pixels keeps the export crisp on any display.
      const cell = Math.max(3, Math.min(8, Math.round(scale / 175)));
      const ux = (x2 - x1) / length, uy = (y2 - y1) / length;
      const nx = -uy, ny = ux;
      const headLength = Math.min(length * 0.42, Math.max(18, Math.min(54, scale * 0.032)));
      const snap = (value: number) => Math.round(value / cell) * cell;
      ctx.fillStyle = annotation.color;
      const pixel = (x: number, y: number) =>
        ctx.fillRect(snap(x - cell / 2), snap(y - cell / 2), cell, cell);
      for (let t = 0; t <= length - headLength; t += cell * 0.62) {
        pixel(x1 + ux * t, y1 + uy * t);
      }
      // Stepped triangular head: one tip cell, expanding in discrete columns.
      const steps = Math.max(2, Math.ceil(headLength / cell));
      for (let i = 0; i <= steps; i++) {
        const back = Math.min(headLength, i * cell);
        const spread = Math.floor((back / headLength) * 3) * cell;
        for (let offset = -spread; offset <= spread; offset += cell) {
          pixel(x2 - ux * back + nx * offset, y2 - uy * back + ny * offset);
        }
      }
    } else {
      const fine = style === 'fine';
      ctx.strokeStyle = annotation.color;
      ctx.fillStyle = annotation.color;
      ctx.lineWidth = fine ? Math.max(1.5, widthPx * 0.45) :
        style === 'line' ? Math.max(1.9, widthPx * 0.72) : widthPx;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      if (style === 'line') {
        // Open arrow: no filled wedge, dot, double stroke or halo.
        const wing = Math.min(length * 0.3, head * 0.75);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.moveTo(x2 - wing * Math.cos(angle - Math.PI / 6),
          y2 - wing * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2, y2);
        ctx.lineTo(x2 - wing * Math.cos(angle + Math.PI / 6),
          y2 - wing * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
      } else {
        const tip = fine ? head * 0.62 : head;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 - Math.cos(angle) * tip * 0.70,
          y2 - Math.sin(angle) * tip * 0.70);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - tip * Math.cos(angle - Math.PI / 7),
          y2 - tip * Math.sin(angle - Math.PI / 7));
        ctx.lineTo(x2 - tip * Math.cos(angle + Math.PI / 7),
          y2 - tip * Math.sin(angle + Math.PI / 7));
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
    return;
  }

  // A compact annotation label: dark surface + selected ink, readable on busy UI.
  const lines = annotation.text.split('\n').slice(0, 6);
  const font = Math.max(14, Math.min(48, scale * 0.026));
  const lineHeight = font * 1.35;
  const padX = font * 0.53;
  const padY = font * 0.38;
  ctx.font = '500 ' + font + 'px -apple-system, BlinkMacSystemFont, Arial, sans-serif';
  ctx.textBaseline = 'top';
  const maxText = Math.max(0, ...lines.map(line => ctx.measureText(line).width));
  const boxW = Math.min(width, maxText + padX * 2);
  const boxH = lines.length * lineHeight + padY * 2;
  const x = Math.max(0, Math.min(annotation.x * width, width - boxW));
  const y = Math.max(0, Math.min(annotation.y * height, height - boxH));
  const radius = Math.max(3, font * 0.2);
  ctx.fillStyle = 'rgba(20, 19, 19, 0.93)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, radius);
  ctx.fill();
  ctx.fillStyle = annotation.color;
  lines.forEach((line, index) => ctx.fillText(line, x + padX,
    y + padY + index * lineHeight, Math.max(1, boxW - padX * 2)));
  ctx.restore();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the uploaded image.'));
    image.src = url;
  });
}

export async function renderExport(
  url: string, annotations: Annotation[], format: OutputFormat,
  quality = 0.92,
): Promise<Blob> {
  const image = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The image encoder is unavailable in this browser.');
  try {
    // JPEG has no alpha. Flatten to white instead of generating black transparency.
    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image, 0, 0);
    annotations.forEach(annotation => drawAnnotation(ctx, annotation, canvas.width, canvas.height));
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
    const result = await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob(blob => {
          if (blob && blob.type === mime) resolve(blob);
          else reject(new Error(format.toUpperCase() + ' export is unsupported by this browser. Choose JPEG or WebP.'));
        }, mime, quality);
      } catch (error) { reject(error); }
    });
    return result;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export type AnnotationHit = { index: number; part: 'body' | 'start' | 'end' };

/**
 * Hit tests use the same image-relative geometry as drawing and exporting.
 * Tolerance remains approximately 10 screen pixels while zoomed.
 */
export function hitTestAnnotation(
  annotations: Annotation[], point: Point, width: number, height: number,
  zoom = 1,
): AnnotationHit | null {
  const x = point.x * width;
  const y = point.y * height;
  const tolerance = 11 / Math.max(0.25, zoom);
  const ctx = document.createElement('canvas').getContext('2d');
  for (let index = annotations.length - 1; index >= 0; index--) {
    const annotation = annotations[index];
    if (annotation.kind === 'arrow') {
      const ax = annotation.x1 * width;
      const ay = annotation.y1 * height;
      const bx = annotation.x2 * width;
      const by = annotation.y2 * height;
      // Body first: clicking the shaft never accidentally grabs its endpoint.
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      const dist = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      if (dist <= tolerance + Math.max(2.6, Math.min(15, Math.min(width, height) * 0.0045)) / 2) {
        const tipTolerance = tolerance * 1.1;
        if (Math.hypot(x - bx, y - by) < tipTolerance) return { index, part: 'end' };
        if (Math.hypot(x - ax, y - ay) < tipTolerance) return { index, part: 'start' };
        return { index, part: 'body' };
      }
      continue;
    }
    if (!ctx) continue;
    const scale = Math.min(width, height);
    const font = Math.max(14, Math.min(48, scale * 0.026));
    const lineHeight = font * 1.35;
    const padX = font * 0.53;
    const padY = font * 0.38;
    const lines = annotation.text.split('\n').slice(0, 6);
    ctx.font = '500 ' + font + 'px -apple-system, BlinkMacSystemFont, Arial, sans-serif';
    const boxWidth = Math.min(width,
      Math.max(0, ...lines.map(line => ctx.measureText(line).width)) + padX * 2);
    const boxHeight = lines.length * lineHeight + padY * 2;
    const left = Math.max(0, Math.min(annotation.x * width, width - boxWidth));
    const top = Math.max(0, Math.min(annotation.y * height, height - boxHeight));
    if (x >= left - tolerance && x <= left + boxWidth + tolerance &&
      y >= top - tolerance && y <= top + boxHeight + tolerance) {
      return { index, part: 'body' };
    }
  }
  return null;
}
