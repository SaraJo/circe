import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          wizard: resolve(__dirname, 'src/preload/wizard.ts'),
          tile: resolve(__dirname, 'src/preload/tile.ts'),
        },
      },
    },
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          wizard: resolve(__dirname, 'src/renderer/wizard/index.html'),
          tile: resolve(__dirname, 'src/renderer/tile/index.html'),
        },
      },
    },
  },
});
