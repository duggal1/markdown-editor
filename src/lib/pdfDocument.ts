import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

/**
 * An actual vector/text PDF, not a canvas screenshot of the editor.
 * 595pt A4 page, 58pt outer measure, one grayscale typographic system.
 * Parsing and rendering run only after the user chooses Export PDF.
 */
type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  depth?: number;
  ordered?: boolean;
  start?: number;
  checked?: boolean | null;
  lang?: string | null;
  url?: string;
  alt?: string;
  align?: Array<'left' | 'right' | 'center' | null>;
};
type PdfPart = string | Record<string, unknown>;
type PdfBlock = Record<string, unknown>;
export type PdfImageAssets = ReadonlyMap<string, string>;
const BLACK = '#181818';
const BODY = '#303030';
const MUTED = '#656565';
const LIGHT = '#E5E5E5';
const PAPER = '#FFFFFF';
const WASH = '#F6F6F6';
const contentWidth = 595.28 - 116;

function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const value = new URL(url);
    return /^(https?:|mailto:)$/i.test(value.protocol) ? value.href : undefined;
  } catch { return undefined; }
}
function inline(nodes: MdNode[] = [], attrs: Record<string, unknown> = {}): PdfPart[] {
  const out: PdfPart[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (Object.keys(attrs).length) out.push({ text: node.value || '', ...attrs });
      else out.push(node.value || '');
    } else if (node.type === 'inlineCode') {
      out.push({ text: node.value || '', fontSize: 9.2, color: BLACK, background: '#F0F0F0', ...attrs });
    } else if (node.type === 'strong') out.push(...inline(node.children, { ...attrs, bold: true }));
    else if (node.type === 'emphasis') out.push(...inline(node.children, { ...attrs, italics: true }));
    else if (node.type === 'delete') out.push(...inline(node.children, { ...attrs, decoration: 'lineThrough' }));
    else if (node.type === 'link') {
      const link = safeUrl(node.url);
      out.push(...inline(node.children, {
        ...attrs, color: BLACK, decoration: 'underline',
        ...(link ? { link } : {}),
      }));
    } else if (node.type === 'image') {
      const text = node.alt || 'Image';
      const link = safeUrl(node.url);
      out.push({ text, color: MUTED, italics: true, ...(link ? { link } : {}) });
    } else if (node.type === 'break') out.push('\n');
    else if (node.type === 'html') {
      // Raw HTML markup should never be executed or put into PDF content.
      const text = (node.value || '').replace(/<[^>]*>/g, '').trim();
      if (text) out.push({ text, ...attrs });
    } else if (node.children) out.push(...inline(node.children, attrs));
    else if (node.value) out.push({ text: node.value, ...attrs });
  }
  return out.length ? out : [''];
}

function imageBlock(node: MdNode, images: PdfImageAssets): PdfBlock {
  const source = node.url || '';
  const data = images.get(source) ||
    (/^data:image\/(?:png|jpe?g);base64,/i.test(source) && source.length < 6_000_000 ? source : '');
  if (data) {
    return {
      image: data, fit: [contentWidth, 290], alignment: 'center',
      margin: [0, 9, 0, 13],
    };
  }
  const link = safeUrl(source);
  return {
    text: [{ text: node.alt || 'Image', italics: true, color: MUTED,
      ...(link ? { link, decoration: 'underline' } : {}) }],
    margin: [0, 7, 0, 12],
  };
}

function blocks(nodes: MdNode[], images: PdfImageAssets, inList = false): PdfBlock[] {
  const out: PdfBlock[] = [];
  for (const node of nodes) {
    if (node.type === 'heading') {
      const level = Math.max(1, Math.min(6, node.depth || 2));
      out.push({
        text: inline(node.children),
        style: 'h' + level,
        headlineLevel: level,
        margin: level === 1 ? [0, 10, 0, 19] :
          level === 2 ? [0, 24, 0, 11] : [0, 17, 0, 8],
      });
    } else if (node.type === 'paragraph') {
      const children = node.children || [];
      if (children.length === 1 && children[0].type === 'image') {
        out.push(imageBlock(children[0], images));
      } else {
        out.push({
          text: inline(children), style: 'body',
          margin: inList ? [0, 0, 0, 4] : [0, 0, 0, 12],
        });
      }
    } else if (node.type === 'list') {
      const items = (node.children || []).map(item => {
        const itemBlocks = blocks(item.children || [], images, true);
        if (item.checked !== null && item.checked !== undefined) {
          const prefix = item.checked ? '[x] ' : '[ ] ';
          const first = itemBlocks[0];
          if (first && Array.isArray(first.text)) first.text = [prefix, ...first.text];
          else itemBlocks.unshift({ text: prefix, style: 'body' });
        }
        // A full stack keeps paragraphs and nested lists together as a
        // single logical item. pdfmake paginates long list items as needed.
        return itemBlocks.length === 1 ? itemBlocks[0] : { stack: itemBlocks };
      });
      out.push({
        ...(node.ordered ? { ol: items, start: node.start || 1 } : { ul: items }),
        style: 'list', markerColor: BODY,
        margin: inList ? [8, 2, 0, 6] : [4, 3, 0, 12],
      });
    } else if (node.type === 'code') {
      const label = (node.lang || '').trim().slice(0, 24);
      const raw = node.value || '';
      const content = [
        ...(label ? [{ text: label.toUpperCase(), style: 'codeLabel', margin: [0, 0, 0, 8] }] : []),
        { text: raw || ' ', style: 'code', wordBreak: 'break-all' },
      ];
      out.push({
        table: { widths: ['*'], body: [[{
          stack: content, fillColor: WASH,
          margin: [10, 9, 10, 9],
        }]] },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          paddingLeft: () => 0, paddingRight: () => 0,
          paddingTop: () => 0, paddingBottom: () => 0,
        },
        margin: [0, 5, 0, 16],
      });
    } else if (node.type === 'blockquote') {
      const body = blocks(node.children || [], images);
      out.push({
        table: { widths: ['*'], body: [[{ stack: body, fillColor: '#FAFAFA' }]] },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: (index: number) => index === 0 ? 2 : 0,
          vLineColor: () => '#777777',
          paddingLeft: () => 13, paddingRight: () => 11,
          paddingTop: () => 10, paddingBottom: () => 7,
        },
        margin: [0, 4, 0, 16],
      });
    } else if (node.type === 'thematicBreak') {
      out.push({
        canvas: [{ type: 'line', x1: 0, y1: 1, x2: contentWidth, y2: 1,
          lineWidth: 0.65, lineColor: LIGHT }],
        margin: [0, 12, 0, 23],
      });
    } else if (node.type === 'table') {
      const rows = node.children || [];
      const columnCount = Math.max(1, ...rows.map(row => (row.children || []).length));
      const body = rows.map((row, rowIndex) =>
        Array.from({ length: columnCount }, (_, col) => {
          const cell = row.children?.[col];
          return {
            text: inline(cell?.children || []),
            style: rowIndex === 0 ? 'tableHead' : 'tableCell',
            fillColor: rowIndex === 0 ? '#F3F3F3' : PAPER,
            alignment: node.align?.[col] || 'left',
          };
        }));
      if (body.length) out.push({
        table: {
          headerRows: 1, dontBreakRows: true,
          widths: Array.from({ length: columnCount }, () => '*'),
          body,
        },
        layout: {
          hLineWidth: (i: number) => i === 0 ? 0 : 0.65,
          vLineWidth: () => 0,
          hLineColor: () => '#DDDDDD',
          paddingTop: () => 8, paddingBottom: () => 8,
          paddingLeft: () => 9, paddingRight: () => 9,
        },
        margin: [0, 7, 0, 17],
      });
    } else if (node.type === 'image') {
      out.push(imageBlock(node, images));
    } else if (node.type === 'html') {
      const readable = (node.value || '').replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (readable) out.push({ text: readable, style: 'body', margin: [0, 0, 0, 12] });
    } else if (node.children) {
      out.push(...blocks(node.children, images, inList));
    } else if (node.value) {
      out.push({ text: node.value, style: 'body', margin: [0, 0, 0, 12] });
    }
  }
  return out;
}

export function parsePdfMarkdown(markdown: string): MdNode {
  const withoutFrontmatter = markdown.replace(
    /^\uFEFF?---\r?\n[\s\S]{0,12000}?\r?\n---\r?\n/, '',
  );
  return unified().use(remarkParse).use(remarkGfm).parse(withoutFrontmatter) as unknown as MdNode;
}

export function pdfImageUrls(markdown: string): string[] {
  const root = parsePdfMarkdown(markdown);
  const urls = new Set<string>();
  const visit = (node: MdNode) => {
    if (node.type === 'image' && node.url && /^https?:\/\//i.test(node.url)) {
      if (urls.size < 24) urls.add(node.url);
    }
    node.children?.forEach(visit);
  };
  visit(root);
  return [...urls];
}

export function buildPdfDefinition(
  markdown: string, title: string, images: PdfImageAssets = new Map(),
): TDocumentDefinitions {
  const root = parsePdfMarkdown(markdown);
  const safeTitle = (title || 'Untitled').trim().slice(0, 160) || 'Untitled';
  const nodes = root.children || [];
  const hasTopHeading = nodes.some(node => node.type === 'heading' && node.depth === 1);
  const content: PdfBlock[] = [];
  if (!hasTopHeading) content.push({
    text: safeTitle, style: 'h1', headlineLevel: 1,
    margin: [0, 2, 0, 21],
  });
  content.push(...blocks(nodes, images));
  if (!content.length) content.push({ text: safeTitle, style: 'h1' });

  const definition = {
    info: { title: safeTitle, creator: 'Flow', producer: 'Flow PDF Export' },
    pageSize: 'A4', pageOrientation: 'portrait',
    pageMargins: [58, 68, 58, 64],
    content,
    defaultStyle: {
      font: 'Roboto', fontSize: 10.4, color: BODY,
      lineHeight: 1.48,
    },
    styles: {
      h1: { fontSize: 25, bold: true, color: BLACK, lineHeight: 1.13 },
      h2: { fontSize: 16, bold: true, color: BLACK, lineHeight: 1.21 },
      h3: { fontSize: 12.4, bold: true, color: BLACK, lineHeight: 1.30 },
      h4: { fontSize: 11.1, bold: true, color: BLACK, lineHeight: 1.32 },
      h5: { fontSize: 10.5, bold: true, color: BLACK, lineHeight: 1.36 },
      h6: { fontSize: 10.3, bold: true, color: MUTED, lineHeight: 1.36 },
      body: { fontSize: 10.4, color: BODY, lineHeight: 1.48 },
      list: { fontSize: 10.4, color: BODY, lineHeight: 1.45 },
      code: { fontSize: 8.8, color: BLACK, lineHeight: 1.35 },
      codeLabel: { fontSize: 8.1, bold: true, color: MUTED, characterSpacing: 0.5 },
      tableHead: { fontSize: 9.1, bold: true, color: BLACK, lineHeight: 1.3 },
      tableCell: { fontSize: 9.1, color: BODY, lineHeight: 1.32 },
    },
    header: (page: number) => page === 1 ? { text: '' } : {
      text: safeTitle, color: '#969696', fontSize: 8.2,
      alignment: 'right', margin: [58, 31, 58, 0],
    },
    footer: (page: number, total: number) => ({
      margin: [58, 0, 58, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: contentWidth, y2: 0,
          lineWidth: 0.5, lineColor: LIGHT }], margin: [0, 0, 0, 10] },
        {
          columns: [
            { text: safeTitle, fontSize: 8, color: MUTED, width: '*' },
            { text: page + ' / ' + total, fontSize: 8, color: MUTED,
              width: 'auto', alignment: 'right' },
          ],
        },
      ],
    }),
    pageBreakBefore: (
      current: { headlineLevel?: number },
      following: unknown[],
      _next: unknown[],
      previous: unknown[],
    ) => Boolean(current.headlineLevel && !following.length && previous.length),
  };
  return definition as unknown as TDocumentDefinitions;
}
