import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('circe', {
  onUpdate: (cb: (u: Record<string, unknown>) => void) =>
    ipcRenderer.on('tile:update', (_e, u) => cb(u)),
  onOpening: (cb: (text: string) => void) =>
    ipcRenderer.on('tile:opening', (_e, text: string) => cb(text)),
  // A profile's persona and colours can change after its tile opens — the
  // orchestrator writes `circe.json` after the `SOUL.md` that opened it, and a
  // user can edit either by hand. The main process re-reads and sends here.
  onCharacter: (cb: (character: Record<string, unknown>) => void) =>
    ipcRenderer.on('tile:character', (_e, c) => cb(c)),
  // The profile's face, sent on its own channel because a base64 PNG would not
  // fit in the window URL alongside the rest of the character (see
  // `main/tiles.ts`).
  onAvatar: (cb: (dataUrl: string | null) => void) =>
    ipcRenderer.on('tile:avatar', (_e, url: string | null) => cb(url)),
  onTabs: (cb: (tabs: Record<string, unknown>) => void) =>
    ipcRenderer.on('tile:tabs', (_e, tabs) => cb(tabs)),
  send: (text: string) => ipcRenderer.send('tile:prompt', text),
  newTab: () => ipcRenderer.send('tile:new-tab'),
  switchTab: (index: number) => ipcRenderer.send('tile:switch-tab', index),
  clearTab: () => ipcRenderer.send('tile:clear-tab'),
  rollover: () => ipcRenderer.send('tile:rollover'),
  replaceAvatar: () => ipcRenderer.send('tile:choose-avatar'),
  closeTab: (index: number) => ipcRenderer.send('tile:close-tab', index),
  close: () => ipcRenderer.send('tile:close'),
  answerPermission: (id: number, choice: string) =>
    ipcRenderer.send('tile:permission-answer', { id, choice }),
  // The tile can no longer navigate itself (see `pinToItsOwnDocument`), so a
  // link in an agent reply reaches the user's browser through here, on the
  // same channel and the same https-only vetting the wizard's "Get Hermes"
  // button already uses.
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
});
