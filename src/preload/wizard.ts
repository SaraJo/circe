import { contextBridge, ipcRenderer } from 'electron';
import type { WizardStep } from '../shared/types';

contextBridge.exposeInMainWorld('circe', {
  onStep: (cb: (s: WizardStep) => void) =>
    ipcRenderer.on('wizard:step', (_e, s: WizardStep) => cb(s)),
  ready: () => ipcRenderer.send('wizard:ready'),
  submitFandom: (text: string) => ipcRenderer.send('wizard:fandom', text),
  retry: () => ipcRenderer.send('wizard:retry'),
  accept: () => ipcRenderer.send('wizard:accept'),
  confirmClaim: () => ipcRenderer.send('wizard:confirm-claim'),
  declineClaim: () => ipcRenderer.send('wizard:decline-claim'),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  onAvatar: (cb: (dataUrl: string | null) => void) =>
    ipcRenderer.on('wizard:avatar', (_e, url: string | null) => cb(url)),
});
