type RpcRequest = { id?: string | number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
const apiBase = (process.env.WORLD_CODEX_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const token = process.env.WORLD_CODEX_MCP_TOKEN;
const allowProposalCreate = process.env.WORLD_CODEX_MCP_ALLOW_PROPOSALS === 'true';
const scopedWorldIds = new Set((process.env.WORLD_CODEX_MCP_WORLD_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean));

const tools = [
  { name: 'world_list', description: 'List worlds visible to the configured API identity.', inputSchema: { type: 'object', properties: {} } },
  { name: 'world_get', description: 'Read one explicitly selected world and its current revision.', inputSchema: { type: 'object', required: ['worldId'], properties: { worldId: { type: 'string' } } } },
  { name: 'world_search', description: 'Search entities and facts in one explicitly selected world.', inputSchema: { type: 'object', required: ['worldId', 'q'], properties: { worldId: { type: 'string' }, q: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  { name: 'entity_get', description: 'Read one entity from an explicitly selected world.', inputSchema: { type: 'object', required: ['worldId', 'entityId'], properties: { worldId: { type: 'string' }, entityId: { type: 'string' } } } },
  { name: 'timeline_query', description: 'Read facts, relations, and events intersecting a world tick range.', inputSchema: { type: 'object', required: ['worldId', 'fromTick', 'toTick'], properties: { worldId: { type: 'string' }, fromTick: { type: 'string' }, toTick: { type: 'string' }, canonStatus: { type: 'string', enum: ['canon', 'pending', 'retconned', 'draft', 'all'] } } } },
  { name: 'branch_list', description: 'List timeline branches for an explicitly selected world.', inputSchema: { type: 'object', required: ['worldId'], properties: { worldId: { type: 'string' } } } },
  { name: 'world_snapshot', description: 'Read a Canon snapshot at a signed world tick, optionally as of a specific revision or on a timeline branch.', inputSchema: { type: 'object', required: ['worldId', 'atTick'], properties: { worldId: { type: 'string' }, atTick: { type: 'string' }, asOfRevision: { type: 'string', description: 'Transaction-time cut-off (revision number).' }, branchId: { type: 'string', description: 'Timeline branch ID. Defaults to the main branch.' } } } },
  { name: 'claim_list', description: 'List claims (subjective beliefs, rumors, official records) for an explicitly selected world, optionally filtered by subject, assertor, kind, or truth status.', inputSchema: { type: 'object', required: ['worldId'], properties: { worldId: { type: 'string' }, subjectEntityId: { type: 'string' }, assertedByEntityId: { type: 'string' }, claimKind: { type: 'string', enum: ['belief', 'rumor', 'official_record', 'testimony', 'prophecy', 'legend', 'secret', 'hypothesis'] }, truthStatus: { type: 'string', enum: ['true', 'false', 'disputed', 'unknown', 'author_undecided'] }, canonStatus: { type: 'string', enum: ['draft', 'pending', 'canon', 'retconned', 'all'] }, branchId: { type: 'string' } } } },
  { name: 'canon_validate', description: 'Run deterministic Canon validation for one explicitly selected world.', inputSchema: { type: 'object', required: ['worldId'], properties: { worldId: { type: 'string' } } } },
  { name: 'canon_validate_incremental', description: 'Run dependency-aware incremental Canon validation for a scoped changeSet in one world.', inputSchema: { type: 'object', required: ['worldId', 'changeSet'], properties: { worldId: { type: 'string' }, changeSet: { type: 'object', properties: { entityIds: { type: 'array', items: { type: 'string' } }, factIds: { type: 'array', items: { type: 'string' } }, predicates: { type: 'array', items: { type: 'string' } }, relationIds: { type: 'array', items: { type: 'string' } }, relationTypeIds: { type: 'array', items: { type: 'string' } }, eventIds: { type: 'array', items: { type: 'string' } }, ruleIds: { type: 'array', items: { type: 'string' } } } } } } },
  { name: 'rule_list', description: 'List world validation rules for an explicitly selected world.', inputSchema: { type: 'object', required: ['worldId'], properties: { worldId: { type: 'string' } } } },
  { name: 'rule_test', description: 'Test a validation rule against current world state without persisting it.', inputSchema: { type: 'object', required: ['worldId', 'assert'], properties: { worldId: { type: 'string' }, name: { type: 'string' }, target: { type: 'string', enum: ['entity', 'fact', 'relation', 'event', 'world'] }, targetSelector: { type: 'object' }, when: { type: 'object' }, assert: { type: 'object' }, message: { type: 'string' }, severity: { type: 'string', enum: ['info', 'suggestion', 'warning', 'error', 'blocker'] }, includeDrafts: { type: 'boolean' } } } },
  { name: 'ai_proposal_create', description: 'Create an offline structured AI proposal for review; it never writes Canon directly.', inputSchema: { type: 'object', required: ['worldId', 'request', 'baseWorldRevision'], properties: { worldId: { type: 'string' }, request: { type: 'string' }, baseWorldRevision: { type: 'string' }, atTick: { type: 'string' }, changes: { type: 'array' } } } },
  { name: 'work_list', description: 'List narrative works in an explicitly selected world.', inputSchema: { type: 'object', required: ['worldId'], properties: { worldId: { type: 'string' } } } },
  { name: 'scene_get', description: 'Read one narrative scene from an explicitly selected world.', inputSchema: { type: 'object', required: ['worldId', 'sceneId'], properties: { worldId: { type: 'string' }, sceneId: { type: 'string' } } } },
  { name: 'scene_snapshot', description: 'Read a Canon snapshot reconstructed at the exact time and context of a scene.', inputSchema: { type: 'object', required: ['worldId', 'sceneId'], properties: { worldId: { type: 'string' }, sceneId: { type: 'string' } } } },
  { name: 'continuity_review', description: 'Run deterministic continuity review on a scene to detect dead character appearance, unborn characters, location conflicts, and premature knowledge.', inputSchema: { type: 'object', required: ['worldId', 'sceneId'], properties: { worldId: { type: 'string' }, sceneId: { type: 'string' } } } },
];

const MAX_API_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_STDIN_LINE_BYTES = 1 * 1024 * 1024;
const MAX_QUEUED_REQUESTS = 100;
const API_REQUEST_TIMEOUT_MS = 30_000;

async function fetchApi(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readApiJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  if (reader) {
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_API_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new Error('API response exceeded the configured size limit');
        }
        chunks.push(Buffer.from(part.value));
      }
    } finally {
      reader.releaseLock();
    }
  }
  const text = reader ? Buffer.concat(chunks).toString('utf8') : await response.text();
  if (!reader && Buffer.byteLength(text, 'utf8') > MAX_API_RESPONSE_BYTES) throw new Error('API response exceeded the configured size limit');
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'message' in body.error
      ? String(body.error.message)
      : `API request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const worldId = typeof args.worldId === 'string' ? args.worldId : '';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (name === 'world_list') {
    const response = await fetchApi(`${apiBase}/api/v1/worlds`, { headers });
    const body = await readApiJson(response) as { data?: Array<{ id?: string }> };
    return scopedWorldIds.size === 0 || !Array.isArray(body.data)
      ? body
      : { ...body, data: body.data.filter((world) => typeof world.id === 'string' && scopedWorldIds.has(world.id)) };
  }
  if (!worldId) throw new Error('worldId is required; MCP never selects a world implicitly');
  if (scopedWorldIds.size > 0 && !scopedWorldIds.has(worldId)) throw new Error('worldId is outside the configured MCP scope');
  if (name === 'world_get') {
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}`, { headers });
    return await readApiJson(response);
  }
  if (name === 'world_search') {
    const q = typeof args.q === 'string' ? args.q : '';
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/search?q=${encodeURIComponent(q)}&limit=${limit}`, { headers });
    return await readApiJson(response);
  }
  if (name === 'entity_get') {
    const entityId = typeof args.entityId === 'string' ? args.entityId : '';
    if (!entityId) throw new Error('entityId is required');
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/entities/${encodeURIComponent(entityId)}`, { headers });
    return await readApiJson(response);
  }
  if (name === 'timeline_query') {
    const fromTick = typeof args.fromTick === 'string' || typeof args.fromTick === 'number' ? String(args.fromTick) : '';
    const toTick = typeof args.toTick === 'string' || typeof args.toTick === 'number' ? String(args.toTick) : '';
    const canonStatus = typeof args.canonStatus === 'string' ? `&canonStatus=${encodeURIComponent(args.canonStatus)}` : '';
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/timeline?fromTick=${encodeURIComponent(fromTick)}&toTick=${encodeURIComponent(toTick)}${canonStatus}`, { headers });
    return await readApiJson(response);
  }
  if (name === 'branch_list') {
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/branches`, { headers });
    return await readApiJson(response);
  }
  if (name === 'world_snapshot') {
    const atTick = typeof args.atTick === 'string' || typeof args.atTick === 'number' ? String(args.atTick) : '';
    const asOfRevision = typeof args.asOfRevision === 'string' || typeof args.asOfRevision === 'number' ? `&asOfRevision=${encodeURIComponent(String(args.asOfRevision))}` : '';
    const branchId = typeof args.branchId === 'string' && args.branchId ? `&branchId=${encodeURIComponent(args.branchId)}` : '';
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/snapshot?atTick=${encodeURIComponent(atTick)}${asOfRevision}${branchId}`, { headers });
    return await readApiJson(response);
  }
  if (name === 'claim_list') {
    const params = new URLSearchParams();
    if (typeof args.subjectEntityId === 'string' && args.subjectEntityId) params.set('subjectEntityId', args.subjectEntityId);
    if (typeof args.assertedByEntityId === 'string' && args.assertedByEntityId) params.set('assertedByEntityId', args.assertedByEntityId);
    if (typeof args.claimKind === 'string' && args.claimKind) params.set('claimKind', args.claimKind);
    if (typeof args.truthStatus === 'string' && args.truthStatus) params.set('truthStatus', args.truthStatus);
    if (typeof args.canonStatus === 'string' && args.canonStatus) params.set('canonStatus', args.canonStatus);
    if (typeof args.branchId === 'string' && args.branchId) params.set('branchId', args.branchId);
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/claims${query}`, { headers });
    return await readApiJson(response);
  }
  if (name === 'canon_validate') {
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/validation`, { headers });
    return await readApiJson(response);
  }
  if (name === 'canon_validate_incremental') {
    const changeSet = args.changeSet && typeof args.changeSet === 'object' ? args.changeSet : {};
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/validation/incremental`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ changeSet }),
    });
    return await readApiJson(response);
  }
  if (name === 'rule_list') {
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/rules`, { headers });
    return await readApiJson(response);
  }
  if (name === 'rule_test') {
    const payload: Record<string, unknown> = {
      assert: args.assert,
      ...(typeof args.name === 'string' ? { name: args.name } : {}),
      ...(typeof args.target === 'string' ? { target: args.target } : {}),
      ...(args.targetSelector && typeof args.targetSelector === 'object' ? { targetSelector: args.targetSelector } : {}),
      ...(args.when && typeof args.when === 'object' ? { when: args.when } : {}),
      ...(typeof args.message === 'string' ? { message: args.message } : {}),
      ...(typeof args.severity === 'string' ? { severity: args.severity } : {}),
      ...(typeof args.includeDrafts === 'boolean' ? { includeDrafts: args.includeDrafts } : {}),
    };
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/rules/test`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await readApiJson(response);
  }
  if (name === 'ai_proposal_create') {
    if (!allowProposalCreate) throw new Error('Proposal creation is disabled; set WORLD_CODEX_MCP_ALLOW_PROPOSALS=true for an explicitly scoped MCP identity');
    const baseWorldRevision = typeof args.baseWorldRevision === 'number' || typeof args.baseWorldRevision === 'string'
      ? String(args.baseWorldRevision)
      : '';
    const payload: Record<string, unknown> = { request: args.request, baseWorldRevision };
    if (typeof args.atTick === 'string' || typeof args.atTick === 'number') payload.atTick = String(args.atTick);
    if (Array.isArray(args.changes)) payload.changes = args.changes;
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/ai/proposals`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    return await readApiJson(response);
  }
  if (name === 'work_list') {
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/works`, { headers });
    return await readApiJson(response);
  }
  if (name === 'scene_get') {
    const sceneId = typeof args.sceneId === 'string' ? args.sceneId : '';
    if (!sceneId) throw new Error('sceneId is required');
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/scenes/${encodeURIComponent(sceneId)}`, { headers });
    return await readApiJson(response);
  }
  if (name === 'scene_snapshot') {
    const sceneId = typeof args.sceneId === 'string' ? args.sceneId : '';
    if (!sceneId) throw new Error('sceneId is required');
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/scenes/${encodeURIComponent(sceneId)}/snapshot`, { headers });
    return await readApiJson(response);
  }
  if (name === 'continuity_review') {
    const sceneId = typeof args.sceneId === 'string' ? args.sceneId : '';
    if (!sceneId) throw new Error('sceneId is required');
    const response = await fetchApi(`${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}/scenes/${encodeURIComponent(sceneId)}/continuity-review`, { method: 'POST', headers });
    return await readApiJson(response);
  }
  throw new Error(`Unknown tool: ${name}`);
}

function writeResponse(response: unknown): void { process.stdout.write(`${JSON.stringify(response)}\n`); }

async function processLine(line: string): Promise<void> {
  try {
    const request = JSON.parse(line) as RpcRequest;
    if (request.method === 'initialize') writeResponse({ jsonrpc: '2.0', id: request.id ?? null, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'world-codex-mcp', version: '1.0.0' } } });
    else if (request.method === 'notifications/initialized') return;
    else if (request.method === 'health') writeResponse({ jsonrpc: '2.0', id: request.id ?? null, result: { status: 'ok', service: 'world-codex-mcp' } });
    else if (request.method === 'tools/list') writeResponse({ jsonrpc: '2.0', id: request.id ?? null, result: { tools } });
    else if (request.method === 'tools/call' && request.params?.name) {
      try { const result = await callTool(request.params.name, request.params.arguments ?? {}); writeResponse({ jsonrpc: '2.0', id: request.id ?? null, result: { content: [{ type: 'json', json: result }] } }); }
      catch (error) { writeResponse({ jsonrpc: '2.0', id: request.id ?? null, error: { code: -32001, message: error instanceof Error ? error.message : 'Tool call failed' } }); }
    } else writeResponse({ jsonrpc: '2.0', id: request.id ?? null, error: { code: -32601, message: 'Method not found' } });
  } catch { writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); }
}

let queuedRequests = 0;
let processing = Promise.resolve();
function enqueueLine(line: string): void {
  if (Buffer.byteLength(line, 'utf8') > MAX_STDIN_LINE_BYTES) {
    writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request line exceeded the configured size limit' } });
    return;
  }
  if (queuedRequests >= MAX_QUEUED_REQUESTS) {
    writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32002, message: 'Too many queued MCP requests' } });
    return;
  }
  queuedRequests += 1;
  processing = processing.then(() => processLine(line)).finally(() => { queuedRequests -= 1; });
}

let inputBuffer = '';
let discardingOversizedLine = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  inputBuffer += chunk;
  while (true) {
    const newline = inputBuffer.indexOf('\n');
    if (newline < 0) {
      if (!discardingOversizedLine && Buffer.byteLength(inputBuffer, 'utf8') > MAX_STDIN_LINE_BYTES) {
        discardingOversizedLine = true;
        inputBuffer = '';
        writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request line exceeded the configured size limit' } });
      }
      break;
    }
    const line = inputBuffer.slice(0, newline).replace(/\r$/, '');
    inputBuffer = inputBuffer.slice(newline + 1);
    if (discardingOversizedLine) { discardingOversizedLine = false; continue; }
    enqueueLine(line);
  }
});
process.stdin.on('end', () => {
  if (inputBuffer && !discardingOversizedLine) enqueueLine(inputBuffer.replace(/\r$/, ''));
});
