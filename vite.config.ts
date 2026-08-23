import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.CLIPFORGE_API_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The browser is remote (Arena preview proxy), so it must never be told to
    // call localhost. It uses relative /api URLs and Vite proxies them to the
    // API process running inside the sandbox.
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // Large uploads and long-running renders must not be cut off.
        timeout: 30 * 60_000,
        proxyTimeout: 30 * 60_000,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
