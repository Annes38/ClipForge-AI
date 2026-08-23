import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: [
      '.e2b.app',
      '5173-iyusn59jbwtxd2veapf3r.e2b.app',
    ],
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
})
