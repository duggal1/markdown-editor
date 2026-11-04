import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HugeiconsIcon } from '@hugeicons/react';
import * as icons from '@hugeicons/core-free-icons';

const source = readFileSync(new URL('../src/components/Icons.tsx', import.meta.url), 'utf8');
const start = source.indexOf('const glyphs = {');
const end = source.indexOf('} as const;', start);
assert.ok(start >= 0 && end > start, 'Hugeicons map must exist');
const names = [...source.slice(start, end).matchAll(/(?:^|[\n,])\s*(\w+):\s*(\w+Icon)\s*[,\n]/g)];
assert.ok(names.length >= 30, 'Expected all app and Draw controls to be mapped to Hugeicons');
for (const [, key, iconName] of names) {
  const definition = icons[iconName];
  assert.ok(definition, `Missing Hugeicons icon: ${key} -> ${iconName}`);
  const html = renderToStaticMarkup(createElement(HugeiconsIcon, {
    icon: definition, size: 17, strokeWidth: 1.8,
  }));
  assert.match(html, /<svg\b/, `SVG skeleton missing for ${key}`);
  assert.match(html, /<(?:path|circle|rect|line|polyline|polygon)\b/, `No visible shapes for ${key}`);
}
// A cosmetic pixel overlay must NEVER hide the real SVG in fallback scenarios.
assert.ok(!/visibility:\s*ready\s*\?/.test(source), 'Never hide the original SVG for masking');
assert.match(source, /<HugeiconsIcon icon=\{glyphs\[name\]\}/);
console.log(`Validated ${names.length} Hugeicons SVG glyphs and persistent vector fallbacks.`);
