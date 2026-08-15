import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('circe', {
  onUpdate: (cb: (u: Record<string, unknown>) => void) =>
    ipcRenderer.on('tile:update', (_e, u) => cb(u)),
  onOpening: (cb: (text: string) => void) =>
    ipcRenderer.on('tile:opening', (_e, text: string) => cb(text)),
  send: (text: string) => ipcRenderer.send('tile:prompt', text),
  close: () => ipcRenderer.send('tile:close'),
});
