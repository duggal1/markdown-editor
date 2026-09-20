# Flow

A local-first, multi-workspace Markdown editor built with React 19, TypeScript, Vite 8, CodeMirror 6, Motion, and Geist Sans.

## Features

- Multiple named workspaces and Markdown documents, with local full-text search and recent-document navigation.
- IndexedDB persistence for document bodies, localStorage for UI preferences and an emergency last-edit snapshot. No account or network sync.
- CodeMirror editor with viewport rendering, fenced-language support, formatting shortcuts, and fast edits in long documents.
- Write, Split, and Preview modes remembered across reloads; light/dark theme and sidebar state remembered.
- GitHub-flavored Markdown, task lists, tables, code blocks with numbered lines and copy actions, plus sandboxed SVG code preview.
- Custom SVG Flow identity and favicon, responsive sidebar and reduced-motion-aware UI transitions.
- Import Markdown/text files and export Markdown locally.

## Develop

Requires Node 22.12+ (or 20.19+):

```bash
npm install
npm run dev
npm run build
```

## Privacy and durability

Documents stay in this browser, not on a server. Browser storage is not a backup; export important documents regularly. For very large documents, CodeMirror virtualizes editor lines; rendering a full Markdown preview still depends on content complexity and device performance.
