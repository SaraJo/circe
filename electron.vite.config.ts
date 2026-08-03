import { existsSync } from 'node:fs';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

// preload/renderer entries are conditional on their source files existing:
// Task 1 only creates src/main/index.ts, and electron-vite fails the build
// outright if a configured rollup input doesn't exist on disk. Making the
// entries conditional (rather than commenting them out) means the config
// activates itself the moment a later task drops the expected files in
// place, instead of relying on that task remembering to restore a comment.
const preloadTile = resolve(__dirname, 'src/preload/tile.ts');
const preloadWizard = resolve(__dirname, 'src/preload/wizard.ts');
const rendererTile = resolve(__dirname, 'src/renderer/tile/index.html');
const rendererWizard = resolve(__dirname, 'src/renderer/wizard/index.html');

export default defineConfig({
  main: { build: { lib: { entry: resolve(__dirname, 'src/main/index.ts') } } },
  ...(existsSync(preloadTile) && existsSync(preloadWizard)
    ? { preload: { build: { rollupOptions: { input: { tile: preloadTile, wizard: preloadWizard } } } } }
    : {}),
  ...(existsSync(rendererTile) && existsSync(rendererWizard)
    ? {
        renderer: {
          root: resolve(__dirname, 'src/renderer'),
          build: { rollupOptions: { input: { tile: rendererTile, wizard: rendererWizard } } },
        },
      }
    : {}),
});
