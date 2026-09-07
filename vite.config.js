import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Stamped into the build so a support question like "are you on the new
// version?" can be answered by reading the sign-in screen.
const buildId = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
})
