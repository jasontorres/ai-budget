import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    host: '0.0.0.0',
    // duckdb-wasm fetches parquet via HTTP Range requests; Vite's dev server
    // supports them natively. The headers below enable cross-origin isolation,
    // which lets duckdb-wasm use SharedArrayBuffer + Web Workers for the
    // multi-threaded build (EH bundle). If you only need MVP, these can drop.
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    allowedHosts: ["dev.neonplayground.com"]
  },
  optimizeDeps: {
    // duckdb-wasm ships worker files that Vite's dep-optimizer otherwise
    // mangles; keeping it out of the prebundle lets the worker bootstrap.
    exclude: ['@duckdb/duckdb-wasm'],
  },
  worker: {
    format: 'es',
  },
})