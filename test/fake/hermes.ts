import type { HermesProfile } from '../../src/shared/types';
import type { HermesPaths, HermesRuntime } from '../../src/main/hermes/runtime';

/** Hermes's untouched scaffold persona: prose, no heading. */
export const SCAFFOLD_SOUL =
  'You are Hermes, a helpful AI assistant with tool-calling capabilities.\n';

export interface Scenario {
  version: string | null;
  hasProvider: boolean;
  /** Path under the Hermes home -> contents. */
  files: Record<string, string>;
  /** Profile id -> model, for what `hermes profile list` would print. */
  models: Record<string, string>;
  /** Canned replies, matched by substring against the prompt. */
  replies?: Array<{ match: string; reply: string }>;
}

export const FRESH_MACHINE: Scenario = {
  version: null,
  hasProvider: false,
  files: {},
  models: {},
};

export const INSTALLED_EMPTY: Scenario = {
  version: '0.14.0',
  hasProvider: true,
  files: { 'SOUL.md': SCAFFOLD_SOUL },
  models: { default: 'claude-opus-5' },
};

const CREW = ['ford', 'zaphod', 'random', 'prak', 'eddie', 'deep-thought', 'slartibartfast'];

export const INSTALLED_WITH_AGENTS: Scenario = {
  version: '0.14.0',
  hasProvider: true,
  files: {
    'SOUL.md': '# Trillian — Central Coordinator\n\nYou are **Trillian**.\n',
    ...Object.fromEntries(
      CREW.map((id) => [`profiles/${id}/SOUL.md`, `# ${id} — a specialist\n`]),
    ),
  },
  models: Object.fromEntries(['default', ...CREW].map((id) => [id, 'claude-opus-5'])),
};

export class FakeHermes implements HermesRuntime {
  readonly files: Map<string, string>;
  /** Every query the code under test made, for assertions. */
  readonly queries: Array<{ profileId: string; prompt: string }> = [];
  /** Binary files, kept apart from `files` so a text read of a PNG cannot half-work. */
  readonly bytes = new Map<string, Uint8Array>();

  private homeWatchers = new Set<(relPath: string) => void>();

  constructor(private scenario: Scenario) {
    this.files = new Map(Object.entries(scenario.files));
  }

  /** Mutable so a test can add a profile mid-run, as `hermes profile create` would. */
  get scenarioModels(): Record<string, string> {
    return this.scenario.models;
  }

  paths(): HermesPaths {
    return { bin: '/fake/hermes', home: '/fake/home' };
  }

  async version(): Promise<string | null> {
    return this.scenario.version;
  }

  async hasProvider(): Promise<boolean> {
    return this.scenario.hasProvider;
  }

  async listProfiles(): Promise<HermesProfile[]> {
    if (this.scenario.version === null) return [];
    const ids = Object.keys(this.scenario.models);
    const { isRealSoul, displayNameFor } = await import('../../src/main/profiles');
    const { soulPath } = await import('../../src/main/hermes/runtime');
    return ids.map((id) => {
      const rel = soulPath('', id).replace(/^\//, '');
      const soul = this.files.get(rel) ?? null;
      return {
        id,
        displayName: displayNameFor(id, soul),
        model: this.scenario.models[id] ?? null,
        isReal: isRealSoul(soul),
      };
    });
  }

  async query(profileId: string, prompt: string): Promise<string> {
    this.queries.push({ profileId, prompt });
    const hit = this.scenario.replies?.find((r) => prompt.includes(r.match));
    if (!hit) throw new Error(`FakeHermes: no canned reply matches prompt: ${prompt.slice(0, 80)}`);
    return hit.reply;
  }

  async readHomeFile(relPath: string): Promise<string | null> {
    return this.files.get(relPath) ?? null;
  }

  async writeHomeFile(relPath: string, contents: string): Promise<void> {
    this.files.set(relPath, contents);
  }

  async readHomeFileBytes(relPath: string): Promise<Uint8Array | null> {
    return this.bytes.get(relPath) ?? null;
  }

  async writeHomeFileBytes(relPath: string, bytes: Uint8Array): Promise<void> {
    this.bytes.set(relPath, bytes);
  }

  watchHome(onChange: (relPath: string) => void): () => void {
    this.homeWatchers.add(onChange);
    return () => this.homeWatchers.delete(onChange);
  }

  /** Fires what a real `fs.watch` would fire. */
  fireHomeChange(relPath: string): void {
    for (const cb of this.homeWatchers) cb(relPath);
  }
}
