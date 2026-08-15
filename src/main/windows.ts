import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { Character } from '../shared/types';

const WIZARD_W = 640;
const WIZARD_H = 560;
export const TILE_W = 430;
export const TILE_H = 480;

export function createWizardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIZARD_W,
    height: WIZARD_H,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#12121a',
    webPreferences: { preload: join(__dirname, '../preload/wizard.js') },
  });
  win.loadFile(join(__dirname, '../renderer/wizard/index.html'));
  return win;
}

export function createTileWindow(character: Character, profileId: string): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: TILE_W,
    height: TILE_H,
    x: workArea.x + workArea.width - TILE_W - 40,
    y: workArea.y + 40,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: join(__dirname, '../preload/tile.js') },
  });
  win.loadFile(join(__dirname, '../renderer/tile/index.html'), {
    query: { profile: profileId, character: JSON.stringify(character) },
  });
  return win;
}
