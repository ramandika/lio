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
      '/api': {
        // Live backend in dev: the app container's FastAPI (docker-compose APP_PORT,
        // default 8020). No rewrite — every environment serves the API under
        // /api (the routers' own prefix), and in production FastAPI serves the
        // SPA at the same origin itself.
        target: process.env.API_PROXY_TARGET || 'http://localhost:8020',
        changeOrigin: true,
      },
      // Dormant mock-transport route: only the in-browser mock's L2 fuse
      // (api/mock/llmOcrFuse.js) calls /llm, and the mock only runs when
      // useMock is flipped true in api/index.js. The live stack makes the LLM
      // call server-side (app/services/llm.py) — no browser proxy there.
      '/llm': {
        target: process.env.LLM_PROXY_TARGET || 'http://localhost:11444',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llm/, ''),
      },
    },
  },
})