import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', port: 4173, allowedHosts: ['terminal.local'] },
  build: { target: 'es2022' },
});
