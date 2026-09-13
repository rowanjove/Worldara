import React, { useState } from 'react';
import type { Claim, Entity, TimelineBranch, World } from '../../lib/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { IconPlus, IconScale } from '../ui/Icons';

interface KnowledgeWorkspaceProps {
  world: World;
  claims: Claim[];
  branches: TimelineBranch[];
  entities: Entity[];
  onCreateClaim: (data: { predicateKey: string; value: string; claimKind: Claim['claimKind']; truthStatus: Claim['truthStatus']; subjectEntityId?: string; assertedByEntityId?: string }) => Promise<void>;
  onCreateBranch: (data: { name: string; status: TimelineBranch['status'] }) => Promise<void>;
  disabled?: boolean | undefined;
}

export function KnowledgeWorkspace({
  claims,
  branches,
  entities,
  onCreateClaim,
  onCreateBranch,
  disabled,
}: KnowledgeWorkspaceProps) {
  const [tab, setTab] = useState<'claims' | 'branches'>('claims');
  const [claimOpen, setClaimOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [predicateKey, setPredicateKey] = useState('');
  const [value, setValue] = useState('');
  const [claimKind, setClaimKind] = useState<Claim['claimKind']>('belief');
  const [truthStatus, setTruthStatus] = useState<Claim['truthStatus']>('unknown');
  const [subjectEntityId, setSubjectEntityId] = useState('');
  const [assertedByEntityId, setAssertedByEntityId] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchStatus, setBranchStatus] = useState<TimelineBranch['status']>('sandbox');
  const [saving, setSaving] = useState(false);

  async function submitClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!predicateKey.trim()) return;
    setSaving(true);
    try {
      await onCreateClaim({
        predicateKey: predicateKey.trim(),
        value: value.trim(),
        claimKind,
        truthStatus,
        ...(subjectEntityId ? { subjectEntityId } : {}),
        ...(assertedByEntityId ? { assertedByEntityId } : {}),
      });
      setPredicateKey('');
      setValue('');
      setClaimOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function submitBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!branchName.trim()) return;
    setSaving(true);
    try {
      await onCreateBranch({ name: branchName.trim(), status: branchStatus });
      setBranchName('');
      setBranchOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const entityName = (id?: string) => entities.find((entity) => entity.id === id)?.name ?? id ?? '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="panel-card" style={{ padding: '14px 18px', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <IconScale size={16} style={{ color: 'var(--canon-gold)' }} />
              <h2 style={{ fontSize: '15px', fontWeight: 600 }}>主张与历史分支</h2>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              Claim 记录谁宣称了什么；Branch 与作者 Revision 分开，表示世界内部的另一条历史。
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ display: 'flex', background: 'var(--bg-app)', borderRadius: 'var(--radius-md)', padding: '2px', border: '1px solid var(--border-subtle)' }}>
              <button className={`btn btn-sm ${tab === 'claims' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setTab('claims')}>主张 ({claims.length})</button>
              <button className={`btn btn-sm ${tab === 'branches' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setTab('branches')}>分支 ({branches.length})</button>
            </div>
            {tab === 'claims' ? (
              <Button variant="gold" onClick={() => setClaimOpen(true)} disabled={disabled} icon={<IconPlus size={13} />}>记录主张</Button>
            ) : (
              <Button variant="gold" onClick={() => setBranchOpen(true)} disabled={disabled} icon={<IconPlus size={13} />}>分叉时间线</Button>
            )}
          </div>
        </div>
      </div>

      {tab === 'claims' ? (
        claims.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">尚无主张</div>
            <p className="empty-state-desc">主张不是正史事实。它可以是官方记录、谣言、秘密或作者未决事项。</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {claims.map((claim) => (
              <div key={claim.id} className="panel-card" style={{ marginBottom: 0, padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <strong>{claim.predicateKey}</strong>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{String(claim.value ?? '')}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '6px' }}>
                      主体 {entityName(claim.subjectEntityId)} · 宣称者 {entityName(claim.assertedByEntityId)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <Badge>{claim.claimKind}</Badge>
                    <Badge>{claim.truthStatus}</Badge>
                    <Badge>{claim.canonStatus}</Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {branches.map((branch) => (
            <div key={branch.id} className="panel-card" style={{ marginBottom: 0, padding: '14px', display: 'flex', justifyContent: 'space-between' }}>
              <strong>{branch.name}</strong>
              <Badge>{branch.status}</Badge>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={claimOpen} onClose={() => setClaimOpen(false)} title="记录主张">
        <form onSubmit={submitClaim} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input className="input" placeholder="谓词，例如 death_cause" value={predicateKey} onChange={(e) => setPredicateKey(e.target.value)} />
          <input className="input" placeholder="宣称内容" value={value} onChange={(e) => setValue(e.target.value)} />
          <select className="input" value={claimKind} onChange={(e) => setClaimKind(e.target.value as Claim['claimKind'])}>
            <option value="belief">belief</option>
            <option value="rumor">rumor</option>
            <option value="official_record">official_record</option>
            <option value="secret">secret</option>
            <option value="hypothesis">hypothesis</option>
          </select>
          <select className="input" value={truthStatus} onChange={(e) => setTruthStatus(e.target.value as Claim['truthStatus'])}>
            <option value="unknown">unknown</option>
            <option value="true">true</option>
            <option value="false">false</option>
            <option value="disputed">disputed</option>
            <option value="author_undecided">author_undecided</option>
          </select>
          <select className="input" value={subjectEntityId} onChange={(e) => setSubjectEntityId(e.target.value)}>
            <option value="">主体实体（可选）</option>
            {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
          <select className="input" value={assertedByEntityId} onChange={(e) => setAssertedByEntityId(e.target.value)}>
            <option value="">宣称者（可选）</option>
            {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
          <Button type="submit" variant="gold" loading={saving} disabled={disabled}>保存主张</Button>
        </form>
      </Modal>

      <Modal isOpen={branchOpen} onClose={() => setBranchOpen(false)} title="分叉时间线">
        <form onSubmit={submitBranch} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input className="input" placeholder="分支名称" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
          <select className="input" value={branchStatus} onChange={(e) => setBranchStatus(e.target.value as TimelineBranch['status'])}>
            <option value="sandbox">sandbox</option>
            <option value="alternate">alternate</option>
          </select>
          <Button type="submit" variant="gold" loading={saving} disabled={disabled}>创建分支</Button>
        </form>
      </Modal>
    </div>
  );
}
