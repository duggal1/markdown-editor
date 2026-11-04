import { previewParts } from './previewChunks';

export type PreparedPreview = {
  source: string;
  chunks: string[];
  firstLines: number[];
  continuations: boolean[];
};

/**
 * Two bounded caches, not a framework:
 * 1) prepared Markdown sections / source lines
 * 2) per-code-block highlighting in MarkdownPreview
 *
 * Very large content is never retained in this cache.
 */
const preparedCache = new Map<string, PreparedPreview>();
const MAX_ENTRIES = 4;
const MAX_SOURCE_CHARS = 2_000_000;

export function buildPreviewSections(source: string): PreparedPreview {
  const parts = previewParts(source);
  const chunks: string[] = [];
  const firstLines: number[] = [];
  const continuations: boolean[] = [];
  let line = 1;
  for (const part of parts) {
    chunks.push(part.markdown);
    firstLines.push(line);
    continuations.push(part.continuesList);
    for (let i = 0; i < part.markdown.length; i++) {
      if (part.markdown.charCodeAt(i) === 10) line++;
    }
  }
  return { source, chunks, firstLines, continuations };
}

export function cachedPreview(source: string): PreparedPreview | null {
  const found = preparedCache.get(source);
  if (!found) return null;
  preparedCache.delete(source);
  preparedCache.set(source, found);
  return found;
}

export function cachePreview(result: PreparedPreview): PreparedPreview {
  if (result.source.length > MAX_SOURCE_CHARS) return result;
  preparedCache.delete(result.source);
  preparedCache.set(result.source, result);
  while (preparedCache.size > MAX_ENTRIES) {
    const oldest = preparedCache.keys().next().value;
    if (oldest === undefined) break;
    preparedCache.delete(oldest);
  }
  return result;
}

export function immediatePreview(source: string): PreparedPreview {
  return cachedPreview(source) || cachePreview(buildPreviewSections(source));
}

const inFlight = new Map<number, {
  resolve: (value: PreparedPreview) => void;
  reject: (error: Error) => void;
}>();
let previewWorker: Worker | null = null;
let nextRequest = 0;

function availableWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (previewWorker) return previewWorker;
  try {
    const worker = new Worker(new URL('../workers/preview.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{
      requestId: number; chunks: string[]; firstLines: number[]; continuations: boolean[];
    }>) => {
      const request = inFlight.get(event.data.requestId);
      if (!request) return;
      inFlight.delete(event.data.requestId);
      // Source is held only by the promise closure, not copied back by worker.
      request.resolve({ source: '', chunks: event.data.chunks, firstLines: event.data.firstLines,
        continuations: event.data.continuations });
    };
    worker.onerror = () => {
      for (const task of inFlight.values()) task.reject(new Error('Preview worker unavailable'));
      inFlight.clear();
      worker.terminate();
      previewWorker = null;
    };
    previewWorker = worker;
    return worker;
  } catch { return null; }
}

/** Offload section splitting of large Markdown, falling back safely. */
export async function preparePreview(source: string): Promise<PreparedPreview> {
  const cached = cachedPreview(source);
  if (cached) return cached;
  if (source.length < 80_000) return immediatePreview(source);
  const worker = availableWorker();
  if (!worker) return immediatePreview(source);
  const requestId = ++nextRequest;
  try {
    const payload = await new Promise<PreparedPreview>((resolve, reject) => {
      inFlight.set(requestId, { resolve, reject });
      try { worker.postMessage({ requestId, source }); }
      catch (error) { inFlight.delete(requestId); reject(error instanceof Error ? error : new Error('Preview worker failed')); }
    });
    return cachePreview({ ...payload, source });
  } catch {
    return immediatePreview(source);
  }
}
