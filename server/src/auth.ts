import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { organization } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/d1'
import * as authSchema from './db/auth-schema'
import type { Bindings } from './env'
import type { CambioMiembro, CorreoCuenta, Extension } from './extensiones'
import { amplia, puedeInvitar } from './lib/equipo'
import { AppError } from './lib/errors'
import { proveedorGithub, SIN_TOKENS } from './lib/github'
import { hashPassword, verifyPassword } from './lib/password'
import { consumir } from './services/limites'

export function opcionesAuth(
  env: Pick<
    Bindings,
    | 'APP_URL'
    | 'BETTER_AUTH_SECRET'
    | 'TRUSTED_ORIGINS'
    | 'GITHUB_CLIENT_ID'
    | 'GITHUB_CLIENT_SECRET'
  >,
) {
  const github = proveedorGithub(env)
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
    rateLimit: {
      enabled: true,
      storage: 'database' as const,
      window: 60,
      max: 200,
      // Estas rutas mandan un correo a una dirección que puede ser ajena: tope aparte.
      customRules: {
        '/send-verification-email': { window: 300, max: 3 },
        '/request-password-reset': { window: 300, max: 3 },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    ...(github && { socialProviders: { github } }),
    // Un ingreso externo sólo se une a una cuenta local cuyo correo ya está confirmado (valor por
    // defecto, aquí explícito): si no, la contraseña de esa cuenta pudo ponerla otra persona.
    account: { accountLinking: { enabled: true, requireLocalEmailVerified: true } },
    // El token del proveedor sólo sirve para saber quién es la persona: no se guarda.
    databaseHooks: {
      account: {
        create: {
          before: async (cuenta: { providerId: string }) =>
            cuenta.providerId === 'credential' ? undefined : { data: { ...cuenta, ...SIN_TOKENS } },
        },
        update: {
          before: async (cuenta: Record<string, unknown>) =>
            'accessToken' in cuenta || 'refreshToken' in cuenta || 'idToken' in cuenta
              ? { data: { ...cuenta, ...SIN_TOKENS } }
              : undefined,
        },
      },
    },
    plugins: [organization({ allowUserToCreateOrganization: true })],
  }
}

/** Función de envío de los correos de la cuenta que ofrece alguna extensión, o `null`. */
export const envioDeCuenta = (env: Bindings, extensiones: readonly Extension[] = []) =>
  extensiones.map((e) => e.correosDeCuenta?.(env)).find((enviar) => enviar != null) ?? null

/**
 * Correos de confirmación por dirección y hora, sea cual sea lo que los dispare (alta, reenvío o
 * inicio de sesión sin confirmar): el alta y 3 reenvíos de `/send-verification-email`.
 */
const CONFIRMACIONES_POR_HORA = 4

/**
 * Altas por dirección y hora. Un alta con el correo de una cuenta sin confirmar la reemplaza; sin
 * este tope, cualquiera (cambiando de IP) podría reemplazar sin fin la de otra persona e invalidar
 * su enlace. Pasado el tope, la dueña recupera la cuenta con «Olvidé mi contraseña».
 */
const ALTAS_POR_HORA = 5

/** Una cuenta es «nueva» para la bienvenida durante este tiempo desde que se creó. */
const BIENVENIDA_MS = 7 * 24 * 60 * 60 * 1000

type Persona = { email: string; name: string }

/**
 * `extensiones`: las que escuchan `alCambiarMiembro` (alguien salió de una organización o le
 * cambiaron el rol) o envían los correos de la cuenta. Sólo hacen falta en el manejador de
 * /api/auth, que es donde eso ocurre. `enSegundoPlano`: `waitUntil` de la petición; los correos no
 * retrasan la respuesta ni delatan, por lo que tarda, si una dirección tiene cuenta.
 */
export function createAuth(
  env: Bindings,
  extensiones: readonly Extension[] = [],
  enSegundoPlano?: (tarea: Promise<unknown>) => void,
) {
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
  /** Una extensión puede impedir los cambios del equipo: su AppError llega como error de la API. */
  const antesDeCambiarEquipo = async (organizationId: string) => {
    for (const e of extensiones) {
      try {
        await e.antesDeCambiarEquipo?.(env, organizationId)
      } catch (error) {
        throw new APIError('FORBIDDEN', {
          code: error instanceof AppError ? error.code : 'no_se_puede_cambiar',
          message: error instanceof Error ? error.message : 'No se puede cambiar el equipo',
        })
      }
    }
  }
  /** Una invitación pendiente sólo vale mientras quien la hizo siga pudiendo invitar. */
  const cancelarInvitaciones = async (organizationId: string, userId: string) => {
    await env.DB.prepare(
      `UPDATE invitation SET status = 'canceled'
       WHERE organization_id = ?1 AND inviter_id = ?2 AND status = 'pending'`,
    )
      .bind(organizationId, userId)
      .run()
  }
  const opciones = opcionesAuth(env)
  const enviar = envioDeCuenta(env, extensiones)
  /** Nunca lanza ni registra el mensaje (puede llevar un enlace con token). */
  const correo = async (tipo: CorreoCuenta['tipo'], persona: Persona, url?: string) => {
    if (!enviar) return
    const base = { correo: persona.email, nombre: persona.name }
    const tarea = enviar(
      tipo === 'verificar' || tipo === 'restablecer'
        ? { ...base, tipo, url: url ?? '' }
        : { ...base, tipo },
    ).catch((error) => console.error(`No se pudo enviar el correo de cuenta «${tipo}»`, error))
    if (enSegundoPlano) enSegundoPlano(tarea)
    else await tarea
  }
  return betterAuth({
    ...opciones,
    // Con una extensión que envía correo, nadie inicia sesión sin confirmar el suyo: así una cuenta
    // creada con el correo de otra persona no sirve de nada. Sin ella, todo sigue como antes.
    ...(enviar && {
      emailAndPassword: {
        ...opciones.emailAndPassword,
        requireEmailVerification: true,
        sendResetPassword: ({ user, url }: { user: Persona; url: string }) =>
          correo('restablecer', user, url),
        // Quien recupera la contraseña quizá ya no controla sus sesiones abiertas: se cierran todas.
        revokeSessionsOnPasswordReset: true,
        onPasswordReset: ({ user }: { user: Persona }) => correo('clave_cambiada', user),
      },
      emailVerification: {
        sendOnSignUp: true,
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
        // Un solo tope por dirección para todo envío de confirmación: la ruta de reenvío tiene el
        // suyo, pero el alta y el inicio de sesión sin confirmar mandan correo por otra vía.
        sendVerificationEmail: async ({ user, url }: { user: Persona; url: string }) => {
          const uso = await consumir(
            env.DB,
            `confirmar:${user.email.trim().toLowerCase()}`,
            CONFIRMACIONES_POR_HORA,
            3600,
          )
          if (uso.permitido) await correo('verificar', user, url)
        },
        // Bienvenida al confirmar. Las cuentas viejas que confirman después no la reciben.
        afterEmailVerification: async (user: Persona & { createdAt: Date }) => {
          if (Date.now() - new Date(user.createdAt).getTime() < BIENVENIDA_MS) {
            await correo('bienvenida', user)
          }
        },
      },
      databaseHooks: {
        ...opciones.databaseHooks,
        // Quien entra con un proveedor externo ya llega con el correo confirmado.
        user: {
          create: {
            after: async (user: Persona & { emailVerified: boolean }) => {
              if (user.emailVerified) await correo('bienvenida', user)
            },
          },
        },
      },
    }),
    hooks: {
      // Quien se registra con una dirección que ya tiene una cuenta sin confirmar (y sin uso) la
      // reemplaza: la contraseña de esa cuenta pudo ponerla otra persona, y no debe sobrevivir a
      // que la dueña real confirme el correo. Los enlaces de confirmación llevan el id del usuario
      // viejo, así que dejan de servir.
      ...(enviar && {
        before: createAuthMiddleware(async (ctx) => {
          if (ctx.path !== '/sign-up/email') return
          const { email, password, name } = (ctx.body ?? {}) as {
            email?: unknown
            password?: unknown
            name?: unknown
          }
          // Sólo un alta que va a prosperar reemplaza la cuenta vieja (si falla la validación, no).
          if (typeof email !== 'string' || typeof password !== 'string') return
          if (typeof name !== 'string' || !name.trim()) return
          if (password.length < opciones.emailAndPassword.minPasswordLength) return
          const direccion = email.trim().toLowerCase()
          const altas = await consumir(env.DB, `alta:${direccion}`, ALTAS_POR_HORA, 3600)
          if (!altas.permitido) {
            throw new APIError('TOO_MANY_REQUESTS', {
              message:
                'Demasiados registros con este correo. Revisa tu bandeja o usa «Olvidé mi contraseña».',
            })
          }
          const existente = await ctx.context.internalAdapter.findUserByEmail(direccion)
          if (!existente || existente.user.emailVerified) return
          // Sin sesiones ni equipo: una cuenta vieja (de antes de exigir la confirmación) que ya se
          // usa no se toca.
          const uso = await env.DB.prepare(
            `SELECT (SELECT COUNT(*) FROM session WHERE user_id = ?1)
                  + (SELECT COUNT(*) FROM member WHERE user_id = ?1) AS n`,
          )
            .bind(existente.user.id)
            .first<{ n: number }>()
          if (!uso || uso.n > 0) return
          await ctx.context.internalAdapter.deleteUser(existente.user.id)
          await env.DB.prepare('DELETE FROM verification WHERE value = ?1')
            .bind(existente.user.id)
            .run()
        }),
      }),
      // Salir por cuenta propia (/organization/leave) no pasa por afterRemoveMember.
      after: createAuthMiddleware(async (ctx) => {
        if (isAPIError(ctx.context.returned)) return
        if (ctx.path === '/change-password') {
          const persona = ctx.context.session?.user
          if (persona) await correo('clave_cambiada', persona)
          return
        }
        if (ctx.path !== '/organization/leave') return
        // Devuelve la membresía que se borró (la sesión no llega a este gancho).
        const salida = ctx.context.returned as { userId?: string; organizationId?: string } | null
        if (salida?.userId && salida.organizationId) {
          await cancelarInvitaciones(salida.organizationId, salida.userId)
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
          beforeCreateInvitation: ({ organization: org }) => antesDeCambiarEquipo(org.id),
          beforeAcceptInvitation: async ({ organization: org, invitation }) => {
            await antesDeCambiarEquipo(org.id)
            // La invitación vale mientras quien invitó siga en el equipo y pueda invitar.
            const invitador = await env.DB.prepare(
              'SELECT role FROM member WHERE organization_id = ?1 AND user_id = ?2',
            )
              .bind(org.id, invitation.inviterId)
              .first<{ role: string }>()
            if (!puedeInvitar(invitador?.role)) {
              throw new APIError('FORBIDDEN', {
                code: 'invitacion_sin_vigencia',
                message: 'Quien te invitó ya no puede invitar: pide una invitación nueva',
              })
            }
          },
          // Quitar o bajar de rol no se bloquea con el plan vencido: es quitar acceso, no darlo.
          beforeUpdateMemberRole: async ({ organization: org, member, newRole }) => {
            if (amplia(member.role, newRole)) await antesDeCambiarEquipo(org.id)
          },
          afterRemoveMember: async ({ member }) => {
            await cancelarInvitaciones(member.organizationId, member.userId)
            await avisar({
              organizationId: member.organizationId,
              userId: member.userId,
              rol: null,
            })
          },
          afterUpdateMemberRole: async ({ member }) => {
            if (!puedeInvitar(member.role)) {
              await cancelarInvitaciones(member.organizationId, member.userId)
            }
            await avisar({
              organizationId: member.organizationId,
              userId: member.userId,
              rol: member.role,
            })
          },
        },
      }),
    ],
    database: drizzleAdapter(drizzle(env.DB), { provider: 'sqlite', schema: authSchema }),
  })
}

export type Auth = ReturnType<typeof createAuth>

const ALFABETO_ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Atiende `/api/auth/*`. Dos altas simultáneas con el mismo correo: Better Auth comprueba que no
 * exista y luego inserta, sin bloqueo, y la que pierde la carrera choca con el índice único y
 * responde 422. Con confirmación de correo, se responde igual que a un correo que ya tiene cuenta
 * (200 sin sesión, con un usuario sintético), para no delatar el alta en curso.
 */
export async function atenderAuth(
  env: Bindings,
  extensiones: readonly Extension[] = [],
  enSegundoPlano: (tarea: Promise<unknown>) => void,
  peticion: Request,
): Promise<Response> {
  const alta =
    peticion.method === 'POST' &&
    new URL(peticion.url).pathname === '/api/auth/sign-up/email' &&
    envioDeCuenta(env, extensiones) !== null
  const copia = alta ? peticion.clone() : null
  const respuesta = await createAuth(env, extensiones, enSegundoPlano).handler(peticion)
  if (!copia || respuesta.status !== 422) return respuesta
  const error = (await respuesta
    .clone()
    .json()
    .catch(() => null)) as { code?: string } | null
  if (error?.code !== 'FAILED_TO_CREATE_USER') return respuesta
  const { email, name } = (await copia.json().catch(() => ({}))) as {
    email?: unknown
    name?: unknown
  }
  if (typeof email !== 'string') return respuesta
  const correo = email.trim().toLowerCase()
  const existe = await env.DB.prepare('SELECT 1 AS n FROM user WHERE email = ?1')
    .bind(correo)
    .first()
  if (!existe) return respuesta
  const ahora = new Date()
  const azar = crypto.getRandomValues(new Uint8Array(32))
  return Response.json({
    token: null,
    user: {
      id: [...azar].map((b) => ALFABETO_ID[b % ALFABETO_ID.length]).join(''),
      name: typeof name === 'string' ? name : '',
      email: correo,
      emailVerified: false,
      image: null,
      createdAt: ahora,
      updatedAt: ahora,
    },
  })
}
