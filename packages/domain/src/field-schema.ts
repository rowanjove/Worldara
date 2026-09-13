import { DomainError } from './types';

export const FIELD_VALUE_TYPES = [
  'Text', 'LongText', 'Number', 'Boolean', 'Date', 'WorldDate', 'Select', 'MultiSelect',
  'EntityReference', 'EntityReferenceList', 'Location', 'Coordinate', 'Image', 'URL', 'RichText', 'JSON', 'Formula',
] as const;

export type FieldValueType = typeof FIELD_VALUE_TYPES[number];
export type FieldCardinality = 'one' | 'many';
export type FieldStorageMode = 'fact' | 'relation' | 'computed';

export interface FieldSchema {
  key: string;
  label: string;
  value_type: FieldValueType;
  required: boolean;
  cardinality: FieldCardinality;
  temporal: boolean;
  storage_mode: FieldStorageMode;
  validation_json?: Record<string, unknown>;
  visibility_default?: boolean;
  reference_type_ids: string[];
  description: string;
  relation_type_id?: string;
  formula?: string;
}

export interface FieldSchemaIssue {
  path: string;
  message: string;
}

export interface EntityDocumentIssue {
  field: string;
  code: 'required' | 'type' | 'cardinality' | 'reference' | 'computed' | 'validation';
  message: string;
  relatedIds: string[];
}

const aliases: Record<string, FieldValueType> = {
  text: 'Text', textarea: 'LongText', longtext: 'LongText', number: 'Number', boolean: 'Boolean', bool: 'Boolean',
  date: 'Date', worlddate: 'WorldDate', select: 'Select', multiselect: 'MultiSelect',
  entityreference: 'EntityReference', reference: 'EntityReference', entityreferencelist: 'EntityReferenceList',
  location: 'Location', coordinate: 'Coordinate', image: 'Image', url: 'URL', richtext: 'RichText', json: 'JSON', formula: 'Formula',
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function normalizedValueType(value: unknown): FieldValueType | undefined {
  if (!isNonEmptyString(value)) return undefined;
  const canonical = FIELD_VALUE_TYPES.find((item) => item === value);
  return canonical ?? aliases[value.trim().toLocaleLowerCase()];
}

function normalizeField(raw: Record<string, unknown>, index: number, issues: FieldSchemaIssue[]): FieldSchema | null {
  const path = `fields[${index}]`;
  const key = typeof raw.key === 'string' ? raw.key.trim() : typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(key)) issues.push({ path: `${path}.key`, message: 'key must match /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/' });
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : key;
  if (!label) issues.push({ path: `${path}.label`, message: 'label is required' });
  const valueType = normalizedValueType(raw.value_type ?? raw.type);
  if (!valueType) issues.push({ path: `${path}.value_type`, message: `unsupported value type; expected one of ${FIELD_VALUE_TYPES.join(', ')}` });
  const cardinality = raw.cardinality === undefined ? (valueType === 'MultiSelect' || valueType === 'EntityReferenceList' ? 'many' : 'one') : raw.cardinality;
  if (cardinality !== 'one' && cardinality !== 'many') issues.push({ path: `${path}.cardinality`, message: 'cardinality must be one or many' });
  if ((valueType === 'MultiSelect' || valueType === 'EntityReferenceList') && cardinality !== 'many') issues.push({ path: `${path}.cardinality`, message: `${valueType} fields must use many cardinality` });
  const storageMode = raw.storage_mode === undefined ? (valueType === 'Formula' ? 'computed' : 'fact') : raw.storage_mode;
  if (storageMode !== 'fact' && storageMode !== 'relation' && storageMode !== 'computed') issues.push({ path: `${path}.storage_mode`, message: 'storage_mode must be fact, relation, or computed' });
  if (raw.required !== undefined && typeof raw.required !== 'boolean') issues.push({ path: `${path}.required`, message: 'required must be boolean' });
  if (raw.temporal !== undefined && typeof raw.temporal !== 'boolean') issues.push({ path: `${path}.temporal`, message: 'temporal must be boolean' });
  if (raw.visibility_default !== undefined && typeof raw.visibility_default !== 'boolean') issues.push({ path: `${path}.visibility_default`, message: 'visibility_default must be boolean' });
  const referenceTypeIds = raw.reference_type_ids === undefined ? [] : raw.reference_type_ids;
  if (!Array.isArray(referenceTypeIds) || referenceTypeIds.some((item) => !isNonEmptyString(item))) issues.push({ path: `${path}.reference_type_ids`, message: 'reference_type_ids must be an array of strings' });
  const validation = raw.validation_json === undefined ? undefined : raw.validation_json;
  if (validation !== undefined && !isRecord(validation)) issues.push({ path: `${path}.validation_json`, message: 'validation_json must be an object' });
  if (valueType === 'Formula' && storageMode !== 'computed') issues.push({ path: `${path}.storage_mode`, message: 'Formula fields must use computed storage_mode' });
  const formula = raw.formula ?? (isRecord(validation) ? validation.expression : undefined);
  if (valueType === 'Formula' && (!isNonEmptyString(formula) || /[;{}<>=[\]`]/.test(formula))) issues.push({ path: `${path}.formula`, message: 'Formula fields require a restricted expression without statement/control syntax' });
  if (storageMode === 'relation' && !isNonEmptyString(raw.relation_type_id)) issues.push({ path: `${path}.relation_type_id`, message: 'relation fields must declare relation_type_id' });
  if ((valueType === 'Select' || valueType === 'MultiSelect') && isRecord(validation) && (!Array.isArray(validation.options) || validation.options.some((item) => !isNonEmptyString(item)))) issues.push({ path: `${path}.validation_json.options`, message: 'Select fields require string validation_json.options' });
  if (isRecord(validation) && validation.min !== undefined && (typeof validation.min !== 'number' || !Number.isFinite(validation.min))) issues.push({ path: `${path}.validation_json.min`, message: 'min must be a finite number' });
  if (isRecord(validation) && validation.max !== undefined && (typeof validation.max !== 'number' || !Number.isFinite(validation.max))) issues.push({ path: `${path}.validation_json.max`, message: 'max must be a finite number' });
  if (isRecord(validation) && typeof validation.pattern !== 'undefined' && typeof validation.pattern !== 'string') issues.push({ path: `${path}.validation_json.pattern`, message: 'pattern must be a string' });
  if (isRecord(validation) && typeof validation.pattern === 'string' && validation.pattern.length > 500) issues.push({ path: `${path}.validation_json.pattern`, message: 'pattern cannot exceed 500 characters' });
  if (!valueType || !cardinality || !storageMode || !key) return null;
  return {
    key,
    label,
    value_type: valueType,
    required: raw.required === true,
    cardinality: cardinality as FieldCardinality,
    temporal: raw.temporal === true,
    storage_mode: storageMode as FieldStorageMode,
    ...(isRecord(validation) ? { validation_json: validation } : {}),
    ...(typeof raw.visibility_default === 'boolean' ? { visibility_default: raw.visibility_default } : {}),
    reference_type_ids: Array.isArray(referenceTypeIds) ? referenceTypeIds.filter(isNonEmptyString).map((item) => item.trim()) : [],
    description: typeof raw.description === 'string' ? raw.description : '',
    ...(isNonEmptyString(raw.relation_type_id) ? { relation_type_id: raw.relation_type_id.trim() } : {}),
    ...(isNonEmptyString(formula) ? { formula: formula.trim() } : {}),
  };
}

export function parseFieldSchema(schema: Record<string, unknown>): { fields: FieldSchema[]; issues: FieldSchemaIssue[] } {
  const issues: FieldSchemaIssue[] = [];
  const required = schema.required;
  if (required !== undefined && (!Array.isArray(required) || required.some((item) => !isNonEmptyString(item)))) issues.push({ path: 'required', message: 'required must be an array of strings' });
  const rawFields = schema.fields;
  if (rawFields === undefined) {
    return { fields: [], issues };
  }
  if (!Array.isArray(rawFields)) return { fields: [], issues: [{ path: 'fields', message: 'fields must be an array' }] };
  if (rawFields.length > 500) issues.push({ path: 'fields', message: 'fields cannot contain more than 500 entries' });
  const keys = new Set<string>();
  const fields: FieldSchema[] = [];
  rawFields.forEach((raw, index) => {
    if (!isRecord(raw)) { issues.push({ path: `fields[${index}]`, message: 'field must be an object' }); return; }
    const field = normalizeField(raw, index, issues);
    if (!field) return;
    if (keys.has(field.key)) issues.push({ path: `fields[${index}].key`, message: `duplicate field key ${field.key}` });
    keys.add(field.key);
    fields.push(field);
  });
  return { fields, issues };
}

export function assertValidFieldSchema(schema: Record<string, unknown>): FieldSchema[] {
  const parsed = parseFieldSchema(schema);
  if (parsed.issues.length) throw new DomainError('VALIDATION_ERROR', 'Entity type schema is invalid', { issues: parsed.issues });
  return parsed.fields;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function matchesType(field: FieldSchema, value: unknown): boolean {
  switch (field.value_type) {
    case 'Text': case 'LongText': case 'Date': case 'WorldDate': case 'Image': case 'URL': case 'RichText': case 'Select': return typeof value === 'string';
    case 'Number': return typeof value === 'number' && Number.isFinite(value);
    case 'Boolean': return typeof value === 'boolean';
    case 'MultiSelect': case 'EntityReferenceList': return Array.isArray(value);
    case 'EntityReference': return typeof value === 'string';
    case 'Coordinate': return (Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) || (isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y));
    case 'Location': return typeof value === 'string' || isRecord(value);
    case 'JSON': return true;
    case 'Formula': return false;
    default: return false;
  }
}

export function validateEntityDocument(schema: Record<string, unknown>, document: Record<string, unknown>, entityIds?: ReadonlySet<string>, entityTypeById?: ReadonlyMap<string, string>): EntityDocumentIssue[] {
  const { fields } = parseFieldSchema(schema);
  const issues: EntityDocumentIssue[] = [];
  const fieldKeys = new Set(fields.map((field) => field.key));
  const topLevelRequired = new Set(Array.isArray(schema.required) ? schema.required.filter((required): required is string => typeof required === 'string') : []);
  for (const required of topLevelRequired) {
    if (!fieldKeys.has(required) && isEmpty(document[required])) issues.push({ field: required, code: 'required', message: `Required field ${required} is missing`, relatedIds: [] });
  }
  for (const field of fields) {
    const value = document[field.key];
    if (isEmpty(value)) {
      if (field.required || topLevelRequired.has(field.key)) issues.push({ field: field.key, code: 'required', message: `Required field ${field.key} is missing`, relatedIds: [] });
      continue;
    }
    if (field.storage_mode === 'computed' || field.value_type === 'Formula') { issues.push({ field: field.key, code: 'computed', message: `Computed field ${field.key} is read-only`, relatedIds: [] }); continue; }
    const collectionType = field.value_type === 'MultiSelect' || field.value_type === 'EntityReferenceList';
    if (field.cardinality === 'many' && !Array.isArray(value)) { issues.push({ field: field.key, code: 'cardinality', message: `Field ${field.key} must contain a list`, relatedIds: [] }); continue; }
    if (field.cardinality === 'one' && Array.isArray(value)) { issues.push({ field: field.key, code: 'cardinality', message: `Field ${field.key} must contain a single value`, relatedIds: [] }); continue; }
    const values = field.cardinality === 'many' ? value as unknown[] : [value];
    if (collectionType) {
      if (!Array.isArray(value) || values.some((item) => typeof item !== 'string')) issues.push({ field: field.key, code: 'type', message: `Field ${field.key} must contain a list of strings`, relatedIds: [] });
    } else {
      for (const item of values) if (!matchesType(field, item)) issues.push({ field: field.key, code: 'type', message: `Field ${field.key} has an invalid ${field.value_type} value`, relatedIds: [] });
    }
    const validation = field.validation_json;
    if (isRecord(validation)) {
      const options = Array.isArray(validation.options) ? validation.options : undefined;
      const min = typeof validation.min === 'number' ? validation.min : undefined;
      const max = typeof validation.max === 'number' ? validation.max : undefined;
      if (options && values.some((item) => typeof item === 'string' && !options.includes(item))) issues.push({ field: field.key, code: 'validation', message: `Field ${field.key} contains a value outside its options`, relatedIds: [] });
      if (min !== undefined && values.some((item) => typeof item === 'number' && item < min)) issues.push({ field: field.key, code: 'validation', message: `Field ${field.key} is below its minimum`, relatedIds: [] });
      if (max !== undefined && values.some((item) => typeof item === 'number' && item > max)) issues.push({ field: field.key, code: 'validation', message: `Field ${field.key} exceeds its maximum`, relatedIds: [] });
      if (typeof validation.pattern === 'string') {
        let pattern: RegExp | undefined;
        try { pattern = new RegExp(validation.pattern); } catch { issues.push({ field: field.key, code: 'validation', message: `Field ${field.key} has an invalid pattern`, relatedIds: [] }); }
        if (pattern && values.some((item) => typeof item === 'string' && !pattern!.test(item))) issues.push({ field: field.key, code: 'validation', message: `Field ${field.key} does not match its pattern`, relatedIds: [] });
      }
    }
    if (entityIds && (field.value_type === 'EntityReference' || field.value_type === 'EntityReferenceList')) {
      const references = values.flatMap((item) => Array.isArray(item) ? item : [item]).filter((item): item is string => typeof item === 'string');
      const missing = references.filter((item) => !entityIds.has(item));
      if (missing.length) issues.push({ field: field.key, code: 'reference', message: `Field ${field.key} references an entity outside this world`, relatedIds: missing });
      if (entityTypeById && field.reference_type_ids.length) {
        const wrongType = references.filter((item) => entityIds.has(item) && !field.reference_type_ids.includes(entityTypeById.get(item) ?? ''));
        if (wrongType.length) issues.push({ field: field.key, code: 'reference', message: `Field ${field.key} references an entity of an unsupported type`, relatedIds: wrongType });
      }
    }
  }
  return issues;
}
