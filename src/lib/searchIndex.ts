/**
 * Local-first full-text index. Runs in a Web Worker: no server, vector DB,
 * embeddings, telemetry, or network calls. Indexes full page contents once,
 * then updates only the document that changed.
 */
export type SearchDocument = {
  id: string;
  workspaceId: string;
  title: string;
  markdown: string;
  updatedAt: number;
};
export type SearchHit = {
  id: string;
  score: number;
  snippet: string;
  source: 'title' | 'content';
};
type Weights = { title: number; heading: number; body: number };
type RecordEntry = {
  document: SearchDocument;
  title: string;
  body: string;
  terms: Map<string, Weights>;
  wordCount: number;
};

const WORDS = /[\p{L}\p{N}]+/gu;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.+)$/gm;
const MAX_QUERY_TERMS = 12;
const MAX_RESULTS = 80;

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}
function terms(value: string): string[] {
  return normalize(value).match(WORDS) || [];
}
function snippetFor(record: RecordEntry, query: string, tokens: string[]): {
  snippet: string;
  source: 'title' | 'content';
} {
  const text = record.document.markdown;
  const lowered = text.toLowerCase();
  let index = lowered.indexOf(query);
  if (index < 0) {
    let best = Number.POSITIVE_INFINITY;
    for (const term of tokens) {
      const position = lowered.indexOf(term);
      if (position >= 0 && position < best) best = position;
    }
    index = Number.isFinite(best) ? best : -1;
  }
  if (index < 0) {
    const firstText = text.slice(0, 4096).split(/\n/).find(line => line.trim() && !/^\s*(?:---|\x60{3,}|~{3,})/.test(line)) || '';
    return { snippet: cleanSnippet(firstText).slice(0, 150), source: 'title' };
  }
  // Only slice the small, matched window rather than formatting large pages.
  const start = Math.max(0, index - 48);
  const end = Math.min(text.length, index + Math.max(query.length, 28) + 96);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return {
    snippet: prefix + cleanSnippet(text.slice(start, end)) + suffix,
    source: 'content',
  };
}
function cleanSnippet(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ')
    .replace(/(?:^|\s)#{1,6}\s+/g, ' ')
    .replace(/[\x60*_]+/g, '').trim();
}
export class PageSearchIndex {
  private documents = new Map<string, RecordEntry>();
  private postings = new Map<string, Map<string, Weights>>();
  private totalWords = 0;
  private vocabulary: string[] | null = null;
  private queryCache = new Map<string, SearchHit[]>();

  private invalidate(): void {
    this.vocabulary = null;
    this.queryCache.clear();
  }

  private prefixTerms(prefix: string): string[] {
    const list = this.vocabulary ??= [...this.postings.keys()].sort();
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (list[mid] < prefix) lo = mid + 1; else hi = mid;
    }
    const result: string[] = [];
    for (let i = lo; i < list.length && list[i].startsWith(prefix) && result.length < 28; i++) {
      if (list[i] !== prefix) result.push(list[i]);
    }
    return result;
  }

  reset(documents: SearchDocument[]): void {
    this.documents.clear();
    this.postings.clear();
    this.totalWords = 0;
    this.invalidate();
    for (const document of documents) this.upsert(document);
  }

  upsert(document: SearchDocument): void {
    const previous = this.documents.get(document.id)?.document;
    if (previous && previous.title === document.title && previous.markdown === document.markdown && previous.updatedAt === document.updatedAt && previous.workspaceId === document.workspaceId) return;
    this.remove(document.id);
    this.invalidate();
    const counts = new Map<string, Weights>();
    const add = (term: string, field: keyof Weights) => {
      const weight = counts.get(term) || { title: 0, heading: 0, body: 0 };
      weight[field] = Math.min(24, weight[field] + 1);
      counts.set(term, weight);
    };
    for (const term of terms(document.title)) add(term, 'title');
    for (const match of document.markdown.matchAll(HEADING)) {
      for (const term of terms(match[1])) add(term, 'heading');
    }
    const body = normalize(document.markdown);
    let wordCount = 0;
    for (const match of body.matchAll(WORDS)) { add(match[0], 'body'); wordCount++; }
    const entry: RecordEntry = {
      document,
      title: normalize(document.title),
      body,
      terms: counts,
      wordCount,
    };
    this.documents.set(document.id, entry);
    this.totalWords += entry.wordCount;
    for (const [term, weights] of counts) {
      let matching = this.postings.get(term);
      if (!matching) {
        matching = new Map();
        this.postings.set(term, matching);
      }
      matching.set(document.id, weights);
    }
  }

  remove(id: string): void {
    const existing = this.documents.get(id);
    if (!existing) return;
    this.invalidate();
    for (const term of existing.terms.keys()) {
      const list = this.postings.get(term);
      list?.delete(id);
      if (list?.size === 0) this.postings.delete(term);
    }
    this.totalWords -= existing.wordCount;
    this.documents.delete(id);
  }

  search(rawQuery: string, limit = MAX_RESULTS): SearchHit[] {
    const phrase = normalize(rawQuery.trim());
    const cacheKey = JSON.stringify([phrase, limit]);
    const cached = this.queryCache.get(cacheKey);
    if (cached) { this.queryCache.delete(cacheKey); this.queryCache.set(cacheKey, cached); return cached.map(hit => ({ ...hit })); }
    const words = [...new Set(terms(rawQuery))].slice(0, MAX_QUERY_TERMS);
    if (!words.length) return [];
    const count = this.documents.size;
    if (!count) return [];
    const averageLength = Math.max(1, this.totalWords / count);
    const scores = new Map<string, { score: number; matched: number; title: boolean }>();

    for (const token of words) {
      const postings = this.postings.get(token);
      // Permit partial terms while the user types, but avoid scanning all
      // vocabulary for a 1- or 2-letter prefix.
      const variants: Array<{ values: Map<string, Weights>; factor: number }> = [];
      if (postings) variants.push({ values: postings, factor: 1 });
      if (token.length >= 3 && (!postings || postings.size < 4)) {
        for (const term of this.prefixTerms(token)) {
          const values = this.postings.get(term);
          if (values) variants.push({ values, factor: 0.65 });
        }
      }
      const matchedIds = new Set<string>();
      for (const { values, factor } of variants) {
        const idf = 1 + Math.log(1 + (count - values.size + 0.5) / (values.size + 0.5));
        for (const [id, weights] of values) {
          const document = this.documents.get(id);
          if (!document) continue;
          const current = scores.get(id) || { score: 0, matched: 0, title: false };
          const lengthNorm = 1 - 0.72 + 0.72 * document.wordCount / averageLength;
          const tf = weights.body / (weights.body + 1.3 * lengthNorm || 1);
          current.score += factor * idf *
            (weights.title * 11 + weights.heading * 5 + tf * 3);
          if (weights.title) current.title = true;
          scores.set(id, current);
          matchedIds.add(id);
        }
      }
      for (const id of matchedIds) scores.get(id)!.matched++;
    }

    const hits = [...scores.entries()].map(([id, value]) => {
      const record = this.documents.get(id)!;
      const fullMatch = value.matched === words.length;
      let score = value.score * (fullMatch ? 1.6 : 0.3) +
        (fullMatch ? 5 + 1.2 * words.length : 0);
      if (record.title === phrase) score += 75;
      else if (record.title.includes(phrase)) score += 27;
      if (phrase.length > 2 && record.body.includes(phrase)) score += 18;
      return { id, score };
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, Math.max(1, Math.min(limit, MAX_RESULTS)))
      .map(hit => ({ ...hit, ...snippetFor(this.documents.get(hit.id)!, phrase, words) }));
    this.queryCache.set(cacheKey, hits);
    if (this.queryCache.size > 64) {
      const oldest = this.queryCache.keys().next().value;
      if (oldest !== undefined) this.queryCache.delete(oldest);
    }
    return hits.map(hit => ({ ...hit }));
  }
}
