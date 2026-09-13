import type { ProposalChange } from './types';

/**
 * 智能鲁棒地从包含自然语言、Markdown 代码块的文本中提取合法 JSON
 */
export function extractJsonFromText(rawText: string): unknown {
  if (!rawText || !rawText.trim()) {
    throw new Error('输入的文本为空');
  }

  const trimmed = rawText.trim();

  // 1. 尝试直接解析
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // 2. 尝试从 ```json ... ``` 或 ``` ... ``` 提取
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // continue
    }
  }

  // 3. 括号平衡搜索：寻找最外层的 { ... } 或 [ ... ]
  let firstBrace = -1;
  let lastBrace = -1;
  let braceCount = 0;
  let insideString = false;
  let escapeNext = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      insideString = !insideString;
      continue;
    }

    if (!insideString) {
      if (char === '{' || char === '[') {
        if (firstBrace === -1) {
          firstBrace = i;
        }
        braceCount++;
      } else if (char === '}' || char === ']') {
        braceCount--;
        if (braceCount === 0 && firstBrace !== -1) {
          lastBrace = i;
          const candidate = trimmed.substring(firstBrace, lastBrace + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            // 继续向下找
          }
        }
      }
    }
  }

  throw new Error('未能从回复中解析出合法的 JSON 结构，请检查格式或重试');
}

/**
 * 将提取出来的未知 JSON 归一化为标准的 Proposal 格式
 */
export function normalizeProposalFromJson(jsonObj: unknown): {
  changes: ProposalChange[];
  unknowns: string[];
  citations: string[];
} {
  if (!jsonObj || typeof jsonObj !== 'object') {
    throw new Error('提取的内容不是合法的对象格式');
  }

  const record = jsonObj as Record<string, unknown>;

  // 寻找 changes 数组
  let rawChanges: unknown[] = [];
  if (Array.isArray(record.changes)) {
    rawChanges = record.changes;
  } else if (Array.isArray(record.commands)) {
    rawChanges = record.commands;
  } else if (Array.isArray(record.mutations)) {
    rawChanges = record.mutations;
  } else if (Array.isArray(jsonObj)) {
    rawChanges = jsonObj;
  }

  if (rawChanges.length === 0) {
    throw new Error('未在返回内容中找到变更列表 (changes)');
  }

  const changes: ProposalChange[] = rawChanges.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`第 ${idx + 1} 项变更格式无效`);
    }
    const it = item as Record<string, unknown>;
    const command = typeof it.command === 'string' ? it.command : 'create_entity';
    const payload = (it.payload && typeof it.payload === 'object' ? it.payload : it) as Record<string, unknown>;
    const id = typeof it.id === 'string' ? it.id : `change_${Date.now()}_${idx}`;
    const dependsOn = Array.isArray(it.dependsOn) ? (it.dependsOn as string[]) : [];
    const evidenceRefs = Array.isArray(it.evidenceRefs) ? (it.evidenceRefs as string[]) : [];
    const confidence = typeof it.confidence === 'number' ? Math.max(0, Math.min(1, it.confidence)) : 0.95;

    return {
      id,
      command,
      payload,
      dependsOn,
      evidenceRefs,
      confidence,
      userDecision: 'pending',
    };
  });

  const unknowns = Array.isArray(record.unknowns)
    ? (record.unknowns.filter((u): u is string => typeof u === 'string'))
    : [];

  const citations = Array.isArray(record.citations)
    ? (record.citations.filter((c): c is string => typeof c === 'string'))
    : [];

  return { changes, unknowns, citations };
}

/**
 * 从文本中提取单个实体字段（用于实体录入/扩写）
 */
export function extractEntityFieldsFromJson(rawText: string): {
  name?: string | undefined;
  subtitle?: string | undefined;
  document: Record<string, unknown>;
} {
  const parsed = extractJsonFromText(rawText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('实体数据必须为 JSON 对象');
  }

  const rec = parsed as Record<string, unknown>;
  const name = typeof rec.name === 'string' ? rec.name : undefined;
  const subtitle = typeof rec.subtitle === 'string' ? rec.subtitle : undefined;
  const document = (rec.document && typeof rec.document === 'object' && !Array.isArray(rec.document)
    ? rec.document
    : rec) as Record<string, unknown>;

  // 从 document 中剔除顶级字段
  const cleanDoc = { ...document };
  delete cleanDoc.name;
  delete cleanDoc.subtitle;

  return {
    ...(name !== undefined ? { name } : {}),
    ...(subtitle !== undefined ? { subtitle } : {}),
    document: cleanDoc,
  };
}
