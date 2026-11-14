import { defineConfig } from 'tsup'

// Sin dependencias en tiempo de ejecución: corre donde haya `fetch` y WebCrypto (Node 20+, Bun,
// Deno, Cloudflare Workers, navegadores).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  clean: true,
})
