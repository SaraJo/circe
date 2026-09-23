import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { Character } from '../shared/types';
import type { TileWindow } from './tiles';
import { tilePosition, TILE_H, TILE_W } from './tileLayout';

export { TILE_H, TILE_W };

const WIZARD_W = 640;
const WIZARD_H = 560;

/**
 * Pins a window to the document it was created with. Both renderers load a
 * preload that exposes `window.circe` — the tile's includes `send()`, which
 * prompts the user's agent and answers permission cards. Agent output reaches
 * `innerHTML` through `marked`,
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
    autoHideMenuBar: process.platform === 'linux',
    width: WIZARD_W,
    height: WIZARD_H,
    resizable: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
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
  isOrchestrator = false,
): BrowserWindow {
  // The display holding the cursor, not the primary one. Onboarding finished on
  // a laptop screen used to put the tile on a 3840-wide external display.
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y } = tilePosition(workArea, index);
  const win = new BrowserWindow({
    autoHideMenuBar: process.platform === 'linux',
    title: `Circe [${profileId}] — ${character.name}`,
    width: TILE_W,
    height: TILE_H,
    x,
    y,
    // `hiddenInset` rather than `frame: false`: it hides the title bar but
    // keeps macOS's own close/minimise/zoom buttons at the top left, which is
    // what a window is expected to have. A frameless window has none, which is
    // why this build previously drew its own `×` — a worse close button in the
    // wrong corner, and no minimise or zoom at all. Their position is left at
    // the `hiddenInset` default, which is where every other Mac window puts
    // them; the card's top padding is the room they sit in.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    /**
     * Deliberately **not** vibrant. `vibrancy: 'under-window'` was tried and
     * reverted: it does blur the desktop, which CSS cannot, but the material
     * desaturates whatever is tinted over it, and a dark palette tinting a
     * frost comes out as flat grey. Side by side, a vibrant tile lost its
     * colour entirely while a plainly translucent one still read as its own
     * blue. Colour is the point of theming a tile to a character, so the
     * translucency wins and the blur is not worth the trade.
     *
     * `roundedCorners` stays, and the card still fills the window: that is
     * what lets macOS shape and shadow the window itself, which it does better
     * than a CSS shadow inside a gutter ever did.
     */
    roundedCorners: true,
    transparent: process.platform === 'darwin',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : character.palette.bg,
    webPreferences: { preload: join(__dirname, '../preload/tile.js') },
  });
  pinToItsOwnDocument(win);
  win.on('page-title-updated', (event) => event.preventDefault());
  win.loadFile(join(__dirname, '../renderer/tile/index.html'), {
    query: {
      profile: profileId,
      character: JSON.stringify(character),
      orchestrator: String(isOrchestrator),
    },
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
