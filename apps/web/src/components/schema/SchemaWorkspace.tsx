import React, { useState } from 'react';
import type { World, EntityType, RelationType, SchemaField, ValidationRule } from '../../lib/types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { AiAssistantModal } from '../common/AiAssistantModal';
import { buildSchemaFieldPrompt } from '../../lib/promptCompiler';
import { extractJsonFromText } from '../../lib/jsonExtractor';
import { IconSchema, IconNetwork, IconPlus, IconQuill } from '../ui/Icons';

interface SchemaWorkspaceProps {
  world?: World | undefined;
  entityTypes: EntityType[];
  relationTypes: RelationType[];
  onCreateEntityType: (data: { typeKey: string; label: string; schema: Record<string, unknown> }) => Promise<void>;
  onCreateRelationType: (data: { forwardLabel: string; inverseLabel: string; symmetric: boolean }) => Promise<void>;
  rules?: ValidationRule[];
  onCreateRule?: (data: { name: string; assert: Record<string, unknown>; message?: string }) => Promise<void>;
  disabled?: boolean | undefined;
}

export function SchemaWorkspace({
  world,
  entityTypes,
  relationTypes,
  onCreateEntityType,
  onCreateRelationType,
  rules = [],
  onCreateRule,
  disabled,
}: SchemaWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<'entityTypes' | 'relationTypes' | 'rules'>('entityTypes');

  // 新建实体类型模态框
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [aiSchemaOpen, setAiSchemaOpen] = useState(false);
  const [typeKey, setTypeKey] = useState('');
  const [typeLabel, setTypeLabel] = useState('');
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [expertJsonMode, setExpertJsonMode] = useState(false);
  const [expertJson, setExpertJson] = useState('{"fields":[]}');
  const [savingType, setSavingType] = useState(false);

  // 临时添加字段输入
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState('Text');
  const [newFieldRequired, setNewFieldRequired] = useState(false);

  // 新建关系类型模态框
  const [relModalOpen, setRelModalOpen] = useState(false);
  const [forwardLabel, setForwardLabel] = useState('');
  const [inverseLabel, setInverseLabel] = useState('');
  const [symmetric, setSymmetric] = useState(false);
  const [savingRel, setSavingRel] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleMessage, setRuleMessage] = useState('');
  const [ruleAssert, setRuleAssert] = useState('{"duration_between":{"from":"birth_date","to":"death_date","lte":180}}');
  const [savingRule, setSavingRule] = useState(false);

  // 预设模板
  function applyPreset(preset: 'character' | 'location' | 'faction' | 'artifact') {
    if (preset === 'character') {
      setTypeKey('character');
      setTypeLabel('人物角色 (Character)');
      setFields([
        { id: 'race', key: 'race', label: '种族出身', type: 'Text', required: true },
        { id: 'alignment', key: 'alignment', label: '阵营倾向', type: 'Select', validation_json: { options: ['守序善良', '中立善良', '混乱善良', '守序中立', '真正中立', '混乱中立', '守序邪恶', '中立邪恶', '混乱邪恶'] } },
        { id: 'power_level', key: 'power_level', label: '实力阶位', type: 'Text' },
        { id: 'bio', key: 'bio', label: '生平设定', type: 'LongText' },
      ]);
    } else if (preset === 'location') {
      setTypeKey('location');
      setTypeLabel('地理要塞 (Location)');
      setFields([
        { id: 'climate', key: 'climate', label: '气候地貌', type: 'Text', required: true },
        { id: 'danger_rank', key: 'danger_rank', label: '危险等级', type: 'Select', validation_json: { options: ['定居安全', '荒野险峻', '绝境死地'] } },
        { id: 'population', key: 'population', label: '常驻人口规模', type: 'Number' },
        { id: 'history', key: 'history', label: '地理变迁史', type: 'LongText' },
      ]);
    } else if (preset === 'faction') {
      setTypeKey('faction');
      setTypeLabel('阵营势力 (Faction)');
      setFields([
        { id: 'ideology', key: 'ideology', label: '核心教义/宗旨', type: 'Text', required: true },
        { id: 'headquarters', key: 'headquarters', label: '总部所在地', type: 'Text' },
        { id: 'standing', key: 'standing', label: '影响力评级', type: 'Text' },
      ]);
    } else if (preset === 'artifact') {
      setTypeKey('artifact');
      setTypeLabel('圣物秘宝 (Artifact)');
      setFields([
        { id: 'rarity', key: 'rarity', label: '品质等级', type: 'Select', validation_json: { options: ['常见', '精良', '史诗', '远古遗物'] } },
        { id: 'origin_era', key: 'origin_era', label: '锻造年代', type: 'Text' },
        { id: 'effect_lore', key: 'effect_lore', label: '法则效能与代价', type: 'LongText' },
      ]);
    }
  }

  function handleAddField() {
    if (!newFieldKey.trim() || !newFieldLabel.trim()) return;
    setFields((prev) => [
      ...prev,
      {
        id: newFieldKey.trim(),
        key: newFieldKey.trim(),
        label: newFieldLabel.trim(),
        type: newFieldType,
        required: newFieldRequired,
      },
    ]);
    setNewFieldKey('');
    setNewFieldLabel('');
    setNewFieldRequired(false);
  }

  function handleRemoveField(index: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== index));
  }

  async function handleCreateTypeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!typeKey.trim() || !typeLabel.trim()) return;
    let schema: Record<string, unknown>;
    if (expertJsonMode) {
      try {
        schema = JSON.parse(expertJson);
      } catch {
        alert('JSON 格式不正确');
        return;
      }
    } else {
      schema = { fields };
    }

    setSavingType(true);
    try {
      await onCreateEntityType({
        typeKey: typeKey.trim(),
        label: typeLabel.trim(),
        schema,
      });
      setTypeKey('');
      setTypeLabel('');
      setFields([]);
      setTypeModalOpen(false);
    } finally {
      setSavingType(false);
    }
  }

  async function handleCreateRelTypeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!forwardLabel.trim()) return;
    setSavingRel(true);
    try {
      await onCreateRelationType({
        forwardLabel: forwardLabel.trim(),
        inverseLabel: inverseLabel.trim() || forwardLabel.trim(),
        symmetric,
      });
      setForwardLabel('');
      setInverseLabel('');
      setSymmetric(false);
      setRelModalOpen(false);
    } finally {
      setSavingRel(false);
    }
  }

  async function handleCreateRuleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ruleName.trim() || !onCreateRule) return;
    let assert: Record<string, unknown>;
    try {
      assert = JSON.parse(ruleAssert) as Record<string, unknown>;
    } catch {
      alert('规则 assert JSON 格式不正确');
      return;
    }
    setSavingRule(true);
    try {
      await onCreateRule({ name: ruleName.trim(), assert, ...(ruleMessage.trim() ? { message: ruleMessage.trim() } : {}) });
      setRuleName('');
      setRuleMessage('');
      setRuleModalOpen(false);
    } finally {
      setSavingRule(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 顶部标题与切换栏 */}
      <div className="panel-card" style={{ padding: '14px 18px', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <IconSchema size={16} style={{ color: 'var(--accent)' }} />
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                本体论 Schema 体系与规则工坊 (World Schema)
              </h2>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              定义世界的本体论骨架：自定义实体动态属性字段契约与实体间关系类型拓扑。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ display: 'flex', background: 'var(--bg-app)', borderRadius: 'var(--radius-md)', padding: '2px', border: '1px solid var(--border-subtle)' }}>
              <button
                className={`btn btn-sm ${activeTab === 'entityTypes' ? 'btn-secondary' : 'btn-ghost'}`}
                onClick={() => setActiveTab('entityTypes')}
              >
                实体类型 Schema ({entityTypes.length})
              </button>
              <button
                className={`btn btn-sm ${activeTab === 'relationTypes' ? 'btn-secondary' : 'btn-ghost'}`}
                onClick={() => setActiveTab('relationTypes')}
              >
                关系类型定义 ({relationTypes.length})
              </button>
              <button
                className={`btn btn-sm ${activeTab === 'rules' ? 'btn-secondary' : 'btn-ghost'}`}
                onClick={() => setActiveTab('rules')}
              >
                世界规则 ({rules.length})
              </button>
            </div>

            {activeTab === 'entityTypes' ? (
              <Button variant="gold" onClick={() => setTypeModalOpen(true)} disabled={disabled} icon={<IconPlus size={13} />}>
                定义实体类型
              </Button>
            ) : activeTab === 'relationTypes' ? (
              <Button variant="gold" onClick={() => setRelModalOpen(true)} disabled={disabled} icon={<IconPlus size={13} />}>
                定义关系类型
              </Button>
            ) : (
              <Button variant="gold" onClick={() => setRuleModalOpen(true)} disabled={disabled} icon={<IconPlus size={13} />}>
                添加规则
              </Button>
            )}
          </div>
        </div>
      </div>

      {activeTab === 'rules' ? (
        rules.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">尚无世界自定义规则</div>
            <p className="empty-state-desc">用 JSON AST 描述寿命上限、职位唯一等世界规则。禁止执行任意 JavaScript。</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {rules.map((rule) => (
              <div key={rule.id} className="panel-card" style={{ marginBottom: 0, padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <strong>{rule.name}</strong>
                  <span className="badge badge-neutral">{rule.severity} · {rule.target}</span>
                </div>
                {rule.message ? <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>{rule.message}</p> : null}
              </div>
            ))}
          </div>
        )
      ) : activeTab === 'entityTypes' ? (
        /* 实体类型列表 */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {entityTypes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <IconSchema size={28} />
              </div>
              <div className="empty-state-title">尚未定义自定义实体类型</div>
              <p className="empty-state-desc">
                世界须先具备实体类型结构契约（如人物、派系、地点、物品）方可开展结构化录入。
              </p>
              <Button variant="gold" onClick={() => setTypeModalOpen(true)} disabled={disabled} icon={<IconPlus size={13} />}>
                定义类型
              </Button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {entityTypes.map((t) => {
                const schemaFields: SchemaField[] = Array.isArray(t.schema?.fields) ? t.schema.fields : [];
                return (
                  <div key={t.id} className="panel-card" style={{ marginBottom: 0, padding: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div>
                        <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{t.label}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                          key: {t.typeKey}
                        </div>
                      </div>
                      <Badge variant="neutral" size="sm">Schema v{t.schemaVersion}</Badge>
                    </div>

                    <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: '5px', fontFamily: 'var(--font-mono)' }}>
                        结构化字段 ({schemaFields.length})
                      </div>
                      {schemaFields.length === 0 ? (
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                          仅含默认基础属性
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {schemaFields.map((f, i) => (
                            <span
                              key={i}
                              style={{
                                fontSize: '11px',
                                background: 'var(--bg-app)',
                                border: '1px solid var(--border-subtle)',
                                padding: '1px 6px',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {f.label || f.key} <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>[{f.type || f.value_type || 'Text'}]</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* 关系类型列表 */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {relationTypes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <IconNetwork size={28} />
              </div>
              <div className="empty-state-title">尚未定义关系类型</div>
              <p className="empty-state-desc">
                定义如“同盟”、“宿怨”、“附属”、“传承”等拓扑关系，确立世界知识图谱标准。
              </p>
              <Button variant="gold" onClick={() => setRelModalOpen(true)} disabled={disabled} icon={<IconPlus size={13} />}>
                定义关系类型
              </Button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
              {relationTypes.map((r) => (
                <div key={r.id} className="panel-card" style={{ marginBottom: 0, padding: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{r.forwardLabel}</strong>
                    {r.symmetric ? (
                      <Badge variant="neutral" size="sm">对称 ⇄</Badge>
                    ) : (
                      <Badge variant="neutral" size="sm">定向 →</Badge>
                    )}
                  </div>
                  {!r.symmetric && r.inverseLabel && (
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      反向标签: {r.inverseLabel}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 创建实体类型模态框 */}
      <Modal
        isOpen={typeModalOpen}
        onClose={() => setTypeModalOpen(false)}
        title="定义实体类型与 Schema (Define Entity Type)"
        maxWidth="660px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTypeModalOpen(false)}>取消</Button>
            <Button variant="gold" onClick={handleCreateTypeSubmit} loading={savingType} disabled={disabled}>
              确立类型
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface-elevated)', padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginBottom: '8px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>辅助 Schema 建模</div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>输入概念名称，获取一份可修改的字段建议</div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setAiSchemaOpen(true)}
            icon={<IconQuill size={12} />}
          >
            生成字段建议
          </Button>
        </div>

        <form onSubmit={handleCreateTypeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* 预设模板载入 */}
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
              载入基础设定模板:
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => applyPreset('character')}
              >
                人物角色
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => applyPreset('location')}
              >
                地理要塞
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => applyPreset('faction')}
              >
                阵营派系
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => applyPreset('artifact')}
              >
                圣物秘宝
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                类型标识符 (type_key) <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                required
                value={typeKey}
                onChange={(e) => setTypeKey(e.target.value)}
                placeholder="例如：character, guild, realm"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                显示名称 (Label) <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                required
                value={typeLabel}
                onChange={(e) => setTypeLabel(e.target.value)}
                placeholder="例如：人物角色、公会盟会"
              />
            </div>
          </div>

          {/* 模式切换 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '6px', borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '12px', fontWeight: 600 }}>字段结构设计器</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setExpertJsonMode(!expertJsonMode)}
            >
              {expertJsonMode ? '可视化设计器' : '专家 JSON 模式'}
            </button>
          </div>

          {!expertJsonMode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* 已有字段列表 */}
              {fields.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {fields.map((f, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '6px 10px',
                        background: 'var(--bg-app)',
                        borderRadius: 'var(--radius-md)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '12px',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div>
                        <strong>{f.label}</strong>{' '}
                        <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                          ({f.key})
                        </span>{' '}
                        <span style={{ color: 'var(--canon-gold)', fontSize: '11px' }}>[{f.type}]</span>
                        {f.required && (
                          <span style={{ color: 'var(--danger)', marginLeft: '4px' }}>*必填</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--danger)', padding: '0 4px', fontSize: '11px' }}
                        onClick={() => handleRemoveField(idx)}
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 添加新字段小面板 */}
              <div
                style={{
                  padding: '10px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px dashed var(--border-default)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>新增属性字段</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px auto', gap: '6px', alignItems: 'center' }}>
                  <input
                    placeholder="字段键 (key)"
                    value={newFieldKey}
                    onChange={(e) => setNewFieldKey(e.target.value)}
                    style={{ fontSize: '12px', padding: '5px 8px' }}
                  />
                  <input
                    placeholder="显示名称 (Label)"
                    value={newFieldLabel}
                    onChange={(e) => setNewFieldLabel(e.target.value)}
                    style={{ fontSize: '12px', padding: '5px 8px' }}
                  />
                  <select
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value)}
                    style={{ fontSize: '12px', padding: '5px 8px' }}
                  >
                    <option value="Text">单行文本</option>
                    <option value="LongText">长篇设定</option>
                    <option value="Number">数值</option>
                    <option value="Boolean">布尔开关</option>
                    <option value="EntityReference">实体引用</option>
                  </select>
                  <Button type="button" variant="secondary" size="sm" onClick={handleAddField}>
                    添加
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <textarea
                value={expertJson}
                onChange={(e) => setExpertJson(e.target.value)}
                rows={5}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}
              />
            </div>
          )}
        </form>
      </Modal>

      {/* 创建关系类型模态框 */}
      <Modal
        isOpen={relModalOpen}
        onClose={() => setRelModalOpen(false)}
        title="定义实体间关系类型 (Define Relation Type)"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRelModalOpen(false)}>取消</Button>
            <Button variant="gold" onClick={handleCreateRelTypeSubmit} loading={savingRel} disabled={disabled}>
              确立关系类型
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateRelTypeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              正向关系标签 (Forward Label) <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              required
              autoFocus
              value={forwardLabel}
              onChange={(e) => setForwardLabel(e.target.value)}
              placeholder="例如：师承、统治、效忠、盟约…"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              反向含义标签 (Inverse Label)
            </label>
            <input
              value={inverseLabel}
              onChange={(e) => setInverseLabel(e.target.value)}
              placeholder="例如：被效忠、指导弟子（留空则同正向）"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
            <input
              type="checkbox"
              id="rel-symmetric"
              checked={symmetric}
              onChange={(e) => setSymmetric(e.target.checked)}
              style={{ width: 'auto', cursor: 'pointer' }}
            />
            <label htmlFor="rel-symmetric" style={{ fontSize: '12px', color: 'var(--text-primary)', cursor: 'pointer' }}>
              对称关系（双方地位对等，如“同盟”、“宿敌”）
            </label>
          </div>
        </form>
      </Modal>

      {/* AI 构想实体类型与 Schema 弹窗 */}
      <AiAssistantModal
        isOpen={aiSchemaOpen}
        onClose={() => setAiSchemaOpen(false)}
        title="构思实体字段"
        description={world ? `为世界「${world.name}」设计实体类型数据结构` : '构想实体类型 Schema'}
        promptCompiler={(helper: string) =>
          buildSchemaFieldPrompt({
            world: world || {
              id: 'custom',
              name: '当前世界',
              genre: 'Fantasy',
              revision: '0',
              description: '',
            },
            conceptName: typeLabel || typeKey || '新类型实体',
            ...(helper ? { userPrompt: helper } : {}),
          })
        }
        onApplyResult={(rawText: string) => {
          const parsed = extractJsonFromText(rawText);
          if (parsed && typeof parsed === 'object') {
            const data = parsed as Record<string, unknown>;
            if (typeof data.typeKey === 'string' && data.typeKey.trim()) {
              setTypeKey(data.typeKey.trim().toLowerCase().replace(/\s+/g, '_'));
            }
            if (typeof data.label === 'string' && data.label.trim()) {
              setTypeLabel(data.label.trim());
            }
            if (Array.isArray(data.fields) && data.fields.length > 0) {
              const formattedFields: SchemaField[] = (data.fields as any[]).map((f: any, idx: number) => ({
                id: f.key || `field_${idx}`,
                key: f.key || `field_${idx}`,
                label: f.label || f.key || `字段${idx + 1}`,
                type: f.type || 'Text',
                required: Boolean(f.required),
                ...(f.description ? { description: String(f.description) } : {}),
              }));
              setFields(formattedFields);
              setExpertJson(JSON.stringify({ fields: formattedFields }, null, 2));
            }
          }
        }}
      />

      <Modal isOpen={ruleModalOpen} onClose={() => setRuleModalOpen(false)} title="添加世界规则">
        <form onSubmit={handleCreateRuleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input placeholder="规则名称，例如 凡人寿命上限" value={ruleName} onChange={(e) => setRuleName(e.target.value)} />
          <input placeholder="提示信息（可选）" value={ruleMessage} onChange={(e) => setRuleMessage(e.target.value)} />
          <textarea rows={8} value={ruleAssert} onChange={(e) => setRuleAssert(e.target.value)} />
          <Button type="submit" variant="gold" loading={savingRule} disabled={disabled}>保存规则</Button>
        </form>
      </Modal>
    </div>
  );
}
