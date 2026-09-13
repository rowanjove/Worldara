import { DatabaseSync } from 'node:sqlite';
import { InMemoryWorldRepository, type MemoryRepositorySnapshot } from '@world-codex/application';

const READ_METHOD = /^(get|list|search|export)/;

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.$bigint === 'string') return BigInt(record.$bigint);
    if (typeof record.$date === 'string') return new Date(record.$date);
  }
  return value;
}

export interface SqliteWorldRepository extends InMemoryWorldRepository {
  close(): void;
}

export function openSqliteWorldRepository(path = ':memory:'): SqliteWorldRepository {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS repository_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)');
  db.exec('PRAGMA busy_timeout = 5000');
  const inner = new InMemoryWorldRepository();
  const existing = db.prepare('SELECT payload FROM repository_snapshot WHERE id = 1').get() as { payload: string } | undefined;
  if (existing?.payload) inner.loadSnapshot(JSON.parse(existing.payload, reviver) as MemoryRepositorySnapshot);

  const persist = (): void => {
    const payload = JSON.stringify(inner.exportSnapshot(), replacer);
    db.prepare('INSERT INTO repository_snapshot(id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload').run(payload);
  };
  let writeQueue: Promise<void> = Promise.resolve();

  const wrapper = new Proxy(inner, {
    get(target, property, receiver) {
      if (property === 'close') return () => db.close();
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof property !== 'string' || typeof value !== 'function') return value;
      const bound = (value as (...args: unknown[]) => unknown).bind(target);
      if (READ_METHOD.test(property)) return bound;
      return (...args: unknown[]) => {
        const task = writeQueue.then(async () => {
          const result = await bound(...args);
          persist();
          return result;
        });
        writeQueue = task.then(() => undefined, () => undefined);
        return task;
      };
    },
  }) as SqliteWorldRepository;
  return wrapper;
}
