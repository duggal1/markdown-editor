# Flow performance rollout

## Baseline and constraints
Flow is a Vite SPA mounted with createRoot, not a hydrated Next.js application. Existing in-memory document state, IndexedDB, workers, lazy preview and incremental backup are retained. No measured latency claims until browser traces exist.

## Implementation stages
1. Render a theme-matched static shell immediately; deduplicate startup reads and defer full search indexing/share reconciliation until after first paint. Preserve recovery and error paths.
2. Measure boot time, editor input latency and React commit counts with a representative large workspace. Move remaining expensive transformations off the main thread only where ordering and document revision invariants can be preserved.
3. Make the existing memory + IndexedDB layers explicit; separate lightweight document metadata from large bodies in a versioned IDB migration; avoid breaking recovery and multi-tab behavior.
4. Migrate cloud storage using Drizzle Postgres rc.6. Inventory private backups, public shares and HTML sites, preserving ownership keys, checksums, aliases, tombstones and legacy links. Use a staging database and validated migration before cutover.
5. Use 1–2 MiB signed same-origin chunks for new uploads (Vercel function request/response limits); old 5 MiB direct Blob parts need migration/rechunking. Use native SQL text for Markdown, bytea for attachments; atomic revision CAS; batch commits, pipeline independent writes, parallel reads, bulk import/update when appropriate. Do not use five APIs merely for appearances.
6. Add resumable persistent upload sessions, bounded concurrency, checksums, retry/backoff and explicit local/cloud status.
7. Verify 100 MiB upload, retry after interruption, recovery key, share alias, revoke, deletion, concurrent revision conflicts, HTML hosting, and rollback on staging. Compare p50/p95 startup and cloud latency. Only remove Blob after migration verification.
8. Set DATABASE_URL server-side; run migrations with existing cloud credentials during controlled cutover. No database secrets in the browser.

## Acceptance
No data loss, no public access to private backups, no cloud blocking healthy local loads, no regression in existing UI or tests. CI plus live database integration and browser benchmarks are required before claiming the complete migration is done.
