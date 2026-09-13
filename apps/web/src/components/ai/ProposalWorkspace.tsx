import React, { useState } from 'react';
import type {
  World,
  Entity,
  Relation,
  RelationType,
  Proposal,
  ProposalChange,
  ValidationIssue,
} from '../../lib/types';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { api } from '../../lib/api';
import { buildProposalPrompt } from '../../lib/promptCompiler';
import { extractJsonFromText, normalizeProposalFromJson } from '../../lib/jsonExtractor';
import { getAiConfig } from '../../lib/aiSettings';
import {
  IconQuill,
  IconCopy,
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconDiff,
  IconTerminal,
} from '../ui/Icons';

interface ProposalWorkspaceProps {
  world: World;
  entities: Entity[];
  relations: Relation[];
  relationTypes: RelationType[];
  cursorTick: string;
  proposal: Proposal | null;
  onCreateProposal: (prompt: string) => Promise<void>;
  onSubmitOfflineProposal: (request: string, changes: ProposalChange[]) => Promise<void>;
  onAcceptProposal: (proposalId: string, changeIds: string[]) => Promise<void>;
  onRejectProposal: (proposalId: string) => Promise<void>;
  disabled?: boolean | undefined;
}

export function ProposalWorkspace({
  world,
  entities,
  relations,
  relationTypes,
  cursorTick,
  proposal,
  onCreateProposal,
  onSubmitOfflineProposal,
  onAcceptProposal,
  onRejectProposal,
  disabled,
}: ProposalWorkspaceProps) {
  const [activeMode, setActiveMode] = useState<'offline' | 'direct'>(
    getAiConfig().mode || 'offline'
  );

  // 输入状态
  const [requestPrompt, setRequestPrompt] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 审查状态
  const [selectedChangeIds, setSelectedChangeIds] = useState<string[]>([]);
  const [proposalIssues, setProposalIssues] = useState<ValidationIssue[]>([]);
  const [validating, setValidating] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // 当 proposal 更新时，默认全选 pending 状态的变更
  React.useEffect(() => {
    if (proposal) {
      setSelectedChangeIds(
        proposal.changes.filter((c) => c.userDecision === 'pending').map((c) => c.id)
      );
      setProposalIssues([]);
      setErrorMsg('');
    }
  }, [proposal]);

  // 复制带世界上下文与格式契约的推演 Prompt
  async function handleCopyPrompt() {
    if (!requestPrompt.trim()) {
      setErrorMsg('请先在输入框中填写推演构想');
      return;
    }
    setErrorMsg('');
    const fullPrompt = buildProposalPrompt({
      world,
      request: requestPrompt.trim(),
      entities,
      relations,
      relationTypes,
      cursorTick,
    });

    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setErrorMsg('无法访问系统剪贴板，请手动复制');
    }
  }

  // 解析粘贴的外部内容并创建 Proposal
  async function handleParseAndImport() {
    if (!pasteContent.trim()) {
      setErrorMsg('请先粘贴外部模型输出的内容');
      return;
    }
    setParsing(true);
    setErrorMsg('');
    try {
      const parsedJson = extractJsonFromText(pasteContent.trim());
      const { changes } = normalizeProposalFromJson(parsedJson);

      await onSubmitOfflineProposal(
        requestPrompt.trim() || '外部推演离线变更集',
        changes
      );
      setPasteContent('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '解析失败，请检查是否包含合法的 JSON 变更结构');
    } finally {
      setParsing(false);
    }
  }

  // 直接在线 API 生成
  async function handleDirectGenerate(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!requestPrompt.trim()) return;
    setGenerating(true);
    setErrorMsg('');
    try {
      await onCreateProposal(requestPrompt.trim());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '推演请求失败');
    } finally {
      setGenerating(false);
    }
  }

  async function handleValidate() {
    if (!proposal) return;
    setValidating(true);
    try {
      const issues = await api.validateProposal(world.id, proposal.id);
      setProposalIssues(issues);
    } catch {
      // ignore
    } finally {
      setValidating(false);
    }
  }

  async function handleAccept() {
    if (!proposal || selectedChangeIds.length === 0) return;
    setActionLoading(true);
    try {
      await onAcceptProposal(proposal.id, selectedChangeIds);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!proposal) return;
    setActionLoading(true);
    try {
      await onRejectProposal(proposal.id);
    } finally {
      setActionLoading(false);
    }
  }

  const promptPresets = [
    '推演北境三个反抗教团与帝国要塞的十年冲突战史',
    '设计 3 个相互制约的地下商会派系及其核心头领人物',
    '构建位于黑曜群岛的远古星象要塞及其防御机制',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 顶部标题与架构原则 */}
      <div className="panel-card" style={{ padding: '16px 18px', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <IconQuill size={16} style={{ color: 'var(--canon-gold)' }} />
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                构思提案
              </h2>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              新内容会先成为草案。你可以逐项核对、校验和取舍，确认后才会写入当前世界。
            </p>
          </div>

          {/* 工作流模式切换 */}
          <div style={{ display: 'flex', background: 'var(--bg-app)', padding: '2px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <button
              className={`btn btn-sm ${activeMode === 'offline' ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => setActiveMode('offline')}
            >
              复制创作说明
            </button>
            <button
              className={`btn btn-sm ${activeMode === 'direct' ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => setActiveMode('direct')}
            >
              直接生成草案
            </button>
          </div>
        </div>

        {/* 创作者推演需求输入 */}
        <div style={{ marginTop: '14px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            你想补充什么？
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={requestPrompt}
              onChange={(e) => setRequestPrompt(e.target.value)}
              placeholder="描述需要推演补充的世界设定，例如：推演北境教团的起源、关键领袖及盟友关系…"
              disabled={generating || disabled}
              style={{ flex: 1, fontSize: '12px', padding: '7px 10px' }}
            />
            {activeMode === 'direct' ? (
              <Button
                variant="gold"
                onClick={handleDirectGenerate}
                loading={generating}
                disabled={disabled || !requestPrompt.trim()}
                icon={<IconTerminal size={13} />}
              >
                发起推演
              </Button>
            ) : (
              <Button
                variant="gold"
                onClick={handleCopyPrompt}
                disabled={disabled || !requestPrompt.trim()}
                icon={copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
              >
                {copied ? '创作说明已复制' : '复制创作说明'}
              </Button>
            )}
          </div>

          {/* 预设灵感按钮 */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              试试这些：
            </span>
            {promptPresets.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '11px', padding: '2px 6px', border: '1px solid var(--border-subtle)' }}
                onClick={() => setRequestPrompt(preset)}
                disabled={generating || disabled}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* 离线结果粘贴回流面板 */}
        {activeMode === 'offline' && (
          <div
            style={{
              marginTop: '14px',
              padding: '12px',
              background: 'var(--bg-surface-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                导入外部草案
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                支持 JSON 代码块或纯 JSON
              </span>
            </div>
            <textarea
              value={pasteContent}
              onChange={(e) => setPasteContent(e.target.value)}
              rows={3}
              placeholder="粘贴结构化草案，世界格会先将它拆成可审阅的改动…"
              style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleParseAndImport}
                loading={parsing}
                disabled={disabled || !pasteContent.trim()}
                icon={<IconDiff size={13} />}
              >
                解析并载入变更集
              </Button>
            </div>
          </div>
        )}

        {errorMsg && (
          <div
            style={{
              marginTop: '10px',
              padding: '8px 12px',
              background: 'var(--danger-subtle)',
              border: '1px solid var(--danger-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--danger)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <IconAlertTriangle size={14} />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* 提案审查区 */}
      {proposal ? (
        <div className="panel-card">
          <div className="panel-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <Badge variant={proposal.status === 'accepted' ? 'canon' : 'pending'}>
                  {proposal.status.toUpperCase()}
                </Badge>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  Provider: {proposal.provider} · Base Rev: {proposal.baseRevision}
                </span>
              </div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {proposal.request}
              </h3>
            </div>

            {proposal.status === 'draft' && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleValidate}
                  loading={validating}
                  icon={<IconAlertTriangle size={12} />}
                >
                  预校验
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleReject}
                  loading={actionLoading}
                  disabled={disabled}
                  icon={<IconX size={12} />}
                >
                  拒绝全部
                </Button>
                <Button
                  variant="gold"
                  size="sm"
                  onClick={handleAccept}
                  loading={actionLoading}
                  disabled={disabled || selectedChangeIds.length === 0}
                  icon={<IconCheck size={12} />}
                >
                  合并选中变更 ({selectedChangeIds.length})
                </Button>
              </div>
            )}
          </div>

          {/* 未知项 Unknowns 提醒 */}
          {proposal.unknowns && proposal.unknowns.length > 0 && (
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--warning-subtle)',
                border: '1px solid var(--warning-border)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '14px',
                fontSize: '12px',
              }}
            >
              <span style={{ color: 'var(--warning)', fontWeight: 600 }}>待核实的模糊设定点:</span>
              <ul style={{ paddingLeft: '16px', marginTop: '4px', color: 'var(--text-secondary)' }}>
                {proposal.unknowns.map((unk, i) => (
                  <li key={i}>{unk}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 模拟校验问题 */}
          {proposalIssues.length > 0 && (
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--danger-subtle)',
                border: '1px solid var(--danger-border)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '14px',
                fontSize: '12px',
              }}
            >
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>预校验发现以下潜在冲突:</span>
              <ul style={{ paddingLeft: '16px', marginTop: '4px', color: 'var(--text-secondary)' }}>
                {proposalIssues.map((iss, i) => (
                  <li key={i}>
                    [{iss.ruleCode}] {iss.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 原子级变更 Diff 卡片列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-tertiary)' }}>
              <span>变更集 ({proposal.changes.length} 项原子操作):</span>
              {proposal.status === 'draft' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: 0 }}
                    onClick={() =>
                      setSelectedChangeIds(
                        proposal.changes.filter((c) => c.userDecision === 'pending').map((c) => c.id)
                      )
                    }
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: 0 }}
                    onClick={() => setSelectedChangeIds([])}
                  >
                    取消全选
                  </button>
                </div>
              )}
            </div>

            {proposal.changes.map((change) => {
              const isChecked = selectedChangeIds.includes(change.id);
              const isPending = change.userDecision === 'pending';

              return (
                <div
                  key={change.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface-elevated)',
                    border: isChecked
                      ? '1px solid var(--border-focus)'
                      : '1px solid var(--border-subtle)',
                    transition: 'border-color 0.12s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {proposal.status === 'draft' && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={!isPending}
                          onChange={(e) =>
                            setSelectedChangeIds((prev) =>
                              e.target.checked ? [...prev, change.id] : prev.filter((id) => id !== change.id)
                            )
                          }
                          style={{ width: 'auto', cursor: 'pointer' }}
                        />
                      )}
                      <strong style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--canon-gold)' }}>
                        {change.command}
                      </strong>
                      <Badge variant="neutral" size="sm">
                        置信度 {(change.confidence * 100).toFixed(0)}%
                      </Badge>
                      <Badge variant={change.userDecision === 'accepted' ? 'canon' : 'draft'} size="sm">
                        {change.userDecision}
                      </Badge>
                    </div>
                  </div>

                  {/* Payload 预览 */}
                  <pre
                    style={{
                      background: 'var(--bg-app)',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '11px',
                      color: '#cbd5e1',
                      overflowX: 'auto',
                      border: '1px solid var(--border-subtle)',
                      lineHeight: '1.4',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {JSON.stringify(change.payload, null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">
            <IconQuill size={28} />
          </div>
          <div className="empty-state-title">暂无待审查的提案变更集</div>
          <p className="empty-state-desc">
            在上方写下构思，生成一份可逐项确认的草案；也可以导入你在其他工具中整理好的内容。
          </p>
        </div>
      )}
    </div>
  );
}
