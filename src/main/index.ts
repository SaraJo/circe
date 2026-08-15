import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { RealHermes } from './hermes/real';
import { Wizard } from './wizard';
import { createWizardWindow } from './windows';
import type { WizardStep } from '../shared/types';

app.setName('Circe');

let wizardWin: BrowserWindow | null = null;

function boot(): void {
  const hermes = new RealHermes();
  const wizard = new Wizard(hermes);
  wizardWin = createWizardWindow();

  const push = (s: WizardStep) => wizardWin?.webContents.send('wizard:step', s);
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
  ipcMain.on('open-external', (_e, url: string) => void shell.openExternal(url));

  // Task 11 replaces this with the tile handoff.
  wizard.onChange((s) => {
    if (s.kind === 'launching') console.log('launching', s.profileId);
  });
}

app.whenReady().then(boot);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
