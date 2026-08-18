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
  send: (text: string) => ipcRenderer.send('tile:prompt', text),
  close: () => ipcRenderer.send('tile:close'),
  // The tile can no longer navigate itself (see `pinToItsOwnDocument`), so a
  // link in an agent reply reaches the user's browser through here, on the
  // same channel and the same https-only vetting the wizard's "Get Hermes"
  // button already uses.
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
});
