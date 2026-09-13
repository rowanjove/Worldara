import React, { useState, useEffect } from 'react';
import type { World } from '../../lib/types';
import {
  getAiConfig,
  saveAiConfig,
  testAiConnection,
  PROVIDER_PRESETS,
  type AiModelConfig,
} from '../../lib/aiSettings';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { IconSettings, IconCheck, IconAlertTriangle } from '../ui/Icons';

interface SettingsWorkspaceProps {
  world?: World | undefined;
  onNotify?: ((msg: string, type: 'success' | 'error' | 'info') => void) | undefined;
}

export function SettingsWorkspace({ world: _world, onNotify }: SettingsWorkspaceProps) {
  const [config, setConfig] = useState<AiModelConfig>(getAiConfig());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    setConfig(getAiConfig());
  }, []);

  function handleProviderChange(provider: AiModelConfig['provider']) {
    const preset = PROVIDER_PRESETS[provider];
    setConfig((prev) => ({
      ...prev,
      provider,
      baseUrl: preset.defaultBaseUrl,
      model: preset.defaultModel,
    }));
    setTestResult(null);
  }

  function handleSave() {
    saveAiConfig(config);
    if (onNotify) {
      onNotify('偏好设置已保存', 'success');
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testAiConnection(config);
      setTestResult({
        success: true,
        message: `连通性测试通过，API 响应正常: "${res.slice(0, 50)}"`,
      });
      if (onNotify) onNotify('API 连通性测试成功', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '连接失败';
      setTestResult({ success: false, message: msg });
      if (onNotify) onNotify(`连通性测试失败: ${msg}`, 'error');
    } finally {
      setTesting(false);
    }
  }

  const currentPreset = PROVIDER_PRESETS[config.provider];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '800px' }}>
      {/* 顶部标题栏 */}
      <div className="panel-card" style={{ padding: '14px 18px', marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <IconSettings size={16} style={{ color: 'var(--text-secondary)' }} />
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
            偏好设置
          </h2>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
          选择构思提案的工作方式，并按需连接你使用的内容服务。
        </p>
      </div>

      {/* 工作流偏好 */}
      <div className="panel-card">
        <h3 className="panel-title">
          <span>构思方式</span>
        </h3>
        <p className="panel-subtitle">设定创作环节中默认启用的交互方式</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
          <div
            className={`item-card ${config.mode === 'offline' ? 'selected' : ''}`}
            onClick={() => setConfig({ ...config, mode: 'offline' })}
            style={{ padding: '12px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                复制创作说明（无需密钥）
              </strong>
              {config.mode === 'offline' && <Badge variant="canon" size="sm">当前偏好</Badge>}
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
              复制包含当前世界资料和格式要求的说明，在其他工具中完成构思后再导入。
            </p>
          </div>

          <div
            className={`item-card ${config.mode === 'direct' ? 'selected' : ''}`}
            onClick={() => setConfig({ ...config, mode: 'direct' })}
            style={{ padding: '12px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                在世界格内生成
              </strong>
              {config.mode === 'direct' && <Badge variant="canon" size="sm">当前偏好</Badge>}
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4', marginTop: '4px' }}>
              连接兼容服务，在当前工作区生成草案；写入前仍由你逐项确认。
            </p>
          </div>
        </div>
      </div>

      {/* 模型接口参数配置 */}
      <div className="panel-card">
        <h3 className="panel-title">
          <span>内容服务连接</span>
        </h3>
        <p className="panel-subtitle">仅在选择“在世界格内生成”时使用</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
          {/* 预设服务商切换 */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              服务商
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {(Object.keys(PROVIDER_PRESETS) as Array<AiModelConfig['provider']>).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`btn btn-sm ${config.provider === p ? 'btn-gold' : 'btn-secondary'}`}
                  onClick={() => handleProviderChange(p)}
                >
                  {PROVIDER_PRESETS[p].name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              服务地址（Base URL）
            </label>
            <input
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder={currentPreset.defaultBaseUrl}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              模型名称
            </label>
            <input
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder={currentPreset.defaultModel}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                访问密钥（API Key）
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ padding: '0 4px', fontSize: '11px' }}
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? '隐藏密钥' : '显示明文'}
              </button>
            </div>
            <input
              type={showKey ? 'text' : 'password'}
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="例如：sk-…（仅保存在浏览器本地 localStorage 中）"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
            />
          </div>

          {/* 测试连通性反馈 */}
          {testResult && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                background: testResult.success ? 'var(--success-subtle)' : 'var(--danger-subtle)',
                border: `1px solid ${testResult.success ? 'var(--success-border)' : 'var(--danger-border)'}`,
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {testResult.success ? (
                <IconCheck size={14} style={{ color: 'var(--success)' }} />
              ) : (
                <IconAlertTriangle size={14} style={{ color: 'var(--danger)' }} />
              )}
              <span style={{ color: testResult.success ? 'var(--success)' : 'var(--danger)' }}>
                {testResult.message}
              </span>
            </div>
          )}

          {/* 操作按钮组 */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
            <Button variant="gold" onClick={handleSave}>
              保存配置
            </Button>
            <Button variant="secondary" onClick={handleTest} loading={testing}>
              测试连通性
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
