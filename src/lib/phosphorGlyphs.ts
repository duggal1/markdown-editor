import sidebarGlyph from '@phosphor-icons/core/assets/regular/sidebar-simple.svg?raw';
import searchGlyph from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw';
import plusGlyph from '@phosphor-icons/core/assets/regular/plus.svg?raw';
import fileGlyph from '@phosphor-icons/core/assets/regular/file-text.svg?raw';
import folderGlyph from '@phosphor-icons/core/assets/regular/folder.svg?raw';
import backGlyph from '@phosphor-icons/core/assets/regular/arrow-left.svg?raw';
import forwardGlyph from '@phosphor-icons/core/assets/regular/arrow-right.svg?raw';
import chevronGlyph from '@phosphor-icons/core/assets/regular/caret-right.svg?raw';
import downloadGlyph from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';
import uploadGlyph from '@phosphor-icons/core/assets/regular/upload-simple.svg?raw';
import moonGlyph from '@phosphor-icons/core/assets/regular/moon.svg?raw';
import sunGlyph from '@phosphor-icons/core/assets/regular/sun.svg?raw';
import eyeGlyph from '@phosphor-icons/core/assets/regular/eye.svg?raw';
import splitGlyph from '@phosphor-icons/core/assets/regular/columns.svg?raw';
import editGlyph from '@phosphor-icons/core/assets/regular/pencil-simple.svg?raw';
import linkGlyph from '@phosphor-icons/core/assets/regular/link-simple.svg?raw';
import codeGlyph from '@phosphor-icons/core/assets/regular/code.svg?raw';
import quoteGlyph from '@phosphor-icons/core/assets/regular/quotes.svg?raw';
import listGlyph from '@phosphor-icons/core/assets/regular/list-bullets.svg?raw';
import todoGlyph from '@phosphor-icons/core/assets/regular/list-checks.svg?raw';
import closeGlyph from '@phosphor-icons/core/assets/regular/x.svg?raw';
import trashGlyph from '@phosphor-icons/core/assets/regular/trash.svg?raw';
import moreGlyph from '@phosphor-icons/core/assets/regular/dots-three.svg?raw';
import menuGlyph from '@phosphor-icons/core/assets/regular/list.svg?raw';
import historyGlyph from '@phosphor-icons/core/assets/regular/clock-counter-clockwise.svg?raw';
import copyGlyph from '@phosphor-icons/core/assets/regular/copy.svg?raw';
import checkGlyph from '@phosphor-icons/core/assets/regular/check.svg?raw';
import bookmarkGlyph from '@phosphor-icons/core/assets/regular/bookmark-simple.svg?raw';
import svgGlyph from '@phosphor-icons/core/assets/regular/image-square.svg?raw';
import terminalGlyph from '@phosphor-icons/core/assets/regular/terminal.svg?raw';
import cursorGlyph from '@phosphor-icons/core/assets/regular/cursor.svg?raw';
import textGlyph from '@phosphor-icons/core/assets/regular/text-t.svg?raw';
import arrowUpRightGlyph from '@phosphor-icons/core/assets/regular/arrow-up-right.svg?raw';
import imageAddGlyph from '@phosphor-icons/core/assets/regular/image.svg?raw';
import undoGlyph from '@phosphor-icons/core/assets/regular/arrow-u-up-left.svg?raw';
import formatGlyph from '@phosphor-icons/core/assets/regular/magic-wand.svg?raw';
import boldGlyph from '@phosphor-icons/core/assets/regular/text-b.svg?raw';
import italicGlyph from '@phosphor-icons/core/assets/regular/text-italic.svg?raw';
import settingsGlyph from '@phosphor-icons/core/assets/regular/gear-six.svg?raw';
import lockGlyph from '@phosphor-icons/core/assets/regular/lock-simple.svg?raw';
import globeGlyph from '@phosphor-icons/core/assets/regular/globe.svg?raw';
import globeOffGlyph from '@phosphor-icons/core/assets/regular/warning-circle.svg?raw';
import h1Glyph from '@phosphor-icons/core/assets/regular/text-h-one.svg?raw';
import h2Glyph from '@phosphor-icons/core/assets/regular/text-h-two.svg?raw';
import h3Glyph from '@phosphor-icons/core/assets/regular/text-h-three.svg?raw';
import h4Glyph from '@phosphor-icons/core/assets/regular/text-h-four.svg?raw';
import numberGlyph from '@phosphor-icons/core/assets/regular/list-numbers.svg?raw';
import dividerGlyph from '@phosphor-icons/core/assets/regular/minus.svg?raw';
import tableGlyph from '@phosphor-icons/core/assets/regular/table.svg?raw';
import htmlGlyph from '@phosphor-icons/core/assets/regular/code-block.svg?raw';
import gripGlyph from '@phosphor-icons/core/assets/regular/dots-six-vertical.svg?raw';

// All markup is imported at build time from Phosphor; never interpolate user text.
const glyphs = {
  sidebar: sidebarGlyph,
  search: searchGlyph,
  plus: plusGlyph,
  file: fileGlyph,
  folder: folderGlyph,
  back: backGlyph,
  forward: forwardGlyph,
  chevron: chevronGlyph,
  download: downloadGlyph,
  upload: uploadGlyph,
  moon: moonGlyph,
  sun: sunGlyph,
  eye: eyeGlyph,
  split: splitGlyph,
  edit: editGlyph,
  link: linkGlyph,
  code: codeGlyph,
  quote: quoteGlyph,
  list: listGlyph,
  todo: todoGlyph,
  close: closeGlyph,
  trash: trashGlyph,
  more: moreGlyph,
  menu: menuGlyph,
  history: historyGlyph,
  copy: copyGlyph,
  check: checkGlyph,
  bookmark: bookmarkGlyph,
  svg: svgGlyph,
  terminal: terminalGlyph,
  cursor: cursorGlyph,
  text: textGlyph,
  arrowUpRight: arrowUpRightGlyph,
  imageAdd: imageAddGlyph,
  undo: undoGlyph,
  format: formatGlyph,
  bold: boldGlyph,
  italic: italicGlyph,
  settings: settingsGlyph,
  lock: lockGlyph,
  globe: globeGlyph,
  globeOff: globeOffGlyph,
  h1: h1Glyph,
  h2: h2Glyph,
  h3: h3Glyph,
  h4: h4Glyph,
  number: numberGlyph,
  divider: dividerGlyph,
  table: tableGlyph,
  html: htmlGlyph,
  grip: gripGlyph,
} as const;
export type IconName = keyof typeof glyphs;
export function phosphorMarkup(name: IconName): string {
  return glyphs[name].replace(/fill="(?:#000000|#000|black)"/gi, 'fill="currentColor"')
    .replace(/<svg\b/, '<svg aria-hidden="true" focusable="false"')
    .replace(/\bwidth="[^"]*"/, 'width="100%"').replace(/\bheight="[^"]*"/, 'height="100%"');
}
export function phosphorElement(name: IconName, size = 16): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = phosphorMarkup(name);
  const svg = template.content.querySelector('svg')!;
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  return svg;
}
