import fs from 'node:fs/promises';
import path from 'node:path';
import { createPool } from './client';
import type { Pool } from 'pg';

export async function runMigrations(connectionString = process.env.DATABASE_URL, existingPool?: Pool): Promise<void> {
  const pool = existingPool ?? createPool(connectionString);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['world-codex:migrations']);
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const migrationDir = path.resolve(__dirname, '../migrations');
    const files = (await fs.readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (applied.rowCount) continue;
      const sql = await fs.readFile(path.join(migrationDir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql.replace(/INSERT INTO schema_migrations[\s\S]*$/i, ''));
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`Applied ${version}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['world-codex:migrations']); } finally { client.release(); if (!existingPool) await pool.end(); }
  }
}

if (require.main === module) runMigrations().catch((error) => { console.error(error); process.exitCode = 1; });
