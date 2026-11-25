/** Flow spatial image tokens: non-overlapping 32px source-space rectangles.
 * This defines a patch representation, not an AI model's visual embeddings. */
export const IMAGE_PATCH_SIZE = 32;
export type Dimensions = { width: number; height: number };
export type ImagePatch = Dimensions & { x: number; y: number };
function valid(width: number, height: number): Dimensions | null {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
    width > 0 && height > 0 && width <= 1_000_000 && height <= 1_000_000
    ? { width, height } : null;
}
export function imagePatchCount(width: number, height: number): number {
  if (!valid(width,height)) throw new RangeError('Invalid image dimensions');
  return Math.ceil(width / IMAGE_PATCH_SIZE) * Math.ceil(height / IMAGE_PATCH_SIZE);
}
export function* imagePatches(width: number, height: number): Generator<ImagePatch> {
  if (!valid(width,height)) throw new RangeError('Invalid image dimensions');
  for (let y=0;y<height;y+=IMAGE_PATCH_SIZE)
    for (let x=0;x<width;x+=IMAGE_PATCH_SIZE)
      yield { x,y,width:Math.min(IMAGE_PATCH_SIZE,width-x),height:Math.min(IMAGE_PATCH_SIZE,height-y) };
}
const HEADER_LIMIT = 256 * 1024;
function ascii(bytes: Uint8Array, from: number, value: string): boolean {
  return from + value.length <= bytes.length &&
    Array.from(value).every((c,i)=>bytes[from+i]===c.charCodeAt(0));
}
/** Bounded header inspection avoids decompressing common large images. */
export async function imageDimensions(asset: Blob): Promise<Dimensions | null> {
  const bytes = new Uint8Array(await asset.slice(0, HEADER_LIMIT).arrayBuffer());
  const v = new DataView(bytes.buffer), n = bytes.length;
  if (n >= 24 && bytes[0]===137 && ascii(bytes,1,'PNG') && bytes[4]===13 && bytes[5]===10 &&
      bytes[6]===26 && bytes[7]===10 && ascii(bytes,12,'IHDR'))
    return valid(v.getUint32(16),v.getUint32(20));
  if (n >= 10 && (ascii(bytes,0,'GIF87a') || ascii(bytes,0,'GIF89a')))
    return valid(v.getUint16(6,true),v.getUint16(8,true));
  if (n >= 26 && ascii(bytes,0,'BM')) {
    const header = v.getUint32(14,true);
    if (header === 12) return valid(v.getUint16(18,true),v.getUint16(20,true));
    if (header >= 40) return valid(v.getInt32(18,true),Math.abs(v.getInt32(22,true)));
  }
  if (n>=22 && v.getUint16(0,true)===0 && v.getUint16(2,true)===1) {
    // ICO may contain several resolutions. Represent its largest directory entry.
    const count = v.getUint16(4,true);
    if (count>0 && 6+count*16<=n) {
      let best: Dimensions|null=null;
      for(let i=0;i<count;i++){
        const w=bytes[6+i*16]||256,h=bytes[7+i*16]||256;
        if(!best||w*h>best.width*best.height)best={width:w,height:h};
      }
      return best;
    }
  }
  if (n >= 30 && ascii(bytes,0,'RIFF') && ascii(bytes,8,'WEBP')) {
    const u24=(i:number)=>bytes[i]+bytes[i+1]*256+bytes[i+2]*65536;
    if(ascii(bytes,12,'VP8X'))return valid(1+u24(24),1+u24(27));
    if(ascii(bytes,12,'VP8L')&&bytes[20]===47){
      const bits=v.getUint32(21,true);
      return valid((bits&0x3fff)+1,((bits>>>14)&0x3fff)+1);
    }
    if(ascii(bytes,12,'VP8 ')&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42)
      return valid(v.getUint16(26,true)&0x3fff,v.getUint16(28,true)&0x3fff);
  }
  if(n>=4&&bytes[0]===255&&bytes[1]===216){
    let i=2;
    while(i+3<n){
      if(bytes[i++]!==255)break;
      while(i<n&&bytes[i]===255)i++;
      if(i>=n)break;
      const marker=bytes[i++];
      if(marker===217||marker===218)break;
      if(marker===1||(marker>=208&&marker<=215))continue;
      if(i+2>n)break;
      const length=v.getUint16(i);
      if(length<2||i+length>n)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8)
        return valid(v.getUint16(i+5),v.getUint16(i+3));
      i+=length;
    }
  }
  // AVIF and rare valid containers: use the native decoder if present.
  // Avoid unbounded decode of unrecognized large files or arbitrary MIME types.
  if(asset.size<=16*1024*1024 && /^image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i.test(asset.type) &&
    typeof createImageBitmap==='function') {
    try {
      const bitmap=await createImageBitmap(asset);
      try{return valid(bitmap.width,bitmap.height);}finally{bitmap.close();}
    }catch{ /* Invalid or unsupported image. */ }
  }
  return null;
}
export async function countAssetTokens(asset: Blob|undefined, isImage: boolean): Promise<number> {
  if(!asset)return 0;
  if(!isImage)return 1;
  try{
    const dimensions=await imageDimensions(asset);
    return dimensions?imagePatchCount(dimensions.width,dimensions.height):1;
  }catch{return 1;}
}
