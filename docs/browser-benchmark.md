# Reproduce Flow's historical browser benchmark

Baseline: `b6f83cd05c286f16ff019919ff8c140212587ad2` (last main commit by November 12, 2026).
Candidate: the current checkout. Compare exact commit IDs, never a mutable deployment alias.

On the same machine, with Node 22.12+ and Chromium:

```sh
git worktree add --detach ../flow-before b6f83cd05c286f16ff019919ff8c140212587ad2
(cd ../flow-before && npm ci && npm run build)
npm ci
npm run build
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install chromium
node scripts/benchmark-browser.mjs ../flow-before/dist dist 50 100 20480
```

For larger workspaces repeat with 500 documents × 200000 bytes. Use an isolated browser context per sample and compare p50/p95/max plus raw samples in `test-artifacts/browser-performance.json`. The fixture is deterministic, synthetic and contains no user data. The benchmark measures actual rendered editor readiness, cold/warm reload, navigation, search, document writes, long tasks and Chromium heap snapshots. It does not measure external assets, mobile, cloud uploads, HTML runtime or physical keystroke latency; these need separate trace-based fixtures. Reduced-motion mode isolates application work from visual transitions.

The clean-navigation optimization uses object identity only after a successful local IndexedDB transaction or committed read. Recovery snapshots and new or failed revisions remain uncommitted and still pass through the existing save path. The search worker overlaps at most four document digest/cache reads while preserving edit/delete generation checks.

No IndexedDB schema migration or cloud cutover is included in this patch. Those require separate migration and crash/recovery tests. Do not use synthetic local HTTP numbers as production Vercel latency.
