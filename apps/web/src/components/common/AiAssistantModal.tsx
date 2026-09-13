import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { callDirectAiApi, getAiConfig } from '../../lib/aiSettings';
import {
  IconQuill,
  IconCopy,
  IconCheck,
  IconTerminal,
  IconAlertTriangle,
  IconDiff,
} from '../ui/Icons';

interface AiAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /**
   * 用于复制给外部 AI 的提示词编译器函数，传入用户输入补充词
   */
  promptCompiler: (userInstruction: string) => string;
  /**
   * 用户粘贴外部 AI 回复或直接生成后的解析回调
   */
  onApplyResult: (rawAiText: string) => Promise<void> | void;
}

export function AiAssistantModal({
  isOpen,
  onClose,
  title,
  description,
  promptCompiler,
  onApplyResult,
}: AiAssistantModalProps) {
  const [instruction, setInstruction] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [directLoading, setDirectLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  const config = getAiConfig();

  // 复制 Prompt 到剪贴板
  async function handleCopyPrompt() {
    const fullPrompt = promptCompiler(instruction.trim());
    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setError('无法访问剪贴板，请手动复制');
    }
  }

  // 粘贴外部结果并应用
  async function handleApplyPasted() {
    if (!pasteContent.trim()) {
      setError('请先输入或粘贴外部模型的生成内容');
      return;
    }
    setApplying(true);
    setError('');
    try {
      await onApplyResult(pasteContent.trim());
      setPasteContent('');
      setInstruction('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析应用失败，请检查数据格式');
    } finally {
      setApplying(false);
    }
  }

  // 直接在线 API 生成
  async function handleDirectGenerate() {
    setDirectLoading(true);
    setError('');
    try {
      const fullPrompt = promptCompiler(instruction.trim());
      const reply = await callDirectAiApi(
        'You are a careful Worldara worldbuilding editor. Return only the requested JSON structure for author review.',
        fullPrompt
      );
      await onApplyResult(reply);
      setInstruction('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '内容生成失败，可改用复制说明的方式');
    } finally {
      setDirectLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="640px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            内容服务：{config.provider} · {config.model}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {description && (
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            {description}
          </p>
        )}

        {/* 补充指示输入 */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            补充要求（可选）
          </label>
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="例如：设定宿命论色彩、专精霜冻元素、隶属北方边境守誓骑士团…"
            style={{ fontSize: '13px' }}
          />
        </div>

        {/* 双流动作区分割卡片 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '4px' }}>
          {/* 通道一：离线复制与回流 */}
          <div
            style={{
              padding: '14px',
              background: 'var(--bg-surface-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <IconTerminal size={14} style={{ color: 'var(--text-secondary)' }} />
                <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>复制创作说明</strong>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                带上当前世界资料与返回格式，方便在你常用的内容工具中继续构思。
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={copied ? <IconCheck size={13} style={{ color: 'var(--success)' }} /> : <IconCopy size={13} />}
              onClick={handleCopyPrompt}
              style={{ width: '100%' }}
            >
              {copied ? '创作说明已复制' : '复制创作说明'}
            </Button>
          </div>

          {/* 通道二：在线 API 一键生成 */}
          <div
            style={{
              padding: '14px',
              background: 'var(--bg-surface-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <IconQuill size={14} style={{ color: 'var(--canon-gold)' }} />
                <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>在这里生成草案</strong>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                使用已配置的内容服务生成草案，结果仍需由你确认后才会写入。
              </p>
            </div>
            <Button
              variant="gold"
              size="sm"
              icon={<IconQuill size={13} />}
              onClick={handleDirectGenerate}
              loading={directLoading}
              style={{ width: '100%' }}
            >
              生成可审阅草案
            </Button>
          </div>
        </div>

        {/* 粘贴回流解析输入区 */}
        <div style={{ marginTop: '6px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            导入已有草案
          </label>
          <textarea
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            rows={4}
            placeholder="粘贴结构化内容或包含 JSON 的文本…"
            style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button
              variant="gold"
              size="sm"
              icon={<IconDiff size={13} />}
              onClick={handleApplyPasted}
              loading={applying}
              disabled={!pasteContent.trim()}
            >
              检查并填入
            </Button>
          </div>
        </div>

        {error && (
          <div style={{
            color: 'var(--danger)',
            fontSize: '12px',
            background: 'var(--danger-subtle)',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid rgba(244,63,94,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <IconAlertTriangle size={14} />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
