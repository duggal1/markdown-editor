<div align="center">
  <img src="./public/flow.svg" alt="Flow logo" width="80" height="80" />
  <h1>Flow</h1>
  <p><strong>A quieter place to write, think, and make things.</strong></p>
  <p>A local-first Markdown workspace with a serious code editor, a considered preview, and a focused screenshot annotation studio.</p>
</div>

<p align="center">
  <a href="#the-product">Product</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#the-decisions">The decisions</a> ·
  <a href="#development">Development</a>
</p>

---

## The idea

Most writing tools compete by adding more: accounts, AI buttons, collaboration layers, databases, elaborate toolbars. Flow starts with a different question:

**What does a tool need to do exceptionally well before it deserves to do anything else?**

For Flow, the answer is straightforward: make writing feel immediate, make the output trustworthy, keep the user's work under their control, and stay out of the way.

The technology is important, but it is not the differentiator. **Product judgment, taste, system design, and architecture are the work.** They determine which capabilities belong together, where boundaries should exist, how complexity is contained, and which features are better left unbuilt.

## The product

**Write.** A CodeMirror 6 editor with Markdown-aware editing, language support, formatting shortcuts, and viewport-based rendering. Write, Split, and Preview modes let the interface follow the task instead of forcing one layout.

**Organize.** Multiple workspaces, folders, document movement, recent documents, and local search. Import Markdown, code, text, images, and other files; export the original content without a proprietary document format.

**Preview.** GitHub-flavored Markdown with tables, task lists, syntax-highlighted code, copy actions, and source-aware scroll alignment. Standalone HTML and SVG have purpose-built previews. Large Markdown documents and code blocks take a different, virtualized rendering path.

**Draw.** A separate surface at `/draw` for annotating screenshots with arrows and text. Inspect with zoom and pan, edit annotations, and export a single image or a batch as JPEG/WebP and ZIP. It shares the visual language of Flow without turning the writing editor into an image-editing framework.

**Stay local.** Documents, workspaces, and folders are stored in the browser. There is no account to create and no document-sync backend.

## Architecture

Flow is a **client-side, local-first React application**, organized around explicit browser capabilities rather than a server-driven application architecture.

~~~text
Browser
├── /                          Markdown workspace
│   ├── React                  UI and workspace coordination
│   ├── CodeMirror 6           Source editing
│   ├── Preview pipeline       GFM, sanitization, code / HTML / SVG
│   ├── IndexedDB              Documents, workspaces, folders, assets
│   ├── localStorage           Preferences and bounded edit recovery
│   └── Web Worker             Search and word-count work
│
└── /draw                      Screenshot annotation
    ├── Canvas                 Annotation geometry and interaction
    ├── Canvas export          Native-resolution JPEG / WebP
    └── ZIP Web Worker         Batch packaging
~~~

The boundaries are intentional.

| Concern | Design choice | Why it exists |
| --- | --- | --- |
| **Source of truth** | Plain text documents with browser-local persistence | Content stays portable; an editor should not own the format. |
| **Editor** | CodeMirror 6, not a homegrown text engine | Mature selection, input, undo, and viewport behavior are difficult to reproduce correctly. |
| **Rendering** | A separate Markdown preview pipeline | Editing stays responsive without coupling keystrokes to an entire rendered document. |
| **Large documents** | Deferred updates, chunked Markdown, virtualized code and preview | Rendering cost should scale with what is visible where possible. |
| **Search** | In-memory document scan in a Web Worker | Simple local search does not need a remote index or a main-thread stall. |
| **Saving** | Debounced, serialized IndexedDB writes with bounded local recovery | Minimize write churn while protecting recent edits; avoid synchronously storing huge snapshots. |
| **HTML / SVG** | Sanitized Markdown HTML; sandboxed isolated previews | Display source faithfully without giving preview content access to the app's origin or storage. |
| **Draw** | Image-relative annotation geometry and a shared renderer for preview/export | An annotation should land in the same place in the editor and in the downloaded image. |
| **Delivery** | Vite, static assets, route-level lazy loading | The app doesn't need a runtime server to edit a local document. |

### The important paths

~~~text
src/
├── App.tsx                    Workspace orchestration and editing flows
├── main.tsx                   Lazy route selection and error boundary
├── components/
│   ├── MarkdownEditor.tsx     CodeMirror configuration and input
│   ├── MarkdownPreview.tsx    Markdown, code, HTML, SVG and virtualization
│   ├── WorkspaceTree.tsx      Workspace / folder / document navigation
│   └── Icons.tsx              Shared icon language
├── lib/
│   ├── store.ts               IndexedDB, preferences and recovery
│   ├── code.ts                File language and raw code detection
│   ├── htmlPreview.ts         Isolated HTML preview document
│   ├── svgPreview.ts          Theme-aware SVG preview document
│   └── previewChunks.ts       Safe-enough Markdown chunk boundaries
├── workers/
│   └── search.ts              Local search and word metrics
└── draw/
    ├── DrawPage.tsx           Annotation interaction and export UI
    ├── annotations.ts         Drawing, hit testing and image encoding
    ├── zip.ts                 Dependency-free ZIP/STORE writer
    └── zip.worker.ts          Off-main-thread ZIP assembly
~~~

## The decisions

### 01. Taste is restraint, not decoration

Whitespace, typography, contrast, surface tone, roundedness, and motion all affect how an editor feels after hours of use. The aim is not to maximize visual novelty. It is to give the content priority, make actions discoverable, and make the interface predictable.

Flow uses a small visual vocabulary, responsive layouts, deliberate interaction states, and reduced-motion support. The editor and preview have distinct responsibilities, but neither should feel like a separate product.

### 02. Performance is an interaction design problem

A fast initial render is not enough if typing, scrolling, searching, or switching documents becomes expensive.

Flow keeps CodeMirror in charge of text input, coalesces preview work, uses source-position anchors for scroll alignment, moves document search and word metrics to a worker, and virtualizes long rendered content. Those are targeted solutions to actual UI costs, not a generalized performance framework.

### 03. Local-first is a product boundary

Keeping documents in IndexedDB removes login and backend availability from the writing path. Preferences and a size-limited recovery snapshot use localStorage. Imported binary assets stay as browser data rather than being silently uploaded.

There is an important tradeoff: **local-first is not the same as backed up**. Clearing browser data, changing browser profiles, or losing the device can lose documents. Export work you cannot afford to lose.

### 04. Preview is a security boundary

Markdown can contain raw HTML; standalone HTML may contain scripts. They are not treated as the same thing.

Markdown HTML is sanitized before rendering. Standalone HTML runs inside a sandboxed iframe with a restrictive Content Security Policy; SVG previews use an iframe without script permissions. Preview content is not trusted with access to the editor's storage. Isolation is part of correctness, not an optional hardening pass.

### 05. Keep separate problems separate

Writing and screenshot annotation belong to the same workflow, but not the same rendering engine. Draw owns its canvas interactions and export logic. Flow owns documents, navigation, source editing, and preview. A shared identity is useful; shared complexity is not.

Draw's annotations use image-relative coordinates so zoom and screen size do not define the exported geometry. Batch images are already compressed, so ZIP packaging uses a small STORE writer rather than pulling in a larger compression stack.

## What we deliberately avoid

- **No mandatory account, cloud database, or sync service.** There is no reason to put a server between a person and a local Markdown file.
- **No custom rich-text document format.** Markdown and imported source files remain portable.
- **No invented editor engine.** CodeMirror handles the hard, well-understood text-editing problems.
- **No global state framework by default.** React state, refs, and focused modules are enough for this application's current boundaries.
- **No plugin platform or abstraction layer for hypothetical future features.** New systems should justify their maintenance cost before they exist.
- **No unsandboxed executable preview.** Rendering arbitrary user content in the main app origin is not an acceptable shortcut.
- **No treating animation as quality.** Motion is restrained and respects reduced-motion preferences.

These are choices, not universal rules. If the product's constraints change, the architecture should change with evidence, not fashion.

## Development

Requires **Node.js 22.12+** or **20.19+**.

~~~bash
npm install
npm run dev
~~~

Create a production build:

~~~bash
npm run build
npm run preview
~~~

The stack is **React 19 · TypeScript 5 · Vite 8 · CodeMirror 6 · react-markdown / remark-gfm · TanStack Virtual · Motion · Geist**.

GitHub Actions runs the TypeScript and Vite production build on pushes to `main` and on pull requests. The repository does not currently include a separate automated test suite.

## Current boundaries

Flow is a browser application, not a desktop filesystem editor or a synchronized collaboration service. Browser persistence is not a guaranteed backup. Draw operates on an in-memory annotation session, so export images before navigating away. Very large or unusually complex previews can still be constrained by browser memory and rendering performance.

---

<div align="center">
  <p><strong>Good software is the accumulation of decisions that did not need to become features.</strong></p>
  <sub>Flow · Built with care for the work on the screen.</sub>
</div>
