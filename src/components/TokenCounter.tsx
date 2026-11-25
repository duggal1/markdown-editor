import { memo, useEffect, useRef, useState } from 'react';
import '@fontsource-variable/instrument-sans/wght.css';
import { countTokensCooperative } from '../lib/tokenizer';
import { countAssetTokens } from '../lib/imageTokens';
import { SCRAMBLE_MS, scrambleDigits } from '../lib/tokenScramble';

type Source = { markdown: string; asset?: Blob; fileType?: 'text' | 'image' | 'binary' };
type Result = { count: number; revision: number };
const format = new Intl.NumberFormat(undefined, { numberingSystem: 'latn' });
const DESCRIPTION = 'Flow lexical tokens: words, identifiers, punctuation, emoji and source markup. Whitespace excluded. Local raster images use 32 × 32 pixel patches; unknown files count as one attachment. Remote images count as source references. Not an LLM token estimate.';

function Digits({ result }: { result: Result }) {
  const target = format.format(result.count);
  const [display, setDisplay] = useState(target);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      mounted.current = true;
      setDisplay(target);
      return;
    }
    let frame = 0, previous = -1;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / SCRAMBLE_MS);
      const step = Math.floor(progress * 8);
      if (step !== previous || progress === 1) {
        previous = step;
        setDisplay(scrambleDigits(target, progress, result.revision));
      }
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    setDisplay(scrambleDigits(target, 0, result.revision));
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, result.revision]);
  return <span className="token-digits" aria-hidden="true">
    <span className="token-digits-measure">{target}</span>
    <span className="token-digits-live">{display.length === target.length ? display : target}</span>
  </span>;
}

/** The counter owns its state; neither counting nor animation re-renders the
 * editor. At most one worker job is in flight, with latest-only coalescing. */
function TokenCounter({ documentId, readSource }: { documentId: string; readSource: (id: string) => Source | undefined }) {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(true);
  useEffect(() => {
    let disposed = false, revision = 0, busy = false, timer: number | undefined;
    let worker: Worker | undefined;
    const schedule = () => {
      if (disposed || busy || timer !== undefined) return;
      timer = window.setTimeout(() => { timer = undefined; submit(); }, 75);
    };
    const complete = (value: Result) => {
      if (disposed) return;
      busy = false;
      if (value.revision === revision) {
        setResult(value); setPending(false);
      } else schedule();
    };
    const submit = () => {
      if (disposed || busy) return;
      const doc = readSource(documentId);
      const job = { revision, source: doc?.markdown || '', asset: doc?.asset, isImage: doc?.fileType === 'image' };
      busy = true;
      if (worker) {
        try { worker.postMessage(job); return; }
        catch { worker.terminate(); worker = undefined; }
      }
      const cancelled = () => disposed || revision !== job.revision;
      void Promise.all([countTokensCooperative(job.source, false, cancelled),
        countAssetTokens(job.asset, job.isImage)]).then(([text, asset]) => {
          const count = text === null ? null : text + asset;
          if (disposed) return;
          if (count === null) { busy = false; schedule(); }
          else complete({ revision: job.revision, count });
        });
    };
    try {
      worker = new Worker(new URL('../workers/tokens.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<Result>) => complete(event.data);
      worker.onerror = () => { worker?.terminate(); worker = undefined; busy = false; schedule(); };
    } catch { /* Cooperative fallback for restricted browsers. */ }
    const onEdit = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== documentId) return;
      revision++; setPending(true); schedule();
    };
    window.addEventListener('flow-token-source', onEdit);
    submit();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      worker?.terminate();
      window.removeEventListener('flow-token-source', onEdit);
    };
  }, [documentId, readSource]);
  return <span className="token-stat" aria-busy={pending} title={DESCRIPTION}
    aria-label={result ? format.format(result.count) + ' tokens' : 'Counting tokens'}>
    {result ? <Digits result={result} /> : <span className="token-digits-live" aria-hidden="true">…</span>}
    <span aria-hidden="true">tokens</span>
  </span>;
}
export default memo(TokenCounter);
