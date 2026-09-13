import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProposalProvider, createProposalProviderFromEnv } from './index';

describe('AI provider adapter', () => {
  it('normalizes bounded structured JSON without exposing secrets', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"changes":[{"id":"c1","command":"SetCanonStatus","payload":{},"confidence":1}],"citations":[{"id":"entity-1"}],"unknowns":[] }\n```' } }] }), { status: 200 }));
    const provider = new OpenAICompatibleProposalProvider({ baseUrl: 'https://ai.example.test/v1', apiKey: 'secret', model: 'model', fetchImpl });
    const result = await provider.generate({ request: 'suggest', worldId: 'w', baseWorldRevision: 4n, context: {} });
    expect(result.provider).toBe('openai-compatible:model');
    expect(result.changes[0]).toMatchObject({ id: 'c1', confidence: 1, userDecision: 'pending' });
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).not.toContain('secret');
  });

  it('rejects non-TLS remote endpoints and incomplete environment config', () => {
    expect(() => new OpenAICompatibleProposalProvider({ baseUrl: 'not-a-url', apiKey: 'x', model: 'm' })).toThrow('valid URL');
    expect(() => new OpenAICompatibleProposalProvider({ baseUrl: 'http://remote.example.test', apiKey: 'x', model: 'm' })).toThrow('HTTPS');
    expect(() => new OpenAICompatibleProposalProvider({ baseUrl: 'https://192.168.1.10', apiKey: 'x', model: 'm' })).toThrow('private or reserved');
    expect(() => new OpenAICompatibleProposalProvider({ baseUrl: 'https://user:pass@ai.example.test', apiKey: 'x', model: 'm' })).toThrow('credentials');
    expect(() => createProposalProviderFromEnv({ WORLD_CODEX_AI_BASE_URL: 'https://ai.example.test' })).toThrow('must be configured together');
    expect(createProposalProviderFromEnv({})).toBeUndefined();
  });

  it('rejects oversized response bodies before parsing unbounded JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(200_001), { status: 200 }));
    const provider = new OpenAICompatibleProposalProvider({ baseUrl: 'https://ai.example.test', apiKey: 'secret', model: 'model', fetchImpl });
    await expect(provider.generate({ request: 'suggest', worldId: 'w', baseWorldRevision: 1n, context: {} })).rejects.toThrow('size limit');
  });

  it('turns provider HTTP failures into a bounded provider error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'upstream unavailable' } }), { status: 503 }));
    const provider = new OpenAICompatibleProposalProvider({ baseUrl: 'https://ai.example.test', apiKey: 'secret', model: 'model', fetchImpl });
    await expect(provider.generate({ request: 'suggest', worldId: 'w', baseWorldRevision: 1n, context: {} })).rejects.toMatchObject({ name: 'AiProviderError', details: { status: 503 } });
  });
});
