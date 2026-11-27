# Workspace planner and memory

The workspace tree contains a To-do and Memory entry. Each folder contains a virtual To-do section with its own task and memory documents. Entries materialize on first open; no new database or duplicate task table. Markdown is canonical, so normal preview, export, private backup and worker search use the same records. Folder deletion follows Flow's existing preserve-document behavior.

Manual edits update the shared live document synchronously, update the normal preview and search worker, then enter the existing serialized persistence queue. AI proposes additions in a review panel; applying merges them into the latest document, without replacing previous items. The user may choose whether to include saved root and folder memory in task generation. Only the current input, bounded current document and opted-in memory go to Reflection. No automatic memory extraction or external background calls.

## Deployment

Set server-only REFLECTION_API_KEY and FLOW_PLANNER_ACCESS_KEY (a private random secret at least 24 characters, separate from the provider key) in Vercel. Since Flow has no login, an anonymous paid inference route would be unsafe. The user enters the access key on the first AI request; it is retained only in that browser tab's session storage. Manual use does not require either key. Do not expose these variables via VITE_ prefixes. Production deployments serving multiple unrelated users need authenticated per-user authorization and distributed rate limits before opening the AI service publicly.

Model: Beam-1.0-501B-A23B. A deterministic complexity heuristic chooses low or medium reasoning with one model request, no classifier call. Output is validated, bounded and never applied if incomplete. Actual latency depends on provider inference. The local Vite server does not serve Vercel functions; use a Vercel preview or vercel dev to exercise AI.

## Verification

npm run test:planner checks scope identity, append and deduplication, row edits, memory, reasoning routing, provider request shape and incomplete output. Existing preview, task, cloud and workspace tests remain enabled. Browser and live provider testing require a deployed preview and credentials.
