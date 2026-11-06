import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTaskChecked, taskMarkerEdit } from '../src/lib/taskList.ts';
import { previewParts } from '../src/lib/previewChunks.ts';

assert.deepEqual(taskMarkerEdit('- [ ] One', true), { from: 3, to: 4, insert: 'x' });
assert.equal(taskMarkerEdit('- [x] One', true), null, 'Checking twice must not rewrite content');
assert.equal(taskMarkerEdit('- [X] One', false)?.insert, ' ');
assert.equal(taskMarkerEdit('just [ ] text', true), null, 'Non-list text is not a task');
assert.equal(taskMarkerEdit('- [maybe] text', true), null, 'Invalid task markers stay untouched');
assert.equal(taskMarkerEdit('code: - [ ] text', true), null, 'Inline text stays untouched');

const duplicate = '# Tasks\n- [ ] Same\n- [ ] Same\n- [x] Done';
assert.equal(setTaskChecked(duplicate, 3, true), '# Tasks\n- [ ] Same\n- [x] Same\n- [x] Done');
assert.equal(setTaskChecked(duplicate, 4, false), '# Tasks\n- [ ] Same\n- [ ] Same\n- [ ] Done');
assert.equal(setTaskChecked(duplicate, 1, true), duplicate);
assert.equal(setTaskChecked(duplicate, 99, true), duplicate);
assert.equal(setTaskChecked(duplicate, 0, true), duplicate);
assert.equal(setTaskChecked(duplicate, 2.5, true), duplicate);
assert.equal(setTaskChecked('- [x] Done', 1, true), '- [x] Done');
assert.equal(setTaskChecked('  - [ ] Nested\n    1. [X] Ordered', 2, false),
  '  - [ ] Nested\n    1. [ ] Ordered');
assert.equal(setTaskChecked('> - [ ] Quoted', 1, true), '> - [x] Quoted');
assert.equal(setTaskChecked('> > 2) [ ] Quoted', 1, true), '> > 2) [x] Quoted');
assert.equal(setTaskChecked('Before\r\n- [ ] Windows\r\nAfter', 2, true),
  'Before\r\n- [x] Windows\r\nAfter');
assert.equal(setTaskChecked('- [ ] Tail', 1, true), '- [x] Tail');
const original = '- [ ] Undo\n- [ ] Safe';
assert.equal(setTaskChecked(setTaskChecked(original, 1, true), 1, false), original);

const long = Array.from({ length: 2400 }, (_, i) =>
  '- [ ] Task ' + i + ' with a little extra description').join('\n');
const parts = previewParts(long);
assert.ok(parts.length > 1, 'Long task lists must be virtualized');
let line = 1;
for (const part of parts) {
  if (part.markdown.startsWith('- [ ] ')) {
    const result = setTaskChecked(long, line, true);
    assert.equal(result.split('\n')[line - 1].startsWith('- [x] '), true,
      'Virtualized source line must address the original document');
  }
  line += (part.markdown.match(/\n/g) || []).length;
}
assert.equal(setTaskChecked(long, 2399, true).split('\n')[2398].startsWith('- [x] '), true);
assert.equal(long.split('\n')[2398].startsWith('- [ ] '), true, 'Input stays immutable');

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../src/components/MarkdownPreview.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(preview, /TaskToggleContext\.Provider value=\{onToggleTask\}/);
assert.match(preview, /TaskLineContext\.Provider value=\{taskLine\}/);
assert.match(preview, /onChange=\{event => onToggle\?\.\(line, event\.currentTarget\.checked\)\}/);
assert.match(app, /view\.dispatch\(\{ changes: \{/);
assert.match(app, /onToggleTask=\{onToggleTask\}/);
assert.match(css, /li\.task-list-item input\[type='checkbox'\]:checked/);
assert.match(css, /cursor:pointer; touch-action:manipulation/);

console.log('Task checkbox markers, nested lists, virtualized source lines and integration checks passed.');
