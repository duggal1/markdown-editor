export type ZipEntry = { name: string; file: Blob };

const encoder = new TextEncoder();
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let value = n;
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  crcTable[n] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >>> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function header(size: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

/**
 * ZIP/STORE. Images are already compressed, so wrapping their bytes without
 * recompressing is fast and needs no external dependency.
 */
export async function createImageZip(
  entries: ZipEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  if (entries.length > 65535) throw new Error('A ZIP can contain at most 65,535 images.');
  const output: BlobPart[] = [];
  const central: ArrayBuffer[] = [];
  const { time, day } = dosTimestamp(new Date());
  let offset = 0;
  let centralBytes = 0;

  for (let i = 0; i < entries.length; i++) {
    const name = encoder.encode(entries[i].name);
    const dataBuffer = await entries[i].file.arrayBuffer();
    const data = new Uint8Array(dataBuffer);
    if (name.length > 65535 || data.length > 0xffffffff) {
      throw new Error('An image or file name exceeds the ZIP format limit.');
    }
    const required = 30 + name.length + data.length + 46 + name.length;
    if (offset + centralBytes + required + 22 > 0xffffffff) {
      throw new Error('This batch exceeds 4 GB. Export the images in smaller batches.');
    }
    const crc = crc32(data);
    const local = header(30 + name.length);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true); // UTF-8 filenames
    local.view.setUint16(10, time, true);
    local.view.setUint16(12, day, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, name.length, true);
    local.bytes.set(name, 30);
    output.push(local.bytes.buffer as ArrayBuffer, dataBuffer);

    const directory = header(46 + name.length);
    directory.view.setUint32(0, 0x02014b50, true);
    directory.view.setUint16(4, 20, true);
    directory.view.setUint16(6, 20, true);
    directory.view.setUint16(8, 0x0800, true);
    directory.view.setUint16(12, time, true);
    directory.view.setUint16(14, day, true);
    directory.view.setUint32(16, crc, true);
    directory.view.setUint32(20, data.length, true);
    directory.view.setUint32(24, data.length, true);
    directory.view.setUint16(28, name.length, true);
    directory.view.setUint32(42, offset, true);
    directory.bytes.set(name, 46);
    central.push(directory.bytes.buffer as ArrayBuffer);
    centralBytes += directory.bytes.length;
    offset += local.bytes.length + data.length;
    onProgress?.(i + 1, entries.length);
  }
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, entries.length, true);
  end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, centralBytes, true);
  end.view.setUint32(16, offset, true);
  return new Blob([...output, ...central, end.bytes.buffer as ArrayBuffer], { type: 'application/zip' });
}
