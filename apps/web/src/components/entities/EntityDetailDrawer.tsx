import React, { useEffect, useState } from 'react';
import type { Entity, EntityType, Relation, RelationType, WorldEvent, CanonStatus, World } from '../../lib/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { api } from '../../lib/api';
import { AiAssistantModal } from '../common/AiAssistantModal';
import {
  IconX,
  IconCheck,
  IconFileText,
  IconNetwork,
  IconClock,
  IconQuill,
} from '../ui/Icons';
import { buildEntityPrompt } from '../../lib/promptCompiler';
import { extractEntityFieldsFromJson } from '../../lib/jsonExtractor';

interface EntityDetailDrawerProps {
  world?: World | undefined;
  entity: Entity | null;
  onClose: () => void;
  entityType?: EntityType | undefined;
  allEntities: Entity[];
  relations: Relation[];
  relationTypes: RelationType[];
  events: WorldEvent[];
  onChangeCanonStatus: (entityId: string, status: CanonStatus) => Promise<void>;
  onSaveDocument?: ((entityId: string, doc: Record<string, unknown>) => Promise<void>) | undefined;
  onRefresh?: (() => Promise<void>) | undefined;
  disabled?: boolean | undefined;
}

const allowedTransitions: Record<CanonStatus, CanonStatus[]> = {
  draft: ['pending', 'archived'],
  pending: ['canon', 'draft', 'archived'],
  canon: ['retconned', 'archived'],
  retconned: ['archived'],
  archived: [],
};

export function EntityDetailDrawer({
  world,
  entity,
  onClose,
  entityType,
  allEntities,
  relations,
  relationTypes,
  events,
  onChangeCanonStatus,
  onSaveDocument,
  onRefresh,
  disabled,
}: EntityDetailDrawerProps) {
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [backlinks, setBacklinks] = useState<Array<{ entityId: string; name: string }>>([]);
  const [unlinked, setUnlinked] = useState<Array<{ name: string; entityId: string }>>([]);
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    if (!world || !entity) {
      setBacklinks([]);
      setUnlinked([]);
      return;
    }
    void Promise.all([
      api.listBacklinks(world.id, entity.id).catch(() => []),
      api.listUnlinkedMentions(world.id, entity.id).catch(() => []),
    ]).then(([nextBacklinks, nextUnlinked]) => {
      setBacklinks(nextBacklinks);
      setUnlinked(nextUnlinked);
    });
  }, [world, entity]);

  if (!entity) return null;

  // 筛选与该实体相关的关系
  const relatedAsSource = relations.filter((r) => r.sourceEntityId === entity.id);
  const relatedAsTarget = relations.filter((r) => r.targetEntityId === entity.id);

  // 筛选该实体参与的事件
  const relatedEvents = events.filter(
    (ev) => ev.participantIds?.includes(entity.id)
  );

  async function handleStatusChange(status: CanonStatus) {
    if (!entity || status === entity.canonStatus) return;
    setUpdatingStatus(true);
    try {
      await onChangeCanonStatus(entity.id, status);
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* 抽屉头部 */}
        <div className="drawer-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <Badge variant={entity.canonStatus}>{entity.canonStatus}</Badge>
              <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                {entityType?.label ?? '未知类型'} · Rev {entity.revision}
              </span>
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {entity.name}
            </h2>
            {entity.subtitle && (
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{entity.subtitle}</p>
            )}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            style={{ padding: '6px', color: 'var(--text-secondary)' }}
            aria-label="关闭"
          >
            <IconX size={16} />
          </button>
        </div>

        {/* 抽屉内容区 */}
        <div className="drawer-body">
          {/* Canon 状态治理栏 */}
          <div style={{ background: 'var(--bg-surface-elevated)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.05em', marginBottom: '8px' }}>
              正典状态生命周期
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {(['draft', 'pending', 'canon', 'retconned', 'archived'] as CanonStatus[]).map((st) => {
                const isCurrent = entity.canonStatus === st;
                const isTransitionAllowed = allowedTransitions[entity.canonStatus]?.includes(st);
                const isBtnDisabled = disabled || updatingStatus || (!isCurrent && !isTransitionAllowed);
                return (
                  <button
                    key={st}
                    disabled={isBtnDisabled}
                    className={`btn btn-sm ${isCurrent ? 'btn-gold' : 'btn-secondary'}`}
                    style={{
                      textTransform: 'uppercase',
                      fontSize: '11px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      opacity: !isCurrent && !isTransitionAllowed ? 0.4 : 1,
                      cursor: !isCurrent && !isTransitionAllowed ? 'not-allowed' : undefined,
                    }}
                    title={!isCurrent && !isTransitionAllowed ? `无法从 ${entity.canonStatus} 直接转换为 ${st}` : undefined}
                    onClick={() => handleStatusChange(st)}
                  >
                    {isCurrent && <IconCheck size={12} style={{ marginRight: '4px' }} />}
                    {st}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 属性列表 Document */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                <IconFileText size={14} />
                <span>结构化属性定义 (Structured Document)</span>
              </div>
              {world && onSaveDocument && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={<IconQuill size={12} style={{ color: 'var(--canon-gold)' }} />}
                  onClick={() => setAiModalOpen(true)}
                  style={{ fontSize: '11px', padding: '2px 8px' }}
                >
                  补全设定
                </Button>
              )}
            </div>
            {Object.keys(entity.document || {}).length > 0 ? (
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
                {Object.entries(entity.document).map(([k, val]) => (
                  <div key={k} className="meta-row">
                    <span className="meta-key">{k}</span>
                    <span className="meta-value">
                      {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '8px 0' }}>
                暂未设置附加自定义字段值
              </div>
            )}
          </div>

          {(entity.documentText || unlinked.length > 0 || backlinks.length > 0) && (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>文稿链接</div>
              {entity.documentText ? (
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', marginBottom: '8px' }}>{entity.documentText}</p>
              ) : null}
              {unlinked.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>检测到 {unlinked.length} 个未建立引用的实体</span>
                  {unlinked.map((item) => (
                    <div key={item.entityId} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px' }}>{item.name}</span>
                      <Button
                        size="sm"
                        variant="gold"
                        disabled={disabled || linking !== null}
                        loading={linking === item.name}
                        onClick={async () => {
                          if (!world) return;
                          setLinking(item.name);
                          try {
                            await api.linkMention(world.id, entity.id, world.revision, item.name);
                            await onRefresh?.();
                          } finally {
                            setLinking(null);
                          }
                        }}
                      >
                        转为 [[链接]]
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {backlinks.length > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  反向链接：{backlinks.map((item) => item.name).join('、')}
                </div>
              )}
            </div>
          )}

          {/* 关联关系网络 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              <IconNetwork size={14} />
              <span>拓扑关系网络 ({relatedAsSource.length + relatedAsTarget.length})</span>
            </div>
            {relatedAsSource.length === 0 && relatedAsTarget.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                暂无连接关系，可在「关系图谱」中添加连接。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {relatedAsSource.map((r) => {
                  const targetEnt = allEntities.find((e) => e.id === r.targetEntityId);
                  const rType = relationTypes.find((t) => t.id === r.relationTypeId);
                  return (
                    <div
                      key={r.id}
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-app)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '12px',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <span style={{ color: 'var(--canon-gold)', fontWeight: 600 }}>
                          [{rType?.forwardLabel || '关联'}]
                        </span>{' '}
                        <span>→ {targetEnt?.name || r.targetEntityId}</span>
                        {r.description && (
                          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                            {r.description}
                          </div>
                        )}
                      </div>
                      <Badge variant={r.canonStatus} size="sm">{r.canonStatus}</Badge>
                    </div>
                  );
                })}

                {relatedAsTarget.map((r) => {
                  const srcEnt = allEntities.find((e) => e.id === r.sourceEntityId);
                  const rType = relationTypes.find((t) => t.id === r.relationTypeId);
                  return (
                    <div
                      key={r.id}
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-app)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '12px',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <span>{srcEnt?.name || r.sourceEntityId}</span>{' '}
                        <span style={{ color: 'var(--text-tertiary)' }}>
                          [{rType?.inverseLabel || rType?.forwardLabel || '被关联'}]
                        </span>{' '}
                        <span>→ 本实体</span>
                      </div>
                      <Badge variant={r.canonStatus} size="sm">{r.canonStatus}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 参与的历史事件 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              <IconClock size={14} />
              <span>时序编年记录 ({relatedEvents.length})</span>
            </div>
            {relatedEvents.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                该实体尚未参与已记录的编年史事件。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {relatedEvents.map((ev) => (
                  <div
                    key={ev.id}
                    style={{
                      padding: '8px 12px',
                      background: 'var(--bg-app)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '12px',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{ev.name}</strong>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--canon-gold)' }}>
                        Tick {ev.startTick}
                      </span>
                    </div>
                    {ev.description && (
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        {ev.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 元信息 */}
          <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
            <div>ID: <span style={{ fontFamily: 'var(--font-mono)' }}>{entity.id}</span></div>
            {entity.createdAt && <div>创建时间: {new Date(entity.createdAt).toLocaleString()}</div>}
          </div>
        </div>

        {/* 抽屉底部 */}
        <div className="drawer-footer">
          <Button variant="secondary" size="sm" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>

      {world && entity && onSaveDocument && (
        <AiAssistantModal
          isOpen={aiModalOpen}
          onClose={() => setAiModalOpen(false)}
          title={`补全实体设定 · ${entity.name}`}
          description="会参考现有称号、属性与类型规范，生成一份可编辑的背景与属性草案。"
          promptCompiler={(instr) =>
            buildEntityPrompt({
              world,
              entityType,
              existingEntity: entity,
              userPrompt: instr,
            })
          }
          onApplyResult={async (rawText) => {
            const extracted = extractEntityFieldsFromJson(rawText);
            const merged = { ...entity.document, ...extracted.document };
            await onSaveDocument(entity.id, merged);
          }}
        />
      )}
    </div>
  );
}
