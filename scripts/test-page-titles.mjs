import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = name => readFileSync(new URL('../src/lib/' + name, import.meta.url), 'utf8');
const transpile = value => ts.transpileModule(value, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const code = { exports: {} };
runInNewContext(transpile(source('code.ts')), {
  module: code, exports: code.exports,
  require: name => {
    if (name === './htmlPreview') return {
      looksLikeHtml: text => /^\s*(?:<!doctype html|<html\b|<p\b)/i.test(text),
    };
    throw new Error('Unexpected import ' + name);
  },
});
const title = { exports: {} };
runInNewContext(transpile(source('title.ts')), {
  module: title, exports: title.exports,
  require: name => {
    if (name === './code') return code.exports;
    throw new Error('Unexpected import ' + name);
  },
});
const { inferTitle, isUntitledTitle } = title.exports;

assert.equal(inferTitle('# Investment Thesis\n\nLong body...'), 'Investment Thesis');
assert.equal(inferTitle('Introductory paragraph\n\n## Screen Studio Core Features\n\nMore text'),
  'Screen Studio Core Features', 'First Markdown header wins over prose.');
assert.equal(inferTitle('---\ntitle: draft\n---\n\n# Real Title\n\nText'), 'Real Title');
assert.equal(inferTitle('```markdown\n# Not the title\n```\n\n## Actual Title'), 'Actual Title');
assert.equal(inferTitle('My Roadmap\n==========\n\nA paragraph.'), 'My Roadmap');
assert.equal(inferTitle('## **Bold** [Plan](https://example.com) ###'), 'Bold Plan');
assert.equal(inferTitle('```swift\nfunc main() {}\n```'), 'Swift code');
assert.equal(inferTitle('import SwiftUI\n\nstruct Home: View {\n var body: some View { Text("Hello") }\n}'), 'Swift code');
assert.equal(inferTitle('fn main() {\n    println!("Hello");\n}'), 'Rust code');
assert.equal(inferTitle('def hello():\n    print("Hi")\n'), 'Python code');
assert.equal(inferTitle('{ "foo": 1, "bar": 2 }'), 'JSON data');
assert.equal(inferTitle('A plain first line\n\nMore prose.'), 'A plain first line');
assert.equal(inferTitle(' \n\n  '), 'Untitled');
assert.equal(isUntitledTitle('Untitled'), true);
assert.equal(isUntitledTitle('Untitled document'), true);
assert.equal(isUntitledTitle('Quarterly Report'), false);

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(app, /title: 'Untitled', titleAuto: true/, 'New pages must opt into automatic titles');
assert.match(app, /current\.titleAuto \|\| \(!current\.fileName && isUntitledTitle\(current\.title\)\)/);
assert.match(app, /inferTitle\(value, current\.language\)/);
assert.match(app, /function changeTitle\(value: string\)/);
assert.match(app, /title: value, titleAuto: false/, 'Manual title entry must lock the name');
assert.match(app, /<motion\.button type="button" \{\.\.\.pressMotion\} className="copy-all-button"/);
assert.match(app, /editorRef\.current\?\.state\.doc\.toString\(\) \?\? current\.markdown/);
assert.match(app, /navigator\.clipboard\?\.writeText/);
assert.match(app, /document\.execCommand\('copy'\)/);
assert.match(app, /setNotice\('Entire page copied'\)/);
assert.match(css, /\.formatting-actions \.copy-all-button \{/);
assert.match(css, /\.formatting-actions \.copy-all-button span \{ display:none; \}/);
console.log('Auto titles, manual-title protection, long-page copy and iOS toolbar checks passed.');
