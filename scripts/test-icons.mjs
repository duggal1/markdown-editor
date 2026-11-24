import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('src/lib/phosphorGlyphs.ts');
const names = [...source.matchAll(/@phosphor-icons\/core\/assets\/regular\/([a-z0-9-]+)\.svg\?raw/g)];
assert.ok(names.length >= 40);
for (const [, name] of names) {
  const svg = read('node_modules/@phosphor-icons/core/assets/regular/' + name + '.svg');
  assert.match(svg, /<svg\b/);
  assert.match(svg, /<(?:path|circle|rect|line|polyline|polygon)\b/);
}
assert.match(read('src/components/Icons.tsx'), /phosphorMarkup\(name\)/);
assert.match(read('src/lib/blockCommands.ts'), /phosphorElement\(/);
assert.doesNotMatch(read('package.json'), /@hugeicons\//);
assert.match(read('src/styles.css'), /\.phosphor-icon svg \{[^}]*fill:currentColor/);
console.log('Validated ' + names.length + ' official Phosphor SVG assets.');
