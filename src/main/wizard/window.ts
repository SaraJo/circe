import { BrowserWindow } from 'electron';
import { join } from 'node:path';

export function createWizardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 520,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/wizard.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  return win;
}
