import React, { useEffect, useState } from 'react';
import type { Chapter, ContinuityReview, Entity, Scene, Work, World } from '../../lib/types';
import { api } from '../../lib/api';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { IconBook, IconPlus } from '../ui/Icons';

interface ManuscriptWorkspaceProps {
  world: World;
  works: Work[];
  entities: Entity[];
  onCreateWork: (title: string) => Promise<void>;
  onCreateChapter: (workId: string, title: string) => Promise<void>;
  onCreateScene: (chapterId: string, data: { title: string; proseText: string; povCharacterId?: string }) => Promise<void>;
  disabled?: boolean | undefined;
}

export function ManuscriptWorkspace({
  world,
  works,
  entities,
  onCreateWork,
  onCreateChapter,
  onCreateScene,
  disabled,
}: ManuscriptWorkspaceProps) {
  const [selectedWorkId, setSelectedWorkId] = useState(works[0]?.id ?? '');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [reviewsBySceneId, setReviewsBySceneId] = useState<Record<string, { loading?: boolean; result?: ContinuityReview }>>({});
  const [workOpen, setWorkOpen] = useState(false);
  const [chapterOpen, setChapterOpen] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [workTitle, setWorkTitle] = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [sceneTitle, setSceneTitle] = useState('');
  const [proseText, setProseText] = useState('');
  const [povCharacterId, setPovCharacterId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedWorkId && works[0]) setSelectedWorkId(works[0].id);
  }, [works, selectedWorkId]);

  useEffect(() => {
    if (!selectedWorkId) {
      setChapters([]);
      setScenes([]);
      return;
    }
    void api.listChapters(world.id, selectedWorkId).then((list) => {
      setChapters(list);
      setSelectedChapterId((current) => current && list.some((chapter) => chapter.id === current) ? current : (list[0]?.id ?? ''));
    }).catch(() => setChapters([]));
  }, [world.id, selectedWorkId, world.revision]);

  useEffect(() => {
    if (!selectedChapterId) {
      setScenes([]);
      return;
    }
    void api.listScenes(world.id, selectedChapterId).then(setScenes).catch(() => setScenes([]));
  }, [world.id, selectedChapterId, world.revision]);

  async function submitWork(e: React.FormEvent) {
    e.preventDefault();
    if (!workTitle.trim()) return;
    setSaving(true);
    try {
      await onCreateWork(workTitle.trim());
      setWorkTitle('');
      setWorkOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function submitChapter(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedWorkId || !chapterTitle.trim()) return;
    setSaving(true);
    try {
      await onCreateChapter(selectedWorkId, chapterTitle.trim());
      setChapterTitle('');
      setChapterOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function submitScene(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedChapterId || !sceneTitle.trim()) return;
    setSaving(true);
    try {
      await onCreateScene(selectedChapterId, {
        title: sceneTitle.trim(),
        proseText,
        ...(povCharacterId ? { povCharacterId } : {}),
      });
      setSceneTitle('');
      setProseText('');
      setSceneOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="panel-card" style={{ padding: '14px 18px', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <IconBook size={16} style={{ color: 'var(--accent)' }} />
              <h2 style={{ fontSize: '15px', fontWeight: 600 }}>作品与场景</h2>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              章节绑定世界时间与 POV 后，可做连续性审查。审查只出问题，不改正史。
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="secondary" size="sm" onClick={() => setWorkOpen(true)} disabled={disabled} icon={<IconPlus size={13} />}>作品</Button>
            <Button variant="secondary" size="sm" onClick={() => setChapterOpen(true)} disabled={disabled || !selectedWorkId} icon={<IconPlus size={13} />}>章节</Button>
            <Button variant="gold" size="sm" onClick={() => setSceneOpen(true)} disabled={disabled || !selectedChapterId} icon={<IconPlus size={13} />}>场景</Button>
          </div>
        </div>
      </div>

      {works.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">还没有作品</div>
          <p className="empty-state-desc">先创建一部小说、剧本或战役，再往里面写章节和场景。</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '220px 220px 1fr', gap: '12px' }}>
          <div className="panel-card" style={{ marginBottom: 0, padding: '12px' }}>
            {works.map((work) => (
              <button key={work.id} className={`btn btn-sm ${selectedWorkId === work.id ? 'btn-secondary' : 'btn-ghost'}`} style={{ width: '100%', marginBottom: '6px', justifyContent: 'flex-start' }} onClick={() => setSelectedWorkId(work.id)}>
                {work.title}
              </button>
            ))}
          </div>
          <div className="panel-card" style={{ marginBottom: 0, padding: '12px' }}>
            {chapters.length === 0 ? <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>无章节</div> : chapters.map((chapter) => (
              <button key={chapter.id} className={`btn btn-sm ${selectedChapterId === chapter.id ? 'btn-secondary' : 'btn-ghost'}`} style={{ width: '100%', marginBottom: '6px', justifyContent: 'flex-start' }} onClick={() => setSelectedChapterId(chapter.id)}>
                {chapter.title}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {scenes.map((scene) => {
              const sceneReview = reviewsBySceneId[scene.id];
              return (
                <div key={scene.id} className="panel-card" style={{ marginBottom: 0, padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <strong>{scene.title || '未命名场景'}</strong>
                    <Badge>{scene.status}</Badge>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px', whiteSpace: 'pre-wrap' }}>{scene.proseText || '（空正文）'}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    style={{ marginTop: '8px' }}
                    loading={Boolean(sceneReview?.loading)}
                    disabled={Boolean(disabled)}
                    onClick={async () => {
                      setReviewsBySceneId((prev) => ({ ...prev, [scene.id]: { loading: true } }));
                      try {
                        const result = await api.reviewSceneContinuity(world.id, scene.id);
                        setReviewsBySceneId((prev) => ({ ...prev, [scene.id]: { loading: false, result } }));
                      } catch {
                        setReviewsBySceneId((prev) => ({ ...prev, [scene.id]: { loading: false } }));
                      }
                    }}
                  >
                    连续性审查
                  </Button>
                  {sceneReview?.result && (
                    <div style={{ marginTop: '10px', padding: '10px', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                        <strong>审查结果：</strong>
                        <span style={{ color: sceneReview.result.pass ? 'var(--color-success, #10b981)' : 'var(--color-danger, #ef4444)', fontWeight: 600 }}>
                          {sceneReview.result.pass ? '✓ 通过' : '✗ 存在冲突/异常'}
                        </span>
                      </div>
                      {sceneReview.result.issues.length === 0 ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>未发现连续性问题</div>
                      ) : (
                        sceneReview.result.issues.map((issue, index) => (
                          <div key={`${issue.code}-${index}`} style={{ fontSize: '12px', marginTop: '6px', color: issue.severity === 'error' ? 'var(--color-danger, #ef4444)' : 'var(--text-secondary)' }}>
                            <span style={{ fontWeight: 600, textTransform: 'uppercase', marginRight: '4px' }}>[{issue.severity}]</span>
                            {issue.message}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Modal isOpen={workOpen} onClose={() => setWorkOpen(false)} title="新建作品">
        <form onSubmit={submitWork} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input className="input" placeholder="作品标题" value={workTitle} onChange={(e) => setWorkTitle(e.target.value)} />
          <Button type="submit" variant="gold" loading={saving} disabled={disabled}>创建</Button>
        </form>
      </Modal>
      <Modal isOpen={chapterOpen} onClose={() => setChapterOpen(false)} title="新建章节">
        <form onSubmit={submitChapter} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input className="input" placeholder="章节标题" value={chapterTitle} onChange={(e) => setChapterTitle(e.target.value)} />
          <Button type="submit" variant="gold" loading={saving} disabled={disabled}>创建</Button>
        </form>
      </Modal>
      <Modal isOpen={sceneOpen} onClose={() => setSceneOpen(false)} title="新建场景">
        <form onSubmit={submitScene} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input className="input" placeholder="场景标题" value={sceneTitle} onChange={(e) => setSceneTitle(e.target.value)} />
          <textarea className="input" rows={6} placeholder="正文" value={proseText} onChange={(e) => setProseText(e.target.value)} />
          <select className="input" value={povCharacterId} onChange={(e) => setPovCharacterId(e.target.value)}>
            <option value="">POV（可选）</option>
            {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
          <Button type="submit" variant="gold" loading={saving} disabled={disabled}>创建</Button>
        </form>
      </Modal>
    </div>
  );
}
