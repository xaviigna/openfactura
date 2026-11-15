import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Las pruebas corren dentro de workerd (el mismo runtime que producción) con D1 local.
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          APP_URL: 'http://localhost',
          BETTER_AUTH_SECRET: 'secreto-solo-para-pruebas-0123456789abcdef',
          // 32 bytes en base64, sólo para pruebas.
          CRED_KEK_V1: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
          MH_SIMULADO: '1',
          WEBHOOKS_LOCAL: '1',
          LIMITE_CLAVE_POR_MINUTO: '40',
        },
      },
    }),
  ],
  test: { setupFiles: ['./test/setup.ts'], testTimeout: 30_000 },
}))
