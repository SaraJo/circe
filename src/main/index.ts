import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { RealHermes } from './hermes/real';
import { Wizard } from './wizard';
import { createTileWindow, createWizardWindow } from './windows';
import { AcpClient } from './acp';
import { openingMessage } from './orchestrator/opening';
import type { Character, WizardStep } from '../shared/types';

app.setName('Circe');

let wizardWin: BrowserWindow | null = null;
let tileWin: BrowserWindow | null = null;
let acp: AcpClient | null = null;

/**
 * Only `https:` links may be handed to `shell.openExternal` — parsed, not
 * `startsWith`-checked, so `https:evil` or whitespace/case tricks can't slip
 * past a naive prefix test. The only caller today is a hardcoded literal,
 * but this is the one place in the app that can make the OS open an
 * arbitrary URI handler, so it stays defended even without a live exploit.
 */
function openExternalSafely(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.warn(`Refusing to open external link (unparseable URL): ${url}`);
    return;
  }
  if (parsed.protocol !== 'https:') {
    console.warn(`Refusing to open external link (non-https scheme): ${url}`);
    return;
  }
  void shell.openExternal(parsed.toString());
}

/**
 * Opens the tile and starts the ACP session behind it. Wired to the wizard's
 * `launching` step (Task 9's placeholder), so it runs exactly once per app run.
 *
 * `start()` can reject — most likely the 30s handshake timeout in acp.ts. That
 * rejection does *not* kill the child process, so a caller that doesn't also
 * call `stop()` leaks a `hermes acp` process per failed start (Amendment 1).
 * On failure we reap the child and tell the user in the tile itself, through
 * the same `tile:opening` channel the greeting uses — one honest message with
 * the underlying error text attached, not a branch on which of acp.ts's three
 * failure strings came back.
 *
 * The wizard window closes either way (Amendment 2): a half-dismissed wizard
 * left open behind a broken tile is worse than a tile that clearly explains
 * it couldn't start. The tile is the one true state once launch begins; there
 * is no useful "back to the wizard" once the character has been handed off.
 */
async function launchTile(character: Character, profileId: string): Promise<void> {
  tileWin = createTileWindow(character, profileId);

  // `did-finish-load` fires only after the renderer's module script has run
  // and registered its listeners, so anything queued before that point would
  // be dropped on the floor. Queue messages until the page has actually
  // loaded, then flush in order.
  const queued: string[] = [openingMessage(character)];
  let loaded = false;
  const sendToTile = (text: string) => {
    if (loaded) tileWin?.webContents.send('tile:opening', text);
    else queued.push(text);
  };
  tileWin.webContents.once('did-finish-load', () => {
    loaded = true;
    for (const text of queued.splice(0)) tileWin?.webContents.send('tile:opening', text);
  });

  acp = new AcpClient({
    profileId,
    onUpdate: (u) => tileWin?.webContents.send('tile:update', u),
    onExit: () => tileWin?.webContents.send('tile:update', { sessionUpdate: 'exited' }),
  });

  ipcMain.on('tile:prompt', (_e, text: string) => {
    void acp?.prompt(text).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      sendToTile(`Your message wasn't sent — the agent connection is down. (${message})`);
    });
  });
  ipcMain.on('tile:close', () => {
    acp?.stop();
    tileWin?.close();
  });

  try {
    await acp.start();
  } catch (err) {
    acp.stop();
    const message = err instanceof Error ? err.message : String(err);
    sendToTile(
      "I couldn't reach the Hermes agent behind this tile, so I can't respond yet. " +
        'Check that Hermes is installed and set up (`hermes setup` in a terminal), ' +
        `then close this tile and start over.\n\n(${message})`,
    );
  }

  wizardWin?.close();
  wizardWin = null;
}

function boot(): void {
  const hermes = new RealHermes();
  const wizard = new Wizard(hermes);
  wizardWin = createWizardWindow();
  wizardWin.on('closed', () => {
    wizardWin = null;
  });

  const push = (s: WizardStep) => {
    if (wizardWin && !wizardWin.isDestroyed()) wizardWin.webContents.send('wizard:step', s);
  };
  wizard.onChange(push);

  ipcMain.on('wizard:ready', () => {
    push(wizard.state);
    void wizard.start();
  });
  ipcMain.on('wizard:fandom', (_e, text: string) => void wizard.submitFandom(text));
  ipcMain.on('wizard:retry', () => void wizard.retryDerivation());
  ipcMain.on('wizard:accept', () => void wizard.accept());
  ipcMain.on('wizard:confirm-claim', () => void wizard.confirmClaimDefault());
  ipcMain.on('wizard:decline-claim', () => wizard.declineClaimDefault());
  ipcMain.on('open-external', (_e, url: string) => openExternalSafely(url));

  wizard.onChange((s) => {
    if (s.kind !== 'launching') return;
    void launchTile(s.character, s.profileId);
  });
}

app.whenReady().then(boot);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
