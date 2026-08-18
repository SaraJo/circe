import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { Character } from '../shared/types';
import type { TileWindow } from './tiles';
import { SHADOW_GUTTER, tilePosition, TILE_H, TILE_W } from './tileLayout';

export { TILE_H, TILE_W };

const WIZARD_W = 640;
const WIZARD_H = 560;

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

export function createTileWindow(
  character: Character,
  profileId: string,
  index = 0,
): BrowserWindow {
  // The display holding the cursor, not the primary one. Onboarding finished on
  // a laptop screen used to put the tile on a 3840-wide external display.
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y } = tilePosition(workArea, index);
  const win = new BrowserWindow({
    width: TILE_W,
    height: TILE_H,
    x,
    y,
    // `hiddenInset` rather than `frame: false`: it hides the title bar but
    // keeps macOS's own close/minimise/zoom buttons at the top left, which is
    // what a window is expected to have. A frameless window has none, which is
    // why this build previously drew its own `×` — a worse close button in the
    // wrong corner, and no minimise or zoom at all. The card's top padding is
    // the room they sit in.
    titleBarStyle: 'hiddenInset',
    // Inset by the shadow gutter, because macOS positions these against the
    // *window* and the window is larger than the card on every side. Left at
    // the default they sit hard against the card's edge, tucked into its
    // rounded corner; the extra 13px puts them where they sit on any other
    // Mac window, measured from the edge the user can actually see.
    trafficLightPosition: { x: SHADOW_GUTTER + 13, y: SHADOW_GUTTER + 13 },
    transparent: true,
    backgroundColor: '#00000000',
    // The card draws its own shadow in CSS. Left on, macOS draws a second one
    // around the whole *window* — a square shadow behind a rounded card.
    hasShadow: false,
    webPreferences: { preload: join(__dirname, '../preload/tile.js') },
  });
  pinToItsOwnDocument(win);
  win.loadFile(join(__dirname, '../renderer/tile/index.html'), {
    query: { profile: profileId, character: JSON.stringify(character) },
  });
  // Nothing raised a tile on creation, so a frameless, transparent, chrome-less
  // window opened behind whatever the user had in front. `show()` on an
  // already-visible window raises it.
  win.show();
  win.focus();
  return win;
}

/**
 * Presents a real window as the narrow surface `tiles.ts` consumes. The
 * registry imports no Electron; this is the one place the two meet.
 *
 * `ownsSender` compares against `webContents` because that is what an
 * `IpcMainEvent.sender` is — it is how a message is attributed to the window
 * that actually sent it, rather than to a profile id the renderer names.
 */
export function adaptTileWindow(win: BrowserWindow): TileWindow {
  return {
    send: (channel, payload) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    },
    isDestroyed: () => win.isDestroyed(),
    close: () => win.close(),
    show: () => win.show(),
    focus: () => win.focus(),
    isMinimized: () => win.isMinimized(),
    restore: () => win.restore(),
    ownsSender: (sender) => !win.isDestroyed() && sender === win.webContents,
    onceLoaded: (cb) => win.webContents.once('did-finish-load', cb),
    onceFailedLoad: (cb) => win.webContents.once('did-fail-load', cb),
    onceClosed: (cb) => win.once('closed', cb),
  };
}
