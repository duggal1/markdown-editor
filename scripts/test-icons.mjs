import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('src/lib/phosphorGlyphs.ts');
const names = [...source.matchAll(/^\s+"([A-Za-z0-9]+)":\s+"/gm)].map(m=>m[1]);
assert.ok(names.length >= 60);
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {phosphorMarkup}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const paths=new Set();
for(const name of names){ const svg=phosphorMarkup(name); assert.match(svg,/viewBox="0 0 24 24"/); assert.match(svg,/fill="none" stroke="currentColor"/); assert.match(svg,/aria-hidden="true"/); assert.doesNotMatch(svg,/undefined|<script|<image/); const d=svg.match(/ d="([^"]+)"/)[1]; assert.ok(!paths.has(d),name+' geometry is distinct'); paths.add(d); }
assert.doesNotMatch(source,/@phosphor-icons\/core/);
assert.match(read('src/components/Icons.tsx'), /phosphorMarkup\(name\)/);
assert.match(read('src/lib/blockCommands.ts'), /phosphorElement\(/);
assert.doesNotMatch(read('package.json'), /@hugeicons\//);
console.log('Validated '+names.length+' custom Flow SVG icons.');
