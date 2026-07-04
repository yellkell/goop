import { defineConfig } from 'vite';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';

// IWSDK's dev plugin injects the IWER WebXR emulator so the game can be
// flown in a desktop browser (WASD + mouse) without a headset. On a real
// Quest browser it stays out of the way and the native WebXR session is used.
export default defineConfig({
  base: './',
  plugins: [
    iwsdkDev({
      // Emulate a Quest 3 device profile during local development.
      emulator: { device: 'metaQuest3' },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        // The game plus the flat-screen creature workbench (dev.html): an
        // orbit-camera view of the gel creature for shader/sim iteration
        // without a headset.
        main: 'index.html',
        dev: 'dev.html',
      },
    },
  },
});
