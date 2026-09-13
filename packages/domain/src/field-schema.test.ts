import { describe, expect, it } from 'vitest';
import { assertValidFieldSchema, parseFieldSchema, validateEntityDocument } from './field-schema';

describe('FieldSchema', () => {
  it('normalizes the PRD schema and accepts the UI id/type shorthand', () => {
    const parsed = parseFieldSchema({ fields: [
      { key: 'age', label: 'Age', value_type: 'Number', required: true, validation_json: { min: 0 } },
      { id: 'role', label: 'Role', type: 'select', validation_json: { options: ['hero', 'villain'] } },
    ] });
    expect(parsed.issues).toEqual([]);
    expect(parsed.fields.map((field) => field.key)).toEqual(['age', 'role']);
    expect(parsed.fields[1]?.value_type).toBe('Select');
  });

  it('rejects duplicate keys and invalid relation/computed declarations', () => {
    expect(() => assertValidFieldSchema({ fields: [
      { key: 'same', label: 'One', value_type: 'Text' },
      { key: 'same', label: 'Two', value_type: 'Formula', storage_mode: 'fact' },
    ] })).toThrow('schema is invalid');
  });

  it('rejects collection fields with scalar cardinality and oversized patterns', () => {
    const parsed = parseFieldSchema({ fields: [
      { key: 'tags', label: 'Tags', value_type: 'MultiSelect', cardinality: 'one' },
      { key: 'code', label: 'Code', value_type: 'Text', validation_json: { pattern: 'x'.repeat(501) } },
    ] });
    expect(parsed.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'fields[0].cardinality',
      'fields[1].validation_json.pattern',
    ]));
  });

  it('validates required, typed, constrained, and referenced document values', () => {
    const schema = { fields: [
      { key: 'age', label: 'Age', value_type: 'Number', required: true, validation_json: { min: 0, max: 120 } },
      { key: 'ally', label: 'Ally', value_type: 'EntityReference', reference_type_ids: ['person'] },
      { key: 'score', label: 'Score', value_type: 'Formula', storage_mode: 'computed', formula: 'age * 2' },
    ] };
    const issues = validateEntityDocument(schema, { age: -1, ally: 'missing', score: 3 }, new Set(['known']), new Map([['known', 'person']]));
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['validation', 'reference', 'computed']));
    expect(validateEntityDocument(schema, { age: 12, ally: 'known' }, new Set(['known']), new Map([['known', 'person']]))).toEqual([]);
  });

  it('enforces top-level required keys even when the field declaration is not marked required', () => {
    const issues = validateEntityDocument({ required: ['name'], fields: [{ key: 'name', label: 'Name', value_type: 'Text' }] }, {});
    expect(issues).toEqual([{ field: 'name', code: 'required', message: 'Required field name is missing', relatedIds: [] }]);
  });
});
