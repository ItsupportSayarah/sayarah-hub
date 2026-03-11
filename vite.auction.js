import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'apps/auction',
  publicDir: '../../public',
  base: '/auction/',
  envDir: '../..',
  build: {
    outDir: '../../dist/auction',
    emptyOutDir: true,
  },
  server: { port: 5171 },
})
