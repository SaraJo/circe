import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('circe', {
  onUpdate: (cb: (u: Record<string, unknown>) => void) =>
    ipcRenderer.on('tile:update', (_e, u) => cb(u)),
  onOpening: (cb: (text: string) => void) =>
    ipcRenderer.on('tile:opening', (_e, text: string) => cb(text)),
  send: (text: string) => ipcRenderer.send('tile:prompt', text),
  close: () => ipcRenderer.send('tile:close'),
  // The tile can no longer navigate itself (see `pinToItsOwnDocument`), so a
  // link in an agent reply reaches the user's browser through here, on the
  // same channel and the same https-only vetting the wizard's "Get Hermes"
  // button already uses.
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
});
