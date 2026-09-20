# Plain

A quiet, local-first Markdown editor built with React 19, TypeScript and Vite 8.

## Features

- Distraction-free writing, split view and rendered preview
- GitHub-flavored Markdown: tables, task lists, links, blockquotes and fenced code
- Syntax-colored code for JavaScript, TypeScript, Python, Bash, JSON, CSS, HTML/XML and Rust, with line numbers and copy
- Light and dark themes, responsive layout, reduced-motion support
- Autosave in browser localStorage; no account, database or data upload
- Import .md/.markdown/.txt by file picker or drop; download .md
- Format toolbar and keyboard shortcuts (Cmd/Ctrl+B, I, K, E; Cmd/Ctrl+S to download; Cmd/Ctrl+Shift+P to toggle preview)

## Run

Requires Node.js 22.12+ (or 20.19+).

```bash
npm install
npm run dev
npm run build
```

No secrets or back-end are required. Deploy as a static Vite project on Vercel with `npm run build` and output directory `dist`.

## Design methodology

Design adapted from [Appllama's app-design and usage skills](https://github.com/Appllama/appllama-skills): one neutral family; fixed spacing and radius rhythm; semantic light/dark colors; clear type hierarchy; native HTML controls; feedback without gratuitous motion; keyboard-first and responsive UX. Expo/iOS-specific implementation rules are not appropriate for a Vite web app.

## Privacy

Documents remain in the current browser's localStorage. They are not synced or backed up. Download a Markdown file for a durable copy. Opening a new document replaces the current locally saved document.
