import { contextBridge, ipcRenderer } from 'electron';
import type { MemoryBridge } from '../shared/memory';

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
  }
}

const bridge: MemoryBridge = {
  read: () => invoke('memory:read'),
  configure: (settings) => invoke('memory:configure', settings),
  check: () => invoke('memory:check'),
  forget: (key) => invoke('memory:forget', key),
  forgetAll: () => invoke('memory:forget-all'),
  edit: (key, text) => invoke('memory:edit', key, text),
  history: (profileId, sessionId, query) => invoke('memory:history', profileId, sessionId, query),
  source: (profileId, id) => invoke('memory:source', profileId, id),
  forgetTask: (profileId, sessionId) => invoke('memory:forget-task', profileId, sessionId),
  onFocus: (cb) => { ipcRenderer.on('memory:focus', (_event, focus) => cb(focus)); },
};
contextBridge.exposeInMainWorld('circeMemory', bridge);
