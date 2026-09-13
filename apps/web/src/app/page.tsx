'use client';

import React, { useEffect, useState, useCallback } from 'react';
import type {
  World,
  Entity,
  EntityType,
  Relation,
  RelationType,
  WorldEvent,
  WorldMap,
  MapLayer,
  ValidationIssue,
  Proposal,
  ProposalChange,
  SearchResult,
  CanonStatus,
  Claim,
  TimelineBranch,
  ValidationRule,
  Work,
} from '../lib/types';
import { api } from '../lib/api';
import { Sidebar, type NavTab } from '../components/layout/Sidebar';
import { TopNavbar } from '../components/layout/TopNavbar';
import { GlobalSearchModal } from '../components/layout/GlobalSearchModal';
import { WorldDashboard } from '../components/overview/WorldDashboard';
import { EntityWorkspace } from '../components/entities/EntityWorkspace';
import { GraphWorkspace } from '../components/graph/GraphWorkspace';
import { TimelineWorkspace } from '../components/timeline/TimelineWorkspace';
import { MapWorkspace } from '../components/map/MapWorkspace';
import { CanonWorkspace } from '../components/canon/CanonWorkspace';
import { ProposalWorkspace } from '../components/ai/ProposalWorkspace';
import { SchemaWorkspace } from '../components/schema/SchemaWorkspace';
import { KnowledgeWorkspace } from '../components/knowledge/KnowledgeWorkspace';
import { ManuscriptWorkspace } from '../components/manuscript/ManuscriptWorkspace';
import { SettingsWorkspace } from '../components/settings/SettingsWorkspace';
import { ToastContainer, type ToastItem } from '../components/ui/Toast';
import { CreateEntityModal } from '../components/entities/CreateEntityModal';
import { IconClock, IconWorldara } from '../components/ui/Icons';

export default function HomePage() {
  // 全局世界状态
  const [worlds, setWorlds] = useState<World[]>([]);
  const [activeWorld, setActiveWorld] = useState<World | null>(null);
  const [loading, setLoading] = useState(true);

  // 导航模块
  const [currentTab, setCurrentTab] = useState<NavTab>('overview');

  // 当前世界业务数据集
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [maps, setMaps] = useState<WorldMap[]>([]);
  const [mapLayers, setMapLayers] = useState<Record<string, MapLayer[]>>({});
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [branches, setBranches] = useState<TimelineBranch[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [works, setWorks] = useState<Work[]>([]);

  // 全局搜索弹窗与时间游标
  const [searchOpen, setSearchOpen] = useState(false);
  const [cursorTick, setCursorTick] = useState('0');

  // 快捷创建实体模态框
  const [quickCreateEntityOpen, setQuickCreateEntityOpen] = useState(false);

  // 消息提示反馈
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 加载所有世界
  const loadWorlds = useCallback(async (selectWorldId?: string) => {
    setLoading(true);
    try {
      const list = await api.listWorlds(true);
      setWorlds(list);
      if (list.length > 0) {
        if (selectWorldId) {
          const match = list.find((w) => w.id === selectWorldId);
          setActiveWorld(match ?? list[0] ?? null);
        } else {
          setActiveWorld((cur) => (cur ? list.find((w) => w.id === cur.id) ?? list[0] ?? null : list[0] ?? null));
        }
      } else {
        setActiveWorld(null);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '无法获取世界列表', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // 加载当前世界的所有详情数据
  const loadWorldData = useCallback(async (world: World) => {
    setCursorTick(world.currentTick ?? '0');
    try {
      const [
        ents,
        types,
        rels,
        relTypes,
        evts,
        mapList,
        validationIssues,
        claimList,
        branchList,
        ruleList,
        workList,
      ] = await Promise.all([
        api.listEntities(world.id).catch(() => []),
        api.listEntityTypes(world.id).catch(() => []),
        api.listRelations(world.id).catch(() => []),
        api.listRelationTypes(world.id).catch(() => []),
        api.listEvents(world.id).catch(() => []),
        api.listMaps(world.id).catch(() => []),
        api.getValidation(world.id).catch(() => []),
        api.listClaims(world.id).catch(() => []),
        api.listBranches(world.id).catch(() => []),
        api.listRules(world.id).catch(() => []),
        api.listWorks(world.id).catch(() => []),
      ]);

      setEntities(ents);
      setEntityTypes(types);
      setRelations(rels);
      setRelationTypes(relTypes);
      setEvents(evts);
      setMaps(mapList);
      setIssues(validationIssues);
      setClaims(claimList);
      setBranches(branchList);
      setRules(ruleList);
      setWorks(workList);

      // 加载每个地图的图层
      if (mapList.length > 0) {
        const layerEntries = await Promise.all(
          mapList.map(async (m) => {
            try {
              const layers = await api.listMapLayers(world.id, m.id);
              return [m.id, layers] as const;
            } catch {
              return [m.id, []] as const;
            }
          })
        );
        setMapLayers(Object.fromEntries(layerEntries));
      } else {
        setMapLayers({});
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载世界数据失败', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    void loadWorlds();
  }, [loadWorlds]);

  useEffect(() => {
    if (activeWorld) {
      void loadWorldData(activeWorld);
    } else {
      setEntities([]);
      setEntityTypes([]);
      setRelations([]);
      setRelationTypes([]);
      setEvents([]);
      setMaps([]);
      setMapLayers({});
      setIssues([]);
      setClaims([]);
      setBranches([]);
      setRules([]);
      setWorks([]);
    }
  }, [activeWorld?.id, activeWorld?.revision, loadWorldData]);

  // 世界创建
  async function handleCreateWorld(name: string, genre: string) {
    try {
      const created = await api.createWorld({ name, genre });
      showToast(`世界「${created.name}」已成功创建`, 'success');
      await loadWorlds(created.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建世界失败', 'error');
    }
  }

  // 归档状态切换
  async function handleToggleArchive() {
    if (!activeWorld) return;
    try {
      const isCurrentlyArchived = Boolean(activeWorld.archivedAt);
      const updated = await api.toggleWorldArchive(activeWorld.id, activeWorld.revision, isCurrentlyArchived);
      setActiveWorld(updated);
      showToast(isCurrentlyArchived ? '世界已恢复编辑状态' : '世界已归档为只读模式', 'success');
      await loadWorlds(updated.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '归档操作失败', 'error');
    }
  }

  // 时间游标更新
  async function handleUpdateCursor(newTick: string) {
    if (!activeWorld) return;
    try {
      const updated = await api.updateTimeCursor(activeWorld.id, activeWorld.revision, newTick);
      setActiveWorld(updated);
      setCursorTick(newTick);
      showToast(`世界时间已更新至 Tick ${newTick}`, 'success');
      await loadWorlds(updated.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '时间游标更新失败', 'error');
    }
  }

  // 实体创建
  async function handleCreateEntity(data: {
    typeId: string;
    name: string;
    subtitle: string;
    document: Record<string, unknown>;
  }) {
    if (!activeWorld) return;
    try {
      await api.createEntity(activeWorld.id, activeWorld.revision, data);
      showToast(`实体「${data.name}」已录入`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '录入实体失败', 'error');
      throw err;
    }
  }

  // 实体档案扩写更新
  async function handleUpdateEntityDocument(
    entityId: string,
    document: Record<string, unknown>
  ) {
    if (!activeWorld) return;
    try {
      await api.updateEntityDocument(activeWorld.id, entityId, activeWorld.revision, document);
      showToast('实体档案更新成功', 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '更新实体档案失败', 'error');
      throw err;
    }
  }

  // 实体类型创建
  async function handleCreateEntityType(data: {
    typeKey: string;
    label: string;
    schema: Record<string, unknown>;
  }) {
    if (!activeWorld) return;
    try {
      await api.createEntityType(activeWorld.id, activeWorld.revision, data);
      showToast(`实体类型「${data.label}」已创建`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建类型失败', 'error');
      throw err;
    }
  }

  // 建立实体关系
  async function handleCreateRelation(data: {
    sourceEntityId: string;
    targetEntityId: string;
    relationTypeId: string;
    description: string;
  }) {
    if (!activeWorld) return;
    try {
      await api.createRelation(activeWorld.id, activeWorld.revision, data);
      showToast('实体关系已确立', 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '建立关系失败', 'error');
      throw err;
    }
  }

  // 关系类型创建
  async function handleCreateRelationType(data: {
    forwardLabel: string;
    inverseLabel: string;
    symmetric: boolean;
  }) {
    if (!activeWorld) return;
    try {
      await api.createRelationType(activeWorld.id, activeWorld.revision, data);
      showToast(`关系类型「${data.forwardLabel}」已定义`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建关系类型失败', 'error');
      throw err;
    }
  }

  // 事件创建
  async function handleCreateEvent(data: {
    name: string;
    eventType: string;
    startTick: string;
    endTick?: string;
    description: string;
    participantIds: string[];
  }) {
    if (!activeWorld) return;
    try {
      await api.createEvent(activeWorld.id, activeWorld.revision, data);
      showToast(`历史事件「${data.name}」已记载`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '记载事件失败', 'error');
      throw err;
    }
  }

  // 地图创建
  async function handleCreateMap(data: {
    name: string;
    width: number;
    height: number;
    file: File | null;
  }) {
    if (!activeWorld) return;
    try {
      await api.createMap(activeWorld.id, activeWorld.revision, data);
      showToast(`地图「${data.name}」已创建`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建地图失败', 'error');
      throw err;
    }
  }

  // 图层创建
  async function handleCreateLayer(mapId: string, data: { name: string; kind: 'base' | 'overlay' | 'annotation'; opacity: number }) {
    if (!activeWorld) return;
    try {
      await api.createMapLayer(activeWorld.id, mapId, activeWorld.revision, data);
      showToast(`图层「${data.name}」已添加`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '添加图层失败', 'error');
      throw err;
    }
  }

  // 图层显隐切换
  async function handleToggleLayerVisible(layer: MapLayer) {
    if (!activeWorld) return;
    try {
      await api.updateMapLayer(activeWorld.id, layer.mapId, layer.id, activeWorld.revision, {
        visible: !layer.visible,
      });
      showToast(`图层已${layer.visible ? '隐藏' : '显示'}`, 'info');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '切换图层状态失败', 'error');
    }
  }

  // 地图要素创建
  async function handleCreateFeature(mapId: string, data: { kind: 'marker' | 'polygon'; layerId?: string; entityId?: string; geometry: { type: string; coordinates: number[] | number[][][] } }) {
    if (!activeWorld) return;
    try {
      await api.createMapFeature(activeWorld.id, mapId, activeWorld.revision, data);
      showToast('地图要素标注成功', 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '标注要素失败', 'error');
      throw err;
    }
  }

  // Canon 状态流转
  async function handleChangeCanonStatus(
    kind: 'entity' | 'event',
    itemId: string,
    status: CanonStatus
  ) {
    if (!activeWorld) return;
    try {
      await api.changeCanonStatus(activeWorld.id, activeWorld.revision, kind, itemId, status);
      showToast(`正典状态已流转为 ${status}`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '流转 Canon 状态失败', 'error');
    }
  }

  // 构思提案
  async function handleCreateProposal(prompt: string) {
    if (!activeWorld) return;
    try {
      const p = await api.createProposal(activeWorld.id, activeWorld.revision, prompt);
      setProposal(p);
      showToast('辅助提案已生成，请在审查工作区复核变更', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '生成提案失败', 'error');
    }
  }

  // 离线提案回流提交
  async function handleSubmitOfflineProposal(request: string, changes: ProposalChange[]) {
    if (!activeWorld) return;
    try {
      const p = await api.createProposal(activeWorld.id, activeWorld.revision, request, changes);
      setProposal(p);
      showToast('离线提案解析完成，已载入审查工作区', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '提交回流提案失败', 'error');
      throw err;
    }
  }

  async function handleAcceptProposal(proposalId: string, changeIds: string[]) {
    if (!activeWorld) return;
    try {
      const updated = await api.acceptProposal(activeWorld.id, proposalId, changeIds);
      setProposal(updated);
      showToast(`已成功合并 ${changeIds.length} 项变更入库`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '接受提案失败', 'error');
    }
  }

  async function handleCreateClaim(data: {
    predicateKey: string;
    value: string;
    claimKind: Claim['claimKind'];
    truthStatus: Claim['truthStatus'];
    subjectEntityId?: string;
    assertedByEntityId?: string;
  }) {
    if (!activeWorld) return;
    try {
      await api.createClaim(activeWorld.id, activeWorld.revision, data);
      showToast('主张已记录', 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '记录主张失败', 'error');
      throw err;
    }
  }

  async function handleCreateBranch(data: { name: string; status: TimelineBranch['status'] }) {
    if (!activeWorld) return;
    try {
      await api.createBranch(activeWorld.id, activeWorld.revision, data);
      showToast(`分支「${data.name}」已创建`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建分支失败', 'error');
      throw err;
    }
  }

  async function handleCreateRule(data: { name: string; assert: Record<string, unknown>; message?: string }) {
    if (!activeWorld) return;
    try {
      await api.createRule(activeWorld.id, activeWorld.revision, data);
      showToast(`规则「${data.name}」已创建`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建规则失败', 'error');
      throw err;
    }
  }

  async function handleCreateWork(title: string) {
    if (!activeWorld) return;
    try {
      await api.createWork(activeWorld.id, activeWorld.revision, { title });
      showToast(`作品「${title}」已创建`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建作品失败', 'error');
      throw err;
    }
  }

  async function handleCreateChapter(workId: string, title: string) {
    if (!activeWorld) return;
    try {
      await api.createChapter(activeWorld.id, workId, activeWorld.revision, title);
      showToast(`章节「${title}」已创建`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建章节失败', 'error');
      throw err;
    }
  }

  async function handleCreateScene(chapterId: string, data: { title: string; proseText: string; povCharacterId?: string }) {
    if (!activeWorld) return;
    try {
      await api.createScene(activeWorld.id, chapterId, activeWorld.revision, data);
      showToast(`场景「${data.title}」已创建`, 'success');
      await loadWorlds(activeWorld.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建场景失败', 'error');
      throw err;
    }
  }

  async function handleRejectProposal(proposalId: string) {
    if (!activeWorld) return;
    try {
      const updated = await api.rejectProposal(activeWorld.id, proposalId);
      setProposal(updated);
      showToast('已拒绝该项提案', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '拒绝提案失败', 'error');
    }
  }

  const isWorldDisabled = Boolean(activeWorld?.archivedAt);

  return (
    <div className="app-container">
      {/* 侧边导航栏 */}
      <Sidebar
        worlds={worlds}
        activeWorld={activeWorld}
        onSelectWorld={setActiveWorld}
        onCreateWorld={handleCreateWorld}
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        counts={{
          entities: entities.length,
          relations: relations.length,
          events: events.length,
          maps: maps.length,
          issues: issues.length,
        }}
      />

      {/* 主工作区视口 */}
      <div className="main-viewport">
        {/* 全局顶栏 */}
        <TopNavbar
          activeWorld={activeWorld}
          cursorTick={cursorTick}
          onUpdateCursor={handleUpdateCursor}
          onOpenSearch={() => setSearchOpen(true)}
          onToggleArchive={handleToggleArchive}
          onRefresh={() => (activeWorld ? loadWorlds(activeWorld.id) : loadWorlds())}
        />

        {/* 工作台内容主体 */}
        <main className="workbench-content">
          {loading ? (
            <div className="empty-state" style={{ minHeight: '300px' }}>
              <div className="empty-state-icon" style={{ opacity: 0.6 }}>
                <IconClock size={36} />
              </div>
              <div className="empty-state-title">正在加载世界设定与正典数据…</div>
            </div>
          ) : currentTab === 'settings' ? (
            <SettingsWorkspace
              world={activeWorld ?? undefined}
              onNotify={(msg, type) => showToast(msg, type)}
            />
          ) : !activeWorld ? (
            <div className="empty-state" style={{ minHeight: '400px' }}>
              <div className="empty-state-icon" style={{ opacity: 0.6 }}>
                <IconWorldara size={42} />
              </div>
              <div className="empty-state-title">尚未选择或创建世界</div>
              <p className="empty-state-desc">请从左侧栏选择已有世界，或新建世界开始构建设定。</p>
            </div>
          ) : (
            <>
              {currentTab === 'overview' && (
                <WorldDashboard
                  world={activeWorld}
                  entities={entities}
                  relations={relations}
                  events={events}
                  maps={maps}
                  issues={issues}
                  onNavigate={setCurrentTab}
                  onOpenCreateEntity={() => setQuickCreateEntityOpen(true)}
                  onOpenCreateEvent={() => setCurrentTab('timeline')}
                />
              )}

              {currentTab === 'entities' && (
                <EntityWorkspace
                  world={activeWorld}
                  entities={entities}
                  entityTypes={entityTypes}
                  relations={relations}
                  relationTypes={relationTypes}
                  events={events}
                  onCreateEntity={handleCreateEntity}
                  onUpdateEntityDocument={handleUpdateEntityDocument}
                  onChangeCanonStatus={(id, st) => handleChangeCanonStatus('entity', id, st)}
                  onRefresh={async () => { if (activeWorld) await loadWorlds(activeWorld.id); }}
                  disabled={isWorldDisabled}
                />
              )}

              {currentTab === 'graph' && (
                <GraphWorkspace
                  world={activeWorld}
                  entities={entities}
                  relations={relations}
                  relationTypes={relationTypes}
                  entityTypes={entityTypes}
                  onCreateRelation={handleCreateRelation}
                  disabled={isWorldDisabled}
                />
              )}

              {currentTab === 'timeline' && (
                <TimelineWorkspace
                  world={activeWorld}
                  worldId={activeWorld.id}
                  worldRevision={activeWorld.revision}
                  currentTick={cursorTick}
                  events={events}
                  allEntities={entities}
                  onCreateEvent={handleCreateEvent}
                  onChangeCanonStatus={(id, st) => handleChangeCanonStatus('event', id, st)}
                  disabled={isWorldDisabled}
                />
              )}

              {currentTab === 'map' && (
                <MapWorkspace
                  world={activeWorld}
                  worldId={activeWorld.id}
                  maps={maps}
                  mapLayers={mapLayers}
                  entities={entities}
                  onCreateMap={handleCreateMap}
                  onCreateLayer={handleCreateLayer}
                  onToggleLayerVisible={handleToggleLayerVisible}
                  onCreateFeature={handleCreateFeature}
                  disabled={isWorldDisabled}
                />
              )}

              {currentTab === 'canon' && (
                <CanonWorkspace
                  issues={issues}
                  entities={entities}
                  onChangeCanonStatus={(id, st) => handleChangeCanonStatus('entity', id, st)}
                  onRefreshValidation={() => loadWorldData(activeWorld)}
                  disabled={isWorldDisabled}
                />
              )}

              {currentTab === 'ai' && (
                <ProposalWorkspace
                  world={activeWorld}
                  entities={entities}
                  relations={relations}
                  relationTypes={relationTypes}
                  cursorTick={cursorTick}
                  proposal={proposal}
                  onCreateProposal={handleCreateProposal}
                  onSubmitOfflineProposal={handleSubmitOfflineProposal}
                  onAcceptProposal={handleAcceptProposal}
                  onRejectProposal={handleRejectProposal}
                  disabled={isWorldDisabled}
                />
              )}

              {currentTab === 'knowledge' && (
                <KnowledgeWorkspace
                  world={activeWorld}
                  claims={claims}
                  branches={branches}
                  entities={entities}
                  onCreateClaim={handleCreateClaim}
                  onCreateBranch={handleCreateBranch}
                  disabled={isWorldDisabled}
                />
              )}

              {currentTab === 'manuscript' && (
                <ManuscriptWorkspace
                  world={activeWorld}
                  works={works}
                  entities={entities}
                  onCreateWork={handleCreateWork}
                  onCreateChapter={handleCreateChapter}
                  onCreateScene={handleCreateScene}
                  disabled={isWorldDisabled}
                />
              )}

              {currentTab === 'schema' && (
                <SchemaWorkspace
                  world={activeWorld}
                  entityTypes={entityTypes}
                  relationTypes={relationTypes}
                  rules={rules}
                  onCreateEntityType={handleCreateEntityType}
                  onCreateRelationType={handleCreateRelationType}
                  onCreateRule={handleCreateRule}
                  disabled={isWorldDisabled}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* 全局 Command-K 搜索模态框 */}
      {activeWorld && (
        <GlobalSearchModal
          isOpen={searchOpen}
          onClose={() => setSearchOpen(false)}
          worldId={activeWorld.id}
          onSelectResult={(res: SearchResult) => {
            if (res.kind === 'entity') {
              setCurrentTab('entities');
            } else if (res.kind === 'event') {
              setCurrentTab('timeline');
            }
          }}
        />
      )}

      {/* 快捷录入实体模态框 */}
      {activeWorld && (
        <CreateEntityModal
          world={activeWorld}
          isOpen={quickCreateEntityOpen}
          onClose={() => setQuickCreateEntityOpen(false)}
          entityTypes={entityTypes}
          allEntities={entities}
          onSubmit={handleCreateEntity}
          disabled={isWorldDisabled}
        />
      )}

      {/* 浮动提示容器 */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
