import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDb, documento } from '../src/db'
import { ctxDeMiembro } from '../src/extensiones'
import worker from '../src/index'
import { conciliarPendiente, emitir, obtener } from '../src/services/dte'
import { FACTURA, nuevaOrganizacion } from './ayudas'

beforeEach(() => {
  const original = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (entrada, init) => {
    const url =
      typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    if (url.includes('mh.gob.sv')) throw new Error(`Petición real al MH: ${url}`)
    return original(entrada as RequestInfo, init)
  })
})
afterEach(() => vi.restoreAllMocks())

const viejo = () => Date.now() - 600_000

async function unaEmitida() {
  const { organizationId, userId } = await nuevaOrganizacion({ emisor: true })
  const ctx = (await ctxDeMiembro(env, { userId, organizationId, origen: 'api' }))!
  const r = await emitir(ctx, FACTURA as never)
  expect(r.status).toBe(201)
  const codigo = (r.cuerpo as { codigoGeneracion: string }).codigoGeneracion
  const db = crearDb(env.DB)
  return { ctx, organizationId, codigo, db }
}

const fila = async (codigo: string) => {
  const [f] = await crearDb(env.DB)
    .select()
    .from(documento)
    .where(eq(documento.codigoGeneracion, codigo))
  return f!
}

describe('conciliación de pendientes', () => {
  it('un pendiente que el MH sí registró queda procesado con su sello', async () => {
    const { ctx, codigo, db } = await unaEmitida()
    await db
      .update(documento)
      .set({ estado: 'pendiente', selloRecibido: null })
      .where(eq(documento.codigoGeneracion, codigo))
    expect(await conciliarPendiente(ctx, await fila(codigo))).toBe('procesado')
    const d = await obtener(ctx, codigo)
    expect(d.estado).toBe('procesado')
    expect(d.selloRecibido).toBeTruthy()
  })

  it('no pisa un documento que otra vía ya resolvió (UPDATE condicionado a pendiente)', async () => {
    const { ctx, codigo } = await unaEmitida()
    const procesado = await fila(codigo) // ya procesado, pero la lectura llegó "vieja" como pendiente
    expect(await conciliarPendiente(ctx, { ...procesado, estado: 'pendiente' })).toBe('pendiente')
    expect((await obtener(ctx, codigo)).estado).toBe('procesado')
  })

  it('rechaza sólo ante un veredicto positivo de «no existe» (014)', async () => {
    const { ctx, codigo, db } = await unaEmitida()
    await db
      .update(documento)
      .set({
        estado: 'pendiente',
        selloRecibido: null,
        codigoGeneracion: crypto.randomUUID().toUpperCase(),
      })
      .where(eq(documento.codigoGeneracion, codigo))
    const [f] = await db.select().from(documento).where(eq(documento.estado, 'pendiente'))
    expect(await conciliarPendiente(ctx, f!)).toBe('rechazado')
  })

  it('una respuesta que no es veredicto (429) deja el documento pendiente', async () => {
    const { ctx, codigo, db } = await unaEmitida()
    await db
      .update(documento)
      .set({ estado: 'pendiente', selloRecibido: null })
      .where(eq(documento.codigoGeneracion, codigo))
    const original = ctx.mhFetch
    ctx.mhFetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
      if (url.includes('consultadte')) {
        return new Response(JSON.stringify({ message: 'Too Many Requests' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return (original ?? fetch)(entrada, init)
    }) as typeof fetch
    expect(await conciliarPendiente(ctx, await fila(codigo))).toBe('pendiente')
    expect((await fila(codigo)).estado).toBe('pendiente')
  })

  it('el cron limita cuántos pendientes toma de una organización y no deja sin turno a las demás', async () => {
    const { organizationId: atascada } = await nuevaOrganizacion()
    const insertar = env.DB.prepare(
      `INSERT INTO documento (id, organization_id, codigo_generacion, numero_control, tipo_dte, ambiente, estado,
         fecha_emision, hora_emision, actor_tipo, actor_id, creado)
       VALUES (?1, ?2, ?3, ?4, '01', '00', 'pendiente', '2026-01-01', '10:00:00', 'usuario', 'x', ?5)`,
    )
    await env.DB.batch(
      Array.from({ length: 150 }, (_, i) =>
        insertar.bind(`atasc-${i}`, atascada, `ATASC-${i}`, `NC-A-${i}`, viejo()),
      ),
    )
    const { organizationId } = await nuevaOrganizacion({ emisor: true })
    await insertar.bind('otra-1', organizationId, 'OTRA-1', 'NC-B-1', viejo()).run()
    const contexto = createExecutionContext()
    worker.scheduled({} as ScheduledController, env, contexto)
    await waitOnExecutionContext(contexto)
    const [otra] = await crearDb(env.DB).select().from(documento).where(eq(documento.id, 'otra-1'))
    expect(otra?.estado).not.toBe('pendiente')
  })

  it('el cron no toca pendientes de más de 3 días', async () => {
    const { organizationId } = await nuevaOrganizacion({ emisor: true })
    await env.DB.prepare(
      `INSERT INTO documento (id, organization_id, codigo_generacion, numero_control, tipo_dte, ambiente, estado,
         fecha_emision, hora_emision, actor_tipo, actor_id, creado)
       VALUES ('caduco-1', ?1, 'CADUCO-1', 'NC-C-1', '01', '00', 'pendiente', '2026-01-01', '10:00:00', 'usuario', 'x', ?2)`,
    )
      .bind(organizationId, Date.now() - 4 * 86_400_000)
      .run()
    const contexto = createExecutionContext()
    worker.scheduled({} as ScheduledController, env, contexto)
    await waitOnExecutionContext(contexto)
    const [f] = await crearDb(env.DB).select().from(documento).where(eq(documento.id, 'caduco-1'))
    expect(f?.estado).toBe('pendiente')
  })
})
