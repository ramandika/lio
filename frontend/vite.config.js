import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// design/tokens.css stays the single source of design tokens; Vite bundles it.
export default defineConfig({
  plugins: [react()],
})