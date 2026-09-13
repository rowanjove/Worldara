import React, { useState, useEffect, useRef } from 'react';
import type { SearchResult } from '../../lib/types';
import { api } from '../../lib/api';
import { Badge } from '../ui/Badge';
import { IconSearch, IconBook, IconClock, IconNetwork } from '../ui/Icons';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  worldId: string;
  onSelectResult: (result: SearchResult) => void;
}

export function GlobalSearchModal({
  isOpen,
  onClose,
  worldId,
  onSelectResult,
}: GlobalSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.searchWorld(worldId, query.trim(), 15);
        setResults(data);
      } catch {
        // ignore
      } finally {
        setSearching(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [query, worldId]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ alignItems: 'flex-start', paddingTop: '80px' }}>
      <div
        className="modal-dialog"
        style={{ maxWidth: '600px', background: 'var(--bg-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center' }}>
            <IconSearch size={15} />
          </span>
          <input
            ref={inputRef}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '13px',
              padding: '4px 0',
              color: 'var(--text-primary)',
              boxShadow: 'none',
            }}
            placeholder="搜索世界实体、事实、关系与事件… (ESC 退出)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && (
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              Searching…
            </span>
          )}
        </div>

        <div style={{ maxHeight: '400px', overflowY: 'auto', padding: '6px' }}>
          {results.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {results.map((item, idx) => {
                let kindIcon = <IconBook size={13} />;
                if (item.kind === 'event') kindIcon = <IconClock size={13} />;
                if (item.kind === 'relation') kindIcon = <IconNetwork size={13} />;

                return (
                  <div
                    key={`${item.kind}-${item.id}-${idx}`}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '3px',
                      transition: 'border-color 0.12s ease',
                    }}
                    onClick={() => {
                      onSelectResult(item);
                      onClose();
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: 'var(--text-tertiary)' }}>{kindIcon}</span>
                        <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{item.title}</strong>
                      </div>
                      <Badge variant="neutral" size="sm">
                        {item.kind}
                      </Badge>
                    </div>
                    {item.snippet && (
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4', paddingLeft: '19px' }}>
                        {item.snippet}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : query.trim() ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12px' }}>
              未找到匹配的实体或事件
            </div>
          ) : (
            <div style={{ padding: '20px 14px', color: 'var(--text-tertiary)', fontSize: '12px' }}>
              支持按实体名称、正典设定、双时间关系及历史事件进行全文检索与前缀匹配。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
