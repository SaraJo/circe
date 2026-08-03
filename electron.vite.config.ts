import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

// NOTE: deviates from the Task 1 brief, which also configured `preload` and
// `renderer` entries pointing at src/preload/{tile,wizard}.ts and
// src/renderer/{tile,wizard}/index.html. Those source files are out of scope
// for Task 1 (see the Files list), and electron-vite fails the build outright
// when a configured rollup input doesn't exist on disk. Omitting the keys
// lets electron-vite skip those steps with a warning instead of erroring, so
// `npm run build` succeeds now. Whichever task creates src/preload/tile.ts,
// src/preload/wizard.ts, and the renderer HTML entry points should restore
// the `preload` and `renderer` blocks below:
//
// preload: {
//   build: {
//     rollupOptions: {
//       input: {
//         tile: resolve(__dirname, 'src/preload/tile.ts'),
//         wizard: resolve(__dirname, 'src/preload/wizard.ts'),
//       },
//     },
//   },
// },
// renderer: {
//   root: resolve(__dirname, 'src/renderer'),
//   build: {
//     rollupOptions: {
//       input: {
//         tile: resolve(__dirname, 'src/renderer/tile/index.html'),
//         wizard: resolve(__dirname, 'src/renderer/wizard/index.html'),
//       },
//     },
//   },
// },
export default defineConfig({
  main: { build: { lib: { entry: resolve(__dirname, 'src/main/index.ts') } } },
});
