import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { StateStore } from './state/store';
import { WizardController } from './wizard/controller';
import { AgentBuilder } from './wizard/agents';
import { TileManager, type TileWindow } from './tiles/manager';
import { Fleet } from './fleet';
import { locateHermes } from './hermes/locate';
import { PROVIDERS, ProviderLogin } from './hermes/provider';
import { createWizardWindow } from './wizard/window';
import { IPC_TO_MAIN } from '../shared/ipc';

const HERMES_HOME = process.env.HERMES_HOME ?? join(homedir(), '.hermes');
const STATE_FILE = join(app.getPath('userData'), 'state.json');

const store = new StateStore(STATE_FILE);
let hermesBin = 'hermes';
let wizardWindow: BrowserWindow | null = null;
let tiles: TileManager;
let fleet: Fleet;

function createTileWindow(profileId: string): TileWindow {
  const saved = store.get().tiles[profileId]?.bounds;
  const win = new BrowserWindow({
    width: saved?.width ?? 500,
    height: saved?.height ?? 600,
    x: saved?.x,
    y: saved?.y,
    minWidth: 340,
    minHeight: 380,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/tile.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--profile-id=${profileId}`],
    },
  });
  // spawnTile sends `tile:init` immediately after this factory returns, but
  // loadFile is async — the renderer has not registered its ipcRenderer.on
  // handlers yet, so an unbuffered send is dropped and the tile renders blank.
  let loaded = false;
  const pending: { channel: string; payload: unknown }[] = [];
  win.webContents.on('did-finish-load', () => {
    loaded = true;
    for (const m of pending) win.webContents.send(m.channel, m.payload);
    pending.length = 0;
  });

  void win.loadFile(join(__dirname, '../renderer/tile/index.html'));

  return {
    send: (channel, payload) => {
      if (win.isDestroyed()) return;
      if (loaded) win.webContents.send(channel, payload);
      else pending.push({ channel, payload });
    },
    getBounds: () => win.getBounds(),
    close: () => win.close(),
    isDestroyed: () => win.isDestroyed(),
  };
}

/**
 * Screen 7 lays the fleet out across the primary display. Only tiles still at
 * the (0,0) fallback are moved, so a position the user chose is never
 * overwritten — that is what makes bounds survive a relaunch (§10.5).
 *
 * Both the wizard launch and the onboarded boot go through here. When only the
 * boot path laid tiles out, a freshly-onboarded fleet opened every tile stacked
 * at (0,0) and got silently rearranged on the next launch.
 */
async function layoutUnpositionedTiles(): Promise<void> {
  const { launchable } = await fleet.plan();
  const primary = screen.getPrimaryDisplay().workAreaSize;
  const boxes = fleet.layout(launchable.length, primary);
  const state = store.get();

  launchable.forEach((profileId, i) => {
    const tile = state.tiles[profileId];
    if (tile && tile.bounds.x === 0 && tile.bounds.y === 0 && boxes[i]) {
      tile.bounds = boxes[i]!;
    }
  });
  await store.save(state);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => void tiles?.shutdown());

app.whenReady().then(async () => {
  await store.load();

  const found = await locateHermes();
  if (found.ok) hermesBin = found.bin;

  tiles = new TileManager({ store, hermesBin, hermesHome: HERMES_HOME, createWindow: createTileWindow });
  fleet = new Fleet({ store, tiles, hermesHome: HERMES_HOME });

  const wizard = new WizardController({ store, hermesHome: HERMES_HOME });
  const builder = new AgentBuilder({ store, hermesBin, hermesHome: HERMES_HOME });

  // ---- wizard IPC ----
  ipcMain.handle('wizard:start', () => wizard.start());
  ipcMain.handle('wizard:goto', (_e, screenId) => wizard.goto(screenId));
  ipcMain.handle('wizard:back', () => wizard.back());
  ipcMain.handle('wizard:detect-runtime', () => wizard.detectRuntime());
  ipcMain.handle('wizard:detect-profiles', () => wizard.detectProfiles());
  ipcMain.handle('wizard:create-agent', (_e, payload) => builder.createFromCharacter(payload));
  ipcMain.handle('wizard:adopt-profiles', () => builder.adoptProfiles());
  ipcMain.handle('wizard:list-providers', () => PROVIDERS);
  ipcMain.handle('wizard:login-provider', async (_e, provider: string) => {
    const login = new ProviderLogin({
      hermesBin,
      provider,
      onPrompt: (p) => wizardWindow?.webContents.send('wizard:device-code', p),
    });
    return login.run();
  });
  ipcMain.handle('wizard:launch-fleet', async () => {
    await layoutUnpositionedTiles();
    const result = await fleet.launch();
    if (result.launched > 0) {
      const state = store.get();
      state.onboarded = true;
      state.wizardScreen = null;
      await store.save(state);
      wizardWindow?.close();
      wizardWindow = null;
    }
    return result;
  });

  // ---- tile IPC ----
  ipcMain.handle(IPC_TO_MAIN.send, (_e, { profileId, text }) => tiles.sendPrompt(profileId, text));
  ipcMain.handle(IPC_TO_MAIN.cycleGate, (_e, { profileId }) => tiles.cycleGate(profileId));
  ipcMain.handle(IPC_TO_MAIN.resolvePermission, (_e, { profileId, requestKey, optionId }) =>
    tiles.resolvePermission(profileId, requestKey, optionId),
  );
  ipcMain.handle(IPC_TO_MAIN.restart, async (_e, { profileId }) => {
    tiles.closeTile(profileId);
    await tiles.spawnTile(profileId);
  });

  // ---- boot ----
  const state = store.get();
  if (state.onboarded) {
    await layoutUnpositionedTiles();

    const result = await fleet.launch();
    // Decision 1 — an empty fleet at boot reopens the wizard rather than
    // leaving the user with no window at all.
    if (result.launched === 0) {
      wizardWindow = createWizardWindow();
      void wizardWindow.loadFile(join(__dirname, '../renderer/wizard/index.html'));
    }
  } else {
    wizardWindow = createWizardWindow();
    void wizardWindow.loadFile(join(__dirname, '../renderer/wizard/index.html'));
  }
});
