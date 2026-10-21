import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// design/tokens.css stays the single source of design tokens; Vite bundles it.
export default defineConfig({
  plugins: [react()],
  server: {
    // llm_ocr_fuse dev route: the browser mock reaches the local
    // OpenAI-compatible server (/llm/v1/…) through this same-origin proxy,
    // so there is no CORS and no API key. The real stack makes the LLM call
    // server-side (app/services/llm.py), where this proxy has no analogue.
    proxy: {
      '/llm': {
        target: process.env.LLM_PROXY_TARGET || 'http://localhost:11444',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llm/, ''),
      },
    },
  },
})