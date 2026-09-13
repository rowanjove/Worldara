import React from 'react';
import type { World, Entity, Relation, WorldEvent, WorldMap, ValidationIssue } from '../../lib/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import {
  IconBook,
  IconNetwork,
  IconClock,
  IconMap,
  IconScale,
  IconQuill,
  IconCheck,
  IconAlertTriangle,
  IconPlus,
} from '../ui/Icons';

interface WorldDashboardProps {
  world: World;
  entities: Entity[];
  relations: Relation[];
  events: WorldEvent[];
  maps: WorldMap[];
  issues: ValidationIssue[];
  onNavigate: (tab: 'entities' | 'graph' | 'timeline' | 'map' | 'canon' | 'ai' | 'schema') => void;
  onOpenCreateEntity: () => void;
  onOpenCreateEvent: () => void;
}

export function WorldDashboard({
  world,
  entities,
  relations,
  events,
  maps,
  issues,
  onNavigate,
  onOpenCreateEntity,
  onOpenCreateEvent,
}: WorldDashboardProps) {
  // 计算 Canon 状态分布
  const canonCount = entities.filter((e) => e.canonStatus === 'canon').length;
  const pendingCount = entities.filter((e) => e.canonStatus === 'pending').length;
  const draftCount = entities.filter((e) => e.canonStatus === 'draft').length;
  const retconnedCount = entities.filter((e) => e.canonStatus === 'retconned').length;
  const totalEntities = entities.length;

  const errorIssues = issues.filter((i) => i.severity === 'error');
  const warningIssues = issues.filter((i) => i.severity !== 'error');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 顶部世界档案信息 */}
      <div className="panel-card" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--canon-gold)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                世界档案
              </span>
              <Badge variant="neutral" size="sm">{world.genre}</Badge>
              {world.archivedAt ? (
                <Badge variant="archived" size="sm">已归档</Badge>
              ) : (
                <Badge variant="canon" size="sm">设定一致</Badge>
              )}
            </div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
              {world.name}
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '12px', maxWidth: '720px', lineHeight: '1.5' }}>
              {world.description || '当前世界尚未填写宏观背景描述。所有实体事实、时间切片与因果网络受确定性正典规则约束。'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              variant="gold"
              onClick={onOpenCreateEntity}
              disabled={Boolean(world.archivedAt)}
              icon={<IconPlus size={13} />}
            >
              录入实体
            </Button>
            <Button
              variant="secondary"
              onClick={onOpenCreateEvent}
              disabled={Boolean(world.archivedAt)}
              icon={<IconPlus size={13} />}
            >
              记录事件
            </Button>
          </div>
        </div>

        {/* 核心指标统计横幅 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '10px',
            marginTop: '16px',
            paddingTop: '14px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('entities')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
              <IconBook size={13} />
              <span>实体总数</span>
            </div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
              {entities.length}
            </div>
          </div>

          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('graph')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
              <IconNetwork size={13} />
              <span>实体关系</span>
            </div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--accent)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
              {relations.length}
            </div>
          </div>

          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('timeline')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
              <IconClock size={13} />
              <span>历史事件</span>
            </div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
              {events.length}
            </div>
          </div>

          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('map')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
              <IconMap size={13} />
              <span>地图图层</span>
            </div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
              {maps.length}
            </div>
          </div>

          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate('canon')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
              <IconScale size={13} />
              <span>校验规则</span>
            </div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: errorIssues.length > 0 ? 'var(--danger)' : 'var(--success)',
                marginTop: '2px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {issues.length === 0 ? '全量通过' : `${issues.length} 项问题`}
            </div>
          </div>
        </div>
      </div>

      {/* 两栏内容：正典状态治理 & 核心工作区 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' }}>
        {/* 正典状态分布 */}
        <div className="panel-card">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">
                <IconScale size={15} style={{ color: 'var(--canon-gold)' }} />
                <span>正典状态</span>
              </h2>
              <p className="panel-subtitle">实体与事实条目的生命周期状态分布</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('canon')}>
              管理正典 →
            </Button>
          </div>

          {/* 状态占比分布条 */}
          {totalEntities > 0 && (
            <div
              style={{
                display: 'flex',
                height: '5px',
                borderRadius: '99px',
                overflow: 'hidden',
                backgroundColor: 'var(--border-subtle)',
                marginBottom: '14px',
              }}
            >
              <div style={{ width: `${(canonCount / totalEntities) * 100}%`, backgroundColor: 'var(--canon-gold)' }} title={`Canon: ${canonCount}`} />
              <div style={{ width: `${(pendingCount / totalEntities) * 100}%`, backgroundColor: 'var(--warning)' }} title={`Pending: ${pendingCount}`} />
              <div style={{ width: `${(draftCount / totalEntities) * 100}%`, backgroundColor: 'var(--draft)' }} title={`Draft: ${draftCount}`} />
              <div style={{ width: `${(retconnedCount / totalEntities) * 100}%`, backgroundColor: 'var(--danger)' }} title={`Retconned: ${retconnedCount}`} />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Badge variant="canon">Canon</Badge>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>正式确立的正典设定，受版本与一致性校验约束</span>
              </div>
              <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{canonCount}</strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Badge variant="pending">Pending</Badge>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>已录入待审，等待确定性规则冲突校验</span>
              </div>
              <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{pendingCount}</strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Badge variant="draft">Draft</Badge>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>作者工作草稿，隔离于正典引用池之外</span>
              </div>
              <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{draftCount}</strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Badge variant="retconned">Retconned</Badge>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>因后续设定修改或历史重构追溯失效</span>
              </div>
              <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{retconnedCount}</strong>
            </div>

            {issues.length > 0 && (
              <div
                style={{
                  marginTop: '6px',
                  padding: '10px 12px',
                  background: 'var(--danger-subtle)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--danger-border)',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                <IconAlertTriangle size={15} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <span style={{ color: 'var(--danger)', fontWeight: 600 }}>存在 {errorIssues.length} 个规则冲突项</span>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '11px', marginTop: '2px' }}>
                    检测到时间线或引用关系异常，请进入正典治理面板逐项修正。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 核心工作区入口 */}
        <div className="panel-card">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">
                <span>常用入口</span>
              </h2>
              <p className="panel-subtitle">进入指定子系统进行实体编纂与规则管理</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div
              className="item-card"
              onClick={() => onNavigate('entities')}
              style={{ padding: '12px' }}
            >
              <div style={{ color: 'var(--accent)', display: 'flex' }}>
                <IconBook size={18} />
              </div>
              <div>
                <strong style={{ fontSize: '12px', color: 'var(--text-primary)' }}>实体档案库</strong>
                <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  按类型查看和编辑人物、地点、派系与物品档案
                </p>
              </div>
            </div>

            <div
              className="item-card"
              onClick={() => onNavigate('graph')}
              style={{ padding: '12px' }}
            >
              <div style={{ color: 'var(--accent)', display: 'flex' }}>
                <IconNetwork size={18} />
              </div>
              <div>
                <strong style={{ fontSize: '12px', color: 'var(--text-primary)' }}>关系网络图谱</strong>
                <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  检视实体之间的双向交互网络与依赖链
                </p>
              </div>
            </div>

            <div
              className="item-card"
              onClick={() => onNavigate('timeline')}
              style={{ padding: '12px' }}
            >
              <div style={{ color: 'var(--canon-gold)', display: 'flex' }}>
                <IconClock size={18} />
              </div>
              <div>
                <strong style={{ fontSize: '12px', color: 'var(--text-primary)' }}>编年史与快照</strong>
                <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  通过时间刻度定位历史，检视任意时点的世界投影
                </p>
              </div>
            </div>

            <div
              className="item-card"
              onClick={() => onNavigate('ai')}
              style={{ padding: '12px' }}
            >
              <div style={{ color: 'var(--canon-gold)', display: 'flex' }}>
                <IconQuill size={18} />
              </div>
              <div>
                <strong style={{ fontSize: '12px', color: 'var(--text-primary)' }}>构思提案</strong>
                <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  把新构思拆成可核对的改动，再决定是否写入世界
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
