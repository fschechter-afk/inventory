import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Two pages: the inventory app at the root, the ordering portal at /portal/.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        portal: 'portal/index.html',
      },
    },
  },
})
