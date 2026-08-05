import { contextBridge, ipcRenderer } from 'electron';
import { IPC_TO_MAIN, IPC_TO_RENDERER } from '../shared/ipc';

const profileId = process.argv.find((a) => a.startsWith('--profile-id='))?.split('=')[1] ?? '';

// Context isolation is on and nodeIntegration is off — this is the entire
// surface the renderer gets.
contextBridge.exposeInMainWorld('circe', {
  profileId,
  send: (text: string) => ipcRenderer.invoke(IPC_TO_MAIN.send, { profileId, text }),
  cycleGate: () => ipcRenderer.invoke(IPC_TO_MAIN.cycleGate, { profileId }),
  resolvePermission: (requestKey: string, optionId: string | null) =>
    ipcRenderer.invoke(IPC_TO_MAIN.resolvePermission, { profileId, requestKey, optionId }),
  restart: () => ipcRenderer.invoke(IPC_TO_MAIN.restart, { profileId }),
  on: (event: keyof typeof IPC_TO_RENDERER, handler: (payload: any) => void) => {
    ipcRenderer.on(IPC_TO_RENDERER[event], (_e, payload) => handler(payload));
  },
});
