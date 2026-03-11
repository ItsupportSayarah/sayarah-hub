import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'apps/logistics',
  publicDir: '../../public',
  base: '/logistics/',
  envDir: '../..',
  build: {
    outDir: '../../dist/logistics',
    emptyOutDir: true,
  },
  server: { port: 5172 },
})
