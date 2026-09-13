import React, { useState } from 'react';
import type { World } from '../../lib/types';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  IconWorldara,
  IconDashboard,
  IconBook,
  IconNetwork,
  IconClock,
  IconMap,
  IconScale,
  IconQuill,
  IconSchema,
  IconSettings,
  IconPlus,
} from '../ui/Icons';

export type NavTab =
  | 'overview'
  | 'entities'
  | 'graph'
  | 'timeline'
  | 'map'
  | 'canon'
  | 'knowledge'
  | 'manuscript'
  | 'ai'
  | 'schema'
  | 'settings';

interface SidebarProps {
  worlds: World[];
  activeWorld: World | null;
  onSelectWorld: (world: World) => void;
  onCreateWorld: (name: string, genre: string) => Promise<void>;
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  counts: {
    entities: number;
    relations: number;
    events: number;
    maps: number;
    issues: number;
  };
}

export function Sidebar({
  worlds,
  activeWorld,
  onSelectWorld,
  onCreateWorld,
  currentTab,
  onTabChange,
  counts,
}: SidebarProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWorldName, setNewWorldName] = useState('');
  const [newWorldGenre, setNewWorldGenre] = useState('Fantasy');
  const [creating, setCreating] = useState(false);

  async function handleCreateWorld(e: React.FormEvent) {
    e.preventDefault();
    if (!newWorldName.trim()) return;
    setCreating(true);
    try {
      await onCreateWorld(newWorldName.trim(), newWorldGenre);
      setNewWorldName('');
      setIsCreateOpen(false);
    } finally {
      setCreating(false);
    }
  }

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: React.ReactNode;
    count?: number;
    badgeVariant?: 'neutral' | 'danger' | 'canon';
  }> = [
    { id: 'overview', label: '世界概览', icon: <IconDashboard size={15} /> },
    { id: 'entities', label: '实体档案', icon: <IconBook size={15} />, count: counts.entities },
    { id: 'graph', label: '关系图谱', icon: <IconNetwork size={15} />, count: counts.relations },
    { id: 'timeline', label: '编年史', icon: <IconClock size={15} />, count: counts.events },
    { id: 'map', label: '世界地图', icon: <IconMap size={15} />, count: counts.maps },
    {
      id: 'canon',
      label: '正典校验',
      icon: <IconScale size={15} />,
      count: counts.issues,
      badgeVariant: counts.issues > 0 ? 'danger' : 'neutral',
    },
    { id: 'knowledge', label: '主张与分支', icon: <IconScale size={15} /> },
    { id: 'manuscript', label: '作品与场景', icon: <IconBook size={15} /> },
    { id: 'ai', label: '构思提案', icon: <IconQuill size={15} /> },
    { id: 'schema', label: '类型与规则', icon: <IconSchema size={15} /> },
    { id: 'settings', label: '偏好设置', icon: <IconSettings size={15} /> },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <IconWorldara size={19} />
          </div>
          <div className="sidebar-brand-name">
            <strong>Worldara</strong>
            <span>世界格</span>
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          title="新建世界"
          onClick={() => setIsCreateOpen(true)}
          style={{ padding: '4px' }}
        >
          <IconPlus size={14} />
        </button>
      </div>

      <div className="sidebar-world-selector">
        <div
          style={{
            fontSize: '10px',
            color: 'var(--text-tertiary)',
            marginBottom: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontFamily: 'var(--font-mono)',
          }}
        >
          当前世界
        </div>
        <select
          value={activeWorld?.id || ''}
          onChange={(e) => {
            const found = worlds.find((w) => w.id === e.target.value);
            if (found) onSelectWorld(found);
          }}
          style={{
            fontSize: '12px',
            fontWeight: 500,
            padding: '5px 8px',
            backgroundColor: 'var(--bg-surface)',
          }}
        >
          {worlds.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} {w.archivedAt ? ' (已归档)' : ''}
            </option>
          ))}
          {worlds.length === 0 && <option value="">无可用世界</option>}
        </select>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-title">工作空间</div>
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onTabChange(item.id)}
            >
              <div className="nav-item-left">
                <span style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)', display: 'flex' }}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </div>
              {item.count !== undefined && item.count > 0 && (
                <span
                  className="nav-count"
                  style={
                    item.badgeVariant === 'danger'
                      ? { color: 'var(--danger)', background: 'var(--danger-subtle)', borderColor: 'var(--danger-border)' }
                      : {}
                  }
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div>
          <span>版本 </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--canon-gold)' }}>
            {activeWorld?.revision ?? '0'}
          </span>
        </div>
        {activeWorld?.archivedAt ? (
          <Badge variant="archived" size="sm">已归档</Badge>
        ) : (
          <Badge variant="canon" size="sm">设定一致</Badge>
        )}
      </div>

      {/* 新建世界模态框 */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="新建世界"
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>取消</Button>
            <Button variant="gold" onClick={handleCreateWorld} loading={creating}>创建世界</Button>
          </>
        }
      >
        <form onSubmit={handleCreateWorld} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              世界名称
            </label>
            <input
              autoFocus
              required
              value={newWorldName}
              onChange={(e) => setNewWorldName(e.target.value)}
              placeholder="例如：提瓦特、中土大陆、银河联邦…"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              题材类型
            </label>
            <select value={newWorldGenre} onChange={(e) => setNewWorldGenre(e.target.value)}>
              <option value="Fantasy">奇幻</option>
              <option value="Sci-Fi">科幻</option>
              <option value="Cyberpunk">赛博朋克</option>
              <option value="Alternate History">架空历史</option>
              <option value="Custom">自定义</option>
            </select>
          </div>
        </form>
      </Modal>
    </aside>
  );
}
