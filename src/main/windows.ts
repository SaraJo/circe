import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { Character } from '../shared/types';

const WIZARD_W = 640;
const WIZARD_H = 560;
export const TILE_W = 430;
export const TILE_H = 480;

/**
 * Pins a window to the document it was created with. Both renderers load a
 * preload that exposes `window.circe` — the tile's includes `send()`, which
 * prompts the user's agent, and `acp.ts` auto-approves every permission
 * request that agent makes. Agent output reaches `innerHTML` through `marked`,
 * which does not sanitize, so a reply containing a link renders as a live
 * `<a href>`. Without these two guards, clicking it navigates the window to
 * that origin, the preload re-runs on the new document, and an arbitrary web
 * page is handed `send()` — prompt injection straight into the agent.
 *
 * `will-navigate` covers renderer-initiated navigation (link clicks,
 * `location =`); `setWindowOpenHandler` covers `window.open` and
 * `target="_blank"`. Neither fires for the `loadFile` below, which is
 * main-process-initiated. Links the *user* means to follow are routed through
 * the `open-external` IPC channel instead, where `index.ts` vets the scheme
 * and hands them to the OS browser.
 */
function pinToItsOwnDocument(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

export function createWizardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIZARD_W,
    height: WIZARD_H,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#12121a',
    webPreferences: { preload: join(__dirname, '../preload/wizard.js') },
  });
  pinToItsOwnDocument(win);
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
  pinToItsOwnDocument(win);
  win.loadFile(join(__dirname, '../renderer/tile/index.html'), {
    query: { profile: profileId, character: JSON.stringify(character) },
  });
  return win;
}
