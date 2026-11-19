export interface MemorySettings {
  enabled: boolean;
  contextEnabled?: boolean;
  telegramEnabled?: boolean;
  extractionModel: string;
  embeddingModel: string;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  contextEnabled: true,
  telegramEnabled: false,
  extractionModel: 'qwen3:4b',
  embeddingModel: 'embeddinggemma',
};

export interface PersonalFact {
  channel?: 'telegram';
  key: string;
  text: string;
  evidence: string;
  profileId: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryView {
  settings: MemorySettings;
  facts: PersonalFact[];
  pending: number;
  error: string | null;
  location: string;
  telegram?: { checkedAt: string | null; error: string | null };
}

export interface MemoryBridge {
  read(): Promise<MemoryView>;
  configure(settings: MemorySettings): Promise<void>;
  check(): Promise<string>;
  forget(key: string): Promise<void>;
  forgetAll(): Promise<void>;
  edit(key: string, text: string): Promise<void>;
  history(profileId: string, sessionId: string, query?: string): Promise<import('./context').TaskHistoryView>;
  source(profileId: string, sourceId: string): Promise<import('./context').ConversationSource | null>;
  forgetTask(profileId: string, sessionId: string): Promise<void>;
  onFocus(cb: (focus: import('./context').ContextFocus) => void): void;
}
