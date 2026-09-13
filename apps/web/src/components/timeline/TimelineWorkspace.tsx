import React, { useState } from 'react';
import type { World, WorldEvent, Entity, CanonStatus, WorldSnapshot } from '../../lib/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { api } from '../../lib/api';
import { AiAssistantModal } from '../common/AiAssistantModal';
import { buildEventPrompt } from '../../lib/promptCompiler';
import { extractJsonFromText } from '../../lib/jsonExtractor';
import { IconClock, IconPlus, IconQuill, IconBook, IconNetwork } from '../ui/Icons';

interface TimelineWorkspaceProps {
  world?: World | undefined;
  worldId: string;
  worldRevision: string;
  currentTick: string;
  events: WorldEvent[];
  allEntities: Entity[];
  onCreateEvent: (data: { name: string; eventType: string; startTick: string; endTick?: string; description: string; participantIds: string[] }) => Promise<void>;
  onChangeCanonStatus: (eventId: string, status: CanonStatus) => Promise<void>;
  disabled?: boolean | undefined;
}

export function TimelineWorkspace({
  world,
  worldId,
  worldRevision,
  currentTick,
  events,
  allEntities,
  onCreateEvent,
  onChangeCanonStatus,
  disabled,
}: TimelineWorkspaceProps) {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [eventName, setEventName] = useState('');
  const [eventType, setEventType] = useState('historical');
  const [startTick, setStartTick] = useState(currentTick);
  const [endTick, setEndTick] = useState('');
  const [description, setDescription] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 快照检视器状态
  const [snapshotTick, setSnapshotTick] = useState(currentTick);
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState('');
  const [viewTab, setViewTab] = useState<'chronicle' | 'snapshot'>('chronicle');

  // 按起止时间升序排列事件
  const sortedEvents = [...events].sort((a, b) => {
    try {
      const diff = BigInt(a.startTick) - BigInt(b.startTick);
      return diff < 0n ? -1 : diff > 0n ? 1 : 0;
    } catch {
      return 0;
    }
  });

  async function handleCreateEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!eventName.trim() || !/^-?\d+$/.test(startTick.trim())) return;
    setSubmitting(true);
    try {
      await onCreateEvent({
        name: eventName.trim(),
        eventType,
        startTick: startTick.trim(),
        ...(endTick.trim() ? { endTick: endTick.trim() } : {}),
        description: description.trim(),
        participantIds: selectedParticipants,
      });
      setEventName('');
      setDescription('');
      setSelectedParticipants([]);
      setCreateModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function loadSnapshot() {
    if (!/^-?\d+$/.test(snapshotTick.trim())) return;
    setLoadingSnapshot(true);
    setSnapshotError('');
    try {
      const data = await api.getSnapshot(worldId, snapshotTick.trim());
      setSnapshot(data);
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : '获取快照失败');
    } finally {
      setLoadingSnapshot(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 顶部控制栏 */}
      <div className="panel-card" style={{ padding: '16px 18px', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <IconClock size={16} style={{ color: 'var(--canon-gold)' }} />
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                编年史时间线与状态投影 (Chronicle & Snapshot)
              </h2>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              双时间架构：世界时间 World Tick 记录历法事件，状态投影可在任意时刻还原存续实体与有效关系拓扑。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ display: 'flex', background: 'var(--bg-app)', borderRadius: 'var(--radius-md)', padding: '2px', border: '1px solid var(--border-subtle)' }}>
              <button
                className={`btn btn-sm ${viewTab === 'chronicle' ? 'btn-secondary' : 'btn-ghost'}`}
                onClick={() => setViewTab('chronicle')}
              >
                事件时间流
              </button>
              <button
                className={`btn btn-sm ${viewTab === 'snapshot' ? 'btn-secondary' : 'btn-ghost'}`}
                onClick={() => {
                  setViewTab('snapshot');
                  if (!snapshot) void loadSnapshot();
                }}
              >
                时空快照投影
              </button>
            </div>

            <Button
              variant="gold"
              onClick={() => setCreateModalOpen(true)}
              disabled={disabled}
              icon={<IconPlus size={13} />}
            >
              记录历史事件
            </Button>
          </div>
        </div>
      </div>

      {viewTab === 'chronicle' ? (
        /* 编年史事件流 */
        sortedEvents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <IconClock size={28} />
            </div>
            <div className="empty-state-title">当前世界尚未记录任何重大历史事件</div>
            <p className="empty-state-desc">
              点击上方按钮添加战役、政变、条约签订或重大灾变等历史关键节点。
            </p>
            <Button variant="secondary" onClick={() => setCreateModalOpen(true)} disabled={disabled}>
              记录事件
            </Button>
          </div>
        ) : (
          <div style={{ position: 'relative', paddingLeft: '28px' }}>
            {/* 时间主轴线 */}
            <div
              style={{
                position: 'absolute',
                left: '10px',
                top: '12px',
                bottom: '12px',
                width: '1px',
                background: 'var(--border-default)',
              }}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {sortedEvents.map((ev) => (
                <div key={ev.id} style={{ position: 'relative' }}>
                  {/* 时间轴节点圆点 */}
                  <div
                    style={{
                      position: 'absolute',
                      left: '-22px',
                      top: '16px',
                      width: '9px',
                      height: '9px',
                      borderRadius: '50%',
                      background: 'var(--canon-gold)',
                      border: '2px solid var(--bg-app)',
                    }}
                  />

                  <div className="panel-card" style={{ marginBottom: 0, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--canon-gold)', fontWeight: 600 }}>
                            Tick {ev.startTick}
                            {ev.endTick ? ` → ${ev.endTick}` : ''}
                          </span>
                          <Badge variant="neutral" size="sm">{ev.eventType}</Badge>
                          <Badge variant={ev.canonStatus} size="sm">{ev.canonStatus}</Badge>
                        </div>
                        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {ev.name}
                        </h3>
                      </div>

                      {/* 快速变更 Canon 状态 */}
                      <select
                        value={ev.canonStatus}
                        onChange={(e) => void onChangeCanonStatus(ev.id, e.target.value as CanonStatus)}
                        disabled={disabled}
                        style={{ width: '100px', fontSize: '11px', padding: '3px 6px' }}
                      >
                        <option value="draft">draft</option>
                        <option value="pending">pending</option>
                        <option value="canon">canon</option>
                        <option value="retconned">retconned</option>
                        <option value="archived">archived</option>
                      </select>
                    </div>

                    {ev.description && (
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: '1.5' }}>
                        {ev.description}
                      </p>
                    )}

                    {ev.participantIds && ev.participantIds.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>参与实体:</span>
                        {ev.participantIds.map((pId) => {
                          const pEnt = allEntities.find((e) => e.id === pId);
                          return (
                            <span
                              key={pId}
                              style={{
                                fontSize: '11px',
                                background: 'var(--bg-app)',
                                border: '1px solid var(--border-subtle)',
                                padding: '1px 6px',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {pEnt?.name || pId}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        /* 快照投影模式 */
        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>查看世界在指定时刻的投影快照:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-tertiary)' }}>Tick</span>
              <input
                value={snapshotTick}
                onChange={(e) => setSnapshotTick(e.target.value)}
                style={{ width: '90px', fontFamily: 'var(--font-mono)', fontSize: '12px', padding: '4px 8px' }}
              />
              <Button variant="gold" size="sm" onClick={loadSnapshot} loading={loadingSnapshot}>
                计算快照
              </Button>
            </div>
          </div>

          {snapshotError && (
            <div style={{ color: 'var(--danger)', fontSize: '12px', marginBottom: '14px' }}>
              {snapshotError}
            </div>
          )}

          {snapshot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  gap: '16px',
                  padding: '10px 14px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '12px',
                  border: '1px solid var(--border-subtle)',
                  flexWrap: 'wrap',
                }}
              >
                <span>时空刻度: <strong style={{ color: 'var(--canon-gold)', fontFamily: 'var(--font-mono)' }}>Tick {snapshot.atTick}</strong></span>
                <span>存续实体: <strong style={{ fontFamily: 'var(--font-mono)' }}>{snapshot.entities.length}</strong></span>
                <span>有效事实: <strong style={{ fontFamily: 'var(--font-mono)' }}>{snapshot.facts.length}</strong></span>
                <span>有效关系: <strong style={{ fontFamily: 'var(--font-mono)' }}>{snapshot.relations.length}</strong></span>
                <span>进行中事件: <strong style={{ fontFamily: 'var(--font-mono)' }}>{snapshot.activeEvents.length}</strong></span>
              </div>

              {/* 存续实体 */}
              <div>
                <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IconBook size={14} style={{ color: 'var(--accent)' }} />
                  <span>此时刻存续实体 ({snapshot.entities.length})</span>
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
                  {snapshot.entities.map((ent) => (
                    <div
                      key={ent.id}
                      style={{
                        padding: '8px 10px',
                        background: 'var(--bg-app)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: '12px' }}>{ent.name}</div>
                      {ent.subtitle && (
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{ent.subtitle}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 有效关系 */}
              {snapshot.relations.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <IconNetwork size={14} style={{ color: 'var(--accent)' }} />
                    <span>此时刻有效关系 ({snapshot.relations.length})</span>
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {snapshot.relations.map((r) => {
                      const s = allEntities.find((e) => e.id === r.sourceEntityId);
                      const t = allEntities.find((e) => e.id === r.targetEntityId);
                      return (
                        <div
                          key={r.id}
                          style={{
                            padding: '6px 10px',
                            background: 'var(--bg-app)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '12px',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <strong>{s?.name || r.sourceEntityId}</strong> → <strong>{t?.name || r.targetEntityId}</strong>
                          {r.description && <span style={{ color: 'var(--text-tertiary)', marginLeft: '8px' }}>· {r.description}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 创建事件模态框 */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="记录重大历史事件 (Record Event)"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateModalOpen(false)}>取消</Button>
            <Button variant="gold" onClick={handleCreateEvent} loading={submitting} disabled={disabled}>
              确认记录事件
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface-elevated)', padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>事件构思</div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>参考当前时间线，补充事件的起因、经过与结果</div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setAiModalOpen(true)}
            icon={<IconQuill size={12} />}
          >
            生成草案
          </Button>
        </div>

        <form onSubmit={handleCreateEvent} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              事件标题 <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              required
              autoFocus
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="例如：第一次深渊远征、逐火之约、帝国分裂…"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                起始时间刻 <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                required
                value={startTick}
                onChange={(e) => setStartTick(e.target.value)}
                placeholder="0"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                结束时间刻
              </label>
              <input
                value={endTick}
                onChange={(e) => setEndTick(e.target.value)}
                placeholder="可选留空"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                事件类型
              </label>
              <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option value="historical">历史战役/大事件</option>
                <option value="political">条约与政权更迭</option>
                <option value="discovery">探索发现/灾变</option>
                <option value="manual">其他通用事件</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              参与实体
            </label>
            <select
              multiple
              style={{ minHeight: '80px' }}
              value={selectedParticipants}
              onChange={(e) =>
                setSelectedParticipants(Array.from(e.target.selectedOptions, (o) => o.value))
              }
            >
              {allEntities.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              事件始末与结果描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="记录该历史事件的始末、影响以及对后续时代的深远改变…"
            />
          </div>
        </form>
      </Modal>

      {/* AI 构想事件弹窗 */}
      <AiAssistantModal
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        title="构思历史事件"
        description={world ? `为「${world.name}」在时间刻度 ${startTick || currentTick} 补充一段历史` : '补充一段世界历史'}
        promptCompiler={(helper: string) =>
          buildEventPrompt({
            world: world || {
              id: worldId,
              name: '当前世界',
              genre: 'Fantasy',
              revision: worldRevision,
              description: '',
            },
            cursorTick: startTick || currentTick,
            entities: allEntities,
            ...(helper ? { userPrompt: helper } : {}),
          })
        }
        onApplyResult={(rawText: string) => {
          const parsed = extractJsonFromText(rawText);
          if (parsed && typeof parsed === 'object') {
            const data = parsed as Record<string, unknown>;
            if (typeof data.name === 'string') setEventName(data.name);
            if (typeof data.eventType === 'string') setEventType(data.eventType);
            if (data.startTick != null) setStartTick(String(data.startTick));
            if (data.endTick != null) setEndTick(String(data.endTick));
            if (typeof data.description === 'string') setDescription(data.description);
          }
        }}
      />
    </div>
  );
}
