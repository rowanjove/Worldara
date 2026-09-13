import pg from 'pg';

const { Pool } = pg;

export function createPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL access');
  return new Pool({ connectionString, max: Number(process.env.DB_POOL_SIZE ?? 10), application_name: 'world-codex' });
}
