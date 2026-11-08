import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import type { PersonalMemory } from './service';

/** Only this pinned local document can inspect or change personal memory. */
export class MemoryWindow {
  private win: BrowserWindow | null = null;

  constructor(private memory: PersonalMemory) {
    const operations: Record<string, (...args: any[]) => unknown> = {
      read: () => memory.view(),
      configure: (settings) => memory.configure(settings),
      check: () => memory.check(),
      forget: (key) => memory.forget(key),
      'forget-all': () => memory.forgetAll(),
      edit: (key, text) => memory.edit(key, text),
    };
    for (const [operation, run] of Object.entries(operations)) {
      ipcMain.handle(`memory:${operation}`, (event, ...args) => {
        if (!this.win || this.win.isDestroyed() || event.sender !== this.win.webContents ||
          event.senderFrame !== this.win.webContents.mainFrame) throw new Error('Memory access denied.');
        return run(...args);
      });
    }
  }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show(); this.win.focus(); return;
    }
    const win = new BrowserWindow({
      title: 'Circe — Memory', width: 760, height: 740, minWidth: 540, minHeight: 500,
      backgroundColor: '#171822',
      webPreferences: { preload: join(__dirname, '../preload/memory.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.win = win;
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => { if (this.win === win) this.win = null; });
    void win.loadFile(join(__dirname, '../renderer/memory/index.html'));
  }
}
