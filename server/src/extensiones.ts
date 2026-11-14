/**
 * Punto de extensión del servidor. Una distribución (p. ej. una nube privada) compone el Worker con
 * `crearWorker([miExtension])` y agrega rutas, tareas del cron y enlaces del panel sin tocar este
 * repositorio. Una instalación propia usa `crearWorker([])`, que es la exportación por defecto.
 *
 * Reglas para quien escribe una extensión:
 * - La lógica de negocio sigue en los servicios del núcleo: llámelos con un `Ctx` (permisos y
 *   organización ya resueltos), nunca consulte tablas del núcleo saltándose `exigir`.
 * - Las tablas propias van en las migraciones de la distribución, no en `server/migrations`.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import type { OpcionesPdf } from '@openfactura/dte/pdf'
import { and, eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { EVENTOS_WEBHOOK, type EventoWebhook, NOMBRE_EVENTO_EXTENSION, type Permiso } from 'shared'
import { type Actor, actorDeMiembro, type Ctx } from './contexto'
import { crearDb, type Db, member } from './db'
import type { Bindings } from './env'
import type { Entorno } from './middleware/actor'

/** Enlace que una extensión agrega a la barra lateral del panel. */
export interface EnlacePanel {
  titulo: string
  /** Ruta del mismo origen que sirve la extensión (p. ej. `/cloud/whatsapp`). Navegación completa. */
  ruta: string
  /** Nombre de ícono genérico del panel: 'mensaje', 'tarjeta', 'nube' o 'extension'. */
  icono?: string
  /** Sólo se muestra a quien tenga este permiso. */
  permiso?: Permiso
  /** Grupo de la barra lateral donde aparece. Por defecto `'mas'`. */
  grupo?: GrupoPanel
}

/** `cuenta`: lo de la cuenta en sí (plan, facturación), que se muestra en cualquier modo del panel. */
/** Un cambio de membresía: `rol: null` si la persona ya no es miembro. */
export interface CambioMiembro {
  organizationId: string
  userId: string
  rol: string | null
}

export const GRUPOS_PANEL = ['desarrolladores', 'administracion', 'cuenta', 'mas'] as const
export type GrupoPanel = (typeof GRUPOS_PANEL)[number]

/** Lo que una distribución cuenta de la cuenta al panel: plan, uso y aviso de mejora. */
export interface CuentaExtension {
  /** P. ej. `{ id: 'free', nombre: 'Free' }`. */
  plan: { id: string; nombre: string }
  /** Barras de uso en Inicio (p. ej. DTE del mes). `limite: null` = sin tope. */
  uso?: { etiqueta: string; usado: number; limite: number | null }[]
  /**
   * Tarjeta «Mejora tu plan» al pie de la barra lateral. `ruta` es interna (`/app/…`, o una página
   * de la extensión) o una URL absoluta.
   */
  mejorar?: { titulo: string; detalle: string; ruta: string }
}

export interface Extension {
  /** Identificador corto en minúsculas: define el prefijo `/api/v1/ext/<id>`. */
  id: string
  /**
   * Rutas PÚBLICAS en la raíz del Worker (webhooks de terceros, páginas propias). No pasan por la
   * autenticación: cada ruta verifica lo suyo (firma, sesión con `autenticar`, etc.). Recuerde
   * agregarlas a `assets.run_worker_first` en el `wrangler.jsonc` de la distribución.
   */
  rutas?(app: Hono<Entorno>): void
  /**
   * Rutas AUTENTICADAS bajo `/api/v1/ext/<id>/…`. Pasan por el mismo middleware que el resto de
   * `/api/v1` (sesión o clave de API, CSRF, límites), así que `c.var.ctx` trae actor, organización y
   * permisos. No forman parte del documento OpenAPI del núcleo.
   */
  api?(router: Hono<Entorno>): void
  /** Se llama en cada ejecución del cron. Sus errores se registran y no afectan las tareas del núcleo. */
  cron?(env: Bindings, ejecucion: ExecutionContext): Promise<void>
  panel?: EnlacePanel[]
  /** Datos de la cuenta que el panel muestra (plan, uso, aviso de mejora). Se agrega a GET /api/v1/yo como `cuenta`. */
  cuenta?: (ctx: Ctx) => Promise<CuentaExtension | null>
  /** Se llama antes de reservar el número de control en cada emisión (DTE y eventos que consumen correlativo). Lanza AppError para impedirla (p. ej. 402 plan_requerido, 429 limite_plan). */
  antesDeEmitir?: (ctx: Ctx, datos: { ambiente: '00' | '01'; tipoDte: string }) => Promise<void>
  /**
   * Herramientas propias en el MCP remoto (`/mcp`). Se registran después de las del núcleo, con el
   * `ctx` de la petición; envuelva cada una con `responder` para el mismo formato de errores.
   */
  mcp?: (servidor: McpServer, ctx: Ctx) => void
  /**
   * Funciones que la extensión agrega y el panel debe conocer (p. ej. `'certificacion'`). Llegan a
   * GET /api/v1/yo como `capacidades`.
   */
  capacidades?: readonly string[]
  /**
   * Alguien salió de una organización (`rol: null`) o le cambiaron el rol. Corre después del
   * cambio; un error se registra sin deshacerlo. Útil para retirar accesos que dependían de él.
   */
  alCambiarMiembro?: (env: Bindings, datos: CambioMiembro) => Promise<void>
  /**
   * Antes de borrar una organización. Lanza `AppError` para impedirlo (p. ej. si todavía tiene
   * accesos en otras organizaciones que se quedarían huérfanos).
   */
  antesDeBorrarOrganizacion?: (env: Bindings, organizationId: string) => Promise<void>
  /**
   * Opciones del PDF de los documentos de una organización (p. ej. su logo). Gana la primera
   * extensión que devuelva algo; sin extensiones, el PDF sale sin logo.
   */
  opcionesPdf?: (ctx: Ctx) => Promise<OpcionesPdf | null>
  /**
   * Se llama cada vez que el núcleo publica un evento (los mismos de los webhooks: `dte.procesado`,
   * `dte.invalidado`…), haya o no webhooks suscritos, venga de la API, del MCP, de una contingencia
   * o de la conciliación del cron. Corre después de la operación: lo que tarde debe ir a
   * `ctx.waitUntil`, y sus errores se registran sin deshacer nada.
   */
  alPublicar?: (
    ctx: Ctx,
    evento: EventoWebhook | (string & {}),
    datos: readonly Record<string, unknown>[],
  ) => Promise<void>
  /**
   * Eventos de webhook propios (`recurso.accion` → descripción). Los webhooks de la organización
   * pueden suscribirse a ellos y la extensión los emite con `publicar`. Llegan a GET /api/v1/yo como
   * `eventosWebhook` para que el panel los ofrezca.
   */
  eventos?: Readonly<Record<string, string>>
}

const ID_VALIDO = /^[a-z][a-z0-9-]{0,31}$/

/** Eventos de webhook que declaran las extensiones, con su descripción. */
export const eventosDeExtensiones = (extensiones: readonly Extension[] = []) =>
  extensiones.flatMap((e) =>
    Object.entries(e.eventos ?? {}).map(([evento, descripcion]) => ({ evento, descripcion })),
  )

/** Valida las extensiones al componer el Worker: un error aquí es de programación. */
export function validarExtensiones(extensiones: readonly Extension[]): void {
  const vistos = new Set<string>()
  for (const e of extensiones) {
    if (!ID_VALIDO.test(e.id)) throw new Error(`Id de extensión inválido: ${e.id}`)
    if (vistos.has(e.id)) throw new Error(`Extensión repetida: ${e.id}`)
    vistos.add(e.id)
    for (const evento of Object.keys(e.eventos ?? {})) {
      const delNucleo = (EVENTOS_WEBHOOK as readonly string[]).includes(evento)
      if (!NOMBRE_EVENTO_EXTENSION.test(evento) || delNucleo) {
        throw new Error(`Evento de webhook inválido en ${e.id}: ${evento}`)
      }
    }
    for (const enlace of e.panel ?? []) {
      // `new URL` normaliza `/\host` como `//host`: se exige que la ruta quede en el mismo origen.
      const base = 'https://origen.invalid'
      if (!enlace.ruta.startsWith('/') || new URL(enlace.ruta, base).origin !== base)
        throw new Error(`La ruta del enlace de ${e.id} debe ser del mismo origen: ${enlace.ruta}`)
      if (enlace.grupo && !GRUPOS_PANEL.includes(enlace.grupo))
        throw new Error(`Grupo de enlace desconocido en ${e.id}: ${enlace.grupo}`)
    }
  }
}

/** Enlaces del panel visibles para un actor. */
export const enlacesVisibles = (enlaces: readonly EnlacePanel[], actor: Actor) =>
  enlaces
    .filter((e) => !e.permiso || actor.permisos.has(e.permiso))
    .map((e) => ({
      titulo: e.titulo,
      ruta: e.ruta,
      icono: e.icono ?? null,
      grupo: e.grupo ?? ('mas' as GrupoPanel),
    }))

/**
 * Cuenta que el panel muestra en `/yo`: la de la primera extensión que devuelva una. Un fallo de
 * una extensión se registra y cuenta como «sin datos»: nunca rompe `/yo`.
 */
export async function cuentaDe(ctx: Ctx): Promise<CuentaExtension | null> {
  for (const e of ctx.extensiones ?? []) {
    if (!e.cuenta) continue
    try {
      const cuenta = await e.cuenta(ctx)
      if (cuenta) return cuenta
    } catch (error) {
      console.error(`Falló la cuenta de la extensión ${e.id}`, error)
    }
  }
  return null
}

/** Opciones del PDF que aporta la primera extensión que las tenga (`{}` si ninguna). */
export async function opcionesPdf(ctx: Ctx): Promise<OpcionesPdf> {
  for (const e of ctx.extensiones ?? []) {
    const o = await e.opcionesPdf?.(ctx)
    if (o) return o
  }
  return {}
}

/**
 * Llama a `antesDeEmitir` de cada extensión, en orden, justo antes de reservar el número de
 * control. La primera que lance impide la emisión. Sin extensiones no hace nada.
 */
export async function antesDeEmitir(
  ctx: Ctx,
  datos: { ambiente: '00' | '01'; tipoDte: string },
): Promise<void> {
  for (const e of ctx.extensiones ?? []) await e.antesDeEmitir?.(ctx, datos)
}

/**
 * `Ctx` para actuar a nombre de un usuario dentro de una organización, con los permisos de su rol
 * actual. Devuelve `null` si ya no es miembro (la extensión debe dejar de actuar por él).
 */
export async function ctxDeMiembro(
  env: Bindings,
  opciones: {
    userId: string
    organizationId: string
    origen: Actor['origen']
    db?: Db
    waitUntil?: Ctx['waitUntil']
    /**
     * Extensiones cuyos ganchos (`antesDeEmitir`) deben valer para lo que haga este `Ctx`. Pase las
     * mismas que dio a `crearWorker` para que los límites del plan apliquen también fuera de HTTP.
     */
    extensiones?: readonly Extension[]
  },
): Promise<Ctx | null> {
  const db = opciones.db ?? crearDb(env.DB)
  const [m] = await db
    .select({ userId: member.userId, organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, opciones.userId), eq(member.organizationId, opciones.organizationId)),
    )
  if (!m) return null
  return {
    env,
    db,
    actor: actorDeMiembro(m, opciones.origen),
    waitUntil: opciones.waitUntil,
    extensiones: opciones.extensiones,
  }
}

/** Avisa a las extensiones de un evento publicado. Nunca lanza: cada fallo sólo se registra. */
export async function avisarExtensiones(
  ctx: Ctx,
  evento: EventoWebhook | (string & {}),
  datos: readonly Record<string, unknown>[],
): Promise<void> {
  for (const e of ctx.extensiones ?? []) {
    if (!e.alPublicar) continue
    try {
      await e.alPublicar(ctx, evento, datos)
    } catch (error) {
      console.error(`Falló alPublicar de la extensión ${e.id}`, evento, error)
    }
  }
}
