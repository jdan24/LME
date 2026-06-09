import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    viteSingleFile(),
  ],
  build: {
    outDir: '../',       // output index.html to project root (C:\Users\dmena\LME\)
    emptyOutDir: false,  // never wipe the project root
    cssCodeSplit: false,
  },
  server: {
    // dev-server proxy (only used when running `npm run dev` during development)
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
