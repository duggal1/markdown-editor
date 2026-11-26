// Run from the candidate checkout with Playwright installed.
// Usage: node scripts/benchmark-browser.mjs <before-dist> <after-dist> [iterations] [documents] [bytes-per-document]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { strict as assert } from 'node:assert';

const [before, after, iterations = '50', count = '100', size = '20480'] = process.argv.slice(2);
const runs = Number(iterations), docs = Number(count), bytes = Number(size);
assert(before && after && Number.isInteger(runs) && runs > 0 && runs <= 200 &&
  Number.isInteger(docs) && docs >= 2 && docs <= 2000 &&
  Number.isInteger(bytes) && bytes >= 256 && bytes <= 10_000_000, 'Invalid benchmark arguments');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.png': 'image/png' };
async function serve(root) {
  root = resolve(root);
  await stat(resolve(root, 'index.html'));
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/__flow_benchmark_seed') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end('<!doctype html><title>Fixture setup</title>'); return;
      }
      let file = resolve(root, '.' + decodeURIComponent(path));
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      if (file === root || !extname(file)) file = resolve(root, 'index.html');
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': file.includes(sep + 'assets' + sep) ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(await readFile(file));
    } catch { res.end(); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(ok => server.close(ok)) };
}
const title = i => 'Benchmark document ' + String(i).padStart(4, '0');
async function seed(page, url) {
  await page.goto(url + '/__flow_benchmark_seed');
  await page.evaluate(async ({ docs, bytes }) => {
    const db = await new Promise((ok, fail) => {
      const request = indexedDB.open('flow.workspace.v1', 2);
      request.onupgradeneeded = () => {
        for (const store of ['workspaces', 'folders', 'documents']) request.result.createObjectStore(store, { keyPath: 'id' });
      };
      request.onsuccess = () => ok(request.result);
      request.onerror = () => fail(request.error);
    });
    await new Promise((ok, fail) => {
      const tx = db.transaction(['workspaces', 'documents'], 'readwrite');
      tx.objectStore('workspaces').put({ id: 'bench', name: 'Benchmark', createdAt: 1 });
      for (let i = 0; i < docs; i++) {
        const name = 'Benchmark document ' + String(i).padStart(4, '0');
        const prefix = '# ' + name + '\n\n';
        const paragraph = 'The synthetic workspace contains ordinary prose for the reproducible latency benchmark.\n\n';
        const markdown = prefix + paragraph.repeat(Math.ceil((bytes - prefix.length) / paragraph.length)).slice(0, bytes - prefix.length);
        tx.objectStore('documents').put({ id: 'doc-' + i, workspaceId: 'bench', title: name, titleAuto: false,
          markdown, createdAt: i + 1, updatedAt: i + 1 });
      }
      tx.oncomplete = ok; tx.onerror = () => fail(tx.error); tx.onabort = () => fail(tx.error);
    });
    db.close();
    localStorage.setItem('flow.preferences.v1', JSON.stringify({ theme: 'dark', mode: 'write',
      sidebarOpen: true, activeWorkspaceId: 'bench', activeDocumentId: 'doc-0', recentIds: ['doc-0'],
      expandedWorkspaceIds: ['bench'] }));
  }, { docs, bytes });
}
async function ready(page, name) {
  await page.waitForFunction(name => {
    const editor = document.querySelector('.cm-content');
    return editor && editor.textContent.includes(name) && editor.getBoundingClientRect().height > 0;
  }, name, { timeout: 30000 });
  return page.evaluate(() => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(performance.now())))));
}
async function startup(page, url, warm) {
  if (warm) await page.reload({ waitUntil: 'commit' });
  else await page.goto(url, { waitUntil: 'commit' });
  const editorReady = await ready(page, title(0));
  return page.evaluate(editorReady => ({ editorReady, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    ttfb: performance.getEntriesByType('navigation')[0]?.responseStart ?? null }), editorReady);
}
async function navigate(page, i) {
  const start = await page.evaluate(name => {
    const button = [...document.querySelectorAll('button.filetree-label')].find(el => el.title === name);
    if (!button) throw Error('Missing page ' + name);
    const start = performance.now(); button.click(); return start;
  }, title(i));
  return (await ready(page, title(i))) - start;
}
async function sample(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    await context.addInitScript(() => {
      window.__bench = { documentPuts: 0, longTasks: [] };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'documents') window.__bench.documentPuts++;
        return put.apply(this, args);
      };
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        new PerformanceObserver(list => window.__bench.longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
      }
    });
    const page = await context.newPage();
    await seed(page, url);
    const cold = await startup(page, url, false);
    const warm = await startup(page, url, true);
    // Allow startup maintenance to settle; not included in readiness timing.
    await page.waitForTimeout(400);
    const writesBefore = await page.evaluate(() => window.__bench.documentPuts);
    const navigation = await navigate(page, 1);
    const returnNavigation = await navigate(page, 0);
    await page.waitForTimeout(400);
    const cleanNavigationWrites = (await page.evaluate(() => window.__bench.documentPuts)) - writesBefore;
    const search = page.getByRole('textbox', { name: 'Search page names and content' });
    await search.evaluate(el => el.addEventListener('input', () => performance.mark('benchmark:search-start'), { once: true }));
    await search.fill(title(1));
    await page.waitForFunction(name => [...document.querySelectorAll('.filetree-result-title')].some(el => el.textContent === name), title(1));
    const searchMs = await page.evaluate(() => new Promise(ok => requestAnimationFrame(() => ok(performance.now() - performance.getEntriesByName('benchmark:search-start').at(-1).startTime))));
    const diagnostics = await page.evaluate(() => ({ longTasks: window.__bench.longTasks, heapBytes: performance.memory?.usedJSHeapSize ?? null }));
    return { cold, warm, navigation, returnNavigation, cleanNavigationWrites, searchMs, ...diagnostics };
  } finally { await context.close(); }
}
function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { n: sorted.length, p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) };
}
function summarize(samples) {
  return Object.fromEntries(Object.entries({
    coldEditorReadyMs: samples.map(s => s.cold.editorReady), warmEditorReadyMs: samples.map(s => s.warm.editorReady),
    coldFcpMs: samples.map(s => s.cold.fcp), coldTtfbMs: samples.map(s => s.cold.ttfb),
    navigationMs: samples.map(s => s.navigation), returnNavigationMs: samples.map(s => s.returnNavigation),
    searchMs: samples.map(s => s.searchMs), cleanNavigationWrites: samples.map(s => s.cleanNavigationWrites),
    longTaskCount: samples.map(s => s.longTasks.length), heapBytes: samples.map(s => s.heapBytes)
  }).map(([name, values]) => [name, stats(values)]));
}
const servers = [], samples = { before: [], after: [] };
let browser;
try {
  servers.push(await serve(before)); servers.push(await serve(after));
  browser = await chromium.launch();
  // Alternate order to reduce systematic warm-up or thermal bias.
  for (let i = 0; i < runs; i++) {
    for (const index of i % 2 ? [1, 0] : [0, 1]) {
      const key = index ? 'after' : 'before';
      samples[key].push(await sample(browser, servers[index].url));
    }
    console.log('Completed pair ' + (i + 1) + '/' + runs);
  }
  const report = { fixture: { docs, bytesPerDocument: bytes, iterations: runs }, browser: browser.version(),
    platform: process.platform, architecture: process.arch, node: process.version,
    methodology: 'Fresh browser context and seeded IndexedDB per pair; cold means cold HTTP cache, warm means reload. Navigation uses the real button handler and two animation frames after editor text is visible. Local HTTP only; no cloud throughput claims.',
    before: summarize(samples.before), after: summarize(samples.after), samples };
  await mkdir('test-artifacts', { recursive: true });
  await writeFile('test-artifacts/browser-performance.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ before: report.before, after: report.after }, null, 2));
} finally {
  await browser?.close();
  await Promise.all(servers.map(s => s.close()));
}
