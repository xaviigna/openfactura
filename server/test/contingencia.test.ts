import { env } from 'cloudflare:test'
import { crearMockMH } from '@openfactura/dte/mock'
import { PERMISOS } from 'shared'
import { describe, expect, it, vi } from 'vitest'
import type { Ctx } from '../src/contexto'
import { crearDb } from '../src/db'
import { AppError } from '../src/lib/errors'
import { emitir, listar, obtener, transmitirContingencia } from '../src/services/dte'
import { guardarCredenciales, guardarEmisor } from '../src/services/emisor'
import { crearWebhook, entregarPendientes } from '../src/services/webhooks'
import { EMISOR, nuevaOrganizacion } from './ayudas'

const NIT = '06142907861023'
const PASSWORD_API = 'api-de-prueba'
const FACTURA = {
  tipoDte: '01' as const,
  datos: { items: [{ descripcion: 'Servicio', cantidad: 1, precioUni: 11.3 }] },
}

/** Organización lista para emitir contra un MH simulado que la prueba puede tumbar o hacer rechazar. */
async function entorno() {
  const { organizationId, userId } = await nuevaOrganizacion()
  const mock = crearMockMH({ usuarios: { [NIT]: PASSWORD_API } })
  const estado = { caido: false, rechazar: false }
  const mhFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    if (estado.caido) throw new TypeError('fetch failed')
    if (estado.rechazar && url.pathname === '/fesv/recepciondte') {
      return Response.json({
        estado: 'RECHAZADO',
        selloRecibido: null,
        codigoMsg: '096',
        descripcionMsg: 'DOCUMENTO NO CUMPLE ESQUEMA JSON',
        observaciones: ['Campo #/resumen/totalPagar no coincide'],
      })
    }
    return mock.fetch(input, init)
  }
  const ctx: Ctx = {
    env,
    db: crearDb(env.DB),
    actor: {
      tipo: 'usuario',
      id: userId,
      organizationId,
      permisos: new Set(PERMISOS),
      origen: 'panel',
    },
    mhFetch,
  }
  const { esquemaEmisor } = await import('shared')
  await guardarEmisor(ctx, esquemaEmisor.parse(EMISOR))
  const { generarCertificadoPrueba } = await import('@openfactura/dte')
  const { xml } = await generarCertificadoPrueba(NIT, 'clave-cert')
  await guardarCredenciales(ctx, '00', {
    apiPassword: PASSWORD_API,
    certificado: xml,
    certificadoPassword: 'clave-cert',
  })
  return { ctx, mock, estado }
}

describe('rechazo del MH', () => {
  it('registra el documento como rechazado y conserva su número de control', async () => {
    const { ctx, estado } = await entorno()
    estado.rechazar = true
    const error = await emitir(ctx, FACTURA).catch((e) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error.status).toBe(422)
    expect(error.code).toBe('dte_rechazado')
    expect(error.details.mh.observaciones).toEqual(['Campo #/resumen/totalPagar no coincide'])

    const doc = await obtener(ctx, error.details.codigoGeneracion)
    expect(doc.estado).toBe('rechazado')
    expect(doc.numeroControl).toBe('DTE-01-M001P001-000000000000001')
    expect(doc.error?.codigo).toBe('096')

    // El siguiente documento toma el número siguiente: el rechazado no se reutiliza.
    estado.rechazar = false
    const siguiente = await emitir(ctx, FACTURA)
    expect(siguiente.status).toBe(201)
    expect((siguiente.cuerpo as { numeroControl: string }).numeroControl).toBe(
      'DTE-01-M001P001-000000000000002',
    )
  })

  it('credenciales rechazadas no consumen número de control', async () => {
    const { ctx } = await entorno()
    await guardarCredenciales(ctx, '00', { apiPassword: 'incorrecta' })
    const error = await emitir(ctx, FACTURA).catch((e) => e)
    expect(error.status).toBe(502)
    expect(error.code).toBe('mh_credenciales_rechazadas')
    expect((await listar(ctx, { pagina: 1, porPagina: 25 })).total).toBe(0)
  })
})

describe('contingencia', () => {
  it('si el MH no responde, firma en contingencia y transmite cuando vuelve', async () => {
    const { ctx, mock, estado } = await entorno()
    // Una emisión normal primero, para que haya token guardado.
    expect((await emitir(ctx, FACTURA)).status).toBe(201)

    estado.caido = true
    const a = await emitir(ctx, FACTURA)
    const b = await emitir(ctx, FACTURA)
    expect(a.status).toBe(202)
    expect(b.status).toBe(202)
    const docA = a.cuerpo as {
      codigoGeneracion: string
      estado: string
      selloRecibido: string | null
    }
    expect(docA.estado).toBe('contingencia')
    expect(docA.selloRecibido).toBeNull()
    const detalle = await obtener(ctx, docA.codigoGeneracion)
    // Modelo diferido y transmisión por contingencia (Manual Funcional, VIII).
    expect(detalle.dte?.identificacion).toMatchObject({
      tipoModelo: 2,
      tipoOperacion: 2,
      tipoContingencia: 1,
    })
    expect(mock.recibidos.has(docA.codigoGeneracion)).toBe(false)

    estado.caido = false
    const r = await transmitirContingencia(ctx)
    expect(r.procesados).toHaveLength(2)
    expect(r.rechazados).toHaveLength(0)
    expect(r.restantes).toBe(0)
    expect(mock.contingencias.size).toBe(1)

    const final = await obtener(ctx, docA.codigoGeneracion)
    expect(final.estado).toBe('procesado')
    expect(final.selloRecibido).toBe(mock.recibidos.get(docA.codigoGeneracion)?.sello)
    expect((await transmitirContingencia(ctx)).evento).toBeNull()
  })

  it('si el MH está caído desde la autenticación también cae en contingencia', async () => {
    const { ctx, estado } = await entorno()
    estado.caido = true
    const r = await emitir(ctx, FACTURA)
    expect(r.status).toBe(202)
    expect((r.cuerpo as { numeroControl: string }).numeroControl).toBe(
      'DTE-01-M001P001-000000000000001',
    )
  })
})

describe('documentos sin contingencia (08, 09 y 15)', () => {
  const DONACION = {
    tipoDte: '15' as const,
    datos: {
      receptor: {
        tipoDocumento: '13',
        numDocumento: '01234567-8',
        nombre: 'María Gómez',
        codActividad: '10005',
        descActividad: 'Otros',
        direccion: {
          departamento: '06',
          municipio: '23',
          distrito: '14',
          complemento: 'Colonia Escalón',
        },
      },
      documentosAsociados: [{ descripcion: 'Resolución', detalle: 'RES-01-2026' }],
      items: [{ tipoDonacion: 1, descripcion: 'Donación en efectivo', valorUni: 100 }],
    },
  }

  it('con el MH caído desde la autenticación responden mh_no_disponible sin gastar correlativo', async () => {
    const { ctx, estado } = await entorno()
    estado.caido = true
    const error = await emitir(ctx, DONACION).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('mh_no_disponible')
    estado.caido = false
    const r = await emitir(ctx, DONACION)
    expect(r.status).toBe(201)
    expect((r.cuerpo as { numeroControl: string }).numeroControl).toBe(
      'DTE-15-M001P001-000000000000001',
    )
  })

  it('si el MH cae al transmitir quedan pendientes, nunca en contingencia', async () => {
    const { ctx, estado } = await entorno()
    expect((await emitir(ctx, FACTURA)).status).toBe(201)
    estado.caido = true
    const error = await emitir(ctx, DONACION).catch((e: unknown) => e)
    expect((error as AppError).code).toBe('emision_incierta')
    const { codigoGeneracion } = (error as AppError).details as { codigoGeneracion: string }
    const doc = await obtener(ctx, codigoGeneracion)
    expect(doc.estado).toBe('pendiente')
    expect(doc.dte?.identificacion).not.toHaveProperty('tipoContingencia')
  })
})

describe('webhooks de la contingencia', () => {
  it('notifica contingencia y procesado; sin waitUntil las entregas esperan al cron', async () => {
    const { ctx, estado } = await entorno()
    const { id } = await crearWebhook(ctx, {
      url: 'https://receptor.ejemplo.com/hook',
      descripcion: null,
      eventos: ['dte.contingencia', 'dte.procesado', 'dte.rechazado'],
      activo: true,
    })
    const eventos = async () =>
      (
        await env.DB.prepare(
          'SELECT evento, estado, payload FROM webhook_entrega WHERE webhook_id = ?1 ORDER BY creado',
        )
          .bind(id)
          .all<{ evento: string; estado: string; payload: string }>()
      ).results

    estado.rechazar = true
    await emitir(ctx, FACTURA).catch(() => {})
    estado.rechazar = false
    estado.caido = true
    const a = await emitir(ctx, FACTURA)
    estado.caido = false
    await transmitirContingencia(ctx)
    const codigo = (a.cuerpo as { codigoGeneracion: string }).codigoGeneracion

    const filas = await eventos()
    expect(filas.map((f) => [f.evento, f.estado])).toEqual([
      ['dte.rechazado', 'pendiente'],
      ['dte.contingencia', 'pendiente'],
      ['dte.procesado', 'pendiente'],
    ])
    expect(JSON.parse(filas[2]!.payload).datos).toMatchObject({
      codigoGeneracion: codigo,
      estado: 'procesado',
    })

    const envio = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(null, { status: 204 }))
    try {
      await entregarPendientes(env, crearDb(env.DB))
      expect((await eventos()).map((f) => f.estado)).toEqual([
        'entregado',
        'entregado',
        'entregado',
      ])
      expect(envio).toHaveBeenCalledTimes(3)
    } finally {
      envio.mockRestore()
    }
  })
})
