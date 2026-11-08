export interface MemorySettings {
  enabled: boolean;
  extractionModel: string;
  embeddingModel: string;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  extractionModel: 'qwen3:4b',
  embeddingModel: 'embeddinggemma',
};

export interface PersonalFact {
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
}

export interface MemoryBridge {
  read(): Promise<MemoryView>;
  configure(settings: MemorySettings): Promise<void>;
  check(): Promise<string>;
  forget(key: string): Promise<void>;
  forgetAll(): Promise<void>;
  edit(key: string, text: string): Promise<void>;
}
