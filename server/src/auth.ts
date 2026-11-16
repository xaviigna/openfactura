import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { organization } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/d1'
import * as authSchema from './db/auth-schema'
import type { Bindings } from './env'
import type { CambioMiembro, CorreoCuenta, Extension } from './extensiones'
import { confirmacionConClave, PAGINA_CONFIRMAR } from './lib/confirmacion'
import { amplia, puedeInvitar } from './lib/equipo'
import { AppError } from './lib/errors'
import { proveedorGithub, SIN_TOKENS } from './lib/github'
import { hashPassword, verifyPassword } from './lib/password'
import { accionTurnstile, verificarTurnstile } from './lib/turnstile'
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
        // Confirmar el correo con la contraseña: no debe servir para adivinarla desde una IP.
        '/confirmar-correo': { window: 300, max: 10 },
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
 * Topes de correo por dirección y hora (ventanas fijas en D1). Cada vía tiene el suyo, así que el
 * reenvío anónimo no gasta el de lo que hace la dueña:
 *
 * - Alta: siempre manda su enlace (reemplaza la cuenta sin confirmar e invalida los anteriores, así
 *   que el enlace más reciente siempre llega). La limita ALTAS_POR_HORA.
 * - Inicio de sesión sin confirmar (necesita la contraseña): CONFIRMACIONES_POR_HORA, compartido con
 *   las altas; pasado el tope responde igual pero no manda correo.
 * - Reenvío anónimo (`/send-verification-email`): REENVIOS_POR_HORA; pasado el tope, 429.
 * - Recuperar la contraseña: RESTABLECIMIENTOS_POR_HORA; pasado el tope responde igual (200, para no
 *   delatar si hay cuenta) pero no manda correo.
 *
 * En total, a lo sumo 5 + 6 + 3 confirmaciones y 3 restablecimientos por dirección y hora.
 */
const CONFIRMACIONES_POR_HORA = 6
const REENVIOS_POR_HORA = 3
const RESTABLECIMIENTOS_POR_HORA = 3

/**
 * Altas por dirección y hora. Un alta con el correo de una cuenta sin confirmar la reemplaza; sin
 * este tope, cualquiera (cambiando de IP) podría reemplazar sin fin la de otra persona. Cada alta
 * manda un enlace a la dirección, y con cualquiera de ellos la dueña define su contraseña; también
 * le sirve «Olvidé mi contraseña».
 */
const ALTAS_POR_HORA = 5

/** Organizaciones de las que una persona es propietaria; las que la invitan no cuentan. */
const ORGANIZACIONES_POR_PERSONA = 10

/** Topes de los campos que la persona escribe en su cuenta y en sus organizaciones. */
const TOPES = { nombre: 120, slug: 60, metadatos: 4096, url: 2048 }

const direccionDe = (correo: string) => correo.trim().toLowerCase()

const campoInvalido = (message: string) =>
  new APIError('BAD_REQUEST', { code: 'datos_invalidos', message })

/** Una imagen o un logo: vacío, o una URL https de 2 KB o menos (nada de `javascript:` ni `data:`). */
function validarUrlImagen(valor: unknown, campo: string) {
  if (valor === undefined || valor === null || valor === '') return
  if (typeof valor !== 'string' || valor.length > TOPES.url) {
    throw campoInvalido(`${campo}: una URL https de ${TOPES.url} caracteres o menos`)
  }
  let protocolo = ''
  try {
    protocolo = new URL(valor).protocol
  } catch {}
  if (protocolo !== 'https:') throw campoInvalido(`${campo}: debe ser una URL https://`)
}

function validarTexto(valor: unknown, tope: number, campo: string) {
  if (valor === undefined || valor === null) return
  if (typeof valor === 'string' && valor.length <= tope) return
  throw campoInvalido(`${campo}: ${tope} caracteres como máximo`)
}

/**
 * Topes de longitud de lo que la persona escribe: su nombre e imagen (alta y `/update-user`) y el
 * nombre, identificador, logo y metadatos de sus organizaciones.
 */
function validarCampos(ruta: string, cuerpo: unknown) {
  if (!cuerpo || typeof cuerpo !== 'object') return
  const b = cuerpo as Record<string, unknown>
  if (ruta === '/sign-up/email' || ruta === '/update-user') {
    validarTexto(b.name, TOPES.nombre, 'name')
    validarUrlImagen(b.image, 'image')
    return
  }
  const org =
    ruta === '/organization/create'
      ? b
      : ruta === '/organization/update' && b.data && typeof b.data === 'object'
        ? (b.data as Record<string, unknown>)
        : null
  if (!org) return
  validarTexto(org.name, TOPES.nombre, 'name')
  validarTexto(org.slug, TOPES.slug, 'slug')
  validarUrlImagen(org.logo, 'logo')
  if (org.metadata !== undefined && org.metadata !== null) {
    const json = typeof org.metadata === 'string' ? org.metadata : JSON.stringify(org.metadata)
    if (new TextEncoder().encode(json).length > TOPES.metadatos) {
      throw campoInvalido(`metadata: ${TOPES.metadatos / 1024} KB como máximo`)
    }
  }
}

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
  const bienvenida = async (user: Persona & { createdAt: Date }) => {
    // Las cuentas viejas que confirman después no la reciben.
    if (Date.now() - new Date(user.createdAt).getTime() < BIENVENIDA_MS) {
      await correo('bienvenida', user)
    }
  }
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
        // Tope por dirección (la ruta tiene además el suyo por IP). Pasado, la respuesta no cambia.
        sendResetPassword: async ({ user, url }: { user: Persona; url: string }) => {
          const uso = await consumir(
            env.DB,
            `restablecer:${direccionDe(user.email)}`,
            RESTABLECIMIENTOS_POR_HORA,
            3600,
          )
          if (uso.permitido) await correo('restablecer', user, url)
        },
        // Quien recupera la contraseña quizá ya no controla sus sesiones abiertas: se cierran todas.
        revokeSessionsOnPasswordReset: true,
        // El enlace llegó a su buzón: si el correo no estaba confirmado, queda confirmado. Es la
        // salida de quien se encuentra su dirección registrada por otra persona.
        onPasswordReset: async ({
          user,
        }: {
          user: Persona & { id: string; emailVerified: boolean; createdAt: Date }
        }) => {
          await correo('clave_cambiada', user)
          if (user.emailVerified) return
          await env.DB.prepare(
            'UPDATE user SET email_verified = 1, updated_at = ?2 WHERE id = ?1 AND email_verified = 0',
          )
            .bind(user.id, Date.now())
            .run()
          await bienvenida(user)
        },
      },
      emailVerification: {
        sendOnSignUp: true,
        sendOnSignIn: true,
        // El enlace del correo ya no confirma por sí solo (ver lib/confirmacion.ts).
        autoSignInAfterVerification: false,
        sendVerificationEmail: async (
          { user, token, url }: { user: Persona; token: string; url: string },
          peticion?: Request,
        ) => {
          const ruta = peticion ? new URL(peticion.url).pathname : ''
          const direccion = direccionDe(user.email)
          // El reenvío ya pasó por su tope en el gancho `before`.
          if (!ruta.endsWith('/send-verification-email')) {
            const uso = await consumir(
              env.DB,
              `confirmar:${direccion}`,
              CONFIRMACIONES_POR_HORA,
              3600,
            )
            if (!uso.permitido && !ruta.endsWith('/sign-up/email')) return
          }
          // El enlace lleva a la página del panel que pide la contraseña (o una nueva).
          const destino = new URL(PAGINA_CONFIRMAR, env.APP_URL)
          destino.searchParams.set('token', token)
          const volver = new URL(url).searchParams.get('callbackURL')
          if (volver) destino.searchParams.set('callbackURL', volver)
          await correo('verificar', user, destino.href)
        },
        // Bienvenida al confirmar.
        afterEmailVerification: bienvenida,
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
      before: createAuthMiddleware(async (ctx) => {
        validarCampos(ctx.path, ctx.body)
        if (!enviar) return
        // El enlace viejo (`/verify-email`) ya no confirma: lleva a la página que pide la contraseña.
        if (ctx.path === '/verify-email') {
          const destino = new URL(PAGINA_CONFIRMAR, env.APP_URL)
          const { token, callbackURL } = (ctx.query ?? {}) as Record<string, unknown>
          if (typeof token === 'string') destino.searchParams.set('token', token)
          if (
            typeof callbackURL === 'string' &&
            ctx.context.isTrustedOrigin(callbackURL, { allowRelativePaths: true })
          ) {
            destino.searchParams.set('callbackURL', callbackURL)
          }
          throw ctx.redirect(destino.href)
        }
        // Reenvío anónimo: tope propio por dirección, exista o no la cuenta (no delata nada).
        if (ctx.path === '/send-verification-email') {
          const email = (ctx.body as { email?: unknown } | undefined)?.email
          if (typeof email !== 'string') return
          const uso = await consumir(
            env.DB,
            `reenvio:${direccionDe(email)}`,
            REENVIOS_POR_HORA,
            3600,
          )
          if (!uso.permitido) {
            throw new APIError('TOO_MANY_REQUESTS', {
              code: 'demasiados_reenvios',
              message:
                'Ya enviamos varios enlaces a este correo. Usa el más reciente o «Olvidé mi contraseña».',
            })
          }
          return
        }
        // Quien se registra con una dirección que ya tiene una cuenta sin confirmar (y sin uso) la
        // reemplaza: la contraseña de esa cuenta pudo ponerla otra persona, y no debe sobrevivir a
        // que la dueña real confirme el correo. Los enlaces de confirmación llevan el id del usuario
        // viejo, así que dejan de servir.
        if (ctx.path === '/sign-up/email') {
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
        }
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
      ...(enviar ? [confirmacionConClave(env.DB)] : []),
      organization({
        allowUserToCreateOrganization: true,
        // Cuenta sólo las organizaciones propias: las invitaciones (y los espacios de clientes que
        // administra una plataforma) no quitan cupo.
        organizationLimit: async (user) => {
          const fila = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM member
             WHERE user_id = ?1 AND (',' || replace(role, ' ', '') || ',') LIKE '%,owner,%'`,
          )
            .bind(user.id)
            .first<{ n: number }>()
          return (fila?.n ?? 0) >= ORGANIZACIONES_POR_PERSONA
        },
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
  // Turnstile va antes que todo, incluido el hash de la contraseña.
  const accion = accionTurnstile(env, peticion)
  if (accion) {
    const rechazo = await verificarTurnstile(env, peticion, accion)
    if (rechazo) return rechazo
  }
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
