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
for(const name of names){ const svg=phosphorMarkup(name); if (name === "file" || name === "globe") { assert.match(svg,/viewBox="0 0 256 256"/); assert.match(svg,/fill="currentColor"/); assert.doesNotMatch(svg,/stroke-width/); } else { assert.match(svg,/viewBox="0 0 24 24"/); assert.match(svg,/fill="none" stroke="currentColor"/); } assert.match(svg,/aria-hidden="true"/); assert.doesNotMatch(svg,/undefined|<script|<image/); const d=svg.match(/ d="([^"]+)"/)[1]; assert.ok(!paths.has(d),name+' geometry is distinct'); paths.add(d); }
assert.ok(phosphorMarkup('file').includes('M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z'));
assert.ok(phosphorMarkup('globe').includes('M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm87.62,96H175.79C174,83.49,159.94,57.67,148.41,42.4A88.19,88.19,0,0,1,215.63,120ZM96.23,136h63.54c-2.31,41.61-22.23,67.11-31.77,77C118.45,203.1,98.54,177.6,96.23,136Zm0-16C98.54,78.39,118.46,52.89,128,43c9.55,9.93,29.46,35.43,31.77,77Zm11.36-77.6C96.06,57.67,82,83.49,80.21,120H40.37A88.19,88.19,0,0,1,107.59,42.4ZM40.37,136H80.21c1.82,36.51,15.85,62.33,27.38,77.6A88.19,88.19,0,0,1,40.37,136Zm108,77.6c11.53-15.27,25.56-41.09,27.38-77.6h39.84A88.19,88.19,0,0,1,148.41,213.6Z'));
assert.doesNotMatch(source,/@phosphor-icons\/core/);
assert.match(read('src/components/Icons.tsx'), /phosphorMarkup\(name\)/);
assert.match(read('src/lib/blockCommands.ts'), /phosphorElement\(/);
assert.doesNotMatch(read('package.json'), /@hugeicons\//);
console.log('Validated '+names.length+' custom Flow SVG icons.');
