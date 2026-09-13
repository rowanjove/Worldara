import React, { useState } from 'react';
import type { Entity, EntityType, Relation, RelationType, WorldEvent, CanonStatus, World } from '../../lib/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { CreateEntityModal } from './CreateEntityModal';
import { EntityDetailDrawer } from './EntityDetailDrawer';
import { IconBook, IconPlus } from '../ui/Icons';

interface EntityWorkspaceProps {
  world?: World | undefined;
  entities: Entity[];
  entityTypes: EntityType[];
  relations: Relation[];
  relationTypes: RelationType[];
  events: WorldEvent[];
  onCreateEntity: (data: { typeId: string; name: string; subtitle: string; document: Record<string, unknown> }) => Promise<void>;
  onChangeCanonStatus: (entityId: string, status: CanonStatus) => Promise<void>;
  onUpdateEntityDocument?: ((entityId: string, doc: Record<string, unknown>) => Promise<void>) | undefined;
  onRefresh?: (() => Promise<void>) | undefined;
  disabled?: boolean | undefined;
}

export function EntityWorkspace({
  world,
  entities,
  entityTypes,
  relations,
  relationTypes,
  events,
  onCreateEntity,
  onChangeCanonStatus,
  onUpdateEntityDocument,
  onRefresh,
  disabled,
}: EntityWorkspaceProps) {
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [activeEntity, setActiveEntity] = useState<Entity | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // 过滤计算
  const filteredEntities = entities.filter((ent) => {
    if (selectedTypeFilter !== 'all' && ent.typeId !== selectedTypeFilter) return false;
    if (selectedStatusFilter !== 'all' && ent.canonStatus !== selectedStatusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = ent.name.toLowerCase().includes(q);
      const matchSub = ent.subtitle?.toLowerCase().includes(q);
      return matchName || matchSub;
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 顶部操作与筛选条 */}
      <div className="panel-card" style={{ padding: '14px 18px', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <IconBook size={16} style={{ color: 'var(--accent)' }} />
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                实体档案库 (Entities & Lore)
              </h2>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              收录 {entities.length} 个设定实体，支持按类型、正典状态与关键词过滤检索。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              variant="gold"
              onClick={() => setCreateModalOpen(true)}
              disabled={disabled}
              icon={<IconPlus size={13} />}
            >
              录入新实体
            </Button>
          </div>
        </div>

        {/* 筛选控件行 */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: '220px' }}>
            <input
              placeholder="按名称或副标题过滤…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ fontSize: '12px', padding: '5px 8px' }}
            />
          </div>

          <select
            value={selectedTypeFilter}
            onChange={(e) => setSelectedTypeFilter(e.target.value)}
            style={{ width: '160px', fontSize: '12px', padding: '5px 8px' }}
          >
            <option value="all">所有类型 ({entities.length})</option>
            {entityTypes.map((t) => {
              const count = entities.filter((e) => e.typeId === t.id).length;
              return (
                <option key={t.id} value={t.id}>
                  {t.label} ({count})
                </option>
              );
            })}
          </select>

          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value)}
            style={{ width: '130px', fontSize: '12px', padding: '5px 8px' }}
          >
            <option value="all">所有状态</option>
            <option value="canon">Canon (正典)</option>
            <option value="pending">Pending (待审)</option>
            <option value="draft">Draft (草稿)</option>
            <option value="retconned">Retconned (废弃)</option>
            <option value="archived">Archived (归档)</option>
          </select>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '3px' }}>
            <button
              className={`btn btn-sm ${viewMode === 'grid' ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => setViewMode('grid')}
              title="网格卡片视图"
            >
              网格
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'table' ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => setViewMode('table')}
              title="紧凑表格视图"
            >
              表格
            </button>
          </div>
        </div>
      </div>

      {/* 实体展示区 */}
      {filteredEntities.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <IconBook size={28} />
          </div>
          <div className="empty-state-title">未检索到匹配的实体档案</div>
          <p className="empty-state-desc">
            可调整筛选条件或搜索词，或点击下方按钮录入世界新实体。
          </p>
          <Button variant="secondary" onClick={() => setCreateModalOpen(true)} disabled={disabled}>
            录入实体
          </Button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid-cards">
          {filteredEntities.map((ent) => {
            const entType = entityTypes.find((t) => t.id === ent.typeId);
            const relCount = relations.filter(
              (r) => r.sourceEntityId === ent.id || r.targetEntityId === ent.id
            ).length;

            return (
              <div
                key={ent.id}
                className={`item-card ${activeEntity?.id === ent.id ? 'selected' : ''}`}
                onClick={() => setActiveEntity(ent)}
              >
                <div className="item-card-title">
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>{ent.name}</span>
                  <Badge variant={ent.canonStatus} size="sm">{ent.canonStatus}</Badge>
                </div>

                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', minHeight: '16px' }}>
                  {ent.subtitle || <span style={{ color: 'var(--text-tertiary)' }}>未设定头衔</span>}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 'auto',
                    paddingTop: '8px',
                    borderTop: '1px solid var(--border-subtle)',
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  <span>{entType?.label || '通用类型'}</span>
                  <span>{relCount > 0 ? `${relCount} 处关联` : '独立'}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface-elevated)', borderBottom: '1px solid var(--border-default)' }}>
                <th style={{ padding: '8px 14px', fontWeight: 600 }}>实体名称</th>
                <th style={{ padding: '8px 14px', fontWeight: 600 }}>定位/头衔</th>
                <th style={{ padding: '8px 14px', fontWeight: 600 }}>类型</th>
                <th style={{ padding: '8px 14px', fontWeight: 600 }}>状态</th>
                <th style={{ padding: '8px 14px', fontWeight: 600 }}>修订序列</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntities.map((ent) => {
                const entType = entityTypes.find((t) => t.id === ent.typeId);
                return (
                  <tr
                    key={ent.id}
                    onClick={() => setActiveEntity(ent)}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ padding: '8px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {ent.name}
                    </td>
                    <td style={{ padding: '8px 14px', color: 'var(--text-secondary)' }}>
                      {ent.subtitle || '-'}
                    </td>
                    <td style={{ padding: '8px 14px', color: 'var(--text-tertiary)' }}>
                      {entType?.label || ent.typeId}
                    </td>
                    <td style={{ padding: '8px 14px' }}>
                      <Badge variant={ent.canonStatus} size="sm">{ent.canonStatus}</Badge>
                    </td>
                    <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      r{ent.revision}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 实体抽屉 */}
      <EntityDetailDrawer
        world={world}
        entity={activeEntity}
        onClose={() => setActiveEntity(null)}
        entityType={entityTypes.find((t) => t.id === activeEntity?.typeId)}
        allEntities={entities}
        relations={relations}
        relationTypes={relationTypes}
        events={events}
        onChangeCanonStatus={onChangeCanonStatus}
        onSaveDocument={onUpdateEntityDocument}
        onRefresh={onRefresh}
        disabled={disabled}
      />

      {/* 新建实体模态框 */}
      <CreateEntityModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        entityTypes={entityTypes}
        allEntities={entities}
        onSubmit={onCreateEntity}
        world={world}
        disabled={disabled}
      />
    </div>
  );
}
