import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: '.',
  server: {
    open: true,
    fs: { allow: ['..'] },
    proxy: {
      // Real .glb hero models live in the shared ../models folder, served by the
      // Express agent server (agent/server.js) at /assets/<file>. Proxy ONLY
      // /assets — do NOT proxy /models, which gesture uses for the local
      // MediaPipe hand_landmarker.task in public/models.
      '/assets': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2021',
    sourcemap: true,
    rollupOptions: {
      input: {
        // Presenter (default gesture app) + hologram follower page.
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        hologram: fileURLToPath(new URL('./hologram.html', import.meta.url)),
      },
    },
  },
});
