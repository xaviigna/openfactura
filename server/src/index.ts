import { inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { PERMISOS } from 'shared'
import { atenderAuth, envioDeCuenta } from './auth'
import type { Ctx } from './contexto'
import { crearDb, documento } from './db'
import type { Bindings } from './env'
import { type Extension, validarExtensiones } from './extensiones'
import { AppError } from './lib/errors'
import { githubConfigurado } from './lib/github'
import { atenderMcp } from './mcp'
import { autenticar, type Entorno, limitarPorIp } from './middleware/actor'
import { openApiJson } from './openapi'
import { admin } from './routes/admin'
import { v1 } from './routes/v1'
import { conciliarPendiente, transmitirContingenciasAbiertas } from './services/dte'
import { limpiar } from './services/limites'
import { limpiarRegistros } from './services/registros'
import { entregarPendientes } from './services/webhooks'

/**
 * Arma la aplicación Hono. Las rutas de las extensiones se montan después de las del núcleo y antes
 * del 404 de `/api/*`, así que nunca reemplazan una ruta del núcleo.
 */
function crearApp(extensiones: readonly Extension[]) {
  const app = new Hono<Entorno>()
    .use(async (c, next) => {
      c.set('extensiones', extensiones)
      await next()
    })
    .onError((error, c) => {
      if (error instanceof AppError) return c.json(error.toJSON(), error.status)
      if (error instanceof HTTPException) {
        // Cuerpo que no es JSON válido, demasiado grande, etc.
        const mensaje =
          error.status === 413
            ? 'El cuerpo de la petición es demasiado grande'
            : 'Petición inválida'
        return c.json({ error: { code: 'datos_invalidos', message: mensaje } }, error.status)
      }
      console.error(error)
      return c.json(
        { error: { code: 'error_interno', message: 'Ocurrió un error inesperado' } },
        500,
      )
    })
    // Tope de cuerpo: el certificado (.crt) ronda los 10 KB; nada legítimo se acerca a 512 KB.
    .use('/api/*', bodyLimit({ maxSize: 512 * 1024 }))
    .use('/mcp', bodyLimit({ maxSize: 512 * 1024 }))
    .get('/api/health', (c) => c.json({ ok: true }))

    // Better Auth: registro, sesión, organizaciones e invitaciones.
    .on(['GET', 'POST'], '/api/auth/*', limitarPorIp('auth', 300), (c) =>
      atenderAuth(
        c.env,
        c.var.extensiones ?? [],
        (tarea) => {
          try {
            c.executionCtx.waitUntil(tarea)
          } catch {
            // Sin contexto de ejecución (pruebas con `app.request`): la tarea corre igual.
          }
        },
        c.req.raw,
      ),
    )

    // Formas de ingresar que ofrece esta instalación, para la pantalla de acceso. Público.
    .get('/api/v1/acceso', (c) =>
      c.json(
        {
          github: githubConfigurado(c.env),
          // Con correo hay verificación de la dirección y recuperación de la contraseña.
          correo: envioDeCuenta(c.env, c.var.extensiones) !== null,
          // Clave pública de Turnstile: con ella, el panel muestra el widget en el registro, el
          // inicio de sesión y la recuperación de la contraseña.
          turnstile: (c.env.TURNSTILE_SECRET && c.env.TURNSTILE_SITE_KEY) || null,
        },
        200,
        { 'Cache-Control': 'no-store' },
      ),
    )

    // Documento OpenAPI: público, se arma una vez por isolate. Va antes de `v1`, que exige sesión.
    .get('/api/v1/openapi.json', (c) =>
      c.body(openApiJson(), 200, {
        'Content-Type': 'application/json; charset=UTF-8',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      }),
    )

    // Administración de una instalación propia sin panel (sólo con ADMIN_TOKEN).
    .route('/api/admin', admin)

    // API REST: la usan el panel (cookie de sesión) y los integradores (clave de API).
    .route('/api/v1', v1)

    // MCP remoto: Streamable HTTP sin estado, autenticado con clave de API.
    .all('/mcp', autenticar('mcp', { soloClave: true }), (c) => atenderMcp(c.var.ctx, c.req.raw))

  for (const e of extensiones) {
    // Bajo `/api/v1/*` ya corre la autenticación de `v1`: el router sólo recibe peticiones con `ctx`.
    if (e.api) {
      const router = new Hono<Entorno>()
      e.api(router)
      app.route(`/api/v1/ext/${e.id}`, router)
    }
    e.rutas?.(app)
  }

  return (
    app
      // El núcleo no trae panel: la raíz dice dónde está la API. Va después de las extensiones, así que
      // una distribución puede servir aquí su propia portada.
      .get('/', (c) =>
        c.json({
          nombre: 'Open Factura',
          api: '/api/v1',
          openapi: '/api/v1/openapi.json',
          mcp: '/mcp',
          docs: 'https://docs.openfactura.co',
        }),
      )
      .all('/api/*', (c) =>
        c.json({ error: { code: 'no_encontrado', message: 'Ruta no encontrada' } }, 404),
      )
  )
}

export const app = crearApp([])
export type App = typeof app

/**
 * Cada 5 minutos: concilia documentos que quedaron pendientes, transmite las contingencias abiertas
 * de producción, limpia contadores viejos y reintenta los webhooks vencidos (incluidos los que
 * acaban de publicarse).
 */
/** Pendientes que concilia el cron por vuelta, en total y por organización, y hasta qué edad. */
const MAX_CONCILIACIONES = 20
const MAX_PENDIENTES_POR_ORGANIZACION = 5
const CADUCIDAD_PENDIENTE_MS = 3 * 24 * 3_600_000

async function tareasProgramadas(env: Bindings, extensiones: readonly Extension[] = []) {
  const db = crearDb(env.DB)
  await limpiar(env.DB)
  try {
    await limpiarRegistros(env.DB)
  } catch (error) {
    console.error('No se pudieron limpiar los registros de la API', error)
  }
  // Tanda de conciliación: pendientes de entre 3 minutos y 3 días, con un tope por organización
  // para que las filas atascadas de una no desplacen a las de las demás. Pasados 3 días el cron
  // las deja (siguen pendientes, a la vista del operador): reintentarlas para siempre sólo gasta la tanda.
  const ahora = Date.now()
  const { results: ids } = await env.DB.prepare(
    `SELECT id FROM (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY creado) AS n
       FROM documento WHERE estado = 'pendiente' AND creado < ?1 AND creado > ?2
     ) WHERE n <= ?3 ORDER BY random() LIMIT ?4`,
  )
    .bind(
      ahora - 180_000,
      ahora - CADUCIDAD_PENDIENTE_MS,
      MAX_PENDIENTES_POR_ORGANIZACION,
      MAX_CONCILIACIONES,
    )
    .all<{ id: string }>()
  const colgados = ids.length
    ? await db
        .select()
        .from(documento)
        .where(
          inArray(
            documento.id,
            ids.map((r) => r.id),
          ),
        )
    : []
  for (const fila of colgados) {
    const ctx: Ctx = {
      env,
      db,
      actor: {
        tipo: 'sistema',
        id: 'cron',
        organizationId: fila.organizationId,
        permisos: new Set(PERMISOS),
        modo: fila.ambiente === '01' ? 'live' : 'test',
        origen: 'api',
      },
      // Para que las extensiones también se enteren de lo que concilia el cron (alPublicar).
      extensiones,
    }
    try {
      await conciliarPendiente(ctx, fila)
    } catch (error) {
      console.error('No se pudo conciliar', fila.codigoGeneracion, error)
    }
  }
  try {
    await transmitirContingenciasAbiertas(env, db, extensiones)
  } catch (error) {
    console.error('No se pudieron transmitir las contingencias', error)
  }
  try {
    await entregarPendientes(env, db)
  } catch (error) {
    console.error('No se pudieron entregar los webhooks pendientes', error)
  }
}

/**
 * Worker de Open Factura con las extensiones dadas. `crearWorker([])` es la instalación estándar;
 * una distribución privada exporta `crearWorker([suExtension])` desde su propio Worker.
 */
export function crearWorker(extensiones: Extension[] = []) {
  validarExtensiones(extensiones)
  const aplicacion = extensiones.length ? crearApp(extensiones) : app
  return {
    fetch: aplicacion.fetch,
    scheduled: (_evento: ScheduledController, env: Bindings, contexto: ExecutionContext) => {
      contexto.waitUntil(tareasProgramadas(env, extensiones))
      for (const e of extensiones) {
        if (!e.cron) continue
        // Cada extensión por separado: su fallo no detiene el cron del núcleo ni a las demás.
        contexto.waitUntil(
          Promise.resolve()
            .then(() => e.cron?.(env, contexto))
            .catch((error) => console.error(`Falló el cron de la extensión ${e.id}`, error)),
        )
      }
    },
  } satisfies ExportedHandler<Bindings>
}

export default crearWorker([])
