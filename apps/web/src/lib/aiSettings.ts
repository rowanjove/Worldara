export type AiMode = 'direct' | 'offline';

export interface AiModelConfig {
  mode: AiMode;
  provider: 'deepseek' | 'openai' | 'claude' | 'ollama' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

const STORAGE_KEY = 'world_codex_ai_config';

export const DEFAULT_AI_CONFIG: AiModelConfig = {
  mode: 'offline', // 默认优先离线提示词流，无配置门槛
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.3,
};

export const PROVIDER_PRESETS: Record<
  AiModelConfig['provider'],
  { name: string; defaultBaseUrl: string; defaultModel: string; note: string }
> = {
  deepseek: {
    name: 'DeepSeek (深度求索)',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    note: '高性价比世界观推演推荐模型',
  },
  openai: {
    name: 'OpenAI (GPT-4o / o1)',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    note: '通用顶级逻辑推理',
  },
  claude: {
    name: 'Anthropic Claude (需中转/兼容端点)',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    note: '出色的小说创作品质与世界构建能力',
  },
  ollama: {
    name: 'Ollama (本地免鉴权模型)',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:14b',
    note: '完全本地隐私，无需 API Key',
  },
  custom: {
    name: '自定义 OpenAI 兼容接口',
    defaultBaseUrl: 'https://api.example.com/v1',
    defaultModel: 'custom-model',
    note: '任何支持 OpenAI /chat/completions 规范的端点',
  },
};

export function getAiConfig(): AiModelConfig {
  if (typeof window === 'undefined') return DEFAULT_AI_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_CONFIG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_AI_CONFIG, ...parsed };
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}

export function saveAiConfig(config: AiModelConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

/**
 * 直接调用配置的 OpenAI 兼容 API 发起对话生成
 */
export async function callDirectAiApi(
  systemPrompt: string,
  userPrompt: string,
  configOverride?: Partial<AiModelConfig>
): Promise<string> {
  const config = { ...getAiConfig(), ...(configOverride || {}) };

  if (!config.baseUrl.trim()) {
    throw new Error('未配置 API Base URL，请在设置中配置或使用离线提示词模式');
  }

  // 本地 Ollama 允许无 Key，其他通常需要 Key
  if (config.provider !== 'ollama' && !config.apiKey.trim()) {
    throw new Error('未配置 API Key，请在设置中填写或使用离线复制提示词模式');
  }

  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (config.apiKey.trim()) {
    headers['authorization'] = `Bearer ${config.apiKey.trim()}`;
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model.trim() || 'default',
      temperature: config.temperature ?? 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    let errDetail = `${res.status} ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson?.error?.message) errDetail = errJson.error.message;
    } catch {
      // ignore
    }
    throw new Error(`AI 接口调用失败: ${errDetail}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== 'string' || !reply.trim()) {
    throw new Error('AI 未返回有效内容');
  }

  return reply;
}

/**
 * 测试当前配置的 API 连通性
 */
export async function testAiConnection(config: AiModelConfig): Promise<string> {
  return await callDirectAiApi(
    'You are a testing assistant. Reply with "OK" only.',
    'Ping',
    config
  );
}
