import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

const MAX_RESPONSE_BYTES = 200_000;

export interface ProposalChange {
  id: string;
  command: string;
  payload: Record<string, unknown>;
  dependsOn: string[];
  evidenceRefs: string[];
  confidence: number;
  userDecision: 'pending' | 'accepted' | 'rejected';
}

export interface ProposalGenerationInput {
  request: string;
  worldId: string;
  baseWorldRevision: bigint;
  atTick?: bigint;
  context: Record<string, unknown>;
}

export interface ProposalGenerationResult {
  provider: string;
  model?: string;
  promptVersion?: string;
  contextRefs?: string[];
  changes: ProposalChange[];
  citations: Record<string, unknown>[];
  unknowns: string[];
}

export interface ProposalProvider {
  readonly id: string;
  generate(input: ProposalGenerationInput): Promise<ProposalGenerationResult>;
}

export class AiProviderError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface OpenAICompatibleProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Provider adapter deliberately speaks only the server-side, JSON-only
 * OpenAI-compatible chat contract. It never receives or returns a permission
 * to write Canon; the API still stores a draft ProposalRecord and requires an
 * explicit Canon transition before mutation.
 */
export class OpenAICompatibleProposalProvider implements ProposalProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly hostname: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAICompatibleProviderOptions) {
    let parsed: URL;
    try { parsed = new URL(options.baseUrl); } catch { throw new AiProviderError('AI provider URL must be a valid URL'); }
    if (parsed.username || parsed.password) throw new AiProviderError('AI provider URL must not contain credentials');
    if (parsed.search || parsed.hash) throw new AiProviderError('AI provider URL must not contain a query or fragment');
    if (parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) throw new AiProviderError('AI provider must use HTTPS unless it targets loopback', { protocol: parsed.protocol, hostname: parsed.hostname });
    if (!isLoopbackHost(parsed.hostname) && isDisallowedIp(parsed.hostname)) throw new AiProviderError('AI provider URL must not target a private or reserved IP literal', { hostname: parsed.hostname });
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/chat/completions`;
    this.endpoint = parsed.toString();
    this.hostname = parsed.hostname;
    this.id = `openai-compatible:${options.model}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new AiProviderError('AI provider timeout must be between 1000 and 120000 milliseconds');
    this.timeoutMs = timeoutMs;
    if (!options.apiKey.trim()) throw new AiProviderError('AI provider API key is required');
    if (!options.model.trim()) throw new AiProviderError('AI provider model is required');
  }

  async generate(input: ProposalGenerationInput): Promise<ProposalGenerationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Resolve the configured hostname immediately before the request. This
      // blocks common DNS-based SSRF cases (metadata/private addresses) while
      // retaining an injectable fetch path for deterministic contract tests.
      let resolvedAddress: { address: string; family: number } | undefined;
      if (this.fetchImpl === fetch && !isLoopbackHost(this.hostname)) {
        const addresses = await lookup(this.hostname, { all: true, verbatim: true });
        if (!addresses.length || addresses.some((address) => isDisallowedIp(address.address))) throw new AiProviderError('AI provider hostname resolves to a private or reserved address');
        resolvedAddress = addresses[0];
      }
      const requestInit: RequestInit = {
        method: 'POST',
        signal: controller.signal,
        redirect: 'error',
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Return JSON only. You are a proposal generator for World Codex. Never claim to have written Canon. Every change must be reviewable and cite context ids when possible.' },
            { role: 'user', content: JSON.stringify({ request: input.request, worldId: input.worldId, baseWorldRevision: input.baseWorldRevision.toString(), atTick: input.atTick?.toString(), context: input.context }) },
          ],
        }),
      };
      // Fetching the hostname after a separate DNS check re-opens a DNS
      // rebinding window. The native request path uses the already validated
      // address as its resolver result while retaining the hostname for TLS
      // SNI and the HTTP Host header.
      const response = resolvedAddress
        ? await requestWithPinnedAddress(this.endpoint, requestInit, resolvedAddress)
        : await this.fetchImpl(this.endpoint, requestInit);
      if (!response.ok) throw new AiProviderError('AI provider returned an error', { status: response.status });
      const body = await readBoundedJson(response);
      const content = extractContent(body);
      return normalizeResult(parseJson(content), this.id);
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw new AiProviderError('AI provider request timed out');
      throw new AiProviderError('AI provider request failed');
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createProposalProviderFromEnv(env: NodeJS.ProcessEnv = process.env): ProposalProvider | undefined {
  const baseUrl = env.WORLD_CODEX_AI_BASE_URL?.trim();
  const apiKey = env.WORLD_CODEX_AI_API_KEY?.trim();
  const model = env.WORLD_CODEX_AI_MODEL?.trim();
  if (!baseUrl && !apiKey && !model) return undefined;
  if (!baseUrl || !apiKey || !model) throw new AiProviderError('WORLD_CODEX_AI_BASE_URL, WORLD_CODEX_AI_API_KEY and WORLD_CODEX_AI_MODEL must be configured together');
  return new OpenAICompatibleProposalProvider({ baseUrl, apiKey, model, timeoutMs: Number(env.WORLD_CODEX_AI_TIMEOUT_MS ?? 30_000) });
}

function extractContent(body: unknown): string {
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length > MAX_RESPONSE_BYTES) throw new AiProviderError('AI provider returned no bounded JSON content');
  return content;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length < 0 || length > MAX_RESPONSE_BYTES) throw new AiProviderError('AI provider response exceeded the size limit');
  }
  if (!response.body) throw new AiProviderError('AI provider returned an empty response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AiProviderError('AI provider response exceeded the size limit');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { throw new AiProviderError('AI provider returned invalid JSON'); }
}

function parseJson(content: string): unknown {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(stripped); } catch { throw new AiProviderError('AI provider returned invalid JSON'); }
}

function normalizeResult(value: unknown, provider: string): ProposalGenerationResult {
  if (!isRecord(value)) throw new AiProviderError('AI provider JSON must be an object');
  const rawChanges = Array.isArray(value.changes) ? value.changes : [];
  if (rawChanges.length > 500) throw new AiProviderError('AI provider returned too many changes');
  const changes = rawChanges.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.command !== 'string' || !isRecord(item.payload)) throw new AiProviderError('AI provider returned an invalid change', { index });
    return {
      id: item.id,
      command: item.command,
      payload: item.payload,
      dependsOn: stringArray(item.dependsOn),
      evidenceRefs: stringArray(item.evidenceRefs),
      confidence: typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? Math.max(0, Math.min(1, item.confidence)) : 0,
      userDecision: 'pending',
    } satisfies ProposalChange;
  });
  return { provider, model: provider, promptVersion: 'canon-context-v1', contextRefs: [], changes, citations: Array.isArray(value.citations) ? value.citations.filter(isRecord).slice(0, 500) : [], unknowns: stringArray(value.unknowns).slice(0, 500) };
}

function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 500) : []; }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function isLoopbackHost(hostname: string): boolean { return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'; }
function isDisallowedIp(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const version = isIP(host);
  if (version === 4) {
    const octets = host.split('.').map(Number);
    const a = octets[0] ?? -1;
    const b = octets[1] ?? -1;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b >= 18 && b <= 19 || b === 51)) || (a === 203 && b === 0);
  }
  if (version === 6) {
    if (host.startsWith('::ffff:')) return isDisallowedIp(host.slice(7));
    return host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host) || host.startsWith('ff') || host.startsWith('2001:db8') || host.startsWith('2001:2') || host.startsWith('2001:10') || host.startsWith('2001:20') || host.startsWith('2001:30');
  }
  return false;
}

function requestWithPinnedAddress(endpoint: string, init: RequestInit, resolved: { address: string; family: number }): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(endpoint);
    const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers = new Headers(init.headers);
    const headerRecord: Record<string, string> = {};
    headers.forEach((value, key) => { headerRecord[key] = value; });
    const request = requestFn(target, {
      method: init.method,
      headers: headerRecord,
      ...(init.signal ? { signal: init.signal } : {}),
      lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(response.headers)) if (typeof value === 'string') responseHeaders.set(key, value);
      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status: response.statusCode ?? 502, ...(response.statusMessage ? { statusText: response.statusMessage } : {}), headers: responseHeaders }));
    });
    request.once('error', reject);
    if (typeof init.body === 'string') request.write(init.body);
    request.end();
  });
}
