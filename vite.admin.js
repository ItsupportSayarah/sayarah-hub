import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'apps/admin',
  publicDir: '../../public',
  base: '/admin/',
  build: {
    outDir: '../../dist/admin',
    emptyOutDir: true,
  },
  server: { port: 5175 },
})
