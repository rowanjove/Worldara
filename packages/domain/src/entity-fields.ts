export type EntityFieldKind = 'identity' | 'temporal' | 'derived' | 'presentation';

/** Stable identity stored on the Entity row. */
export const IDENTITY_ENTITY_FIELDS = ['id', 'worldId', 'typeId', 'canonicalKey'] as const;

/** Values that can change with world time and must be Facts for correct snapshots. */
export const TEMPORAL_IDENTITY_PREDICATES: Record<string, 'name' | 'subtitle' | 'parentEntityId'> = {
  name: 'name',
  display_name: 'name',
  subtitle: 'subtitle',
  parent: 'parentEntityId',
  parent_entity_id: 'parentEntityId',
};

export function classifyEntityField(field: string): EntityFieldKind {
  if ((IDENTITY_ENTITY_FIELDS as readonly string[]).includes(field)) return 'identity';
  if (field in TEMPORAL_IDENTITY_PREDICATES) return 'temporal';
  if (field === 'canonStatus' || field === 'revision' || field === 'schemaVersion') return 'derived';
  if (field === 'icon' || field === 'tags' || field === 'document' || field === 'documentText') return 'presentation';
  return 'presentation';
}

export function temporalIdentityField(predicateKey: string): 'name' | 'subtitle' | 'parentEntityId' | undefined {
  return TEMPORAL_IDENTITY_PREDICATES[predicateKey];
}
