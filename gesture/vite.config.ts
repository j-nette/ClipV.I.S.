import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    open: true,
    fs: { allow: ['..'] },
  },
  build: { target: 'es2021', sourcemap: true },
});
