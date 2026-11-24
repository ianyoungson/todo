/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; local dev uses /.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  server: { port: 5173 },
  test: { environment: 'jsdom' },
})
