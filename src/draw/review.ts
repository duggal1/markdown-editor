type Box = { left: number; top: number; right: number; bottom: number };
type Finding = { issue: string; probability: number; confidence: number; box: Box };
export type ReviewFinding = Omit<Finding,'box'> & { arrow: { x1: number; y1: number; x2: number; y2: number } };
const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const clamp = (value: number) => Math.max(0, Math.min(1,value));
async function prepare(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1568 / Math.max(bitmap.width,bitmap.height), Math.max(1,280 / Math.min(bitmap.width,bitmap.height)));
    const width = Math.max(1,Math.round(bitmap.width*scale)), height = Math.max(1,Math.round(bitmap.height*scale));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(280,width); canvas.height = Math.max(280,height);
    const x = Math.floor((canvas.width-width)/2), y = Math.floor((canvas.height-height)/2);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Image processing unavailable');
    try {
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(bitmap,x,y,width,height);
      const jpeg = await new Promise<Blob>((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Could not encode screenshot')), 'image/jpeg',.86));
      const data = await new Promise<string>((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(Error('Could not read screenshot'));
        reader.readAsDataURL(jpeg);
      });
      if (!data || data.length > 2_000_000) throw Error('Screenshot is too large to review');
      return { data, width, height, x, y, canvasWidth:canvas.width, canvasHeight:canvas.height };
    } finally { canvas.width=0; canvas.height=0; }
  } finally { bitmap.close(); }
}
export async function reviewScreenshot(file: File,intent: string,key: string,signal: AbortSignal): Promise<ReviewFinding[]> {
  signal.throwIfAborted();
  const p=await prepare(file);
  signal.throwIfAborted();
  const response=await fetch('/api/draw-review',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','x-flow-draw-key':key},signal,body:JSON.stringify({image:p.data,intent})});
  const result=await response.json();
  if(!response.ok) throw Error(typeof result.error==='string'?result.error:'Review unavailable');
  if(!Array.isArray(result.findings)) throw Error('Invalid review result');
  const output: ReviewFinding[]=[];
  for(const f of result.findings.slice(0,5) as Finding[]) {
    if(!f || typeof f.issue!=='string' || !unit(f.probability) || !unit(f.confidence) || !f.box ||
      ![f.box.left,f.box.right,f.box.top,f.box.bottom].every(unit)) continue;
    const left=(f.box.left*p.canvasWidth-p.x)/p.width, right=(f.box.right*p.canvasWidth-p.x)/p.width;
    const top=(f.box.top*p.canvasHeight-p.y)/p.height, bottom=(f.box.bottom*p.canvasHeight-p.y)/p.height;
    if(right<=0 || bottom<=0 || left>=1 || top>=1 || right<=left || bottom<=top) continue;
    const x2=clamp((left+right)/2), y2=clamp((top+bottom)/2);
    // Choose the nearest viable outside edge, without changing the target.
    const tails=[{x:clamp(left-.12),y:y2},{x:clamp(right+.12),y:y2},{x:x2,y:clamp(top-.12)},{x:x2,y:clamp(bottom+.12)}];
    tails.sort((a,b)=>Math.hypot(b.x-x2,b.y-y2)-Math.hypot(a.x-x2,a.y-y2));
    const tail=tails[0];
    output.push({issue:f.issue,probability:f.probability,confidence:f.confidence,arrow:{x1:tail.x,y1:tail.y,x2,y2}});
  }
  return output;
}
