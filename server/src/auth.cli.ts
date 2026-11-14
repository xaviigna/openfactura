// Sólo para la CLI de Better Auth (`bun run auth:schema`): genera src/db/auth-schema.ts.
// Usa un driver SQLite simulado: la CLI sólo necesita conocer el dialecto y los plugins.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { opcionesAuth } from './auth'

export const auth = betterAuth({
  ...opcionesAuth({
    APP_URL: 'http://localhost:8788',
    BETTER_AUTH_SECRET: 'solo-para-generar-el-esquema-0000',
  }),
  database: drizzleAdapter(
    drizzle(async () => ({ rows: [] })),
    { provider: 'sqlite' },
  ),
})
