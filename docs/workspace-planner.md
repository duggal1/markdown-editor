# Workspace planner and memory

The workspace tree contains a To-do and Memory entry. Each folder contains a virtual To-do section with its own task and memory documents. Entries materialize on first open; no new database or duplicate task table. Markdown is canonical, so normal preview, export, private backup and worker search use the same records. Folder deletion follows Flow's existing preserve-document behavior.

Manual edits update the shared live document synchronously, update the normal preview and search worker, then enter the existing serialized persistence queue. AI proposes additions in a review panel; applying merges them into the latest document, without replacing previous items. Saved root and folder memory is off by default for AI requests; the user can turn it on. Bounded lexical retrieval ranks entries from the whole source instead of taking a fixed tail. Only the current input, bounded current document and opted-in memory go to Reflection. No automatic memory extraction or external background calls.

## Deployment

Set the server-only REFLECTION_API_KEY in Vercel for each intended environment and redeploy. This is the only required environment variable. FLOW_PLANNER_ACCESS_KEY is optional; when configured, it must be at least 24 characters and the browser asks for it. Do not use VITE_ prefixes. Without the optional key the inference endpoint is publicly usable. An instance-local request/concurrency limiter is defense in depth, not a distributed quota: use provider spending limits and Vercel Firewall or distributed rate limiting before enabling unrestricted public traffic. Manual use requires neither key.

Model: Beam-1.0-501B-A23B. A deterministic complexity heuristic chooses low or medium reasoning with one model request, no classifier call. Output is validated, bounded and never applied if incomplete. Actual latency depends on provider inference. The local Vite server does not serve Vercel functions; use a Vercel preview or vercel dev to exercise AI.

## Verification

npm run test:planner checks scope identity, append and deduplication, row edits, memory, reasoning routing, provider request shape and incomplete output. Existing preview, task, cloud and workspace tests remain enabled. Browser and live provider testing require a deployed preview and credentials.

The AI endpoint now forwards the provider's SSE reasoning and answer deltas as NDJSON. The browser batches rendering per animation frame, displays a collapsible transient thinking panel and progressively renders item text. Only a complete, validated final result can be applied; canceled or interrupted streams never save drafts. Reasoning is not persisted or indexed.

Visual pass: reuse Flow's native dark canvas, Phosphor glyphs and save-label-shimmer animation. No heading prefix, sparkle mark, extra cards or ornamental rules. Instrument Sans 400/450/500; transient newest-word reveal only; saved items stay still. Existing light appearance remains supported. No runtime dependency added.

## Optional public GitHub context

On first planner use, enter a username or profile/repository URL, or skip. The browser stores only the chosen owner locally and fetches public repositories directly from GitHub, without a GitHub token. The catalog is paginated (up to 2,000 repositories, visibly partial if capped), cached in memory for 15 minutes, and refreshed on retry. Matched repository names get bounded README excerpts and root file names in parallel, with a 3.2-second lookup deadline. Unrelated prompts do not fetch repository details. Public data is untrusted and included in a single existing model call, with no iterative LLM tool calls. No private repository access, changes to GitHub, or automatic code audits. GitHub network or rate-limit failures do not prevent manual planning. The server-only Reflection API key is required; the planner access key is optional.

Surface refinement: dark composer #141414, inset wells #101010 and control fill #1b1b1b, without adding decorative borders. GitHub disclosure shares a two-column header grid, expands on its own row, and retains keyboard focus. Compact controls keep consistent geometry and a light-theme counterpart. Existing planner layout and data flow remain intact.

Shared SVG task control is used in Markdown preview and planner, with accessible checkbox semantics and theme-selected completion color. Add icon focuses the input when empty and submits when populated. The app defaults to blue for new/invalid preferences without overriding existing saved choices. Input focus is a subtle rounded container indicator. Thinking disclosure uses reduced-motion-aware blur transitions. No storage changes.

Final UX patch removes the redundant workspace breadcrumb, keeps editing borderless with a rounded row fill and uses a compact close glyph for deletion. The canvas scrollbar is hidden while retaining native wheel/touch scrolling; inner text areas use a quiet thumb. Both previews share the SVG checkbox. Existing preferences and data are unchanged.
