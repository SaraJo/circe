import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { RealHermes } from './hermes/real';
import { Wizard } from './wizard';
import { createWizardWindow } from './windows';
import type { WizardStep } from '../shared/types';

app.setName('Circe');

let wizardWin: BrowserWindow | null = null;

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

  // Task 11 replaces this with the tile handoff.
  wizard.onChange((s) => {
    if (s.kind === 'launching') console.log('launching', s.profileId);
  });
}

app.whenReady().then(boot);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
