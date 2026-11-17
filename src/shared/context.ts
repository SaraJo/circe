import type { PersonalFact } from './memory';

export interface ContextScope { profileId: string; sessionId: string }
export interface ConversationSource extends ContextScope {
  id: string; turnId: string; role: 'user' | 'assistant'; text: string; createdAt: string;
  memoryKeys?: string[];
  excerptOffset?: number;
}
export interface CheckpointItem { text: string; sourceIds: string[]; userQuoted?: boolean }
export interface CheckpointDraft {
  goal: CheckpointItem | null;
  constraints: CheckpointItem[];
  decisions: CheckpointItem[];
  progress: CheckpointItem[];
  openQuestions: CheckpointItem[];
  nextSteps: CheckpointItem[];
}
export interface TaskCheckpoint extends ContextScope, CheckpointDraft {
  version: number; updatedAt: string;
  memoryKeys?: string[];
}
export interface ContextReceipt extends ContextScope {
  id: string; createdAt: string;
  facts: PersonalFact[];
  checkpoint: TaskCheckpoint | null;
  sources: ConversationSource[];
  toolSources?: ConversationSource[];
  memoryKeys?: string[];
  outcome: 'prepared' | 'completed' | 'failed';
}
export interface PreparedContext { text: string; receipt: ContextReceipt; generation: number; userSourceId: string }
export interface TaskHistoryView {
  sessions: (ContextScope & { title?: string })[];
  checkpoint: TaskCheckpoint | null;
  sources: ConversationSource[];
  receipts: ContextReceipt[];
}
export interface ContextFocus extends ContextScope { sourceId?: string }
export const CHECKPOINT_FIELDS = ['constraints', 'decisions', 'progress', 'openQuestions', 'nextSteps'] as const;
