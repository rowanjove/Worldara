import { describe, expect, it } from 'vitest';
import { DEFAULT_BRANCH_ID, type Fact } from './types';
import { factToStatement, factsTemporallyConflict, isStatementVisible } from './statement';
import { classifyEntityField, temporalIdentityField } from './entity-fields';
import { applySchemaMigrations } from './schema-migration';

const baseFact = (overrides: Partial<Fact>): Fact => ({
  id: 'f1',
  worldId: 'w',
  subjectEntityId: 'e1',
  predicateKey: 'title',
  objectKind: 'scalar',
  value: 'old',
  canonStatus: 'canon',
  sourceKind: 'manual',
  ...overrides,
});

describe('Statement dual-time', () => {
  it('treats superseded and replacement facts as non-conflicting', () => {
    const oldFact = baseFact({ id: 'old', value: 'Arthur', validFromTick: 100n, validToTick: 200n, revisionFrom: 1n, revisionTo: 2n });
    const newFact = baseFact({ id: 'new', value: 'Lancelot', validFromTick: 150n, validToTick: 200n, revisionFrom: 2n, revisionTo: null });
    expect(factsTemporallyConflict(oldFact, newFact)).toBe(false);
    const oldStatement = factToStatement(oldFact);
    expect(isStatementVisible(oldStatement, 160n, 1n, DEFAULT_BRANCH_ID)).toBe(true);
    expect(isStatementVisible(oldStatement, 160n, 2n, DEFAULT_BRANCH_ID)).toBe(false);
  });

  it('still flags same-revision overlapping canon facts', () => {
    const left = baseFact({ id: 'a', validFromTick: 0n, validToTick: 10n, revisionFrom: 1n });
    const right = baseFact({ id: 'b', validFromTick: 5n, validToTick: 15n, revisionFrom: 1n });
    expect(factsTemporallyConflict(left, right)).toBe(true);
  });
});

describe('entity field classification', () => {
  it('marks name and parent as temporal identity', () => {
    expect(classifyEntityField('id')).toBe('identity');
    expect(classifyEntityField('name')).toBe('temporal');
    expect(temporalIdentityField('display_name')).toBe('name');
    expect(temporalIdentityField('parent_entity_id')).toBe('parentEntityId');
  });
});

describe('schema migrations', () => {
  it('renames a field without rewriting historical documents', () => {
    const next = applySchemaMigrations({ fields: [{ key: 'title', label: 'Title', type: 'Text' }] }, [{ op: 'RenameField', from: 'title', to: 'office' }]);
    const fields = next.fields as Array<{ key: string }>;
    expect(fields[0]?.key).toBe('office');
    expect(next.migrations).toEqual([{ op: 'RenameField', from: 'title', to: 'office' }]);
  });

  it('rejects renaming onto an existing key', () => {
    expect(() => applySchemaMigrations(
      { fields: [{ key: 'title', label: 'Title', type: 'Text' }, { key: 'office', label: 'Office', type: 'Text' }] },
      [{ op: 'RenameField', from: 'title', to: 'office' }],
    )).toThrow(/already exists/);
  });
});
