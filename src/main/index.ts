import { app } from 'electron';

// Circe quits when the last tile closes (§6.3.4). There is no dock-persistent
// app shell — each tile is the app.
app.on('window-all-closed', () => {
  app.quit();
});

app.whenReady().then(() => {
  // Wizard vs. fleet boot is wired in Task 15.
});
