# PostgreSQL storage cutover

The new storage adapter supports all existing API handlers (backups, shares, HTML). Drizzle Postgres 1.0.0-rc.6 is pinned. PostgreSQL stores bytea objects using path keys, allowing migration of the existing versioned manifest protocol without breaking links. This is a transitional schema, not the final normalized native document schema.

For a **new empty installation** set DATABASE_URL, run npm run db:migrate against that database, then deploy. When legacy Blob credentials are present, the existing deployment stays on Blob by default to prevent accidental loss. For an existing installation:
1. Back up existing Blob storage and stop all legacy writes (maintenance window). Keep the original storage untouched.
2. Set DATABASE_URL locally, retain the existing BLOB_READ_WRITE_TOKEN, and run npm run db:migrate.
3. Run FLOW_MIGRATION_FROZEN=1 npm run db:import-blob. Every object is checked by SHA-256 after copying; conflicts fail rather than overwrite.
4. Test restore/recovery keys, public links, unpublish, tombstones, HTML hosting, and 100 MiB upload in staging with FLOW_STORAGE_BACKEND=postgres. Existing 5 MiB objects are served as bounded signed ranges; new objects use 2 MiB chunks.
5. Switch production with FLOW_STORAGE_BACKEND=postgres only after successful tests. Remove Blob credentials after cutover. A rollback after PostgreSQL receives new writes requires exporting those writes; do not simply toggle back and lose them.
6. Retain Blob source until retention and rollback requirements are satisfied. Expired PostgreSQL objects can be purged by npm run db:migrate. Schedule regular cleanup separately.

DATABASE_URL is server-only. Signed upload/download capabilities use FLOW_STORAGE_SIGNING_SECRET if present, otherwise a domain-separated HMAC using the database URL; rotation invalidates outstanding tickets. No credentials are sent to the browser.

The existing tests exercise the legacy API contracts; PostgreSQL integration CI exercises real storage operations. A full deployed Vercel transport test and production migration remain mandatory. This patch does not claim that PostgreSQL is intrinsically faster for large binary transfers. 
