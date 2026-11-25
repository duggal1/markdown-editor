// CSS hex literals, including shorthand and explicit alpha. Never match a
// prefix of a longer identifier or malformed hex token.
export const hexPattern = /(?<![\w#])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![\w-])/gi;

export function normalizeHex(value: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1].toLowerCase();
  if (hex.length < 5) hex = Array.from(hex, c => c + c).join('');
  return '#' + hex;
}

export function hexToHsv(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const v = Math.max(r, g, b), d = v - Math.min(r, g, b);
  const h = !d ? 0 : v === r ? ((g - b) / d + 6) % 6 :
    v === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: v ? d / v : 0, v, a: hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1 };
}

export function hsvToHex(h: number, s: number, v: number, alpha?: number): string {
  const f = (n: number) => {
    const k = (n + ((h % 360 + 360) % 360) / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const byte = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
  return '#' + [f(5), f(3), f(1), ...(alpha === undefined ? [] : [alpha])].map(byte).join('');
}
