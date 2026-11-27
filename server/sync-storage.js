import { sql } from 'drizzle-orm';
import { database } from './postgres-storage.js';
import { seedDocument, mergeDocument } from './sync-crdt.js';
import { createHash } from 'node:crypto';

// Internal foundation only: no legacy-note migration or public route is
// enabled until the editor and durable client outbox use this authority.
export async function migrateSync() {
  await database().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(609501328)`);
    await tx.execute(sql`create table if not exists flow_sync_documents (
      owner text not null, id text not null, state bytea not null,
      revision bigint not null default 0, markdown text not null,
      deleted boolean not null default false,
      primary key(owner,id))`);
    await tx.execute(sql`create table if not exists flow_sync_mutations (
      owner text not null, document_id text not null, mutation_id text not null,
      hash text not null, revision bigint not null,
      primary key(owner,document_id,mutation_id),
      foreign key(owner,document_id) references flow_sync_documents(owner,id))`);
    await tx.execute(sql`create table if not exists flow_sync_versions (
      owner text not null, document_id text not null, revision bigint not null,
      markdown text not null, created_at timestamptz not null default now(),
      primary key(owner,document_id,revision),
      foreign key(owner,document_id) references flow_sync_documents(owner,id))`);
  });
}
const encode = value => Buffer.from(value).toString('base64');
const decode = value => new Uint8Array(Buffer.from(value,'base64'));
const rows = result => Array.isArray(result) ? result : result.rows;
function validateId(owner, id) {
  if (!/^[a-f0-9]{64}$/.test(owner) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw Error('Invalid sync identity');
}
export async function initializeSyncDocument(owner, id, markdown) {
  validateId(owner,id);
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > 10 * 1024 * 1024) throw Error('Invalid document');
  const seed = encode(seedDocument(markdown));
  return database().transaction(async tx => {
    await tx.execute(sql`insert into flow_sync_documents(owner,id,state,markdown)
      values (${owner},${id},decode(${seed},'base64'),${markdown}) on conflict do nothing`);
    const [row] = rows(await tx.execute(sql`select encode(state,'base64') as state, revision, markdown, deleted
      from flow_sync_documents where owner=${owner} and id=${id} for update`));
    if (!row || row.deleted) throw Error('Document unavailable');
    await tx.execute(sql`insert into flow_sync_versions(owner,document_id,revision,markdown)
      values (${owner},${id},${row.revision},${row.markdown}) on conflict do nothing`);
    return {state:decode(row.state), revision:String(row.revision), markdown:row.markdown};
  });
}
// Lock the per-document row, deduplicate retries and acknowledge only after
// the transaction commits. The caller derives owner from authenticated identity.
export async function commitSyncUpdate(owner,id,mutationId,update,vector) {
  validateId(owner,id);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(mutationId) || !(update instanceof Uint8Array) ||
      update.byteLength > 2*1024*1024 || !(vector instanceof Uint8Array) || vector.byteLength > 128*1024) throw Error('Invalid update');
  const hash = createHash('sha256').update(update).digest('hex');
  return database().transaction(async tx => {
    const [row] = rows(await tx.execute(sql`select encode(state,'base64') as state, revision, deleted
      from flow_sync_documents where owner=${owner} and id=${id} for update`));
    if (!row || row.deleted) throw Error('Document unavailable');
    const [previous] = rows(await tx.execute(sql`select hash from flow_sync_mutations
      where owner=${owner} and document_id=${id} and mutation_id=${mutationId}`));
    if (previous && previous.hash !== hash) throw Error('Mutation identifier reused');
    const result = mergeDocument(decode(row.state),previous ? [] : [update],vector);
    let revision = String(row.revision);
    if (!previous) {
      const [next] = rows(await tx.execute(sql`update flow_sync_documents set state=decode(${encode(result.state)},'base64'),
        markdown=${result.markdown}, revision=revision+1 where owner=${owner} and id=${id} returning revision`));
      revision=String(next.revision);
      await tx.execute(sql`insert into flow_sync_mutations(owner,document_id,mutation_id,hash,revision)
        values (${owner},${id},${mutationId},${hash},${revision})`);
    }
    return {revision, delta:result.delta, vector:result.vector, markdown:result.markdown};
  });
}
export async function checkpointSyncDocument(owner,id) {
  validateId(owner,id);
  await database().execute(sql`insert into flow_sync_versions(owner,document_id,revision,markdown)
    select owner,id,revision,markdown from flow_sync_documents where owner=${owner} and id=${id} and not deleted
    on conflict do nothing`);
}
