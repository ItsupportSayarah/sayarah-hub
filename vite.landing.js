import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'apps/landing',
  publicDir: '../../public',
  base: '/',
  build: {
    outDir: '../../dist/landing',
    emptyOutDir: true,
  },
  server: { port: 5170 },
})
