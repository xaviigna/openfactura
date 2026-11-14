import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { organization } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/d1'
import * as authSchema from './db/auth-schema'
import type { Bindings } from './env'
import type { CambioMiembro, Extension } from './extensiones'
import { AppError } from './lib/errors'
import { hashPassword, verifyPassword } from './lib/password'

export function opcionesAuth(
  env: Pick<Bindings, 'APP_URL' | 'BETTER_AUTH_SECRET' | 'TRUSTED_ORIGINS'>,
) {
  return {
    appName: 'Open Factura',
    baseURL: env.APP_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [
      env.APP_URL,
      ...(env.TRUSTED_ORIGINS?.split(',')
        .map((o) => o.trim())
        .filter(Boolean) ?? []),
    ],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    // Límite general por IP; el inicio de sesión y el registro conservan los topes propios, más
    // estrictos, de Better Auth. Una oficina entera suele salir por una sola IP.
    rateLimit: { enabled: true, storage: 'database' as const, window: 60, max: 200 },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    plugins: [organization({ allowUserToCreateOrganization: true })],
  }
}

/**
 * `extensiones`: las que escuchan `alCambiarMiembro` (alguien salió de una organización o le
 * cambiaron el rol). Sólo hacen falta en el manejador de /api/auth, que es donde eso ocurre.
 */
export function createAuth(env: Bindings, extensiones: readonly Extension[] = []) {
  const avisar = async (datos: CambioMiembro) => {
    for (const e of extensiones) {
      if (!e.alCambiarMiembro) continue
      try {
        await e.alCambiarMiembro(env, datos)
      } catch (error) {
        console.error(`Falló alCambiarMiembro de la extensión ${e.id}`, error)
      }
    }
  }
  return betterAuth({
    ...opcionesAuth(env),
    hooks: {
      // Salir por cuenta propia (/organization/leave) no pasa por afterRemoveMember.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/organization/leave' || isAPIError(ctx.context.returned)) return
        // Devuelve la membresía que se borró (la sesión no llega a este gancho).
        const salida = ctx.context.returned as { userId?: string; organizationId?: string } | null
        if (salida?.userId && salida.organizationId) {
          await avisar({ organizationId: salida.organizationId, userId: salida.userId, rol: null })
        }
      }),
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        organizationHooks: {
          beforeDeleteOrganization: async ({ organization: org }) => {
            for (const e of extensiones) {
              try {
                await e.antesDeBorrarOrganizacion?.(env, org.id)
              } catch (error) {
                throw new APIError('BAD_REQUEST', {
                  code: error instanceof AppError ? error.code : 'no_se_puede_borrar',
                  message: error instanceof Error ? error.message : 'No se puede borrar',
                })
              }
            }
          },
          afterRemoveMember: ({ member }) =>
            avisar({ organizationId: member.organizationId, userId: member.userId, rol: null }),
          afterUpdateMemberRole: ({ member }) =>
            avisar({
              organizationId: member.organizationId,
              userId: member.userId,
              rol: member.role,
            }),
        },
      }),
    ],
    database: drizzleAdapter(drizzle(env.DB), { provider: 'sqlite', schema: authSchema }),
  })
}

export type Auth = ReturnType<typeof createAuth>
