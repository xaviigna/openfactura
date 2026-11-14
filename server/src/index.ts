import { and, eq, lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { PERMISOS } from 'shared'
import { createAuth } from './auth'
import type { Ctx } from './contexto'
import { crearDb, documento } from './db'
import type { Bindings } from './env'
import { type Extension, validarExtensiones } from './extensiones'
import { AppError } from './lib/errors'
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
      createAuth(c.env, c.var.extensiones).handler(c.req.raw),
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
async function tareasProgramadas(env: Bindings, extensiones: readonly Extension[] = []) {
  const db = crearDb(env.DB)
  await limpiar(env.DB)
  try {
    await limpiarRegistros(env.DB)
  } catch (error) {
    console.error('No se pudieron limpiar los registros de la API', error)
  }
  const colgados = await db
    .select()
    .from(documento)
    .where(
      and(eq(documento.estado, 'pendiente'), lt(documento.creado, new Date(Date.now() - 180_000))),
    )
    // Orden aleatorio: unas filas atascadas de una organización no bloquean a las demás.
    .orderBy(sql`random()`)
    .limit(20)
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
