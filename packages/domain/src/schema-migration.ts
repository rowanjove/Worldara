import { DomainError } from './types';
import { FIELD_VALUE_TYPES, parseFieldSchema, type FieldValueType } from './field-schema';

export type SchemaMigrationOp =
  | { op: 'RenameField'; from: string; to: string }
  | { op: 'SetDefault'; field: string; value: unknown }
  | { op: 'MapEnum'; field: string; mapping: Record<string, string> }
  | { op: 'ChangeType'; field: string; value_type: FieldValueType };

export function applySchemaMigrations(schema: Record<string, unknown>, operations: SchemaMigrationOp[]): Record<string, unknown> {
  const parsed = parseFieldSchema(schema);
  if (parsed.issues.length) throw new DomainError('VALIDATION_ERROR', 'Cannot migrate an invalid entity type schema', { issues: parsed.issues });
  const fields = parsed.fields.map((field) => ({ ...field, validation_json: field.validation_json ? { ...field.validation_json } : undefined, reference_type_ids: [...field.reference_type_ids] }));
  const history = Array.isArray(schema.migrations) ? [...schema.migrations] : [];
  for (const operation of operations) {
    if (operation.op === 'RenameField') {
      const field = fields.find((item) => item.key === operation.from);
      if (!field) throw new DomainError('VALIDATION_ERROR', 'RenameField source does not exist', { from: operation.from });
      if (!/^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(operation.to)) throw new DomainError('VALIDATION_ERROR', 'RenameField target key is invalid', { to: operation.to });
      if (fields.some((item) => item.key === operation.to)) throw new DomainError('VALIDATION_ERROR', 'RenameField target already exists', { to: operation.to });
      field.key = operation.to;
    } else if (operation.op === 'SetDefault') {
      const field = fields.find((item) => item.key === operation.field);
      if (!field) throw new DomainError('VALIDATION_ERROR', 'SetDefault field does not exist', { field: operation.field });
      field.validation_json = { ...(field.validation_json ?? {}), default: operation.value };
    } else if (operation.op === 'MapEnum') {
      const field = fields.find((item) => item.key === operation.field);
      if (!field) throw new DomainError('VALIDATION_ERROR', 'MapEnum field does not exist', { field: operation.field });
      const options = field.validation_json?.options;
      if (!Array.isArray(options) || options.some((item) => typeof item !== 'string')) throw new DomainError('VALIDATION_ERROR', 'MapEnum requires string options', { field: operation.field });
      field.validation_json = {
        ...(field.validation_json ?? {}),
        options: options.map((item) => operation.mapping[item] ?? item),
      };
    } else if (operation.op === 'ChangeType') {
      if (!FIELD_VALUE_TYPES.includes(operation.value_type)) throw new DomainError('VALIDATION_ERROR', 'ChangeType value_type is unsupported', { value_type: operation.value_type });
      const field = fields.find((item) => item.key === operation.field);
      if (!field) throw new DomainError('VALIDATION_ERROR', 'ChangeType field does not exist', { field: operation.field });
      field.value_type = operation.value_type;
    }
    history.push(operation);
  }
  return {
    fields: fields.map((field) => ({
      key: field.key,
      label: field.label,
      value_type: field.value_type,
      required: field.required,
      cardinality: field.cardinality,
      temporal: field.temporal,
      storage_mode: field.storage_mode,
      reference_type_ids: field.reference_type_ids,
      description: field.description,
      ...(field.validation_json === undefined ? {} : { validation_json: field.validation_json }),
      ...(field.relation_type_id === undefined ? {} : { relation_type_id: field.relation_type_id }),
      ...(field.formula === undefined ? {} : { formula: field.formula }),
    })),
    migrations: history,
  };
}
