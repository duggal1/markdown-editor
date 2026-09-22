export type Point = { x: number; y: number };
export type ArrowAnnotation = {
  kind: 'arrow'; color: string; x1: number; y1: number; x2: number; y2: number;
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
    // One opaque color. No white halo, no start dot, no white arrow-tip artifact.
    ctx.strokeStyle = annotation.color;
    ctx.fillStyle = annotation.color;
    ctx.lineWidth = widthPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7),
      y2 - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7),
      y2 - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
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
