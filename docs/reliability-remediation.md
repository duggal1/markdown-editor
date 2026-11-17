# Reliability remediation: workspace visibility and 100 MB cloud sharing

## Observed failures and causes

1. **Workspace files exist but disappear from the explorer.** Search uses the complete document collection, while the normal sidebar uses a flex column whose workspace children may shrink to fit the available viewport. The branch clips its overflow, so shrinking a workspace can hide valid files. Separately, collapsed workspace IDs were saved and restored, allowing old collapsed state to persist after reloads.
2. **Cloud uploads fail for large Markdown pages.** The original API rejected UTF-8 Markdown larger than 240,000 bytes, and serialized all contents through a serverless function. A numeric limit increase alone would fail at Vercel's 4.5 MB function request/response cap.

## Changes

### Workspace

- Set workspace and search-result rows to non-shrinking flex items; let the file explorer scroll its full content.
- On each desktop visit, show the sidebar and expand all workspaces, regardless of stale collapsed preferences. Collapsing in the current session remains possible. On mobile, preserve the existing closed-drawer default.
- Keep document search independent from expansion. No IndexedDB schema or document storage migration is required.
- Regression assertions enforce the non-shrinking tree and expanded initial state.

### Cloud

- Limit **UTF-8 document content to 100 MiB** (104,857,600 bytes). Binary attachments remain local-only. The 100 MB allowance applies to explicitly shared text/Markdown, not to automatic workspace backup.
- The browser calculates the total SHA-256 and requests a short-lived upload session. The server mints path-specific, time-limited private-Blob upload URLs using Vercel signed URLs. The signing secret stays on the server.
- Uploads are split into 5 MiB parts (at most 20), with four concurrent workers and bounded per-part retries. Data bypasses Vercel Functions, so the 4.5 MB function-body cap remains respected.
- An incomplete new upload is not publicly readable. An incomplete update leaves the old version accessible.
- Finalization checks that every expected part exists at exactly the expected size, removes the temporary object expiration, and conditionally replaces the metadata manifest. Reader URLs point to immutable versioned parts, not a mutable blob pathname.
- Shared readers download parts directly from private Blob via presigned GET URLs, retry transient failures, and validate the full UTF-8 document against the published size and SHA-256 before rendering.
- Existing pre-migration share links remain readable. Existing shares can update using the new protocol.
- Unfinished sessions expire. Unfinished parts expire. Replaced content receives a short expiry after a successful publish; revoked active parts are deleted.
- Cloud edits automatically retry with increasing backoff. Multi-megabyte pages have a longer quiet-period debounce to avoid uploading 100 MB after every keystroke.
- The sharing dialog reports upload progress and the new limit.

## Verification

Run:

- \`npm run test:workspace-ui\`
- \`npm run test:cloud\`
- \`npm run build\`

The cloud test uses an in-memory Blob adapter and covers exact 100 MiB acceptance, oversized rejection, missing parts, atomic commit, retries of a committed upload, failed update retaining the prior version, legacy links, editing capability checks, and revocation. CI runs it on every PR.

A live deployed integration test is also required before claiming production-grade throughput: upload a 100 MiB UTF-8 text document, open its link on a separate browser/device, check its digest, disconnect the network during upload, verify retry, edit and sync, and revoke the link. The in-memory tests do not prove Vercel connectivity, quotas, CORS, network reliability, or large preview performance.

## Security and operations

- Anonymous cloud sharing was already supported. Increasing its payload allowance to 100 MB increases storage and bandwidth abuse risk. Add account-level or edge-level rate limits and spend alerts before broad public rollout.
- Vercel Blob private-storage operations and signed URLs incur usage charges. Per-part uploads, metadata checks, and full-document updates cost more than uploading only changed text. This is a stress-test limit, not an efficient default editing workload.
- The share URL acts as a bearer capability: anyone with the link can read the document until it is revoked. Already issued signed part URLs can remain valid for up to one hour.
- Local IndexedDB remains the source of truth for the editor; uploading a single shared document is not backup/sync of the entire workspace.
