import type { GateMode, Palette, Message } from './types';

/** Main → renderer. */
export const IPC_TO_RENDERER = {
  init: 'tile:init',
  chunk: 'tile:chunk',
  turnEnd: 'tile:turn-end',
  denied: 'tile:denied',
  permissionAsk: 'tile:permission-ask',
  agentStopped: 'tile:agent-stopped',
  gateChanged: 'tile:gate-changed',
  error: 'tile:error',
} as const;

/** Renderer → main, all `invoke`. */
export const IPC_TO_MAIN = {
  send: 'tile:send',
  cycleGate: 'tile:cycle-gate',
  resolvePermission: 'tile:resolve-permission',
  restart: 'tile:restart',
} as const;

export interface TileInitPayload {
  profileId: string;
  displayName: string;
  tagline: string | null;
  model: string | null;
  palette: Palette;
  gateMode: GateMode;
  messages: Message[];
}

export interface ChunkPayload { text: string }
export interface DeniedPayload { title: string }
export interface PermissionAskPayload {
  requestKey: string;
  title: string;
  options: { optionId: string; name: string }[];
}
