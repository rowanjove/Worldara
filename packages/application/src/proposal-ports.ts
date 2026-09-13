/**
 * Persistence contract for reviewable AI proposals.
 *
 * Proposals are deliberately separate from Canon targets: storing or updating
 * a proposal must never mutate the world revision. The API decides when a
 * pending change is accepted and then calls the Canon application service.
 */
export interface ProposalChangeRecord {
  id: string;
  command: string;
  payload: Record<string, unknown>;
  dependsOn: string[];
  evidenceRefs: string[];
  confidence: number;
  userDecision: 'pending' | 'accepted' | 'rejected';
}

export interface ProposalRecord {
  id: string;
  worldId: string;
  baseRevision: bigint;
  request: string;
  atTick?: bigint;
  status: 'draft' | 'accepted' | 'rejected' | 'stale';
  provider: string;
  model?: string;
  promptVersion?: string;
  contextRefs?: string[];
  changes: ProposalChangeRecord[];
  citations: Record<string, unknown>[];
  unknowns: string[];
  createdAt: string;
}

export interface ProposalRepository {
  createProposal(proposal: ProposalRecord): Promise<ProposalRecord>;
  getProposal(worldId: string, proposalId: string): Promise<ProposalRecord | null>;
  updateProposal(proposal: ProposalRecord): Promise<ProposalRecord>;
}
