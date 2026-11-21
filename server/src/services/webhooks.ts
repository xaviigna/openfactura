import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  EVENTOS_WEBHOOK,
  type EventoWebhook,
  MAX_WEBHOOKS,
  problemaUrlWebhook,
  type WebhookCambios,
  type WebhookEntrada,
} from 'shared'
import { ambienteDeModo, type Ctx, exigir } from '../contexto'
import { type Db, webhook, webhookEntrega } from '../db'
import type { Bindings } from '../env'
import { avisarExtensiones, eventosDeExtensiones } from '../extensiones'
import { aleatorioBase62, cifrar, descifrar, hmacSha256Hex, nuevoId } from '../lib/crypto'
import { conflicto, invalido, noEncontrado } from '../lib/errors'
import { registrar } from './auditoria'
import { ambienteActivo } from './emisor'

/** Espera antes de cada reintento, en minutos. Tras el último, la entrega queda `fallido`. */
export const RETRASOS_MINUTOS = [1, 5, 30, 120, 360, 720, 1440]
export const MAX_INTENTOS = RETRASOS_MINUTOS.length + 1
const TIEMPO_LIMITE_MS = 10_000
/** Mientras un intento está en curso, el cron no vuelve a tomar la entrega. */
const RESERVA_MS = 120_000
/** Entregas que se intentan al publicar; el resto (p. ej. una contingencia grande) va al cron. */
const MAX_INMEDIATAS = 10
/** Entregas por ejecución del cron: cada una cuesta una subpetición y una escritura en D1. */
const MAX_POR_TANDA = 20
/** Tope por organización en la primera pasada del cron, para que una no deje sin turno a otra. */
const POR_ORGANIZACION = 3
const ERROR_PRUEBA = 'La prueba no se pudo entregar'
export const USER_AGENT = 'OpenFactura-Webhooks/1'

type FilaWebhook = typeof webhook.$inferSelect
type FilaEntrega = typeof webhookEntrega.$inferSelect
/** Lo que se publica: la vista pública de un documento o evento (nunca su JSON ni secretos). */
type Datos = { ambiente?: string | null; [campo: string]: unknown }

const aad = (w: { organizationId: string; id: string }) => `${w.organizationId}|webhook|${w.id}`
const nuevoSecreto = () => `whsec_${aleatorioBase62(40)}`
/**
 * El host de este despliegue (`APP_URL`) y su dominio padre (`app.ejemplo.com` -> `ejemplo.com`):
 * un webhook no puede apuntar al propio servicio. Se ignoran IP y `localhost`.
 */
const SUFIJOS_PUBLICOS = new Set([
  'com.sv',
  'org.sv',
  'edu.sv',
  'gob.sv',
  'co.uk',
  'com.mx',
  'com.br',
  'com.ar',
  'workers.dev',
  'pages.dev',
  'vercel.app',
  'netlify.app',
  'github.io',
])

export function hostsPropios(env: Pick<Bindings, 'APP_URL'>): string[] {
  try {
    const host = new URL(env.APP_URL).hostname.toLowerCase()
    if (host === 'localhost' || host.startsWith('[') || /^[\d.]+$/.test(host)) return []
    const etiquetas = host.split('.')
    if (etiquetas.length < 3) return [host]
    // El dominio padre (openfactura.co para app.openfactura.co) sólo si no es un sufijo público.
    const padre = etiquetas.slice(1).join('.')
    return SUFIJOS_PUBLICOS.has(padre) ? [host] : [host, padre]
  } catch {
    return []
  }
}
const permitirLocal = (env: Bindings) => env.WEBHOOKS_LOCAL === '1'

/** `WEBHOOKS_HOSTS_PERMITIDOS`: hosts exactos (sin esquema ni ruta) separados por coma. */
export function hostsPermitidos(env: Pick<Bindings, 'WEBHOOKS_HOSTS_PERMITIDOS'>): string[] {
  return (env.WEBHOOKS_HOSTS_PERMITIDOS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h))
}

const vista = (w: FilaWebhook) => ({
  id: w.id,
  ambiente: w.ambiente,
  url: w.url,
  descripcion: w.descripcion,
  eventos: JSON.parse(w.eventos) as EventoWebhook[],
  activo: w.activo,
  creado: w.creado.getTime(),
  actualizado: w.actualizado?.getTime() ?? null,
})

/** Columnas de una entrega sin el cuerpo: los listados no cargan ni devuelven el payload. */
const columnasEntrega = {
  id: webhookEntrega.id,
  webhookId: webhookEntrega.webhookId,
  evento: webhookEntrega.evento,
  estado: webhookEntrega.estado,
  intentos: webhookEntrega.intentos,
  ultimoStatus: webhookEntrega.ultimoStatus,
  ultimoError: webhookEntrega.ultimoError,
  proximoIntento: webhookEntrega.proximoIntento,
  creado: webhookEntrega.creado,
  entregado: webhookEntrega.entregado,
}
type ResumenEntrega = { [K in keyof typeof columnasEntrega]: FilaEntrega[K] }

const vistaEntrega = (e: ResumenEntrega) => ({
  id: e.id,
  webhookId: e.webhookId,
  evento: e.evento,
  estado: e.estado,
  intentos: e.intentos,
  ultimoStatus: e.ultimoStatus,
  ultimoError: e.ultimoError,
  proximoIntento: e.estado === 'pendiente' ? (e.proximoIntento?.getTime() ?? null) : null,
  creado: e.creado.getTime(),
  entregado: e.entregado?.getTime() ?? null,
})

function validarUrl(ctx: Ctx, url: string) {
  const problema = problemaUrlWebhook(url, {
    permitirLocal: permitirLocal(ctx.env),
    hostsPropios: hostsPropios(ctx.env),
    hostsPermitidos: hostsPermitidos(ctx.env),
  })
  if (problema) throw invalido(problema, [{ ruta: 'url', mensaje: problema }])
}

/** Sólo el host va a la auditoría: la ruta o la consulta pueden llevar tokens del receptor. */
const hostDe = (url: string) => new URL(url).host

/**
 * Webhooks que ve el actor: una clave de API sólo ve (y administra) los de su ambiente, porque
 * reciben datos de ese ambiente; una sesión de persona ve todos de la organización.
 */
const visibles = (ctx: Ctx) =>
  ctx.actor.modo
    ? and(
        eq(webhook.organizationId, ctx.actor.organizationId),
        eq(webhook.ambiente, ambienteDeModo(ctx.actor.modo)),
      )
    : eq(webhook.organizationId, ctx.actor.organizationId)

async function filaWebhook(ctx: Ctx, id: string): Promise<FilaWebhook> {
  const [w] = await ctx.db
    .select()
    .from(webhook)
    .where(and(eq(webhook.id, id), visibles(ctx)))
  if (!w) throw noEncontrado('El webhook')
  return w
}

// ---------------------------------------------------------------------------
// Administración

export async function listarWebhooks(ctx: Ctx) {
  exigir(ctx, 'webhooks:manage')
  const filas = await ctx.db
    .select()
    .from(webhook)
    .where(visibles(ctx))
    .orderBy(desc(webhook.creado))
  return filas.map(vista)
}

/** Sólo los eventos del núcleo y los que declara alguna extensión activa. */
function validarEventos(ctx: Ctx, eventos: readonly string[]) {
  const validos = new Set<string>([
    ...EVENTOS_WEBHOOK,
    ...eventosDeExtensiones(ctx.extensiones).map((e) => e.evento),
  ])
  const desconocidos = eventos.filter((e) => !validos.has(e))
  if (desconocidos.length) {
    throw invalido(
      'Evento desconocido',
      desconocidos.map((e) => ({ ruta: 'eventos', mensaje: e })),
    )
  }
}

/** Crea un webhook. El secreto de firma sólo existe en claro en esta respuesta. */
export async function crearWebhook(ctx: Ctx, datos: WebhookEntrada) {
  exigir(ctx, 'webhooks:manage')
  validarUrl(ctx, datos.url)
  validarEventos(ctx, datos.eventos)
  const [conteo] = await ctx.db
    .select({ total: sql<number>`count(*)` })
    .from(webhook)
    .where(eq(webhook.organizationId, ctx.actor.organizationId))
  if ((conteo?.total ?? 0) >= MAX_WEBHOOKS) {
    throw conflicto(
      'limite_webhooks',
      `Una organización puede tener hasta ${MAX_WEBHOOKS} webhooks`,
    )
  }
  const id = nuevoId()
  const organizationId = ctx.actor.organizationId
  const secreto = nuevoSecreto()
  await ctx.db.insert(webhook).values({
    id,
    organizationId,
    url: datos.url,
    descripcion: datos.descripcion,
    eventos: JSON.stringify(datos.eventos),
    secretoEnc: await cifrar(ctx.env, aad({ organizationId, id }), secreto),
    creadoPor: ctx.actor.tipo === 'usuario' ? ctx.actor.id : null,
    creadoPorClave: ctx.actor.tipo === 'clave' ? ctx.actor.id : null,
    activo: datos.activo,
    // Una clave lo ata a su ambiente; una persona lo deja en `null` (ambos).
    ambiente: ctx.actor.modo ? ambienteDeModo(ctx.actor.modo) : null,
  })
  await registrar(ctx, 'webhook.crear', 'webhook', id, {
    host: hostDe(datos.url),
    eventos: datos.eventos,
  })
  return { ...vista(await filaWebhook(ctx, id)), secreto }
}

export async function actualizarWebhook(ctx: Ctx, id: string, cambios: WebhookCambios) {
  exigir(ctx, 'webhooks:manage')
  await filaWebhook(ctx, id)
  if (cambios.url !== undefined) validarUrl(ctx, cambios.url)
  if (cambios.eventos) validarEventos(ctx, cambios.eventos)
  await ctx.db
    .update(webhook)
    .set({
      url: cambios.url,
      descripcion: cambios.descripcion === undefined ? undefined : cambios.descripcion || null,
      eventos: cambios.eventos && JSON.stringify(cambios.eventos),
      activo: cambios.activo,
      actualizado: new Date(),
    })
    .where(and(eq(webhook.id, id), eq(webhook.organizationId, ctx.actor.organizationId)))
  await registrar(ctx, 'webhook.actualizar', 'webhook', id, {
    campos: Object.keys(cambios).filter((k) => cambios[k as keyof WebhookCambios] !== undefined),
    ...(cambios.url ? { host: hostDe(cambios.url) } : {}),
  })
  return vista(await filaWebhook(ctx, id))
}

export async function eliminarWebhook(ctx: Ctx, id: string) {
  exigir(ctx, 'webhooks:manage')
  const w = await filaWebhook(ctx, id)
  // Las entregas se borran en cascada.
  await ctx.db
    .delete(webhook)
    .where(and(eq(webhook.id, id), eq(webhook.organizationId, ctx.actor.organizationId)))
  await registrar(ctx, 'webhook.eliminar', 'webhook', id, { host: hostDe(w.url) })
  return { eliminado: true }
}

/** Sustituye el secreto de firma. El anterior deja de valer de inmediato. */
export async function rotarSecretoWebhook(ctx: Ctx, id: string) {
  exigir(ctx, 'webhooks:manage')
  const w = await filaWebhook(ctx, id)
  const secreto = nuevoSecreto()
  await ctx.db
    .update(webhook)
    .set({ secretoEnc: await cifrar(ctx.env, aad(w), secreto), actualizado: new Date() })
    .where(and(eq(webhook.id, id), eq(webhook.organizationId, ctx.actor.organizationId)))
  await registrar(ctx, 'webhook.rotar_secreto', 'webhook', id)
  return { ...vista(await filaWebhook(ctx, id)), secreto }
}

/** Las 50 entregas más recientes de un webhook, sin su cuerpo. */
export async function listarEntregas(ctx: Ctx, id: string) {
  exigir(ctx, 'webhooks:manage')
  await filaWebhook(ctx, id)
  const filas = await ctx.db
    .select(columnasEntrega)
    .from(webhookEntrega)
    .where(
      and(
        eq(webhookEntrega.webhookId, id),
        eq(webhookEntrega.organizationId, ctx.actor.organizationId),
      ),
    )
    .orderBy(desc(webhookEntrega.creado))
    .limit(50)
  return filas.map(vistaEntrega)
}

/** Envía ya un evento `webhook.prueba` y espera la respuesta. No se reintenta. */
export async function probarWebhook(ctx: Ctx, id: string) {
  exigir(ctx, 'webhooks:manage')
  const w = await filaWebhook(ctx, id)
  const entrega = nuevaEntrega(ctx, w.id, 'webhook.prueba', {
    ambiente: w.ambiente ?? (await ambienteActivo(ctx)),
    mensaje: 'Prueba de Open Factura: si recibe esto, el webhook está bien configurado.',
    webhookId: w.id,
  })
  await ctx.db.insert(webhookEntrega).values(entrega)
  let r = await intentar(ctx.env, ctx.db, entrega, w, false)
  if (r.estado !== 'entregado') {
    // Un mensaje único: distinguir conexión, tiempo agotado o código HTTP serviría para explorar
    // la red desde el servidor (escaneo de puertos).
    const cambios = { ultimoStatus: null, ultimoError: ERROR_PRUEBA }
    await ctx.db.update(webhookEntrega).set(cambios).where(eq(webhookEntrega.id, r.id))
    r = { ...r, ...cambios }
  }
  return {
    entregado: r.estado === 'entregado',
    status: r.ultimoStatus,
    error: r.ultimoError,
    entrega: vistaEntrega(r),
  }
}

/** Vuelve a enviar una entrega ahora mismo, con el mismo cuerpo y una firma nueva. */
export async function reenviarEntrega(ctx: Ctx, id: string) {
  exigir(ctx, 'webhooks:manage')
  const [e] = await ctx.db
    .select()
    .from(webhookEntrega)
    .where(
      and(eq(webhookEntrega.id, id), eq(webhookEntrega.organizationId, ctx.actor.organizationId)),
    )
  if (!e) throw noEncontrado('La entrega')
  const w = await filaWebhook(ctx, e.webhookId)
  // Un reenvío manual empieza de nuevo el calendario de reintentos.
  return vistaEntrega(await intentar(ctx.env, ctx.db, { ...e, intentos: 0 }, w, true))
}

// ---------------------------------------------------------------------------
// Publicación y entrega

function nuevaEntrega(ctx: Ctx, webhookId: string, evento: string, datos: Datos): FilaEntrega {
  const id = nuevoId()
  const creado = new Date()
  return {
    id,
    organizationId: ctx.actor.organizationId,
    webhookId,
    evento,
    payload: JSON.stringify({
      id,
      evento,
      creado: creado.toISOString(),
      ambiente: datos.ambiente ?? null,
      organizacion: ctx.actor.organizationId,
      datos,
    }),
    estado: 'pendiente',
    intentos: 0,
    ultimoStatus: null,
    ultimoError: null,
    proximoIntento: creado,
    creado,
    entregado: null,
  }
}

/**
 * Notifica un cambio de estado a los webhooks activos suscritos al evento: crea una entrega por
 * webhook y documento, y la intenta después de responder (`waitUntil`); lo que no se intenta ahí
 * lo toma el cron. Nunca lanza: un fallo aquí no puede deshacer la operación que lo origina.
 * Uso interno de los servicios: el permiso ya lo exigió la operación que publica.
 */
export async function publicar(
  ctx: Ctx,
  evento: EventoWebhook | (string & {}),
  datos: Datos | Datos[],
) {
  try {
    const lista = Array.isArray(datos) ? datos : [datos]
    if (!lista.length) return
    await avisarExtensiones(ctx, evento, lista)
    const activos = await ctx.db
      .select({ id: webhook.id, eventos: webhook.eventos, ambiente: webhook.ambiente })
      .from(webhook)
      .where(and(eq(webhook.organizationId, ctx.actor.organizationId), eq(webhook.activo, true)))
    const suscritos = activos.filter((w) => (JSON.parse(w.eventos) as string[]).includes(evento))
    if (!suscritos.length) return

    // Un webhook atado a un ambiente no recibe datos de otro. Sin `ambiente` en el dato cuenta el
    // activo; `ambiente: null` explícito es un evento sin ambiente (p. ej. de una extensión) y
    // llega a todos.
    const activo = lista.some((d) => d.ambiente === undefined) ? await ambienteActivo(ctx) : null
    const entregas = suscritos.flatMap((w) =>
      lista
        .filter((d) => !w.ambiente || d.ambiente === null || (d.ambiente ?? activo) === w.ambiente)
        .map((d) => nuevaEntrega(ctx, w.id, evento, d)),
    )
    if (!entregas.length) return
    const inmediatas = ctx.waitUntil ? entregas.slice(0, MAX_INMEDIATAS) : []
    for (const e of inmediatas) e.proximoIntento = new Date(Date.now() + RESERVA_MS)
    // D1 admite 100 parámetros por sentencia: 5 filas de 12 columnas por inserción.
    const inserciones = []
    for (let i = 0; i < entregas.length; i += 5) {
      inserciones.push(ctx.db.insert(webhookEntrega).values(entregas.slice(i, i + 5)))
    }
    type Insercion = (typeof inserciones)[number]
    await ctx.db.batch(inserciones as [Insercion, ...Insercion[]])

    if (inmediatas.length && ctx.waitUntil) {
      const ids = inmediatas.map((e) => e.id)
      ctx.waitUntil(
        entregar(ctx.env, ctx.db, ids).catch((error) =>
          console.error('Falló el primer intento de los webhooks', error),
        ),
      )
    }
  } catch (error) {
    console.error('No se pudo publicar el evento de webhook', evento, error)
  }
}

/** Intenta las entregas indicadas (ya reservadas) con su webhook. */
async function entregar(env: Bindings, db: Db, ids: string[], ahora = Date.now()) {
  if (!ids.length) return []
  const entregas = await db.select().from(webhookEntrega).where(inArray(webhookEntrega.id, ids))
  const destinos = await db
    .select()
    .from(webhook)
    .where(
      inArray(
        webhook.id,
        entregas.map((e) => e.webhookId),
      ),
    )
  const porId = new Map(destinos.map((w) => [w.id, w]))
  return Promise.all(
    entregas.map(async (e) => {
      const w = porId.get(e.webhookId)
      if (w?.activo) return intentar(env, db, e, w, true, ahora)
      const cambios = {
        estado: 'fallido' as const,
        ultimoError: 'El webhook está desactivado',
        proximoIntento: null,
      }
      await db.update(webhookEntrega).set(cambios).where(eq(webhookEntrega.id, e.id))
      return { ...e, ...cambios }
    }),
  )
}

/**
 * Cron: toma hasta MAX_POR_TANDA entregas vencidas y las intenta. La reserva se hace en una sola
 * sentencia, así que dos ejecuciones simultáneas nunca envían la misma entrega.
 */
export async function entregarPendientes(env: Bindings, db: Db, ahora = Date.now()) {
  // Reparto justo: como mucho POR_ORGANIZACION por organización (las más antiguas de cada una);
  // el resto de la tanda se llena por orden de vencimiento. Una sola consulta.
  const vencidas = sql`
    SELECT id FROM (
      SELECT id, proximo_intento,
        ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY proximo_intento, id) AS n
      FROM webhook_entrega
      WHERE estado = 'pendiente' AND proximo_intento <= ${ahora}
    )
    ORDER BY (n > ${POR_ORGANIZACION}), CASE WHEN n > ${POR_ORGANIZACION} THEN proximo_intento END,
      n, proximo_intento
    LIMIT ${MAX_POR_TANDA}`
  const tomadas = await db
    .update(webhookEntrega)
    .set({ proximoIntento: new Date(ahora + RESERVA_MS) })
    .where(sql`${webhookEntrega.id} IN (${vencidas})`)
    .returning({ id: webhookEntrega.id })
  return entregar(
    env,
    db,
    tomadas.map((t) => t.id),
    ahora,
  )
}

/** Firma y envía una entrega, y guarda el resultado y el siguiente intento. */
async function intentar(
  env: Bindings,
  db: Db,
  e: FilaEntrega,
  w: FilaWebhook,
  reintentar: boolean,
  ahora = Date.now(),
): Promise<FilaEntrega> {
  const intentos = e.intentos + 1
  let status: number | null = null
  let error: string | null = null
  let secreto: string | null = null
  try {
    secreto = await descifrar(env, aad(w), w.secretoEnc)
  } catch (fallo) {
    console.error('No se pudo descifrar el secreto del webhook', w.id, fallo)
    error = 'No se pudo preparar la firma'
  }
  if (secreto) {
    const t = Math.floor(Date.now() / 1000)
    try {
      const respuesta = await fetch(w.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'OpenFactura-Event': e.evento,
          'OpenFactura-Delivery': e.id,
          'OpenFactura-Signature': `t=${t},v1=${await hmacSha256Hex(secreto, `${t}.${e.payload}`)}`,
        },
        body: e.payload,
        // Una redirección podría llevar a un destino interno: no se sigue.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
      })
      status = respuesta.status
      // El cuerpo de la respuesta no se lee ni se guarda.
      await respuesta.body?.cancel()
      if (status < 200 || status > 299) {
        error =
          status >= 300 && status < 400
            ? `Redirección HTTP ${status}: no se siguen`
            : `El destino respondió HTTP ${status}`
      }
    } catch (fallo) {
      const nombre = (fallo as Error)?.name
      error =
        nombre === 'TimeoutError' || nombre === 'AbortError'
          ? `Sin respuesta en ${TIEMPO_LIMITE_MS / 1000} s`
          : 'No se pudo conectar con el destino'
    }
  }

  const cambios: Partial<FilaEntrega> = !error
    ? {
        estado: 'entregado',
        intentos,
        ultimoStatus: status,
        ultimoError: null,
        proximoIntento: null,
        entregado: new Date(),
      }
    : !reintentar || intentos >= MAX_INTENTOS
      ? {
          estado: 'fallido',
          intentos,
          ultimoStatus: status,
          ultimoError: error,
          proximoIntento: null,
        }
      : {
          estado: 'pendiente',
          intentos,
          ultimoStatus: status,
          ultimoError: error,
          proximoIntento: new Date(ahora + (RETRASOS_MINUTOS[intentos - 1] ?? 0) * 60_000),
        }
  await db.update(webhookEntrega).set(cambios).where(eq(webhookEntrega.id, e.id))
  return { ...e, ...cambios }
}
