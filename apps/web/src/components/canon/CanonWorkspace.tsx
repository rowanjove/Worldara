import React, { useState } from 'react';
import type { ValidationIssue, Entity, CanonStatus } from '../../lib/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { IconScale, IconCheck, IconAlertTriangle, IconRefresh } from '../ui/Icons';

interface CanonWorkspaceProps {
  issues: ValidationIssue[];
  entities: Entity[];
  onChangeCanonStatus: (entityId: string, status: CanonStatus) => Promise<void>;
  onRefreshValidation: () => Promise<void>;
  disabled?: boolean | undefined;
}

export function CanonWorkspace({
  issues,
  entities,
  onChangeCanonStatus,
  onRefreshValidation,
  disabled,
}: CanonWorkspaceProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [selectedStatusTab, setSelectedStatusTab] = useState<CanonStatus | 'all'>('pending');

  const errorIssues = issues.filter((i) => i.severity === 'error');
  const warningIssues = issues.filter((i) => i.severity !== 'error');

  const filteredEntities = entities.filter((e) => {
    if (selectedStatusTab === 'all') return true;
    return e.canonStatus === selectedStatusTab;
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefreshValidation();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 顶部控制与完整性状态 */}
      <div className="panel-card" style={{ padding: '16px 18px', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <IconScale size={16} style={{ color: 'var(--canon-gold)' }} />
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                正典治理与校验控制台 (Canon & Integrity)
              </h2>
              {issues.length === 0 ? (
                <span className="badge" style={{ background: 'var(--success-subtle)', color: 'var(--success)', border: '1px solid var(--success-border)' }}>
                  确定性规则全量通过
                </span>
              ) : (
                <span className="badge" style={{ background: 'var(--danger-subtle)', color: 'var(--danger)', border: '1px solid var(--danger-border)' }}>
                  检测到 {errorIssues.length} 个规则冲突
                </span>
              )}
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              世界格的正典规则：只有通过一致性校验并经作者确认的内容才能成为正典（Canon）；任何外部草案都不能直接覆写。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              loading={refreshing}
              icon={<IconRefresh size={13} />}
            >
              重新执行确定性校验
            </Button>
          </div>
        </div>
      </div>

      {/* 校验违规问题列表 */}
      <div className="panel-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">
              <span>完整性诊断报告 (Integrity Audit)</span>
            </h3>
            <p className="panel-subtitle">
              检测时间线先后因果矛盾、实体闭环继承、基数约束违背与跨世界引用
            </p>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            共计 {issues.length} 条报告
          </span>
        </div>

        {issues.length === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              background: 'var(--bg-app)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ color: 'var(--success)', marginBottom: '4px', display: 'flex', justifyContent: 'center' }}>
              <IconCheck size={22} />
            </div>
            <div style={{ fontWeight: 600, color: 'var(--success)', fontSize: '13px' }}>世界逻辑严密，无正典冲突</div>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              所有时间游标、实体类型字段契约与关系拓扑完整性均符合系统预设规则。
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {issues.map((issue, idx) => {
              const relatedEntity = issue.subjectId
                ? entities.find((e) => e.id === issue.subjectId)
                : null;
              const isError = issue.severity === 'error';

              return (
                <div
                  key={`${issue.ruleCode}-${idx}`}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    background: isError ? 'var(--danger-subtle)' : 'var(--warning-subtle)',
                    border: isError
                      ? '1px solid var(--danger-border)'
                      : '1px solid var(--warning-border)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <span style={{ color: isError ? 'var(--danger)' : 'var(--warning)', marginTop: '1px' }}>
                      <IconAlertTriangle size={15} />
                    </span>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <strong style={{ fontSize: '12px', color: isError ? 'var(--danger)' : 'var(--warning)', fontFamily: 'var(--font-mono)' }}>
                          {issue.ruleCode}
                        </strong>
                        <Badge variant="neutral" size="sm">{issue.severity}</Badge>
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--text-primary)', marginTop: '3px', lineHeight: '1.4' }}>
                        {issue.message}
                      </p>
                      {relatedEntity && (
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          相关实体: <strong style={{ color: 'var(--text-primary)' }}>{relatedEntity.name}</strong> ({relatedEntity.canonStatus})
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 正典生命周期管理列表 */}
      <div className="panel-card">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">
              <span>正典生命周期流转 (Canon Pipeline)</span>
            </h3>
            <p className="panel-subtitle">
              审核草稿（Draft）与待定（Pending）项，决断确认正式正典（Canon）
            </p>
          </div>

          {/* 状态筛选切换 */}
          <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-app)', padding: '2px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            {(['pending', 'draft', 'canon', 'retconned', 'all'] as const).map((st) => (
              <button
                key={st}
                className={`btn btn-sm ${selectedStatusTab === st ? 'btn-secondary' : 'btn-ghost'}`}
                onClick={() => setSelectedStatusTab(st)}
                style={{ textTransform: 'capitalize', fontSize: '11px', padding: '2px 8px' }}
              >
                {st} ({st === 'all' ? entities.length : entities.filter((e) => e.canonStatus === st).length})
              </button>
            ))}
          </div>
        </div>

        {filteredEntities.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12px' }}>
            当前状态分类下暂无实体
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {filteredEntities.map((ent) => (
              <div
                key={ent.id}
                style={{
                  padding: '10px 14px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{ent.name}</strong>
                    <Badge variant={ent.canonStatus} size="sm">{ent.canonStatus}</Badge>
                  </div>
                  {ent.subtitle && (
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {ent.subtitle}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>流转为:</span>
                  <select
                    value={ent.canonStatus}
                    disabled={disabled}
                    onChange={(e) => void onChangeCanonStatus(ent.id, e.target.value as CanonStatus)}
                    style={{ width: '120px', fontSize: '11px', padding: '3px 6px' }}
                  >
                    <option value="draft">Draft (草稿)</option>
                    <option value="pending">Pending (待审)</option>
                    <option value="canon">Canon (正典)</option>
                    <option value="retconned">Retconned (废弃)</option>
                    <option value="archived">Archived (归档)</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
