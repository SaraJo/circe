import { AcpClient, type PermissionEvent, type SessionUpdate } from '../hermes/acpClient';
import { enumerateProfiles } from '../hermes/profiles';
import { nextGateMode } from '../../shared/gate';
import { IPC_TO_RENDERER } from '../../shared/ipc';
import type { StateStore } from '../state/store';
import type { GateMode, Message } from '../../shared/types';

/** The slice of BrowserWindow TileManager needs, so tests can substitute a fake. */
export interface TileWindow {
  send(channel: string, payload: unknown): void;
  getBounds(): { x: number; y: number; width: number; height: number };
  close(): void;
  isDestroyed(): boolean;
}

export type WindowFactory = (profileId: string) => TileWindow;

interface OpenTile {
  window: TileWindow;
  client: AcpClient;
  sessionId: string | null;
  /** Accumulates the current turn's streamed text. */
  streaming: string;
}

export interface TileManagerDeps {
  store: StateStore;
  hermesBin: string;
  hermesHome: string;
  env?: NodeJS.ProcessEnv;
  createWindow: WindowFactory;
}

export class TileManager {
  private tiles = new Map<string, OpenTile>();

  constructor(private readonly deps: TileManagerDeps) {}

  get openTileIds(): string[] {
    return [...this.tiles.keys()];
  }

  async spawnTile(profileId: string): Promise<void> {
    if (this.tiles.has(profileId)) return;

    const profile = (await enumerateProfiles(this.deps.hermesHome)).find((p) => p.id === profileId);
    if (!profile) throw new Error(`No Hermes profile named "${profileId}".`);

    const tileState = this.deps.store.get().tiles[profileId];
    if (!tileState) throw new Error(`No saved tile for "${profileId}".`);

    const window = this.deps.createWindow(profileId);
    const client = new AcpClient({
      hermesBin: this.deps.hermesBin,
      profileId,
      env: this.deps.env,
      gateMode: tileState.gateMode,
      onUpdate: (u) => this.onUpdate(profileId, u),
      onPermission: (e) => this.onPermission(profileId, e),
      onExit: (code) => this.onExit(profileId, code),
    });

    const entry: OpenTile = { window, client, sessionId: null, streaming: '' };
    this.tiles.set(profileId, entry);

    window.send(IPC_TO_RENDERER.init, {
      profileId,
      displayName: profile.displayName,
      tagline: profile.tagline,
      model: null,
      palette: tileState.palette,
      gateMode: tileState.gateMode,
      messages: tileState.tabs[0]?.messages ?? [],
    });

    try {
      await client.start();
      entry.sessionId = await client.newSession();
    } catch (err) {
      window.send(IPC_TO_RENDERER.agentStopped, { message: (err as Error).message });
      throw err;
    }
  }

  async sendPrompt(profileId: string, text: string): Promise<void> {
    const tile = this.tiles.get(profileId);
    if (!tile || !tile.sessionId) throw new Error(`Tile "${profileId}" isn’t ready.`);

    await this.appendMessage(profileId, { role: 'user', text });
    tile.streaming = '';
    await tile.client.prompt(tile.sessionId, text);

    if (tile.streaming) {
      await this.appendMessage(profileId, { role: 'agent', text: tile.streaming });
      tile.streaming = '';
    }
    tile.window.send(IPC_TO_RENDERER.turnEnd, {});
  }

  async cycleGate(profileId: string): Promise<GateMode> {
    const current = this.deps.store.get().tiles[profileId]?.gateMode ?? 'unlocked';
    const next = nextGateMode(current);
    // Apply to the live client first — §10.4 requires the next inbound request
    // to see the new mode, with no session or turn boundary.
    this.tiles.get(profileId)?.client.setGateMode(next);
    await this.deps.store.updateTile(profileId, { gateMode: next });
    this.tiles.get(profileId)?.window.send(IPC_TO_RENDERER.gateChanged, { gateMode: next });
    return next;
  }

  resolvePermission(profileId: string, requestKey: string, optionId: string | null): boolean {
    return this.tiles.get(profileId)?.client.resolvePermission(requestKey, optionId) ?? false;
  }

  closeTile(profileId: string): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    if (!tile.window.isDestroyed()) {
      void this.deps.store.updateTile(profileId, { bounds: tile.window.getBounds() });
      tile.window.close();
    }
    tile.client.stop();
    this.tiles.delete(profileId);
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.tiles.keys()]) this.closeTile(id);
    await this.deps.store.save(this.deps.store.get());
  }

  private onUpdate(profileId: string, update: SessionUpdate): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      tile.streaming += update.content.text;
      tile.window.send(IPC_TO_RENDERER.chunk, { text: update.content.text });
    }
  }

  private onPermission(profileId: string, event: PermissionEvent): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    const title = event.toolCall?.title ?? 'a tool call';

    if (event.resolved === 'locked') {
      tile.window.send(IPC_TO_RENDERER.denied, { title });
      void this.appendMessage(profileId, { role: 'tool', text: `Denied: ${title}`, kind: 'denied' });
      return;
    }
    if (event.requestKey) {
      tile.window.send(IPC_TO_RENDERER.permissionAsk, {
        requestKey: event.requestKey,
        title,
        options: event.options.map((o) => ({
          optionId: o.optionId ?? o.name ?? '',
          name: o.name ?? o.optionId ?? '',
        })),
      });
    }
  }

  private onExit(profileId: string, code: number | null): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    tile.window.send(IPC_TO_RENDERER.agentStopped, {
      message: `This agent stopped unexpectedly (exit ${code}).`,
    });
  }

  private async appendMessage(profileId: string, message: Message): Promise<void> {
    const state = this.deps.store.get().tiles[profileId];
    if (!state) return;
    const tab = state.tabs[0];
    if (!tab) return;
    tab.messages.push(message);
    await this.deps.store.updateTile(profileId, { tabs: state.tabs });
  }
}
