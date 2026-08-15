import { defineConfig } from 'electron-vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
    plugins: [
      {
        name: 'copy-resources',
        closeBundle() {
          const from = resolve(__dirname, 'resources/orchestrator');
          const to = resolve(__dirname, 'out/resources/orchestrator');
          mkdirSync(resolve(to, 'skills/circe-orchestrator'), { recursive: true });
          copyFileSync(resolve(from, 'SOUL.template.md'), resolve(to, 'SOUL.template.md'));
          copyFileSync(
            resolve(from, 'skills/circe-orchestrator/SKILL.md'),
            resolve(to, 'skills/circe-orchestrator/SKILL.md'),
          );
        },
      },
    ],
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
