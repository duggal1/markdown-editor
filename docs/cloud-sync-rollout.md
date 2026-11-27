# Cloud sync rollout

## Delivered in this change

- Existing private cloud persistence is connected once at workspace level. Markdown notes do not have a per-note upload consent checkbox.
- Explicit public link creation is separate from opening the Share dialog. Existing links continue to work.
- Public readers revalidate every five seconds while visible, on reconnect and on returning to the tab. ETag validation happens after authorization; unchanged versions skip part downloads.
- Yjs merge primitives and PostgreSQL durable update transactions are implemented with one canonical seed, owner scoping, retry deduplication and explicit checkpoints. Schema migration is additive.

## Not activated yet

The live editor still writes to the legacy backup path. The new CRDT tables are not the authority for existing documents and have no exposed API. Do not advertise concurrent multi-device editing as available. The workspace-level upload still uses the existing all-page scope, including assets.

## Next implementation gates

1. Establish device-specific authentication, a durable local CRDT outbox and shared workspace metadata feed.
2. Migrate only after validating the legacy cloud revision and local baseline; preserve divergent local content as a conflict copy rather than guessing a common ancestor. Enforce one canonical Yjs seed.
3. Atomically switch authority for each migrated document; reject legacy writes for migrated records and point existing public aliases to the authoritative text. Integrate every editor/planner mutation path.
4. Add reconnecting real-time transport and HTTP catch-up; verify concurrent offline edits, lost responses, tab shutdown, tombstones and revocation.
5. Add version list, compare and restore UI against the authoritative checkpoint history. Restore creates a new revision.
6. Benchmark active desktop and iOS devices before enabling by default.

Do not run a destructive migration or enable legacy-note CRDT writes merely to satisfy a deployment checklist.
