import { createPool } from '@world-codex/database';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 25;
const CLAIM_TIMEOUT_MS = 5 * 60_000;
type WorkerPool = ReturnType<typeof createPool>;
type OutboxRow = { id: string; world_id: string; event_type: string; payload_json: Record<string, unknown>; attempts: number };

/**
 * Claims and processes a bounded batch. Claiming is short and transactional;
 * embedding preparation happens after commit so one slow provider cannot hold
 * a world write lock. The job table is the durable hand-off to a future vector
 * provider and is already useful for retry/observability today.
 */
export async function processOutboxBatch(pool: WorkerPool, batchSize = DEFAULT_BATCH_SIZE): Promise<{ claimed: number; completed: number; failed: number }> {
  const client = await pool.connect();
  let rows: OutboxRow[] = [];
  try {
    await client.query('BEGIN');
    const result = await client.query<OutboxRow>(
      `SELECT id,world_id,event_type,payload_json,attempts
         FROM outbox_events
        WHERE processed_at IS NULL
          AND available_at <= now()
          AND (claimed_at IS NULL OR claimed_at < now() - ($1::bigint * interval '1 millisecond'))
        ORDER BY created_at,id
        FOR UPDATE SKIP LOCKED
        LIMIT $2`,
      [CLAIM_TIMEOUT_MS, Math.max(1, Math.min(batchSize, 100))],
    );
    rows = result.rows;
    for (const row of rows) await client.query('UPDATE outbox_events SET claimed_at=now(),attempts=attempts+1 WHERE id=$1', [row.id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }

  let completed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await materializeEmbeddingJob(pool, row);
      await pool.query('UPDATE outbox_events SET processed_at=now(),claimed_at=NULL,last_error=NULL WHERE id=$1', [row.id]);
      completed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown worker error';
      await pool.query("UPDATE outbox_events SET claimed_at=NULL,available_at=now() + interval '30 seconds',last_error=$2 WHERE id=$1", [row.id, message]);
    }
  }
  return { claimed: rows.length, completed, failed };
}

async function materializeEmbeddingJob(pool: WorkerPool, row: OutboxRow): Promise<void> {
  const sourceKind = String(row.payload_json.objectType ?? '').trim();
  const sourceId = String(row.payload_json.objectId ?? '').trim();
  if (!sourceId || !['entity', 'fact', 'relation', 'event', 'map_feature'].includes(sourceKind)) return;
  const contentText = await sourceText(pool, sourceKind, sourceId, row.world_id);
  if (contentText === null) return;
  await pool.query(
    `INSERT INTO embedding_jobs(id,outbox_event_id,world_id,source_kind,source_id,content_text,status,attempts,available_at,created_at)
     VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'pending',0,now(),now())
     ON CONFLICT (source_kind,source_id) DO UPDATE
       SET outbox_event_id=EXCLUDED.outbox_event_id,world_id=EXCLUDED.world_id,content_text=EXCLUDED.content_text,status='pending',available_at=now(),last_error=NULL`,
    [row.id, row.world_id, sourceKind, sourceId, contentText],
  );
}

async function sourceText(pool: WorkerPool, kind: string, id: string, worldId: string): Promise<string | null> {
  if (kind === 'entity') {
    const result = await pool.query(`SELECT concat_ws(E'\\n',name,subtitle,document_text) AS text FROM entities WHERE world_id=$1 AND id=$2`, [worldId, id]);
    return result.rowCount ? String(result.rows[0].text ?? '') : null;
  }
  if (kind === 'fact') {
    const result = await pool.query(`SELECT concat_ws(' ',predicate_key,value_json::text) AS text FROM facts WHERE world_id=$1 AND id=$2`, [worldId, id]);
    return result.rowCount ? String(result.rows[0].text ?? '') : null;
  }
  if (kind === 'relation') {
    const result = await pool.query(`SELECT concat_ws(' ',description,relation_type_id::text) AS text FROM relations WHERE world_id=$1 AND id=$2`, [worldId, id]);
    return result.rowCount ? String(result.rows[0].text ?? '') : null;
  }
  if (kind === 'event') {
    const result = await pool.query(`SELECT concat_ws(E'\\n',name,event_type,description) AS text FROM events WHERE world_id=$1 AND id=$2`, [worldId, id]);
    return result.rowCount ? String(result.rows[0].text ?? '') : null;
  }
  const result = await pool.query(`SELECT concat_ws(E'\\n',geometry_json::text,properties_json::text) AS text FROM map_features WHERE world_id=$1 AND id=$2`, [worldId, id]);
  return result.rowCount ? String(result.rows[0].text ?? '') : null;
}

async function main(): Promise<void> {
  const intervalMs = parsePositiveInt(process.env.WORKER_HEARTBEAT_MS, DEFAULT_INTERVAL_MS, 1_000, 300_000);
  const batchSize = parsePositiveInt(process.env.WORKER_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 100);
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL is not set; worker is running heartbeat-only and will not process outbox jobs.');
    const timer = setInterval(() => console.log(JSON.stringify({ service: 'world-codex-worker', status: 'idle', at: new Date().toISOString() })), intervalMs);
    process.on('SIGTERM', () => { clearInterval(timer); process.exit(0); });
    return;
  }
  const pool = createPool();
  let running = false;
  const poll = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await processOutboxBatch(pool, batchSize);
      if (result.claimed) console.log(JSON.stringify({ service: 'world-codex-worker', status: 'processed', ...result, at: new Date().toISOString() }));
    } catch (error) {
      console.error(JSON.stringify({ service: 'world-codex-worker', status: 'error', message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }));
    } finally { running = false; }
  };
  await poll();
  const timer = setInterval(() => { void poll(); }, intervalMs);
  const shutdown = async (): Promise<void> => { clearInterval(timer); await pool.end(); process.exit(0); };
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}

function parsePositiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

if (require.main === module) void main();
