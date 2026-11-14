import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/pdf/index.ts', 'src/mh/mock.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2022',
  loader: { '.json': 'json' }
})
