import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldApplicationService } from '@world-codex/application';
import { registerRepositoryContract } from '../../application/src/repository-contract';
import { openSqliteWorldRepository } from './sqlite-repository';

registerRepositoryContract('sqlite', () => openSqliteWorldRepository(':memory:'));

describe('sqlite persistence', () => {
  it('reloads worlds after closing and reopening the file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'world-codex-sqlite-'));
    const path = join(directory, 'world.sqlite');
    const first = openSqliteWorldRepository(path);
    const clock = { now: () => new Date('2026-01-01T00:00:00.000Z') };
    const ids = { next: () => crypto.randomUUID() };
    const app = new WorldApplicationService(first, ids, clock);
    const world = await app.createWorld({ name: 'Portable Local', slug: 'portable-local' });
    first.close();

    const second = openSqliteWorldRepository(path);
    const restored = new WorldApplicationService(second, ids, clock);
    expect((await restored.getWorld(world.id)).name).toBe('Portable Local');
    second.close();
  });
});
