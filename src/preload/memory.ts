import { contextBridge, ipcRenderer } from 'electron';
import type { MemoryBridge } from '../shared/memory';

const bridge: MemoryBridge = {
  read: () => ipcRenderer.invoke('memory:read'),
  configure: (settings) => ipcRenderer.invoke('memory:configure', settings),
  check: () => ipcRenderer.invoke('memory:check'),
  forget: (key) => ipcRenderer.invoke('memory:forget', key),
  forgetAll: () => ipcRenderer.invoke('memory:forget-all'),
  edit: (key, text) => ipcRenderer.invoke('memory:edit', key, text),
};
contextBridge.exposeInMainWorld('circeMemory', bridge);
