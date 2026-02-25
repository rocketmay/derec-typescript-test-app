import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "node:path"

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
        'F:/PROJECTS/GITHUB/derecalliance/lib-derec',
        path.resolve(__dirname, "../lib-derec/library/target/pkg-web"),
      ]
    }
  }
})
