import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A second, independent app in the same repo (see spending/README.md).
// Runs and deploys separately from the inventory app at the root.
export default defineConfig({
  root: 'spending',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist/spending', emptyOutDir: true },
})
