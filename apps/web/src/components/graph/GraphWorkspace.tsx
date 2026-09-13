import React, { useState, useRef, useEffect } from 'react';
import type { Entity, Relation, RelationType, EntityType, World } from '../../lib/types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { AiAssistantModal } from '../common/AiAssistantModal';
import { buildRelationPrompt } from '../../lib/promptCompiler';
import { extractJsonFromText } from '../../lib/jsonExtractor';
import { IconNetwork, IconPlus, IconQuill, IconX } from '../ui/Icons';

interface GraphWorkspaceProps {
  world?: World | undefined;
  entities: Entity[];
  relations: Relation[];
  relationTypes: RelationType[];
  entityTypes: EntityType[];
  onCreateRelation: (data: { sourceEntityId: string; targetEntityId: string; relationTypeId: string; description: string }) => Promise<void>;
  disabled?: boolean | undefined;
}

export function GraphWorkspace({
  world,
  entities,
  relations,
  relationTypes,
  entityTypes: _entityTypes,
  onCreateRelation,
  disabled,
}: GraphWorkspaceProps) {
  const [filterRelationTypeId, setFilterRelationTypeId] = useState<string>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // 连线模态框状态
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [relTypeId, setRelTypeId] = useState('');
  const [relDesc, setRelDesc] = useState('');
  const [connecting, setConnecting] = useState(false);

  // 图谱节点位置与拖拽状态
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 初始化节点位置：放射状或环形错落分布
  useEffect(() => {
    const map = new Map<string, { x: number; y: number }>();
    const total = Math.min(entities.length, 60);
    const centerX = 450;
    const centerY = 300;
    const radius = Math.min(260, Math.max(160, total * 8));

    entities.slice(0, total).forEach((ent, idx) => {
      if (positions.has(ent.id)) {
        map.set(ent.id, positions.get(ent.id)!);
      } else {
        const angle = (idx / total) * 2 * Math.PI;
        const r = idx % 2 === 0 ? radius : radius * 0.65;
        map.set(ent.id, {
          x: centerX + r * Math.cos(angle),
          y: centerY + r * Math.sin(angle),
        });
      }
    });
    setPositions(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities.length]);

  function handleMouseDown(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setDraggingNodeId(id);
    setSelectedNodeId(id);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!draggingNodeId || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setPositions((prev) => {
      const next = new Map(prev);
      next.set(draggingNodeId, { x, y });
      return next;
    });
  }

  function handleMouseUp() {
    setDraggingNodeId(null);
  }

  // 过滤关系
  const activeRelations = relations.filter((r) => {
    if (filterRelationTypeId !== 'all' && r.relationTypeId !== filterRelationTypeId) return false;
    return positions.has(r.sourceEntityId) && positions.has(r.targetEntityId);
  });

  // 与当前选中节点相关的邻接节点
  const connectedNodeIds = new Set<string>();
  if (selectedNodeId) {
    connectedNodeIds.add(selectedNodeId);
    activeRelations.forEach((r) => {
      if (r.sourceEntityId === selectedNodeId) connectedNodeIds.add(r.targetEntityId);
      if (r.targetEntityId === selectedNodeId) connectedNodeIds.add(r.sourceEntityId);
    });
  }

  async function handleCreateRelationSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceId || !targetId || !relTypeId || sourceId === targetId) return;
    setConnecting(true);
    try {
      await onCreateRelation({
        sourceEntityId: sourceId,
        targetEntityId: targetId,
        relationTypeId: relTypeId,
        description: relDesc.trim(),
      });
      setRelDesc('');
      setConnectModalOpen(false);
    } finally {
      setConnecting(false);
    }
  }

  const selectedEntity = entities.find((e) => e.id === selectedNodeId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 顶部控制栏 */}
      <div className="panel-card" style={{ padding: '14px 18px', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <IconNetwork size={16} style={{ color: 'var(--accent)' }} />
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                实体关系网络图谱 (Relationship Graph)
              </h2>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              节点代表世界实体，连线由确定性 Canon 关系驱动。拖拽节点可调整布局，点击实体可聚焦邻接网络。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              value={filterRelationTypeId}
              onChange={(e) => setFilterRelationTypeId(e.target.value)}
              style={{ width: '160px', fontSize: '12px', padding: '5px 8px' }}
            >
              <option value="all">全部关系类型 ({relations.length})</option>
              {relationTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.forwardLabel}
                </option>
              ))}
            </select>

            <Button
              variant="gold"
              onClick={() => {
                if (selectedNodeId) setSourceId(selectedNodeId);
                setConnectModalOpen(true);
              }}
              disabled={disabled}
              icon={<IconPlus size={13} />}
            >
              建立实体关系
            </Button>
          </div>
        </div>
      </div>

      {/* 主画布容器与侧边详情 */}
      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        {/* SVG 画布 */}
        <div
          style={{
            flex: 1,
            background: 'var(--bg-input)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {entities.length === 0 ? (
            <div className="empty-state" style={{ minHeight: '480px' }}>
              <div className="empty-state-icon">
                <IconNetwork size={28} />
              </div>
              <div className="empty-state-title">当前世界尚未录入实体</div>
              <p className="empty-state-desc">请先前往实体档案录入实体，再确立实体间的网络连接。</p>
            </div>
          ) : (
            <svg
              ref={svgRef}
              style={{ width: '100%', height: '560px', display: 'block', cursor: draggingNodeId ? 'grabbing' : 'default' }}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onClick={() => setSelectedNodeId(null)}
            >
              <defs>
                <marker
                  id="graph-arrow-head"
                  markerWidth="8"
                  markerHeight="8"
                  refX="18"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--canon-gold)" />
                </marker>
              </defs>

              {/* 背景微网格点阵 */}
              <pattern id="graph-dots" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="#1b2331" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#graph-dots)" />

              {/* 绘制关系连线 */}
              {activeRelations.map((r) => {
                const s = positions.get(r.sourceEntityId);
                const t = positions.get(r.targetEntityId);
                if (!s || !t) return null;

                const isConnected =
                  !selectedNodeId ||
                  r.sourceEntityId === selectedNodeId ||
                  r.targetEntityId === selectedNodeId;

                const rType = relationTypes.find((type) => type.id === r.relationTypeId);
                const midX = (s.x + t.x) / 2;
                const midY = (s.y + t.y) / 2;

                return (
                  <g key={r.id} opacity={isConnected ? 1 : 0.12} style={{ transition: 'opacity 0.15s' }}>
                    <line
                      x1={s.x}
                      y1={s.y}
                      x2={t.x}
                      y2={t.y}
                      stroke={isConnected && selectedNodeId ? 'var(--canon-gold)' : 'var(--border-strong)'}
                      strokeWidth={isConnected && selectedNodeId ? 1.8 : 1}
                      markerEnd="url(#graph-arrow-head)"
                    />
                    {isConnected && (
                      <text
                        x={midX}
                        y={midY - 4}
                        fill="var(--text-tertiary)"
                        fontSize="10"
                        textAnchor="middle"
                        style={{ pointerEvents: 'none', userSelect: 'none', fontFamily: 'var(--font-mono)' }}
                      >
                        {rType?.forwardLabel || ''}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* 绘制实体节点 */}
              {Array.from(positions.entries()).map(([id, pos]) => {
                const entity = entities.find((e) => e.id === id);
                if (!entity) return null;

                const isSelected = selectedNodeId === id;
                const isConnected = !selectedNodeId || connectedNodeIds.has(id);
                const isHovered = hoveredNodeId === id;

                return (
                  <g
                    key={id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onMouseDown={(e) => handleMouseDown(id, e)}
                    onMouseEnter={() => setHoveredNodeId(id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                    opacity={isConnected ? 1 : 0.15}
                  >
                    <circle
                      r={isSelected ? 20 : isHovered ? 18 : 16}
                      fill="var(--bg-surface-elevated)"
                      stroke={
                        isSelected
                          ? 'var(--canon-gold)'
                          : entity.canonStatus === 'canon'
                          ? 'var(--accent)'
                          : 'var(--border-strong)'
                      }
                      strokeWidth={isSelected ? 2.5 : 1.5}
                    />
                    <text
                      textAnchor="middle"
                      y={4}
                      fill="var(--text-primary)"
                      fontSize="10"
                      fontWeight={isSelected ? '600' : 'normal'}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {entity.name.slice(0, 4)}
                    </text>
                    {(isSelected || isHovered) && (
                      <text
                        textAnchor="middle"
                        y={28}
                        fill="var(--text-primary)"
                        fontSize="11"
                        fontWeight="600"
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >
                        {entity.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}

          <div
            style={{
              position: 'absolute',
              bottom: '10px',
              left: '12px',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              background: 'rgba(11, 13, 17, 0.85)',
              border: '1px solid var(--border-subtle)',
              padding: '3px 8px',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            操作说明：左键拖拽可微调节点；点击实体聚焦关联关系
          </div>
        </div>

        {/* 侧边选中节点面板 */}
        {selectedEntity && (
          <div
            className="panel-card"
            style={{ width: '270px', minWidth: '270px', marginBottom: 0, padding: '14px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <Badge variant={selectedEntity.canonStatus} size="sm">{selectedEntity.canonStatus}</Badge>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectedNodeId(null)}
                style={{ padding: '2px 4px' }}
              >
                <IconX size={12} />
              </button>
            </div>

            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {selectedEntity.name}
            </h3>
            {selectedEntity.subtitle && (
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {selectedEntity.subtitle}
              </p>
            )}

            <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: '6px', fontFamily: 'var(--font-mono)' }}>
                图谱邻接网络
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {activeRelations
                  .filter((r) => r.sourceEntityId === selectedEntity.id || r.targetEntityId === selectedEntity.id)
                  .map((r) => {
                    const isSrc = r.sourceEntityId === selectedEntity.id;
                    const otherEnt = entities.find((e) => e.id === (isSrc ? r.targetEntityId : r.sourceEntityId));
                    const rType = relationTypes.find((t) => t.id === r.relationTypeId);
                    return (
                      <div
                        key={r.id}
                        style={{
                          fontSize: '11px',
                          padding: '4px 6px',
                          background: 'var(--bg-app)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <span style={{ color: 'var(--canon-gold)' }}>
                          {isSrc ? `→ ${rType?.forwardLabel || '关联'}` : `← ${rType?.inverseLabel || rType?.forwardLabel || '关联'}`}
                        </span>{' '}
                        <span style={{ color: 'var(--text-primary)' }}>{otherEnt?.name || '未知实体'}</span>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div style={{ marginTop: '14px' }}>
              <Button
                variant="secondary"
                size="sm"
                style={{ width: '100%' }}
                onClick={() => {
                  setSourceId(selectedEntity.id);
                  setConnectModalOpen(true);
                }}
              >
                以此实体为源建立关系
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 建立连接模态框 */}
      <Modal
        isOpen={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
        title="建立实体关系 (Connect Entities)"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConnectModalOpen(false)}>取消</Button>
            <Button
              variant="gold"
              onClick={handleCreateRelationSubmit}
              loading={connecting}
              disabled={disabled || !sourceId || !targetId || !relTypeId || sourceId === targetId}
            >
              确立关系
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateRelationSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {world && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setAiModalOpen(true)}
                style={{ color: 'var(--canon-gold)', fontSize: '11px', gap: '4px' }}
                disabled={!sourceId}
              >
                <IconQuill size={12} />
                <span>帮我构思关系</span>
              </button>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              来源实体 (Source) <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} required>
              <option value="">请选择来源实体…</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              关系类型 (Relation Type) <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <select value={relTypeId} onChange={(e) => setRelTypeId(e.target.value)} required>
              <option value="">请选择关系类型…</option>
              {relationTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.forwardLabel}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              目标实体 (Target) <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
              <option value="">请选择目标实体…</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              关系描述 (Description)
            </label>
            <input
              value={relDesc}
              onChange={(e) => setRelDesc(e.target.value)}
              placeholder="例如：师徒传承、宿怨冲突、盟誓契约…"
            />
          </div>
        </form>
      </Modal>

      {world && sourceId && (
        <AiAssistantModal
          isOpen={aiModalOpen}
          onClose={() => setAiModalOpen(false)}
          title="构思实体关系"
          description="参考两个实体的现有设定，整理一份关系与因果草案供你修改。"
          promptCompiler={(instr) => {
            const src = entities.find((e) => e.id === sourceId)!;
            const tgt = targetId ? entities.find((e) => e.id === targetId) : undefined;
            return buildRelationPrompt({
              world,
              sourceEntity: src,
              targetEntity: tgt,
              relationTypes,
              userPrompt: instr,
            });
          }}
          onApplyResult={(rawText) => {
            const parsed = extractJsonFromText(rawText) as Record<string, unknown>;
            if (typeof parsed.description === 'string') {
              setRelDesc(parsed.description);
            }
            if (typeof parsed.relationTypeName === 'string') {
              const matched = relationTypes.find(
                (t) =>
                  t.forwardLabel.includes(parsed.relationTypeName as string) ||
                  (parsed.relationTypeName as string).includes(t.forwardLabel)
              );
              if (matched) setRelTypeId(matched.id);
            }
          }}
        />
      )}
    </div>
  );
}
