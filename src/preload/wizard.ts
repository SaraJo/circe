import { contextBridge, ipcRenderer } from 'electron';
import type { WizardStep } from '../shared/types';

contextBridge.exposeInMainWorld('circe', {
  onStep: (cb: (s: WizardStep) => void) =>
    ipcRenderer.on('wizard:step', (_e, s: WizardStep) => cb(s)),
  ready: () => ipcRenderer.send('wizard:ready'),
  start: () => ipcRenderer.send('wizard:start'),
  submitFandom: (text: string) => ipcRenderer.send('wizard:fandom', text),
  retry: () => ipcRenderer.send('wizard:retry'),
  accept: () => ipcRenderer.send('wizard:accept'),
  confirmClaim: () => ipcRenderer.send('wizard:confirm-claim'),
  declineClaim: () => ipcRenderer.send('wizard:decline-claim'),
  reviewFleet: () => ipcRenderer.send('wizard:review-fleet'),
  personalizeFleet: () => ipcRenderer.send('wizard:personalize-fleet'),
  keepFleetNames: () => ipcRenderer.send('wizard:keep-fleet-names'),
  acceptFleetSelection: (profileIds: string[]) =>
    ipcRenderer.send('wizard:accept-fleet-selection', profileIds),
  submitFleetFandom: (text: string) => ipcRenderer.send('wizard:fleet-fandom', text),
  retryFleet: () => ipcRenderer.send('wizard:retry-fleet'),
  reviseFleet: (feedback: string) => ipcRenderer.send('wizard:revise-fleet', feedback),
  acceptFleetRenames: (renameProfileIds: string[], tileProfileIds: string[]) =>
    ipcRenderer.send('wizard:accept-fleet-renames', { renameProfileIds, tileProfileIds }),
  chooseCoordinator: (profileId: string | null) =>
    ipcRenderer.send('wizard:choose-coordinator', profileId),
  newCoordinator: () => ipcRenderer.send('wizard:new-coordinator'),
  acceptNewCoordinator: () => ipcRenderer.send('wizard:accept-new-coordinator'),
  retryNewCoordinator: () => ipcRenderer.send('wizard:retry-new-coordinator'),
  resumeAdoption: () => ipcRenderer.send('wizard:resume-adoption'),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  onAvatar: (cb: (dataUrl: string | null) => void) =>
    ipcRenderer.on('wizard:avatar', (_e, url: string | null) => cb(url)),
});
