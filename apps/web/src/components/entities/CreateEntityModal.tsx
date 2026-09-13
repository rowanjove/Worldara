import React, { useState, useEffect } from 'react';
import type { EntityType, SchemaField, Entity, World } from '../../lib/types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AiAssistantModal } from '../common/AiAssistantModal';
import { IconQuill } from '../ui/Icons';
import { buildEntityPrompt } from '../../lib/promptCompiler';
import { extractEntityFieldsFromJson } from '../../lib/jsonExtractor';

interface CreateEntityModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityTypes: EntityType[];
  allEntities: Entity[];
  onSubmit: (data: { typeId: string; name: string; subtitle: string; document: Record<string, unknown> }) => Promise<void>;
  world?: World | undefined;
  disabled?: boolean | undefined;
}

export function CreateEntityModal({
  isOpen,
  onClose,
  entityTypes,
  allEntities,
  onSubmit,
  world,
  disabled,
}: CreateEntityModalProps) {
  const [typeId, setTypeId] = useState('');
  const [name, setName] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [document, setDocument] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);

  useEffect(() => {
    if (entityTypes.length > 0 && !typeId && entityTypes[0]) {
      setTypeId(entityTypes[0].id);
    }
  }, [entityTypes, typeId]);

  useEffect(() => {
    // 重置文档内容
    setDocument({});
  }, [typeId]);

  const selectedType = entityTypes.find((t) => t.id === typeId);
  const fields: SchemaField[] = Array.isArray(selectedType?.schema?.fields)
    ? selectedType!.schema.fields.filter(
        (f): f is SchemaField => Boolean(f) && typeof f === 'object'
      )
    : [];

  function handleFieldChange(key: string, value: unknown) {
    setDocument((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !typeId) return;
    setSubmitting(true);
    try {
      await onSubmit({
        typeId,
        name: name.trim(),
        subtitle: subtitle.trim(),
        document,
      });
      setName('');
      setSubtitle('');
      setDocument({});
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  function renderField(field: SchemaField) {
    const key = field.key || field.id || '';
    if (!key) return null;
    const label = field.label || key;
    const valueType = (field.value_type || field.type || 'text').toLowerCase();
    const rawValue = document[key];
    const options = Array.isArray(field.validation_json?.options)
      ? (field.validation_json.options as string[])
      : [];

    if (valueType === 'boolean') {
      return (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
          <input
            type="checkbox"
            id={`field-${key}`}
            checked={rawValue === true}
            onChange={(e) => handleFieldChange(key, e.target.checked)}
            style={{ width: 'auto' }}
          />
          <label htmlFor={`field-${key}`} style={{ fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer' }}>
            {label} {field.required && <span style={{ color: 'var(--danger)' }}>*</span>}
          </label>
        </div>
      );
    }

    if (valueType === 'select' && options.length > 0) {
      return (
        <div key={key}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            {label} {field.required && <span style={{ color: 'var(--danger)' }}>*</span>}
          </label>
          <select
            required={field.required}
            value={typeof rawValue === 'string' ? rawValue : ''}
            onChange={(e) => handleFieldChange(key, e.target.value)}
          >
            <option value="">请选择…</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    }

    if (valueType === 'entityreference' || valueType === 'entityreferencelist') {
      const isMulti = valueType === 'entityreferencelist' || field.cardinality === 'many';
      return (
        <div key={key}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            {label} (关联实体) {field.required && <span style={{ color: 'var(--danger)' }}>*</span>}
          </label>
          <select
            required={field.required && !isMulti}
            multiple={isMulti}
            value={
              isMulti
                ? Array.isArray(rawValue)
                  ? (rawValue as string[])
                  : []
                : typeof rawValue === 'string'
                ? rawValue
                : ''
            }
            onChange={(e) => {
              if (isMulti) {
                const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                handleFieldChange(key, selected);
              } else {
                handleFieldChange(key, e.target.value);
              }
            }}
          >
            <option value="">请选择关联实体…</option>
            {allEntities.map((ent) => (
              <option key={ent.id} value={ent.id}>{ent.name}</option>
            ))}
          </select>
        </div>
      );
    }

    if (valueType === 'longtext' || valueType === 'richtext') {
      return (
        <div key={key}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            {label} {field.required && <span style={{ color: 'var(--danger)' }}>*</span>}
          </label>
          <textarea
            required={field.required}
            value={typeof rawValue === 'string' ? rawValue : ''}
            onChange={(e) => handleFieldChange(key, e.target.value)}
            rows={3}
            placeholder={field.description || `输入 ${label} 详细内容…`}
          />
        </div>
      );
    }

    return (
      <div key={key}>
        <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
          {label} {field.required && <span style={{ color: 'var(--danger)' }}>*</span>}
        </label>
        <input
          required={field.required}
          type={valueType === 'number' ? 'number' : 'text'}
          value={rawValue === undefined || rawValue === null ? '' : String(rawValue)}
          onChange={(e) => {
            const val = valueType === 'number'
              ? e.target.value === '' ? undefined : Number(e.target.value)
              : e.target.value;
            handleFieldChange(key, val);
          }}
          placeholder={field.description || `输入 ${label}…`}
        />
      </div>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="录入新实体"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button variant="gold" size="sm" onClick={handleSubmit} loading={submitting} disabled={disabled || !typeId}>
            创建实体档案
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {world && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<IconQuill size={13} style={{ color: 'var(--canon-gold)' }} />}
              onClick={() => setAiModalOpen(true)}
            >
              帮我补全档案
            </Button>
          </div>
        )}

        <div>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            实体所属类型 (Type)
          </label>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {entityTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} ({t.typeKey}) · v{t.schemaVersion}
              </option>
            ))}
          </select>
          {entityTypes.length === 0 && (
            <p style={{ fontSize: '11px', color: 'var(--warning)', marginTop: '4px' }}>
              当前世界尚无自定义类型，可在「Schema 与规则」中创建。
            </p>
          )}
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            实体主名称 (Entity Name) <span style={{ color: 'var(--danger)' }}>*</span>
          </label>
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：亚瑟·潘德拉贡、霜火要塞、暗月教团…"
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            副标题 / 头衔 (Subtitle / Title)
          </label>
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="例如：圆桌骑士领袖、北境古老要塞…"
          />
        </div>

        {fields.length > 0 && (
          <div style={{ marginTop: '8px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: '10px', letterSpacing: '0.05em' }}>
              动态属性字段 (Schema Fields)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {fields.map(renderField)}
            </div>
          </div>
        )}
      </form>

      {world && (
        <AiAssistantModal
          isOpen={aiModalOpen}
          onClose={() => setAiModalOpen(false)}
          title={`补全实体档案 · ${selectedType?.label || '通用'}`}
          description="会参考当前世界题材、实体类型和已有字段生成一份可编辑草案。"
          promptCompiler={(instr) =>
            buildEntityPrompt({
              world,
              entityType: selectedType,
              userPrompt: instr,
            })
          }
          onApplyResult={(rawText) => {
            const extracted = extractEntityFieldsFromJson(rawText);
            if (extracted.name) setName(extracted.name);
            if (extracted.subtitle) setSubtitle(extracted.subtitle);
            if (extracted.document && Object.keys(extracted.document).length > 0) {
              setDocument((prev) => ({ ...prev, ...extracted.document }));
            }
          }}
        />
      )}
    </Modal>
  );
}
