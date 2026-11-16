import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { verifyJWT } from 'better-auth/crypto'
import * as z from 'zod'
import { consumir } from '../services/limites'

/**
 * Intentos con contraseña por cuenta y hora en la confirmación del correo. El enlace no debe servir
 * para adivinar la contraseña de quien se registró; pasado el tope queda «Define una contraseña
 * nueva», que no la necesita.
 */
export const INTENTOS_DE_CLAVE_POR_HORA = 5

/** Página del panel a la que lleva el enlace del correo «Confirma tu correo». */
export const PAGINA_CONFIRMAR = '/auth/confirmar'

/**
 * `POST /api/auth/confirmar-correo`: segundo paso de la confirmación del correo. El enlace del correo
 * sólo prueba que quien lo abre controla el buzón; no basta para entrar, porque la cuenta pudo
 * crearla otra persona con una contraseña que conoce. Con el token del enlace:
 *
 * - `password`: la contraseña con la que se registró. Si es la correcta, confirma y abre sesión.
 * - `newPassword`: quien no la conoce define una nueva. Reemplaza la anterior (la de quien haya
 *   creado la cuenta deja de servir), cierra todas las sesiones, confirma y abre sesión.
 *
 * El token es el JWT que firma Better Auth para `/verify-email` (lleva el correo y el id del
 * usuario). Una cuenta ya confirmada no acepta más el enlace.
 */
export const confirmacionConClave = (d1: D1Database) =>
  ({
    id: 'confirmar-correo',
    endpoints: {
      confirmarCorreo: createAuthEndpoint(
        '/confirmar-correo',
        {
          method: 'POST',
          body: z
            .object({
              token: z.string().min(1).max(4096),
              password: z.string().min(1).optional(),
              newPassword: z.string().optional(),
            })
            .refine((b) => (b.password === undefined) !== (b.newPassword === undefined), {
              message: 'Envía la contraseña o una contraseña nueva, no ambas',
            }),
          use: [formCsrfMiddleware],
        },
        async (ctx) => {
          const { token, password, newPassword } = ctx.body
          const datos = await verifyJWT<Record<string, unknown>>(token, ctx.context.secret)
          // Sólo los enlaces de confirmación de una cuenta: los de cambio de correo llevan `updateTo`.
          if (
            !datos ||
            typeof datos.email !== 'string' ||
            typeof datos.userId !== 'string' ||
            datos.updateTo !== undefined ||
            datos.requestType !== undefined
          ) {
            throw new APIError('BAD_REQUEST', {
              code: 'INVALID_TOKEN',
              message: 'El enlace venció o no es válido',
            })
          }
          const usuario = await ctx.context.internalAdapter.findUserById(datos.userId)
          // Si otra alta reemplazó la cuenta, el id ya no existe y el enlace deja de servir.
          if (!usuario || usuario.email.toLowerCase() !== datos.email.toLowerCase()) {
            throw new APIError('BAD_REQUEST', {
              code: 'INVALID_TOKEN',
              message: 'El enlace venció o no es válido',
            })
          }
          if (usuario.emailVerified) {
            throw new APIError('BAD_REQUEST', {
              code: 'EMAIL_ALREADY_VERIFIED',
              message: 'Tu correo ya está confirmado. Inicia sesión.',
            })
          }
          const { minPasswordLength, maxPasswordLength } = ctx.context.password.config
          const credencial = await ctx.context.internalAdapter.findCredentialAccount(usuario.id)

          if (password !== undefined) {
            const intentos = await consumir(
              d1,
              `confirmar-clave:${usuario.id}`,
              INTENTOS_DE_CLAVE_POR_HORA,
              3600,
            )
            if (!intentos.permitido) {
              throw new APIError('TOO_MANY_REQUESTS', {
                code: 'demasiados_intentos',
                message:
                  'Demasiados intentos con contraseña. Define una contraseña nueva para confirmar tu correo.',
              })
            }
            const correcta =
              password.length <= maxPasswordLength &&
              !!credencial?.password &&
              (await ctx.context.password.verify({ hash: credencial.password, password }))
            if (!correcta) {
              throw new APIError('UNAUTHORIZED', {
                code: 'INVALID_PASSWORD',
                message: 'No es la contraseña con la que se creó la cuenta',
              })
            }
          } else {
            const nueva = newPassword ?? ''
            if (nueva.length < minPasswordLength) {
              throw new APIError('BAD_REQUEST', {
                code: 'PASSWORD_TOO_SHORT',
                message: `La contraseña debe tener al menos ${minPasswordLength} caracteres`,
              })
            }
            if (nueva.length > maxPasswordLength) {
              throw new APIError('BAD_REQUEST', {
                code: 'PASSWORD_TOO_LONG',
                message: 'La contraseña es demasiado larga',
              })
            }
            const hash = await ctx.context.password.hash(nueva)
            // Nadie conserva una sesión abierta con la contraseña anterior.
            await ctx.context.internalAdapter.deleteUserSessions(usuario.id)
            if (credencial) await ctx.context.internalAdapter.updatePassword(usuario.id, hash)
            else {
              await ctx.context.internalAdapter.createAccount({
                userId: usuario.id,
                providerId: 'credential',
                accountId: usuario.id,
                password: hash,
              })
            }
          }

          const confirmado = await ctx.context.internalAdapter.updateUser(usuario.id, {
            emailVerified: true,
          })
          await ctx.context.options.emailVerification?.afterEmailVerification?.(
            confirmado,
            ctx.request,
          )
          const sesion = await ctx.context.internalAdapter.createSession(usuario.id)
          if (!sesion) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              code: 'FAILED_TO_CREATE_SESSION',
              message: 'No se pudo abrir la sesión',
            })
          }
          await setSessionCookie(ctx, { session: sesion, user: confirmado })
          return ctx.json({ status: true })
        },
      ),
    },
  }) satisfies BetterAuthPlugin
