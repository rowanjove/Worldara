import type { World, Entity, EntityType, Relation, RelationType, SchemaField } from './types';

/**
 * 编译提案工坊的完整推演提示词（供一键复制给外部 Codex / ChatGPT / Claude / Antigravity）
 */
export function buildProposalPrompt(params: {
  world: World;
  request: string;
  entities: Entity[];
  relations: Relation[];
  relationTypes: RelationType[];
  cursorTick: string;
}): string {
  const { world, request, entities, relations, relationTypes, cursorTick } = params;

  // 截取当前世界已知核心实体摘要（避免上下文超长，取前 30 个）
  const entitySummary = entities.slice(0, 30).map((e) => `- ${e.name} (id: ${e.id}, 状态: ${e.canonStatus}) ${e.subtitle ? `· ${e.subtitle}` : ''}`).join('\n');
  const relationTypesSummary = relationTypes.map((t) => `${t.forwardLabel}(id: ${t.id})`).join(', ');

  return `你是「Worldara 世界格」的世界设定编辑，负责协助作者整理严格正典（Canon）世界观。
当前操作的世界具有严格的双时间机制（世界时间 World Tick 与 修订时间 Revision）和确定性正典校验。

【世界背景】
- 世界名称: ${world.name}
- 世界题材: ${world.genre}
- 世界宏观描述: ${world.description || '无'}
- 当前世界时间刻度 (World Tick): ${cursorTick}
- 当前版本 (Revision): ${world.revision}

【世界已知部分实体】
${entitySummary || '当前世界尚未录入核心实体'}

【世界已定义的关系类型】
${relationTypesSummary || '暂无已定义关系类型'}

【作者创作意图 / 推演需求】
${request}

【输出协议规范 (必须严格遵守)】
你必须只输出标准的 JSON，并包裹在 \`\`\`json 与 \`\`\` 代码块中，不得输出任何多余的开场白或解释。
格式契约如下：
\`\`\`json
{
  "request": "${request.replace(/"/g, '\\"')}",
  "unknowns": ["列出推演中可能存疑或需要作者核实的模糊设定点"],
  "citations": ["引用的世界已有实体或背景要点"],
  "changes": [
    {
      "id": "change_1",
      "command": "create_entity",
      "payload": {
        "name": "新实体名称",
        "subtitle": "头衔/定位",
        "document": {
          "race": "种族/归属",
          "bio": "简要设定传记"
        }
      },
      "confidence": 0.95
    },
    {
      "id": "change_2",
      "command": "create_relation",
      "payload": {
        "sourceEntityId": "引用已有实体ID或写新实体名称",
        "targetEntityId": "引用已有实体ID或写新实体名称",
        "relationTypeName": "关系名称(如: 宿敌/盟友/效忠)",
        "description": "关系背后的纽带渊源"
      },
      "confidence": 0.90
    },
    {
      "id": "change_3",
      "command": "create_event",
      "payload": {
        "name": "事件名称",
        "startTick": "${cursorTick}",
        "endTick": "${Number(cursorTick) + 5}",
        "eventType": "historical",
        "description": "历史事件始末与深远影响"
      },
      "confidence": 0.92
    }
  ]
}
\`\`\`

请根据作者需求，生成内容饱满、符合题材氛围、逻辑自洽的原子变更提案。`;
}

/**
 * 编译实体录入/扩写的提示词
 */
export function buildEntityPrompt(params: {
  world: World;
  entityType?: EntityType | undefined;
  existingEntity?: Entity | undefined;
  userPrompt?: string | undefined;
}): string {
  const { world, entityType, existingEntity, userPrompt } = params;

  const fields = (entityType?.schema?.fields || []) as SchemaField[];
  const fieldsDesc = fields.map((f) => `- ${f.label || f.key} (${f.type || 'Text'})${f.required ? ' [必填]' : ''}: ${f.description || ''}`).join('\n');

  return `你是一个严谨的奇幻/科幻世界观角色与设定档案撰写专家。
当前正在为世界「${world.name}」（题材：${world.genre}）录入/扩写实体档案。

【实体所属类型】
${entityType?.label || '自定义实体'} (${entityType?.typeKey || 'custom'})

【类型要求的属性字段规范 (Schema)】
${fieldsDesc || '通用自由属性'}

${existingEntity ? `【现有实体已有档案】\n名称: ${existingEntity.name}\n副标题: ${existingEntity.subtitle}\n已有属性: ${JSON.stringify(existingEntity.document)}\n` : ''}

【作者偏好要求】
${userPrompt || '请自动构想一个极富传奇色彩、设定严密且符合世界题材的全新实体档案。'}

【输出要求】
必须只输出合法的 JSON 代码块（\`\`\`json ... \`\`\`），字段对应如下格式：
\`\`\`json
{
  "name": "实体全称",
  "subtitle": "核心称号或定位短句",
  "document": {
    ${fields.map((f) => `"${f.key || f.id}": "合理的值"`).join(',\n    ') || '"summary": "背景生平描述"'}
  }
}
\`\`\``;
}

/**
 * 编译关系推演提示词
 */
export function buildRelationPrompt(params: {
  world: World;
  sourceEntity: Entity;
  targetEntity?: Entity | undefined;
  relationTypes: RelationType[];
  userPrompt?: string | undefined;
}): string {
  const { world, sourceEntity, targetEntity, relationTypes, userPrompt } = params;

  return `你是一个世界观剧情与网状关系推演专家。
当前正在为世界「${world.name}」构建实体间的羁绊与因果纽带。

【来源实体】
${sourceEntity.name} (${sourceEntity.subtitle || '无头衔'})

${targetEntity ? `【目标实体】\n${targetEntity.name} (${targetEntity.subtitle || '无头衔'})\n` : '【目标实体】未指定，请从世界观角度为其匹配或虚构一个交织关联的角色/组织/要塞\n'}

【可用关系类型预设】
${relationTypes.map((t) => t.forwardLabel).join('、') || '盟友、宿敌、宗属、师徒'}

【作者补充指示】
${userPrompt || '推演最符合二人性格与世界命运的张力关系。'}

【输出要求】
输出合法 JSON 代码块：
\`\`\`json
{
  "relationTypeName": "关系名称(如: 师承/宿命对决/暗中结盟)",
  "description": "详细描述该关系背后的起源故事、利益冲突与历史发展。"
}
\`\`\``;
}

/**
 * 编译编年史事件推演提示词
 */
export function buildEventPrompt(params: {
  world: World;
  cursorTick: string;
  entities: Entity[];
  userPrompt?: string | undefined;
}): string {
  const { world, cursorTick, entities, userPrompt } = params;

  return `你是一个史诗编年史官与历史推演专家。
当前世界「${world.name}」（${world.genre}），当前时间刻度为 World Tick: ${cursorTick}。
世界现有关键角色/势力：${entities.slice(0, 15).map((e) => e.name).join('、') || '暂无'}。

【作者事件指示】
${userPrompt || '推演当前时代即将爆发的一场重大转折历史事件。'}

【输出要求】
输出合法 JSON 代码块：
\`\`\`json
{
  "name": "事件史诗标题 (例如: 苍白黎明之战)",
  "eventType": "historical",
  "startTick": "${cursorTick}",
  "endTick": "${Number(cursorTick) + 10}",
  "description": "事件的导火索、过程经过与给整个世界带来的永久性改变。"
}
\`\`\``;
}

/**
 * 编译 Schema 字段设计的提示词
 */
export function buildSchemaFieldPrompt(params: {
  world: World;
  conceptName: string;
  userPrompt?: string | undefined;
}): string {
  const { world, conceptName, userPrompt } = params;

  return `你是一个世界观数据库建模与 Schema 本体论专家。
正在为世界「${world.name}」（${world.genre}）设计名为「${conceptName}」的实体类型数据规范。

【要求】
${userPrompt || '设计 4 到 6 个最核心的结构化属性字段，类型涵盖单行文本 Text、长篇文稿 LongText、数值 Number、下拉单选 Select、布尔开关 Boolean 等。'}

【输出要求】
输出合法 JSON 代码块：
\`\`\`json
{
  "typeKey": "类型英文标识(小写下划线)",
  "label": "${conceptName}",
  "fields": [
    {
      "key": "字段英文key",
      "label": "中文显示名",
      "type": "Text",
      "required": true,
      "description": "字段说明"
    }
  ]
}
\`\`\``;
}

/**
 * 编译地图要素构想提示词
 */
export function buildMapFeaturePrompt(params: {
  world: World;
  mapName: string;
  mapWidth: number;
  mapHeight: number;
  entities: Entity[];
  userPrompt?: string | undefined;
}): string {
  const { world, mapName, mapWidth, mapHeight, entities, userPrompt } = params;

  return `你是一个史诗世界地理与版图测绘推演专家。
当前世界「${world.name}」（${world.genre}），正在为地图「${mapName}」（画布尺寸: ${mapWidth}x${mapHeight} 像素）构想一处重要的地理标志、遗迹、城邦或领地多边形边界。
世界已知部分实体：${entities.slice(0, 15).map((e) => `${e.name} (id: ${e.id})`).join('、') || '暂无'}。

【作者指示】
${userPrompt || '构想一处具有深厚历史沉淀或关键地缘政治价值的地理地标或领地区域。'}

【输出要求】
必须只输出合法 JSON 代码块：
\`\`\`json
{
  "kind": "marker",
  "name": "地标名称",
  "entityId": "",
  "x": ${Math.round(mapWidth / 2)},
  "y": ${Math.round(mapHeight / 2)},
  "polygonCoords": "100,100;300,120;350,280;120,250;100,100",
  "description": "地理地貌、气候、防务或传奇故事描述"
}
\`\`\``;
}
