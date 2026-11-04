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
const names = [...source.slice(start, end).matchAll(/(\w+):\s*(\w+Icon)\s*(?=,|\n)/g)];
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
// No client-side icon masking, canvas thresholding, or hidden vector sources.
assert.doesNotMatch(source, /rasterCache|createElement\(['"]canvas|\.toDataURL\(|PixelatedIcon|maskStyle|imageRendering/);
assert.match(source, /<HugeiconsIcon icon=\{glyphs\[name\]\}/);
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.doesNotMatch(css, /\.pixel-huge-icon-paint|\.pixel-huge-icon-source/);
assert.match(css, /\.pixel-huge-icon-subtle svg\s*\{\s*shape-rendering:crispEdges;/);
assert.match(css, /\.pixel-sidebar-toggle::after/);
assert.match(source, /name === 'sidebar' \? ' pixel-sidebar-toggle'/);
const drawSource = readFileSync(new URL('../src/draw/DrawPage.tsx', import.meta.url), 'utf8');
const flowSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(drawSource, /from '\.\.\/components\/Icons'/);
assert.match(flowSource, /from '\.\/components\/Icons'/);
assert.doesNotMatch(source, /rasterCache|canvas|toDataURL/);
assert.match(css, /\.save-indicator\[data-save-state='saved'\]::before/);
assert.match(css, /background:\s*#ea580c;\s*opacity:/);
console.log(`Validated ${names.length} unmodified Hugeicons SVG glyphs and sharp saving indicator.`);
