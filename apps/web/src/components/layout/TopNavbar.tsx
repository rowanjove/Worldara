import React, { useState, useEffect } from 'react';
import type { World } from '../../lib/types';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { api } from '../../lib/api';
import {
  IconSearch,
  IconDownload,
  IconChevronDown,
  IconArchive,
  IconBook,
  IconFileText,
  IconGlobe,
  IconLock,
  IconUnlock,
  IconRefresh,
} from '../ui/Icons';

interface TopNavbarProps {
  activeWorld: World | null;
  cursorTick: string;
  onUpdateCursor: (newTick: string) => Promise<void>;
  onOpenSearch: () => void;
  onToggleArchive: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

export function TopNavbar({
  activeWorld,
  cursorTick,
  onUpdateCursor,
  onOpenSearch,
  onToggleArchive,
  onRefresh,
}: TopNavbarProps) {
  const [tickInput, setTickInput] = useState(cursorTick);
  const [updatingTick, setUpdatingTick] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    setTickInput(cursorTick);
  }, [cursorTick]);

  async function handleTickSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!/^-?\d+$/.test(tickInput.trim())) return;
    setUpdatingTick(true);
    try {
      await onUpdateCursor(tickInput.trim());
    } finally {
      setUpdatingTick(false);
    }
  }

  function adjustTick(delta: number) {
    const current = parseInt(tickInput, 10) || 0;
    const next = (current + delta).toString();
    setTickInput(next);
  }

  if (!activeWorld) {
    return (
      <header className="topbar">
        <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>未选择世界</div>
      </header>
    );
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="world-title-badge">
          <span className="world-title">{activeWorld.name}</span>
          <Badge variant="neutral" size="sm">
            {activeWorld.genre}
          </Badge>
          {activeWorld.archivedAt && (
            <Badge variant="archived" size="sm">
              只读模式
            </Badge>
          )}
        </div>

        {/* 时间游标控制器 */}
        <form onSubmit={handleTickSubmit} className="time-cursor-widget">
          <span className="time-cursor-label">时间</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ padding: '0 4px', fontSize: '10px', height: '20px' }}
            onClick={() => adjustTick(-10)}
            title="倒退 10 个时间刻"
          >
            -10
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ padding: '0 4px', fontSize: '10px', height: '20px' }}
            onClick={() => adjustTick(-1)}
            title="倒退 1 个时间刻"
          >
            -1
          </button>
          <input
            className="time-cursor-input"
            value={tickInput}
            onChange={(e) => setTickInput(e.target.value)}
            disabled={Boolean(activeWorld.archivedAt)}
            title="世界当前时间刻度"
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ padding: '0 4px', fontSize: '10px', height: '20px' }}
            onClick={() => adjustTick(1)}
            title="推进 1 个时间刻"
          >
            +1
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ padding: '0 4px', fontSize: '10px', height: '20px' }}
            onClick={() => adjustTick(10)}
            title="推进 10 个时间刻"
          >
            +10
          </button>
          {tickInput !== cursorTick && (
            <Button
              type="submit"
              variant="gold"
              size="sm"
              loading={updatingTick}
              style={{ padding: '1px 6px', fontSize: '10px' }}
            >
              更新
            </Button>
          )}
        </form>
      </div>

      <div className="topbar-right">
        {/* 全局搜索按钮 */}
        <button
          className="btn btn-secondary btn-sm"
          onClick={onOpenSearch}
          title="全局检索 (⌘K / Ctrl+K)"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}
        >
          <IconSearch size={13} />
          <span>搜索世界事实与实体…</span>
          <kbd
            style={{
              fontSize: '10px',
              padding: '0 4px',
              borderRadius: '3px',
              background: 'var(--bg-app)',
              border: '1px solid var(--border-default)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-tertiary)',
            }}
          >
            ⌘K
          </kbd>
        </button>

        {/* 导出下拉面板 */}
        <div style={{ position: 'relative' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setExportOpen(!exportOpen)}
            icon={<IconDownload size={13} />}
          >
            <span>导出</span>
            <IconChevronDown size={11} style={{ marginLeft: '2px', opacity: 0.7 }} />
          </Button>

          {exportOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '4px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                minWidth: '190px',
                padding: '4px',
                zIndex: 30,
                display: 'flex',
                flexDirection: 'column',
                gap: '1px',
              }}
              onMouseLeave={() => setExportOpen(false)}
            >
              <a
                href={api.getExportUrl(activeWorld.id, 'zip')}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm"
                style={{ justifyContent: 'flex-start', gap: '8px' }}
              >
                <IconArchive size={13} style={{ color: 'var(--accent)' }} />
                <span>完整离线归档 (.zip)</span>
              </a>
              <a
                href={api.getExportUrl(activeWorld.id, 'obsidian.zip')}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm"
                style={{ justifyContent: 'flex-start', gap: '8px' }}
              >
                <IconBook size={13} style={{ color: '#a855f7' }} />
                <span>Obsidian 知识库 (.zip)</span>
              </a>
              <a
                href={api.getExportUrl(activeWorld.id, 'md')}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm"
                style={{ justifyContent: 'flex-start', gap: '8px' }}
              >
                <IconFileText size={13} style={{ color: 'var(--text-secondary)' }} />
                <span>Markdown 设定集 (.md)</span>
              </a>
              <a
                href={api.getExportUrl(activeWorld.id, 'geojson')}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm"
                style={{ justifyContent: 'flex-start', gap: '8px' }}
              >
                <IconGlobe size={13} style={{ color: 'var(--canon-gold)' }} />
                <span>GeoJSON 地理图层 (.json)</span>
              </a>
            </div>
          )}
        </div>

        {/* 归档切换 */}
        <Button
          variant={activeWorld.archivedAt ? 'secondary' : 'ghost'}
          size="sm"
          onClick={onToggleArchive}
          icon={activeWorld.archivedAt ? <IconUnlock size={13} /> : <IconLock size={13} />}
          title={activeWorld.archivedAt ? '恢复世界为可编辑状态' : '将世界归档为只读模式'}
        >
          {activeWorld.archivedAt ? '恢复编辑' : '归档'}
        </Button>

        {/* 手动刷新 */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          title="刷新最新数据"
          style={{ padding: '4px 6px' }}
        >
          <IconRefresh size={13} />
        </Button>
      </div>
    </header>
  );
}
