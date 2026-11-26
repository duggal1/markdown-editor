// Compact a UUID without a lookup table, truncation, or network request.
// The marker separates encoded UUIDs from legacy document identifiers.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMPACT = /^~[A-Za-z0-9_-]{22}$/;

export function encodeLocalHtmlId(id: string): string {
  if (!UUID.test(id)) return id;
  const hex = id.replaceAll('-', '');
  const bytes = hex.match(/.{2}/g)!.map(value => Number.parseInt(value, 16));
  return '~' + btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeLocalHtmlId(token: string): string {
  if (!COMPACT.test(token)) return token;
  try {
    const bytes = atob(token.slice(1).replaceAll('-', '+').replaceAll('_', '/') + '==');
    if (bytes.length !== 16) return token;
    const hex = Array.from(bytes, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
      hex.slice(16, 20), hex.slice(20)].join('-');
    return encodeLocalHtmlId(id) === token ? id : token;
  } catch { return token; }
}
