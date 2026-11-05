import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const module = { exports: {} };
const transpiled = ts.transpileModule(read('src/lib/searchIndex.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
runInNewContext(transpiled, { module, exports: module.exports });
const { PageSearchIndex } = module.exports;
const doc = (id, title, markdown, updatedAt = 10) => ({
  id, title, markdown, workspaceId: 'workspace-a', updatedAt,
});
const index = new PageSearchIndex();
index.reset([
  doc('irrelevant-recent', 'Latest Notes', 'Unrelated updates about interface spacing and navigation.', 9999),
  doc('body', 'Investment Notes', 'Our private equity strategy includes renewable energy portfolio acquisitions.', 5),
  doc('heading', 'Weekly Brief', '## Renewable Energy Portfolio\nResearch into new targets.', 1),
  doc('title', 'Renewable Energy Portfolio', 'Overview of this investment project.', 2),
  doc('phrase', 'Investments', 'The team investigates renewable energy portfolio acquisitions with live underwriting.', 3),
]);

assert.equal(index.search('').length, 0);
assert.deepEqual([...index.search('unseenword')].map(x => x.id), []);
assert.equal(index.search('renewable energy portfolio')[0].id, 'title',
  'Exact title must outrank mentions even when its modification date is older.');
assert.equal(index.search('renewable')[0].id, 'title',
  'Title matches should carry greater weight than incidental content.');
const body = index.search('acquisitions');
assert.equal(body.some(x => x.id === 'body'), true, 'Search must include complete Markdown content.');
assert.equal(body.some(x => x.id === 'phrase'), true);
assert.equal(body[0].source, 'content');
assert.match(body[0].snippet, /acquisitions/i);
assert.equal(index.search('Renewable Energy Portfolio').some(x => x.id === 'heading'), true);
assert.equal(index.search('renewa').length >= 3, true, 'Type-ahead prefixes should match indexed terms.');
assert.equal(index.search('unrelated')[0].id, 'irrelevant-recent');

index.upsert(doc('body', 'Investment Notes', 'No longer contains the original subject.', 20));
assert.equal(index.search('acquisitions').some(x => x.id === 'body'), false,
  'Changed content must be removed from the inverted index.');
index.remove('phrase');
assert.equal(index.search('acquisitions').some(x => x.id === 'phrase'), false,
  'Deleted pages must disappear from search.');
index.reset([doc('accent', 'Résumé', 'Café revenue forecasts for Québec.')]);
assert.equal(index.search('resume')[0].id, 'accent',
  'Unicode normalization must permit common accent-insensitive queries.');
assert.equal(index.search('cafe')[0].id, 'accent');
assert.equal(index.search('revenue')[0].id, 'accent');

const huge = Array.from({ length: 6200 }, (_, i) => 'Step ' + i + ': collect diligence evidence.').join('\n') +
  '\nThe final section covers deferred acquisition liabilities and cash flow modeling.';
index.reset([doc('huge', 'Full Deal Plan', huge)]);
const deepHit = index.search('deferred acquisition liabilities');
assert.equal(deepHit[0].id, 'huge',
  'Search must index content at the end of very long plans, not just the first few KB.');
assert.match(deepHit[0].snippet, /deferred acquisition liabilities/);
assert.ok(deepHit[0].snippet.length < 240, 'Excerpts must remain bounded even for huge documents.');
assert.equal(index.search('diligence', 1).length, 1);

const app = read('src/App.tsx');
const tree = read('src/components/WorkspaceTree.tsx');
const style = read('src/styles.css');
const treeStyle = read('src/components/workspace-tree.css');
const worker = read('src/workers/search.ts');

assert.match(worker, /new PageSearchIndex\(\)/);
assert.match(worker, /index\.upsert\(message\.document\)/);
assert.match(worker, /index\.remove\(message\.id\)/);
assert.match(worker, /hits: index\.search\(message\.query\)/);
assert.match(app, /setSearchResults\(event\.data\.hits\)/);
assert.match(app, /searchResults\.flatMap\(hit =>/);
assert.match(app, /aria-keyshortcuts="Meta\+K Control\+K"/);
assert.match(app, /key === 'k' && !event\.shiftKey/);
assert.match(app, /searchRef\.current\?\.select\(\)/);
assert.match(app, /searchHits=\{searchResults\} searchPending=\{searchPending\}/);
assert.match(tree, /filetree-result-snippet/);
assert.match(treeStyle, /\.filetree-result-open/);
assert.match(style, /\.search-field:hover, \.search-field:focus-within \{ background:#151515; \}/);
assert.match(style, /:root\[data-theme='light'\] \.search-field:hover,/);
assert.match(style, /\.search-field \{ padding-inline:10px; \}/);
assert.match(style, /\.search-field kbd \{ padding:0 6px; height:21px; border:0; border-radius:5px; box-shadow:none;/,
  'The Cmd+K badge must not use a border or shadow.');
assert.match(style, /background:#303030; color:#dedede; font:500 10px\/1 var\(--mono\);/,
  'Cmd+K must stand out through a lighter, neutral fill.');
assert.doesNotMatch(worker, /fetch\(|Pinecone|embeddings/i);
console.log('Ranked local full-text search, content indexing, updates and Cmd+K tests passed.');
