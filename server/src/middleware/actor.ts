import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { matchedRoutes } from 'hono/route'
import { createAuth } from '../auth'
import { type Actor, actorDeMiembro, type Ctx } from '../contexto'
import { crearDb, member } from '../db'
import type { Bindings } from '../env'
import type { Extension } from '../extensiones'
import { actorAdmin, esTokenAdmin } from '../lib/admin'
import { AppError, noAutenticado } from '../lib/errors'
import { verificarClave } from '../services/claves'
import { consumir, type ResultadoLimite } from '../services/limites'
import { anotarPeticion } from '../services/registros'

export type Entorno = {
  Bindings: Bindings
  Variables: {
    ctx: Ctx
    usuario?: { id: string; nombre: string; correo: string }
    rol?: string
    /** Extensiones instaladas (las fija `crearWorker`): enlaces del panel y ganchos. */
    extensiones?: readonly Extension[]
  }
}

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Intentos con una clave inválida que se toleran por IP y minuto. */
const LIMITE_CLAVES_INVALIDAS = 30
/** Peticiones por minuto de una sesión del panel. */
const LIMITE_SESION = 600

/**
 * Dirección del cliente para los límites. En Cloudflare `cf-connecting-ip` lo fija el borde y no
 * se puede falsificar. IPv6 se agrupa por /64: una misma red no obtiene un cubo por dirección.
 */
export function ipCliente(encabezado: string | undefined): string {
  if (!encabezado) return 'local'
  if (!encabezado.includes(':')) return encabezado
  return `${encabezado.split(':').slice(0, 4).join(':')}::/64`
}

const excedido = (uso: ResultadoLimite, mensaje: string) =>
  new AppError(429, 'limite_excedido', mensaje, { reintentarEn: uso.reinicioEn })

/**
 * Una petición con cookie que modifica datos debe venir del propio sitio (defensa contra CSRF,
 * además de SameSite=Lax). Se compara el origen completo, esquema incluido.
 */
function origenPermitido(
  env: Bindings,
  peticion: { url: string; origin?: string; sitio?: string },
) {
  if (peticion.sitio === 'cross-site') return false
  if (!peticion.origin) return true // clientes que no son navegadores no envían Origin
  const permitidos = [env.APP_URL, ...(env.TRUSTED_ORIGINS?.split(',') ?? [])].map((o) => o.trim())
  return permitidos.includes(peticion.origin) || peticion.origin === new URL(peticion.url).origin
}

/**
 * Patrón de la ruta que atiende la petición (`/api/v1/dte/:codigo`), para los registros: nunca la
 * URL real, que lleva identificadores. Una ruta desconocida queda como `/api/*`.
 */
const patronDeRuta = (c: Context<Entorno>) =>
  matchedRoutes(c).find((r) => !r.path.endsWith('*'))?.path ?? '/api/*'

/**
 * Resuelve quién hace la petición y deja `ctx` listo para los servicios.
 * - `Authorization: Bearer of_…` → clave de API (con límite de peticiones por clave).
 * - `Authorization: Bearer <ADMIN_TOKEN>` + `X-Organizacion` → el operador de una instalación propia,
 *   con todos los permisos sobre esa organización (sólo en la API REST; ver lib/admin.ts).
 * - Cookie de sesión → usuario del panel, con los permisos de su rol en la organización activa.
 *   Con `soloClave` (MCP) las cookies no se aceptan.
 */
type ContextoHono = Parameters<Parameters<typeof createMiddleware<Entorno>>[0]>[0]

/** Sesión del navegador comprobada: existe, viene de un origen permitido (CSRF) y no abusa. */
async function sesionVerificada(c: ContextoHono) {
  const sesion = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers })
  if (!sesion) throw noAutenticado()
  if (
    !METODOS_SEGUROS.has(c.req.method) &&
    !origenPermitido(c.env, {
      url: c.req.url,
      origin: c.req.header('origin'),
      sitio: c.req.header('sec-fetch-site'),
    })
  ) {
    throw new AppError(403, 'origen_no_permitido', 'Origen de la petición no permitido')
  }
  const uso = await consumir(c.env.DB, `sesion:${sesion.user.id}`, LIMITE_SESION)
  if (!uso.permitido) {
    c.header('Retry-After', String(uso.reinicioEn))
    throw excedido(uso, 'Demasiadas peticiones. Intenta de nuevo en un momento.')
  }
  return sesion
}

/**
 * Sólo la persona, sin organización: para lo que se hace antes de pertenecer a una (p. ej. activar
 * una cuenta que alguien preparó). Deja `usuario` en el contexto; no hay `ctx` ni permisos.
 */
export const autenticarUsuario = () =>
  createMiddleware<Entorno>(async (c, next) => {
    const sesion = await sesionVerificada(c)
    c.set('usuario', { id: sesion.user.id, nombre: sesion.user.name, correo: sesion.user.email })
    await next()
  })

export const autenticar = (origen: Actor['origen'], opciones: { soloClave?: boolean } = {}) =>
  createMiddleware<Entorno>(async (c, next) => {
    const db = crearDb(c.env.DB)
    const ip = c.req.header('cf-connecting-ip')
    const autorizacion = c.req.header('authorization')
    const inicio = Date.now()
    let actor: Actor
    // `executionCtx` sólo existe dentro de un Worker; fuera de él, los webhooks esperan al cron.
    let ejecucion: ExecutionContext | undefined
    try {
      ejecucion = c.executionCtx as ExecutionContext
    } catch {}
    /** Anota la petición de una clave después de responder: no agrega latencia ni puede fallarla. */
    const anotar = (clave: Actor, estado: number) => {
      const tarea = anotarPeticion(db, {
        organizationId: clave.organizationId,
        claveId: clave.id,
        metodo: c.req.method,
        ruta: patronDeRuta(c),
        estado,
        duracionMs: Date.now() - inicio,
        origen: origen === 'mcp' ? 'mcp' : 'api',
      }).catch((error) => console.error('No se pudo anotar la petición', error))
      ejecucion?.waitUntil(tarea)
    }

    if (autorizacion) {
      const [esquema, token] = autorizacion.trim().split(/\s+/)
      const portador = esquema?.toLowerCase() === 'bearer' && token ? token : undefined
      // ADMIN_TOKEN (instalación propia sin panel) sólo vale en la API REST, nunca en el MCP.
      const admin = origen === 'api' && (await esTokenAdmin(c.env, portador))
      const clave = admin
        ? await actorAdmin(db, c.req.header('x-organizacion'), ip)
        : portador
          ? await verificarClave(db, portador, origen, ip)
          : null
      if (!clave) {
        // Frena el tanteo de claves: los fallos cuentan contra la IP.
        const fallos = await consumir(
          c.env.DB,
          `clave-invalida:${ipCliente(ip)}`,
          LIMITE_CLAVES_INVALIDAS,
        )
        if (!fallos.permitido) {
          c.header('Retry-After', String(fallos.reinicioEn))
          throw excedido(fallos, 'Demasiados intentos con claves inválidas')
        }
        c.header('WWW-Authenticate', 'Bearer error="invalid_token"')
        throw noAutenticado('La clave de API no es válida, fue revocada o expiró')
      }
      actor = clave

      const limite = Number(c.env.LIMITE_CLAVE_POR_MINUTO) || 120
      const uso = await consumir(c.env.DB, `clave:${actor.id}`, limite)
      c.header('RateLimit-Limit', String(uso.limite))
      c.header('RateLimit-Remaining', String(uso.restante))
      c.header('RateLimit-Reset', String(uso.reinicioEn))
      if (!uso.permitido) {
        c.header('Retry-After', String(uso.reinicioEn))
        // Sólo el primer exceso de la ventana: una clave que insiste no llena la tabla de registros.
        if (uso.cuenta === uso.limite + 1) anotar(actor, 429)
        throw excedido(uso, `Límite de ${uso.limite} peticiones por minuto excedido`)
      }
    } else {
      if (opciones.soloClave) {
        c.header('WWW-Authenticate', 'Bearer')
        throw noAutenticado('Envía una clave de API en el encabezado Authorization')
      }
      const sesion = await sesionVerificada(c)

      const membresias = await db.select().from(member).where(eq(member.userId, sesion.user.id))
      if (!membresias.length) {
        throw new AppError(
          409,
          'sin_organizacion',
          'Crea o únete a una organización para continuar',
        )
      }
      const activa = (sesion.session as { activeOrganizationId?: string | null })
        .activeOrganizationId
      // Con varias organizaciones no se adivina: emitir a nombre de la empresa equivocada es grave.
      const membresia =
        membresias.find((m) => m.organizationId === activa) ??
        (membresias.length === 1 ? membresias[0] : undefined)
      if (!membresia) {
        throw new AppError(
          409,
          'sin_organizacion_activa',
          'Elige con qué organización quieres trabajar',
          { organizaciones: membresias.map((m) => m.organizationId) },
        )
      }
      // Una sesión de navegador siempre es el panel, entre por la ruta que entre.
      actor = actorDeMiembro(membresia, 'panel', ip)
      c.set('usuario', { id: sesion.user.id, nombre: sesion.user.name, correo: sesion.user.email })
      c.set('rol', membresia.role)
    }

    c.set('ctx', {
      env: c.env,
      db,
      actor,
      waitUntil: ejecucion && ((p) => ejecucion.waitUntil(p)),
      extensiones: c.var.extensiones,
    })
    await next()
    // Los errores de las rutas ya pasaron por `onError`: `c.res` trae el estado definitivo.
    if (actor.tipo === 'clave') anotar(actor, c.res.status)
  })

/** Límite por IP para rutas sin autenticar (registro, inicio de sesión). */
export const limitarPorIp = (bucket: string, limite: number) =>
  createMiddleware<Entorno>(async (c, next) => {
    const uso = await consumir(
      c.env.DB,
      `${bucket}:${ipCliente(c.req.header('cf-connecting-ip'))}`,
      limite,
    )
    if (!uso.permitido) {
      c.header('Retry-After', String(uso.reinicioEn))
      throw excedido(uso, 'Demasiadas peticiones. Intenta de nuevo en un momento.')
    }
    await next()
  })
