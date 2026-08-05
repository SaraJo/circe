import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('wizard', {
  start: () => ipcRenderer.invoke('wizard:start'),
  goto: (screen: string) => ipcRenderer.invoke('wizard:goto', screen),
  back: () => ipcRenderer.invoke('wizard:back'),
  detectRuntime: () => ipcRenderer.invoke('wizard:detect-runtime'),
  detectProfiles: () => ipcRenderer.invoke('wizard:detect-profiles'),
  createAgent: (payload: unknown) => ipcRenderer.invoke('wizard:create-agent', payload),
  adoptProfiles: () => ipcRenderer.invoke('wizard:adopt-profiles'),
  listProviders: () => ipcRenderer.invoke('wizard:list-providers'),
  loginProvider: (provider: string) => ipcRenderer.invoke('wizard:login-provider', provider),
  launchFleet: () => ipcRenderer.invoke('wizard:launch-fleet'),
  on: (channel: string, handler: (payload: any) => void) => {
    ipcRenderer.on(channel, (_e, payload) => handler(payload));
  },
});
