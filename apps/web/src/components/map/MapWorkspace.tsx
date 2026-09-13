import React, { useState, useEffect } from 'react';
import type { World, WorldMap, MapLayer, MapFeature, Entity } from '../../lib/types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { api } from '../../lib/api';
import { AiAssistantModal } from '../common/AiAssistantModal';
import { buildMapFeaturePrompt } from '../../lib/promptCompiler';
import { extractJsonFromText } from '../../lib/jsonExtractor';
import { IconMap, IconPlus, IconLayers, IconEye, IconEyeOff, IconQuill } from '../ui/Icons';

interface MapWorkspaceProps {
  world?: World | undefined;
  worldId: string;
  maps: WorldMap[];
  mapLayers: Record<string, MapLayer[]>;
  entities: Entity[];
  onCreateMap: (data: { name: string; width: number; height: number; file: File | null }) => Promise<void>;
  onCreateLayer: (mapId: string, data: { name: string; kind: 'base' | 'overlay' | 'annotation'; opacity: number }) => Promise<void>;
  onToggleLayerVisible: (layer: MapLayer) => Promise<void>;
  onCreateFeature: (mapId: string, data: { kind: 'marker' | 'polygon'; layerId?: string; entityId?: string; geometry: { type: string; coordinates: number[] | number[][][] } }) => Promise<void>;
  disabled?: boolean | undefined;
}

export function MapWorkspace({
  world,
  worldId,
  maps,
  mapLayers,
  entities,
  onCreateMap,
  onCreateLayer,
  onToggleLayerVisible,
  onCreateFeature,
  disabled,
}: MapWorkspaceProps) {
  const [selectedMapId, setSelectedMapId] = useState<string>(maps[0]?.id ?? '');
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [loadingFeatures, setLoadingFeatures] = useState(false);

  // 模态框控制
  const [createMapOpen, setCreateMapOpen] = useState(false);
  const [createLayerOpen, setCreateLayerOpen] = useState(false);
  const [createFeatureOpen, setCreateFeatureOpen] = useState(false);
  const [aiFeatureOpen, setAiFeatureOpen] = useState(false);

  // 新建地图状态
  const [newMapName, setNewMapName] = useState('');
  const [newMapWidth, setNewMapWidth] = useState('1200');
  const [newMapHeight, setNewMapHeight] = useState('800');
  const [newMapFile, setNewMapFile] = useState<File | null>(null);

  // 新建图层状态
  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerKind, setNewLayerKind] = useState<'base' | 'overlay' | 'annotation'>('overlay');
  const [newLayerOpacity, setNewLayerOpacity] = useState('1');

  // 新建要素状态
  const [featureKind, setFeatureKind] = useState<'marker' | 'polygon'>('marker');
  const [featureLayerId, setFeatureLayerId] = useState('');
  const [featureEntityId, setFeatureEntityId] = useState('');
  const [featureX, setFeatureX] = useState('300');
  const [featureY, setFeatureY] = useState('200');
  const [polygonCoords, setPolygonCoords] = useState('100,100;400,100;400,300;100,300;100,100');

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (maps.length > 0 && maps[0] && (!selectedMapId || !maps.some((m) => m.id === selectedMapId))) {
      setSelectedMapId(maps[0].id);
    }
  }, [maps, selectedMapId]);

  useEffect(() => {
    if (selectedMapId) {
      setLoadingFeatures(true);
      api
        .listMapFeatures(worldId, selectedMapId)
        .then(setFeatures)
        .catch(() => setFeatures([]))
        .finally(() => setLoadingFeatures(false));
    } else {
      setFeatures([]);
    }
  }, [worldId, selectedMapId]);

  const activeMap = maps.find((m) => m.id === selectedMapId);
  const layers = selectedMapId ? mapLayers[selectedMapId] || [] : [];

  async function handleCreateMapSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newMapName.trim()) return;
    setSaving(true);
    try {
      await onCreateMap({
        name: newMapName.trim(),
        width: Number(newMapWidth) || 1000,
        height: Number(newMapHeight) || 800,
        file: newMapFile,
      });
      setNewMapName('');
      setNewMapFile(null);
      setCreateMapOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateLayerSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMapId || !newLayerName.trim()) return;
    setSaving(true);
    try {
      await onCreateLayer(selectedMapId, {
        name: newLayerName.trim(),
        kind: newLayerKind,
        opacity: Number(newLayerOpacity) || 1,
      });
      setNewLayerName('');
      setCreateLayerOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateFeatureSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMapId) return;
    setSaving(true);
    try {
      let geometry: { type: string; coordinates: number[] | number[][][] };
      if (featureKind === 'marker') {
        geometry = {
          type: 'Point',
          coordinates: [Number(featureX) || 0, Number(featureY) || 0],
        };
      } else {
        const pairs = polygonCoords
          .split(';')
          .map((p) => p.split(',').map(Number))
          .filter((pair) => pair.length === 2 && pair.every(Number.isFinite));
        geometry = {
          type: 'Polygon',
          coordinates: [pairs],
        };
      }

      await onCreateFeature(selectedMapId, {
        kind: featureKind,
        geometry,
        ...(featureLayerId ? { layerId: featureLayerId } : {}),
        ...(featureEntityId ? { entityId: featureEntityId } : {}),
      });
      setCreateFeatureOpen(false);
      // 刷新要素列表
      const updated = await api.listMapFeatures(worldId, selectedMapId);
      setFeatures(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 顶部控制栏 */}
      <div className="panel-card" style={{ padding: '14px 18px', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <IconMap size={16} style={{ color: 'var(--accent)' }} />
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                地图与空间资产工坊 (World Cartography)
              </h2>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              多图层分级管理，支持地标标注（Marker）与区域领地多边形（Polygon），绑定正典世界实体。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {maps.length > 0 && (
              <select
                value={selectedMapId}
                onChange={(e) => setSelectedMapId(e.target.value)}
                style={{ width: '170px', fontSize: '12px', padding: '5px 8px' }}
              >
                {maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.width}×{m.height})
                  </option>
                ))}
              </select>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCreateMapOpen(true)}
              disabled={disabled}
              icon={<IconPlus size={13} />}
            >
              创建新地图
            </Button>

            {activeMap && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCreateLayerOpen(true)}
                  disabled={disabled}
                  icon={<IconPlus size={13} />}
                >
                  添加图层
                </Button>
                <Button
                  variant="gold"
                  size="sm"
                  onClick={() => setCreateFeatureOpen(true)}
                  disabled={disabled}
                  icon={<IconPlus size={13} />}
                >
                  标注要素
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {maps.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <IconMap size={28} />
          </div>
          <div className="empty-state-title">当前世界尚未配置任何地图图幅</div>
          <p className="empty-state-desc">
            可上传底图图像文件（PNG/JPG/WebP）或定义虚拟坐标系网格画布，开展地理与地标要素标注。
          </p>
          <Button variant="gold" onClick={() => setCreateMapOpen(true)} disabled={disabled} icon={<IconPlus size={13} />}>
            创建第一张地图
          </Button>
        </div>
      ) : activeMap ? (
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
          {/* 地图交互画布 */}
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
            <div style={{ padding: '7px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span>{activeMap.name} · {activeMap.crs} 坐标系</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{activeMap.width} × {activeMap.height} px</span>
            </div>

            <div
              style={{
                width: '100%',
                height: '520px',
                position: 'relative',
                overflow: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                viewBox={`0 0 ${activeMap.width} ${activeMap.height}`}
                style={{
                  width: '100%',
                  height: '100%',
                  background: '#0d1017',
                  display: 'block',
                }}
              >
                {/* 虚拟坐标网格 */}
                <defs>
                  <pattern id="map-grid" width="100" height="100" patternUnits="userSpaceOnUse">
                    <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#161c28" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#map-grid)" />

                {/* 底图图片渲染 */}
                {activeMap.assetId && (
                  <image
                    href={api.getAssetUrl(worldId, activeMap.assetId)}
                    width={activeMap.width}
                    height={activeMap.height}
                    preserveAspectRatio="none"
                  />
                )}

                {/* 渲染要素：多边形 */}
                {features
                  .filter((f) => f.kind === 'polygon' && Array.isArray(f.geometry.coordinates?.[0]))
                  .map((f) => {
                    const coords = (f.geometry.coordinates as number[][][])[0] || [];
                    const pointsStr = coords.map((c) => `${c[0]},${c[1]}`).join(' ');
                    const ent = entities.find((e) => e.id === f.entityId);
                    const firstPoint = coords[0];
                    return (
                      <g key={f.id}>
                        <polygon
                          points={pointsStr}
                          fill="rgba(59, 130, 246, 0.18)"
                          stroke="var(--accent)"
                          strokeWidth="1.5"
                        />
                        {ent && firstPoint && firstPoint[0] !== undefined && firstPoint[1] !== undefined && (
                          <text
                            x={firstPoint[0]}
                            y={firstPoint[1] - 6}
                            fill="var(--text-primary)"
                            fontSize="11"
                            fontWeight="600"
                          >
                            {ent.name}
                          </text>
                        )}
                      </g>
                    );
                  })}

                {/* 渲染要素：标记点 */}
                {features
                  .filter((f) => f.kind === 'marker' && Array.isArray(f.geometry.coordinates))
                  .map((f) => {
                    const [x, y] = f.geometry.coordinates as number[];
                    const ent = entities.find((e) => e.id === f.entityId);
                    return (
                      <g key={f.id} transform={`translate(${x}, ${y})`}>
                        <circle r="6" fill="var(--canon-gold)" stroke="#0b0d11" strokeWidth="2" />
                        <text
                          y="-10"
                          textAnchor="middle"
                          fill="var(--text-primary)"
                          fontSize="11"
                          fontWeight="600"
                          style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
                        >
                          {ent?.name || '标记点'}
                        </text>
                      </g>
                    );
                  })}
              </svg>
            </div>
          </div>

          {/* 侧边图层与要素栏 */}
          <div style={{ width: '280px', minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* 图层面板 */}
            <div className="panel-card" style={{ padding: '14px', marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IconLayers size={14} style={{ color: 'var(--accent)' }} />
                  <h3 style={{ fontSize: '13px', fontWeight: 600 }}>图层管理 ({layers.length})</h3>
                </div>
              </div>

              {layers.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  暂未添加图层
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {layers.map((layer) => (
                    <div
                      key={layer.id}
                      style={{
                        padding: '6px 8px',
                        background: 'var(--bg-app)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                      }}
                    >
                      <div>
                        <strong style={{ color: 'var(--text-primary)' }}>{layer.name}</strong>
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                          {layer.kind} · {Math.round(layer.opacity * 100)}%
                        </div>
                      </div>

                      <button
                        className={`btn btn-sm ${layer.visible ? 'btn-secondary' : 'btn-ghost'}`}
                        style={{ padding: '2px 6px', fontSize: '11px', gap: '4px' }}
                        onClick={() => void onToggleLayerVisible(layer)}
                      >
                        {layer.visible ? <IconEye size={12} /> : <IconEyeOff size={12} />}
                        <span>{layer.visible ? '显示' : '隐藏'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 要素列表 */}
            <div className="panel-card" style={{ padding: '14px', marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 600 }}>要素标注 ({features.length})</h3>
              </div>

              {features.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  暂未添加地标标注
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '240px', overflowY: 'auto' }}>
                  {features.map((f) => {
                    const ent = entities.find((e) => e.id === f.entityId);
                    return (
                      <div
                        key={f.id}
                        style={{
                          padding: '5px 8px',
                          background: 'var(--bg-app)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-subtle)',
                          fontSize: '11px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <strong style={{ color: 'var(--text-primary)' }}>{ent?.name || '未绑定实体'}</strong>
                          <Badge variant="neutral" size="sm">{f.kind}</Badge>
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                          {f.kind === 'marker'
                            ? `(${Math.round((f.geometry.coordinates as number[])[0] ?? 0)}, ${Math.round((f.geometry.coordinates as number[])[1] ?? 0)})`
                            : '多边形轮廓'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* 创建地图模态框 */}
      <Modal
        isOpen={createMapOpen}
        onClose={() => setCreateMapOpen(false)}
        title="创建世界地图 (Create World Map)"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateMapOpen(false)}>取消</Button>
            <Button variant="gold" onClick={handleCreateMapSubmit} loading={saving} disabled={disabled}>
              创建地图
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateMapSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              地图名称 <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              required
              autoFocus
              value={newMapName}
              onChange={(e) => setNewMapName(e.target.value)}
              placeholder="例如：北境诸国疆域全图、深渊地底海…"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                画布宽度 (px)
              </label>
              <input
                value={newMapWidth}
                onChange={(e) => setNewMapWidth(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                画布高度 (px)
              </label>
              <input
                value={newMapHeight}
                onChange={(e) => setNewMapHeight(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              上传底图图像 (可选)
            </label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setNewMapFile(e.target.files?.[0] || null)}
            />
          </div>
        </form>
      </Modal>

      {/* 创建图层模态框 */}
      <Modal
        isOpen={createLayerOpen}
        onClose={() => setCreateLayerOpen(false)}
        title="添加地图图层 (Add Map Layer)"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateLayerOpen(false)}>取消</Button>
            <Button variant="gold" onClick={handleCreateLayerSubmit} loading={saving} disabled={disabled}>
              添加图层
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateLayerSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              图层名称 <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              required
              value={newLayerName}
              onChange={(e) => setNewLayerName(e.target.value)}
              placeholder="例如：地形水系、国界边界、地下洞窟…"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              图层种类
            </label>
            <select value={newLayerKind} onChange={(e) => setNewLayerKind(e.target.value as any)}>
              <option value="overlay">覆盖要素图层 (Overlay)</option>
              <option value="annotation">地名与文字标注 (Annotation)</option>
              <option value="base">底图基底图层 (Base)</option>
            </select>
          </div>
        </form>
      </Modal>

      {/* 创建要素模态框 */}
      <Modal
        isOpen={createFeatureOpen}
        onClose={() => setCreateFeatureOpen(false)}
        title="标注地图要素 (Add Map Feature)"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateFeatureOpen(false)}>取消</Button>
            <Button variant="gold" onClick={handleCreateFeatureSubmit} loading={saving} disabled={disabled}>
              确立标注
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface-elevated)', padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>辅助要素测绘</div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>参考地理与势力设定，补充点位或区域边界</div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setAiFeatureOpen(true)}
            icon={<IconQuill size={12} />}
          >
            生成草案
          </Button>
        </div>

        <form onSubmit={handleCreateFeatureSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              要素形态 (Feature Kind)
            </label>
            <select value={featureKind} onChange={(e) => setFeatureKind(e.target.value as any)}>
              <option value="marker">Marker 关键地点点位</option>
              <option value="polygon">Polygon 领地/势力多边形</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              关联世界实体 (Link Entity)
            </label>
            <select value={featureEntityId} onChange={(e) => setFeatureEntityId(e.target.value)}>
              <option value="">不关联实体</option>
              {entities.map((ent) => (
                <option key={ent.id} value={ent.id}>{ent.name}</option>
              ))}
            </select>
          </div>

          {featureKind === 'marker' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  X 坐标 (像素)
                </label>
                <input value={featureX} onChange={(e) => setFeatureX(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Y 坐标 (像素)
                </label>
                <input value={featureY} onChange={(e) => setFeatureY(e.target.value)} />
              </div>
            </div>
          ) : (
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                多边形闭合坐标点串 (x,y;x,y;...)
              </label>
              <input
                value={polygonCoords}
                onChange={(e) => setPolygonCoords(e.target.value)}
                placeholder="0,0;100,0;100,100;0,0"
              />
            </div>
          )}
        </form>
      </Modal>

      {/* AI 地图要素构想弹窗 */}
      <AiAssistantModal
        isOpen={aiFeatureOpen}
        onClose={() => setAiFeatureOpen(false)}
        title="构思地图要素"
        description={activeMap ? `为地图「${activeMap.name}」补充地标或势力版图` : '补充地图要素'}
        promptCompiler={(helper: string) =>
          buildMapFeaturePrompt({
            world: world || {
              id: worldId,
              name: '当前世界',
              genre: 'Fantasy',
              revision: '0',
              description: '',
            },
            mapName: activeMap?.name || '主地图',
            mapWidth: activeMap?.width || 1200,
            mapHeight: activeMap?.height || 800,
            entities,
            ...(helper ? { userPrompt: helper } : {}),
          })
        }
        onApplyResult={(rawText: string) => {
          const parsed = extractJsonFromText(rawText);
          if (parsed && typeof parsed === 'object') {
            const data = parsed as Record<string, unknown>;
            if (data.kind === 'marker' || data.kind === 'polygon') {
              setFeatureKind(data.kind);
            }
            if (typeof data.entityId === 'string') {
              const matched = entities.find((e) => e.id === data.entityId || e.name === data.entityId);
              if (matched) setFeatureEntityId(matched.id);
            }
            if (data.x != null) setFeatureX(String(data.x));
            if (data.y != null) setFeatureY(String(data.y));
            if (typeof data.polygonCoords === 'string') setPolygonCoords(data.polygonCoords);
          }
        }}
      />
    </div>
  );
}
