import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDb, documento } from '../src/db'
import { ctxDeMiembro } from '../src/extensiones'
import {
  emitir,
  LIMITE_INFORME_CONTINGENCIA_MS,
  obtener,
  resumenTablero,
  transmitirContingenciasAbiertas,
} from '../src/services/dte'
import { FACTURA, nuevaOrganizacion } from './ayudas'

// Sólo credenciales del simulador: ninguna petición puede salir hacia Hacienda.
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

async function enContingencia() {
  const { organizationId, userId } = await nuevaOrganizacion({ emisor: true })
  const ctx = await ctxDeMiembro(env, { userId, organizationId, origen: 'api' })
  const r = await emitir(ctx!, FACTURA as never, { forzarContingencia: true })
  expect(r.status).toBe(202)
  return {
    ctx: ctx!,
    organizationId,
    codigo: (r.cuerpo as { codigoGeneracion: string }).codigoGeneracion,
  }
}

describe('contingencia automática (cron)', () => {
  it('transmite sola la contingencia abierta y el tablero deja de mostrarla', async () => {
    const { ctx, organizationId, codigo } = await enContingencia()
    const antes = await resumenTablero(ctx)
    expect(antes.contingencia).toMatchObject({ documentos: 1, requiereInforme: false })

    const r = await transmitirContingenciasAbiertas(env, crearDb(env.DB), [], {
      ambiente: '00',
      maxOrganizaciones: 100,
    })
    expect(r).toContainEqual({ organizationId, transmitidos: 1 })
    expect((await obtener(ctx, codigo)).estado).toBe('procesado')
    expect((await resumenTablero(ctx)).contingencia).toBeNull()
  })

  it('por defecto sólo actúa en producción: no toca las contingencias del ambiente de pruebas', async () => {
    const { ctx, organizationId, codigo } = await enContingencia()
    const r = await transmitirContingenciasAbiertas(env, crearDb(env.DB))
    expect(r.map((x) => x.organizationId)).not.toContain(organizationId)
    expect((await obtener(ctx, codigo)).estado).toBe('contingencia')
  })

  it('pasados 3 días no la transmite: antes va el Informe Técnico de Contingencia', async () => {
    const { ctx, organizationId, codigo } = await enContingencia()
    const db = crearDb(env.DB)
    await db
      .update(documento)
      .set({ creado: new Date(Date.now() - LIMITE_INFORME_CONTINGENCIA_MS - 60_000) })
      .where(eq(documento.organizationId, organizationId))

    expect((await resumenTablero(ctx)).contingencia).toMatchObject({ requiereInforme: true })
    const r = await transmitirContingenciasAbiertas(env, db, [], {
      ambiente: '00',
      maxOrganizaciones: 100,
    })
    expect(r).toContainEqual({ organizationId, transmitidos: 0, omitida: 'informe' })
    expect((await obtener(ctx, codigo)).estado).toBe('contingencia')
  })
})
