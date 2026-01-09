import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['derec-library']
  },
  server: {
    fs: {
      allow: [
        '.',
        'F:/PROJECTS/GITHUB/derecalliance/lib-derec'
      ]
    }
  }
})
