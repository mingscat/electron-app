import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: ['electron-store', 'mitt'] }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          background: resolve(__dirname, 'src/renderer/background.html'),
          'screenshot-editor': resolve(__dirname, 'src/renderer/screenshot-editor.html'),
        },
      },
    },
  },
});
