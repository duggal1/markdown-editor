import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { countTokens, tokenize, countTokensCooperative, TOKENIZER_VERSION } from '../src/lib/tokenizer.ts';
import { scrambleDigits, SCRAMBLE_MS } from '../src/lib/tokenScramble.ts';

assert.equal(TOKENIZER_VERSION, 'flow-lexical-v1');
const tokens = text => [...tokenize(text)].map(x=>x.value);
assert.deepEqual(tokens('Hello, world!'), ['Hello', ',', 'world', '!']);
assert.deepEqual(tokens('const x = "hello";'), ['const','x','=','"','hello','"',';']);
assert.deepEqual(tokens("don't"), ['don',"'",'t']);
assert.deepEqual(tokens('e\u0301 café देवनागरी'), ['e\u0301','café','देवनागरी']);
assert.deepEqual(tokens('你好世界'), ['你','好','世','界']);
assert.deepEqual(tokens('👩🏽‍💻 🇮🇳 1️⃣'), ['👩🏽‍💻','🇮🇳','1️⃣']);
assert.deepEqual(tokens('abc日本123'), ['abc','日','本','123']);
assert.equal(countTokens(' \r\n\t\u00a0'),0);
assert.equal(countTokens(''),0);
assert.equal(countTokens('',true),1);
assert.equal(countTokens('![cat](pic.png)'),9);
assert.deepEqual(tokens('<svg viewBox="0 0 24 24"/>'), ['<','svg','viewBox','=','"','0','0','24','24','"','/','>']);
assert.equal(countTokens('<svg viewBox="0 0 24 24"/>'),12);
for(const text of ['# Markdown\n\n**bold**', 'á 👩🏽‍💻 🏳️‍🌈', '<path d="M1 2L3 4"/>', 'a\u0000b', 'a\ud800b']) {
  const found = [...tokenize(text)];
  assert.equal(found.length,countTokens(text));
  assert.equal(found.map(t=>text.slice(t.start,t.end)).join(''),found.map(t=>t.value).join(''));
  let offset=0;
  for(const t of found){ assert.match(text.slice(offset,t.start),/^\s*$/u);offset=t.end; }
  assert.match(text.slice(offset),/^\s*$/u);
}
assert.equal(await countTokensCooperative('hello!',false,()=>false),2);
assert.equal(await countTokensCooperative('x '.repeat(10000),false,()=>true),null);
for(let p=0;p<1;p+=.05){const out=scrambleDigits('12,345',p,7);assert.match(out,/^\d{2},\d{3}$/);assert.equal(out.length,6);}
assert.notEqual(scrambleDigits('12,345',0,7),'12,345');
assert.equal(scrambleDigits('12,345',1,7),'12,345');
assert.ok(SCRAMBLE_MS<=200);
const fixture=('const x = "hello"; // code\n<svg viewBox="0 0 24 24"/>\n').repeat(20000);
const start=performance.now();
const count=countTokens(fixture);
const elapsed=performance.now()-start;
assert.equal(count, countTokens('const x = "hello"; // code\n<svg viewBox="0 0 24 24"/>\n')*20000);
console.log('Flow lexical benchmark:',JSON.stringify({characters:fixture.length,tokens:count,elapsedMs:Number(elapsed.toFixed(2))}));
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const app=read('src/App.tsx'), css=read('src/styles.css'), counter=read('src/components/TokenCounter.tsx');
assert.doesNotMatch(app,/wordCount|setWords|word-stat/);
assert.match(app,/<TokenCounter key=\{activeId\}/);
assert.match(app,/flow-token-source/);
assert.match(counter,/Instrument Sans|instrument-sans\/wght.css/);
assert.match(counter,/value.revision === revision/);
assert.match(counter,/prefers-reduced-motion: reduce/);
assert.match(counter,/worker\?\.terminate\(\)/);
assert.match(css,/\.token-stat \{[^}]*'Instrument Sans Variable'[^}]*letter-spacing:-\.025em[^}]*font-smoothing:antialiased/);
console.log('Tokenizer exact fixtures, source coverage, attachment semantics, fallback and scramble tests passed.');
