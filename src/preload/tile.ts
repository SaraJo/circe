// Placeholder entry point so `electron.vite.config.ts`'s preload build (which
// already lists this file) can resolve. `createTileWindow` (src/main/windows.ts)
// references `../preload/tile.js` but is not called until Task 11, which is
// where this file's real bridge implementation belongs.
export {};
