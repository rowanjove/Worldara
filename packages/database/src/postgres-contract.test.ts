import { afterAll, describe, it } from 'vitest';
import { registerRepositoryContract } from '../../application/src/repository-contract';
import { createPool } from './client';
import { PostgresWorldRepository } from './world-repository';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  describe.skip('repository contract (postgres)', () => {
    it('skips when DATABASE_URL is not configured', () => {
      /* environment has no PostgreSQL */
    });
  });
} else {
  const pool = createPool(connectionString);
  registerRepositoryContract('postgres', () => new PostgresWorldRepository(pool));
  afterAll(async () => {
    await pool.end();
  });
}
