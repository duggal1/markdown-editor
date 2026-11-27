// Public, read-only GitHub context. No credentials, model tool rounds or arbitrary URLs.
export type PublicRepo = { name: string; fullName: string; description: string; language: string; archived: boolean };
export type RepoCatalog = { repos: PublicRepo[]; complete: boolean };
const API = 'https://api.github.com';
const TTL = 15 * 60_000;
const LIMIT = 6000;
const catalogCache = new Map<string, { value: RepoCatalog; expires: number }>();
const detailCache = new Map<string, { value: string; expires: number }>();
const userPattern = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
const repoPattern = /^[a-z0-9_.-]{1,100}$/i;
export function githubOwner(input: string): string {
  let owner = input.trim().replace(/^@/, '');
  if (/^https?:\/\//i.test(owner)) {
    try {
      const url = new URL(owner);
      if (url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.port) return '';
      owner = url.pathname.split('/').filter(Boolean)[0] || '';
    } catch { return ''; }
  } else owner = owner.split('/')[0];
  return userPattern.test(owner) && !owner.includes('--') ? owner.toLowerCase() : '';
}
function clean(value: unknown, limit: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}
async function request(path: string, signal: AbortSignal, fetcher: typeof fetch, accept = 'application/vnd.github+json') {
  const response = await fetcher(API + path, { signal, credentials: 'omit', headers: { Accept: accept } });
  if (response.status === 403 || response.status === 429) throw Error('GitHub rate limit reached. Try again later.');
  if (response.status === 404) throw Error('GitHub account or repository not found.');
  if (!response.ok) throw Error('GitHub is temporarily unavailable.');
  return response;
}
export async function publicRepos(owner: string, signal: AbortSignal, fetcher = fetch, refresh = false): Promise<RepoCatalog> {
  if (githubOwner(owner) !== owner) throw Error('Enter a valid GitHub username.');
  const cached = catalogCache.get(owner);
  if (!refresh && cached && cached.expires > Date.now()) return cached.value;
  const repos = new Map<string, PublicRepo>();
  let complete = false;
  // A 20-page guard prevents unbounded work. Ordinary accounts are fully paginated.
  for (let page = 1; page <= 20; page++) {
    const response = await request('/users/' + owner + '/repos?type=owner&sort=full_name&direction=asc&per_page=100&page=' + page, signal, fetcher);
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw Error('Invalid GitHub response.');
    for (const item of data) {
      if (!item || item.private !== false || typeof item.name !== 'string' || !repoPattern.test(item.name) || String(item.owner?.login).toLowerCase() !== owner) continue;
      repos.set(item.name.toLowerCase(), { name: item.name, fullName: owner + '/' + item.name, description: clean(item.description, 220), language: clean(item.language, 40), archived: item.archived === true });
    }
    if (data.length < 100 || (response.headers.has('link') && !/rel="next"/.test(response.headers.get('link') || ''))) { complete = true; break; }
  }
  const value = { repos: [...repos.values()], complete };
  if (catalogCache.size >= 8) catalogCache.delete(catalogCache.keys().next().value!);
  catalogCache.set(owner, { value, expires: Date.now() + TTL });
  return value;
}
function normalized(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
export function matchRepos(input: string, repos: PublicRepo[]) {
  const words = ' ' + normalized(input) + ' ';
  const lower = input.toLowerCase();
  return repos.map(repo => {
    const name = normalized(repo.name);
    const explicit = lower.includes(repo.fullName.toLowerCase()) && new RegExp('(?:^|[^a-z0-9_.-])' + repo.fullName.toLowerCase().replace(/[.*+?^$(){}|[\]\\]/g, '\\$&') + '(?:$|[^a-z0-9_.-])').test(lower);
    return { repo, score: explicit ? 1000 : name.length >= 3 && words.includes(' ' + name + ' ') ? name.length : 0 };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(item => item.repo);
}
async function readPrefix(response: Response, limit: number) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = '';
  try {
    while (result.length < limit) {
      const { value, done } = await reader.read();
      if (done) { result += decoder.decode(); break; }
      result += decoder.decode(value, { stream: true });
    }
    return result.slice(0, limit);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function repoDetail(repo: PublicRepo, signal: AbortSignal, fetcher: typeof fetch) {
  const cached = detailCache.get(repo.fullName);
  if (cached && cached.expires > Date.now()) return cached.value;
  const path = '/repos/' + repo.fullName;
  // Parallel, bounded read-only tools; a missing README or root listing is non-fatal.
  const results = await Promise.allSettled([
    request(path + '/readme', signal, fetcher, 'application/vnd.github.raw+json').then(response => readPrefix(response, 1400)),
    request(path + '/contents', signal, fetcher).then(response => response.json()).then(data => Array.isArray(data) ? data.slice(0, 70).map(item => clean(item?.name, 80)).filter(Boolean).join(', ').slice(0, 500) : '')
  ]);
  const readme = results[0].status === 'fulfilled' ? results[0].value : '';
  const root = results[1].status === 'fulfilled' ? results[1].value : '';
  const value = [readme && 'README excerpt: ' + readme, root && 'Root entries: ' + root].filter(Boolean).join('\n');
  if (value && results.every(result => result.status === 'fulfilled')) {
    if (detailCache.size >= 24) detailCache.delete(detailCache.keys().next().value!);
    detailCache.set(repo.fullName, { value, expires: Date.now() + TTL });
  }
  return value;
}
export async function repoContext(input: string, catalog: RepoCatalog, signal: AbortSignal, fetcher = fetch) {
  if (!catalog.repos.length) return '';
  const matched = matchRepos(input, catalog.repos);
  // Context from the exact repos first; no source fetch for unrelated tasks.
  const details = await Promise.all(matched.map(async repo => {
    const detail = await repoDetail(repo, signal, fetcher);
    return [repo.fullName, repo.language, repo.description, repo.archived ? 'Archived' : '', detail].filter(Boolean).join('\n').slice(0, 1750);
  }));
  if (signal.aborted && !details.length && !catalog.repos.length) return '';
  const header = 'Public GitHub metadata only. ' + (catalog.complete ? '' : 'Catalog is partial. ') + 'Do not infer implementation or ownership beyond these records.';
  let context = [header, ...details].join('\n\n').slice(0, LIMIT);
  for (const repo of catalog.repos) {
    if (matched.includes(repo)) continue;
    const line = '\n' + [repo.fullName, repo.language, repo.description].filter(Boolean).join(' | ');
    if (context.length + line.length > LIMIT) break;
    context += line;
  }
  return context;
}
