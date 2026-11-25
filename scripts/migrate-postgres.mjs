import { migrate, purgeExpired } from '../server/postgres-storage.js';
try { await migrate(); await purgeExpired(); console.log('Flow PostgreSQL schema ready'); process.exit(0); }
catch (error) { console.error(error.message); process.exit(1); }
