import type {
  World,
  Entity,
  EntityType,
  RelationType,
  Relation,
  WorldEvent,
  WorldMap,
  MapLayer,
  MapFeature,
  ValidationIssue,
  SearchResult,
  Proposal,
  ProposalChange,
  WorldSnapshot,
  CanonStatus,
  TimelineBranch,
  Claim,
  ValidationRule,
  Work,
  Chapter,
  Scene,
  Plotline,
  ContinuityReview,
} from './types';

const API_BASE = '/api/backend';

async function handleResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    let msg = fallbackMessage;
    try {
      const body = await res.json();
      if (body?.error?.message) {
        msg = body.error.message;
      }
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  const json = await res.json();
  return json.data as T;
}

export const api = {
  // Worlds
  async listWorlds(includeArchived = false): Promise<World[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds${includeArchived ? '?includeArchived=true' : ''}`, {
      cache: 'no-store',
    });
    return handleResponse<World[]>(res, '获取世界列表失败');
  },

  async getWorld(worldId: string): Promise<World> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}`, { cache: 'no-store' });
    return handleResponse<World>(res, '获取世界详情失败');
  },

  async createWorld(data: { name: string; genre?: string; description?: string }): Promise<World> {
    const res = await fetch(`${API_BASE}/api/v1/worlds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: data.name.trim(), genre: data.genre || 'Custom', description: data.description || '' }),
    });
    return handleResponse<World>(res, '创建世界失败');
  },

  async updateWorld(worldId: string, revision: string, data: { name?: string; description?: string }): Promise<World> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify(data),
    });
    return handleResponse<World>(res, '更新世界失败');
  },

  async toggleWorldArchive(worldId: string, revision: string, isCurrentlyArchived: boolean): Promise<World> {
    const action = isCurrentlyArchived ? 'restore' : 'archive';
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/${action}`, {
      method: 'POST',
      headers: { 'if-match': revision },
    });
    return handleResponse<World>(res, isCurrentlyArchived ? '恢复世界失败' : '归档世界失败');
  },

  async updateTimeCursor(worldId: string, revision: string, tick: string): Promise<World> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/time-cursor`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({ tick }),
    });
    return handleResponse<World>(res, '更新时间游标失败');
  },

  // Search
  async searchWorld(worldId: string, query: string, limit = 20): Promise<SearchResult[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
      cache: 'no-store',
    });
    return handleResponse<SearchResult[]>(res, '搜索失败');
  },

  // Snapshot
  async getSnapshot(worldId: string, atTick: string, entityIds?: string[]): Promise<WorldSnapshot> {
    const query = new URLSearchParams({ atTick });
    if (entityIds && entityIds.length > 0) {
      query.set('entityIds', entityIds.join(','));
    }
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/snapshot?${query.toString()}`, {
      cache: 'no-store',
    });
    return handleResponse<WorldSnapshot>(res, '获取世界快照失败');
  },

  // Entity Types
  async listEntityTypes(worldId: string): Promise<EntityType[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/entity-types`, { cache: 'no-store' });
    return handleResponse<EntityType[]>(res, '获取实体类型失败');
  },

  async createEntityType(
    worldId: string,
    revision: string,
    data: { typeKey: string; label: string; schema: Record<string, unknown> }
  ): Promise<EntityType> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/entity-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify(data),
    });
    return handleResponse<EntityType>(res, '创建实体类型失败');
  },

  // Entities
  async listEntities(worldId: string): Promise<Entity[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/entities`, { cache: 'no-store' });
    return handleResponse<Entity[]>(res, '获取实体列表失败');
  },

  async createEntity(
    worldId: string,
    revision: string,
    data: { typeId: string; name: string; subtitle?: string; document?: Record<string, unknown>; tags?: string[] }
  ): Promise<Entity> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({
        typeId: data.typeId,
        name: data.name.trim(),
        subtitle: data.subtitle || '',
        document: data.document || {},
        tags: data.tags || [],
      }),
    });
    return handleResponse<Entity>(res, '创建实体失败');
  },

  async updateEntity(
    worldId: string,
    entityId: string,
    revision: string,
    data: { name?: string; subtitle?: string; document?: Record<string, unknown>; tags?: string[] }
  ): Promise<Entity> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/entities/${entityId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify(data),
    });
    return handleResponse<Entity>(res, '更新实体失败');
  },

  async listBacklinks(worldId: string, entityId: string): Promise<Array<{ entityId: string; name: string }>> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/entities/${entityId}/backlinks`, { cache: 'no-store' });
    return handleResponse(res, '获取反向链接失败');
  },

  async listUnlinkedMentions(worldId: string, entityId: string): Promise<Array<{ name: string; entityId: string }>> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/entities/${entityId}/unlinked-mentions`, { cache: 'no-store' });
    return handleResponse(res, '检测未链接提及失败');
  },

  async linkMention(worldId: string, entityId: string, revision: string, name: string): Promise<Entity> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/entities/${entityId}/link-mention`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({ name }),
    });
    return handleResponse<Entity>(res, '转为 Wiki 链接失败');
  },

  async updateEntityDocument(
    worldId: string,
    entityId: string,
    revision: string,
    document: Record<string, unknown>
  ): Promise<Entity> {
    return this.updateEntity(worldId, entityId, revision, { document });
  },

  // Relations & Relation Types
  async listRelationTypes(worldId: string): Promise<RelationType[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/relation-types`, { cache: 'no-store' });
    return handleResponse<RelationType[]>(res, '获取关系类型失败');
  },

  async createRelationType(
    worldId: string,
    revision: string,
    data: { forwardLabel: string; inverseLabel?: string; symmetric?: boolean; sourceTypeIds?: string[]; targetTypeIds?: string[] }
  ): Promise<RelationType> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/relation-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({
        forwardLabel: data.forwardLabel.trim(),
        inverseLabel: data.inverseLabel?.trim() || data.forwardLabel.trim(),
        symmetric: data.symmetric ?? false,
        sourceTypeIds: data.sourceTypeIds ?? [],
        targetTypeIds: data.targetTypeIds ?? [],
      }),
    });
    return handleResponse<RelationType>(res, '创建关系类型失败');
  },

  async listRelations(worldId: string): Promise<Relation[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/relations`, { cache: 'no-store' });
    return handleResponse<Relation[]>(res, '获取实体关系失败');
  },

  async createRelation(
    worldId: string,
    revision: string,
    data: { sourceEntityId: string; targetEntityId: string; relationTypeId: string; description?: string }
  ): Promise<Relation> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/relations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({
        sourceEntityId: data.sourceEntityId,
        targetEntityId: data.targetEntityId,
        relationTypeId: data.relationTypeId,
        description: data.description || '',
      }),
    });
    return handleResponse<Relation>(res, '创建关系失败');
  },

  // Events & Timeline
  async listEvents(worldId: string): Promise<WorldEvent[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/events`, { cache: 'no-store' });
    return handleResponse<WorldEvent[]>(res, '获取事件列表失败');
  },

  async createEvent(
    worldId: string,
    revision: string,
    data: { name: string; eventType?: string; startTick: string; endTick?: string; description?: string; participantIds?: string[] }
  ): Promise<WorldEvent> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({
        name: data.name.trim(),
        eventType: data.eventType || 'manual',
        startTick: data.startTick,
        ...(data.endTick ? { endTick: data.endTick } : {}),
        participantIds: data.participantIds ?? [],
        description: data.description || '',
        effects: [],
      }),
    });
    return handleResponse<WorldEvent>(res, '创建事件失败');
  },

  // Maps, Layers & Features
  async listMaps(worldId: string): Promise<WorldMap[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/maps`, { cache: 'no-store' });
    return handleResponse<WorldMap[]>(res, '获取地图列表失败');
  },

  async createMap(
    worldId: string,
    revision: string,
    data: { name: string; width: number; height: number; file?: File | null }
  ): Promise<WorldMap> {
    let assetId: string | undefined;
    let currentRevision = revision;

    if (data.file) {
      const uploadRes = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/assets`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-asset-media-type': data.file.type,
          'x-file-name': data.file.name,
          'if-match': currentRevision,
        },
        body: data.file,
      });
      if (!uploadRes.ok) throw new Error('上传底图资产失败');
      const uploadData = await uploadRes.json();
      assetId = uploadData.data.id;

      // refresh world to get latest revision
      const ref = await this.getWorld(worldId);
      currentRevision = ref.revision;
    }

    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/maps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': currentRevision },
      body: JSON.stringify({
        name: data.name.trim(),
        width: data.width,
        height: data.height,
        ...(assetId ? { assetId } : {}),
      }),
    });
    return handleResponse<WorldMap>(res, '创建地图失败');
  },

  async listMapLayers(worldId: string, mapId: string): Promise<MapLayer[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/maps/${mapId}/layers`, { cache: 'no-store' });
    return handleResponse<MapLayer[]>(res, '获取图层列表失败');
  },

  async createMapLayer(
    worldId: string,
    mapId: string,
    revision: string,
    data: { name: string; kind: 'base' | 'overlay' | 'annotation'; opacity?: number }
  ): Promise<MapLayer> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/maps/${mapId}/layers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({
        name: data.name.trim(),
        kind: data.kind,
        opacity: data.opacity ?? 1,
      }),
    });
    return handleResponse<MapLayer>(res, '创建图层失败');
  },

  async updateMapLayer(
    worldId: string,
    mapId: string,
    layerId: string,
    revision: string,
    patch: { visible?: boolean; opacity?: number }
  ): Promise<MapLayer> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/maps/${mapId}/layers/${layerId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify(patch),
    });
    return handleResponse<MapLayer>(res, '更新图层失败');
  },

  async listMapFeatures(worldId: string, mapId: string): Promise<MapFeature[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/maps/${mapId}/features`, { cache: 'no-store' });
    return handleResponse<MapFeature[]>(res, '获取地图要素失败');
  },

  async createMapFeature(
    worldId: string,
    mapId: string,
    revision: string,
    data: {
      kind: 'marker' | 'polygon';
      layerId?: string;
      entityId?: string;
      geometry: { type: string; coordinates: number[] | number[][][] };
    }
  ): Promise<MapFeature> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/maps/${mapId}/features`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({
        kind: data.kind,
        geometry: data.geometry,
        ...(data.layerId ? { layerId: data.layerId } : {}),
        ...(data.entityId ? { entityId: data.entityId } : {}),
      }),
    });
    return handleResponse<MapFeature>(res, '创建地图要素失败');
  },

  // Canon & Validation
  async getValidation(worldId: string): Promise<ValidationIssue[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/validation`, { cache: 'no-store' });
    if (!res.ok) throw new Error('加载 Canon 校验失败');
    const json = await res.json();
    return (json.data?.issues ?? []) as ValidationIssue[];
  },

  async changeCanonStatus(
    worldId: string,
    revision: string,
    kind: 'entity' | 'fact' | 'relation' | 'event',
    itemId: string,
    status: CanonStatus,
    reason?: string
  ): Promise<unknown> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/canon/${kind}/${itemId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({ status, reason: reason || `UI action: changed to ${status}` }),
    });
    return handleResponse(res, '修改 Canon 状态失败');
  },

  // AI Proposals
  async createProposal(
    worldId: string,
    revision: string,
    request: string,
    changes: ProposalChange[] = []
  ): Promise<Proposal> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/ai/proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: request.trim(), baseWorldRevision: revision, changes }),
    });
    return handleResponse<Proposal>(res, '创建 AI 提案失败');
  },

  async validateProposal(worldId: string, proposalId: string): Promise<ValidationIssue[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/ai/proposals/${proposalId}/validate`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('校验 Proposal 失败');
    const json = await res.json();
    return (json.data?.issues ?? []) as ValidationIssue[];
  },

  async rejectProposal(worldId: string, proposalId: string): Promise<Proposal> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/ai/proposals/${proposalId}/reject`, {
      method: 'POST',
    });
    return handleResponse<Proposal>(res, '拒绝 Proposal 失败');
  },

  async acceptProposal(worldId: string, proposalId: string, changeIds: string[]): Promise<Proposal> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/ai/proposals/${proposalId}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changeIds }),
    });
    return handleResponse<Proposal>(res, '接受 Proposal 变更失败');
  },

  // Export URLs
  getExportUrl(worldId: string, format: 'zip' | 'obsidian.zip' | 'json' | 'md' | 'geojson') {
    return `${API_BASE}/api/v1/worlds/${worldId}/export.${format}`;
  },

  getAssetUrl(worldId: string, assetId: string) {
    return `${API_BASE}/api/v1/worlds/${worldId}/assets/${assetId}`;
  },

  async listBranches(worldId: string): Promise<TimelineBranch[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/branches`, { cache: 'no-store' });
    return handleResponse<TimelineBranch[]>(res, '获取时间线分支失败');
  },

  async createBranch(worldId: string, revision: string, data: { name: string; status?: TimelineBranch['status'] }): Promise<TimelineBranch> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/branches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({ name: data.name.trim(), status: data.status ?? 'sandbox' }),
    });
    return handleResponse<TimelineBranch>(res, '创建时间线分支失败');
  },

  async listClaims(worldId: string): Promise<Claim[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/claims?canonStatus=all`, { cache: 'no-store' });
    return handleResponse<Claim[]>(res, '获取主张失败');
  },

  async createClaim(
    worldId: string,
    revision: string,
    data: { predicateKey: string; value?: string; claimKind?: Claim['claimKind']; truthStatus?: Claim['truthStatus']; subjectEntityId?: string; assertedByEntityId?: string }
  ): Promise<Claim> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/claims`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({
        predicateKey: data.predicateKey.trim(),
        objectKind: 'scalar',
        value: data.value ?? '',
        claimKind: data.claimKind ?? 'belief',
        truthStatus: data.truthStatus ?? 'unknown',
        ...(data.subjectEntityId ? { subjectEntityId: data.subjectEntityId } : {}),
        ...(data.assertedByEntityId ? { assertedByEntityId: data.assertedByEntityId } : {}),
      }),
    });
    return handleResponse<Claim>(res, '创建主张失败');
  },

  async listRules(worldId: string): Promise<ValidationRule[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/rules`, { cache: 'no-store' });
    return handleResponse<ValidationRule[]>(res, '获取校验规则失败');
  },

  async createRule(worldId: string, revision: string, data: { name: string; assert: Record<string, unknown>; severity?: string; message?: string }): Promise<ValidationRule> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({
        name: data.name.trim(),
        assert: data.assert,
        severity: data.severity ?? 'warning',
        ...(data.message ? { message: data.message } : {}),
      }),
    });
    return handleResponse<ValidationRule>(res, '创建校验规则失败');
  },

  async listWorks(worldId: string): Promise<Work[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/works`, { cache: 'no-store' });
    return handleResponse<Work[]>(res, '获取作品失败');
  },

  async createWork(worldId: string, revision: string, data: { title: string; type?: string }): Promise<Work> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/works`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({ title: data.title.trim(), type: data.type ?? 'novel' }),
    });
    return handleResponse<Work>(res, '创建作品失败');
  },

  async listChapters(worldId: string, workId: string): Promise<Chapter[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/works/${workId}/chapters`, { cache: 'no-store' });
    return handleResponse<Chapter[]>(res, '获取章节失败');
  },

  async createChapter(worldId: string, workId: string, revision: string, title: string): Promise<Chapter> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/works/${workId}/chapters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({ title: title.trim() }),
    });
    return handleResponse<Chapter>(res, '创建章节失败');
  },

  async listScenes(worldId: string, chapterId: string): Promise<Scene[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/chapters/${chapterId}/scenes`, { cache: 'no-store' });
    return handleResponse<Scene[]>(res, '获取场景失败');
  },

  async createScene(worldId: string, chapterId: string, revision: string, data: { title?: string; proseText?: string; povCharacterId?: string }): Promise<Scene> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/chapters/${chapterId}/scenes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({
        title: data.title?.trim() || 'Untitled scene',
        proseText: data.proseText ?? '',
        ...(data.povCharacterId ? { povCharacterId: data.povCharacterId } : {}),
      }),
    });
    return handleResponse<Scene>(res, '创建场景失败');
  },

  async listPlotlines(worldId: string): Promise<Plotline[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/plotlines`, { cache: 'no-store' });
    return handleResponse<Plotline[]>(res, '获取剧情线失败');
  },

  async reviewSceneContinuity(worldId: string, sceneId: string): Promise<ContinuityReview> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}/scenes/${sceneId}/continuity-review`, { method: 'POST' });
    return handleResponse<ContinuityReview>(res, '连续性审查失败');
  },
};
