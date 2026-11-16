import { env } from 'cloudflare:test'
import { generarCertificadoPrueba } from '@openfactura/dte'
import { crearMockMH } from '@openfactura/dte/mock'
import { esquemaEmision, esquemaEmisor, esquemaOperacionesEspeciales, PERMISOS } from 'shared'
import { afterEach, describe, expect, it } from 'vitest'
import type { Ctx } from '../src/contexto'
import { crearDb } from '../src/db'
import { ctxDeMiembro } from '../src/extensiones'
import type { AppError } from '../src/lib/errors'
import { emitir } from '../src/services/dte'
import { guardarCredenciales, guardarEmisor } from '../src/services/emisor'
import { informarOperacionesEspeciales, listarEventos } from '../src/services/eventos'
import { ejecutarUnaVez } from '../src/services/idempotencia'
import { publicar } from '../src/services/webhooks'
import {
  type Cliente,
  cambiarAmbiente,
  EMISOR,
  FACTURA,
  nuevaClave,
  nuevaOrganizacion,
} from './ayudas'

const CLIENTE = { tipoDocumento: '13', numDocumento: '01234567-8', nombre: 'Cliente de producción' }
const PRODUCTO = { codigo: 'P-1', descripcion: 'Producto de producción', precioUnitario: 10 }

/** Las cinco rutas de clientes y la emisión con `clienteId`: todas responden lo mismo en pruebas. */
async function rutasDeClientes(c: Cliente, id: string) {
  return [
    await c.json('GET', '/api/v1/clientes'),
    await c.json('GET', `/api/v1/clientes/${id}`),
    await c.json('POST', '/api/v1/clientes', { ...CLIENTE, numDocumento: '09876543-2' }),
    await c.json('PUT', `/api/v1/clientes/${id}`, { ...CLIENTE, nombre: 'Robado' }),
    await c.json('DELETE', `/api/v1/clientes/${id}`),
    await c.json('POST', '/api/v1/dte', { tipoDte: '01', clienteId: id, datos: FACTURA.datos }),
  ]
}

const esSoloProduccion = (r: { status: number; cuerpo: any }) =>
  r.status === 409 && r.cuerpo.error.code === 'clientes_solo_produccion'

describe('clientes sólo en producción', () => {
  const PERMISOS_CLAVE = [
    'clientes:read',
    'clientes:write',
    'productos:read',
    'productos:write',
    'dte:emit',
  ]

  it('una clave de pruebas no usa el directorio aunque la organización esté en producción', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    await cambiarAmbiente(cliente, '01')
    const live = await nuevaClave(cliente, PERMISOS_CLAVE, { modo: 'live' })
    const test = await nuevaClave(cliente, PERMISOS_CLAVE, { modo: 'test' })

    // La clave de producción sí usa el directorio.
    const c = await live.cliente.json('POST', '/api/v1/clientes', CLIENTE)
    expect(c.status).toBe(201)
    expect(c.cuerpo).not.toHaveProperty('ambiente')
    expect((await live.cliente.json('GET', '/api/v1/clientes')).cuerpo).toHaveLength(1)
    expect((await live.cliente.json('GET', `/api/v1/clientes/${c.cuerpo.id}`)).status).toBe(200)

    for (const r of await rutasDeClientes(test.cliente, c.cuerpo.id)) {
      expect(esSoloProduccion(r), JSON.stringify(r.cuerpo)).toBe(true)
    }
    // El cliente de producción quedó intacto.
    expect((await live.cliente.json('GET', `/api/v1/clientes/${c.cuerpo.id}`)).cuerpo.nombre).toBe(
      CLIENTE.nombre,
    )

    // Los productos siguen separados por ambiente.
    const p = (await live.cliente.json('POST', '/api/v1/productos', PRODUCTO)).cuerpo
    expect(p.ambiente).toBe('01')
    expect((await test.cliente.json('GET', '/api/v1/productos')).cuerpo).toHaveLength(0)
    expect((await test.cliente.json('GET', `/api/v1/productos/${p.id}`)).status).toBe(404)
    expect((await test.cliente.json('DELETE', `/api/v1/productos/${p.id}`)).status).toBe(404)
    expect(
      (
        await test.cliente.json('PUT', `/api/v1/productos/${p.id}`, {
          ...PRODUCTO,
          descripcion: 'Robado',
        })
      ).status,
    ).toBe(404)
    const propio = await test.cliente.json('POST', '/api/v1/productos', PRODUCTO)
    expect(propio.status).toBe(201)
    expect(propio.cuerpo.ambiente).toBe('00')
    expect((await cliente.json('GET', '/api/v1/productos')).cuerpo).toHaveLength(2)
  })

  it('una sesión con la organización en pruebas recibe el mismo error', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    await cambiarAmbiente(cliente, '01')
    const c = (await cliente.json('POST', '/api/v1/clientes', CLIENTE)).cuerpo
    await cambiarAmbiente(cliente, '00')
    for (const r of await rutasDeClientes(cliente, c.id)) {
      expect(esSoloProduccion(r), JSON.stringify(r.cuerpo)).toBe(true)
    }
  })

  it('pasar de producción a pruebas y volver conserva los clientes', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    await cambiarAmbiente(cliente, '01')
    const c = (await cliente.json('POST', '/api/v1/clientes', CLIENTE)).cuerpo
    await cambiarAmbiente(cliente, '00')
    expect(esSoloProduccion(await cliente.json('GET', '/api/v1/clientes'))).toBe(true)
    await cambiarAmbiente(cliente, '01')
    const lista = (await cliente.json('GET', '/api/v1/clientes')).cuerpo
    expect(lista.map((x: { id: string }) => x.id)).toEqual([c.id])
  })
})

describe('webhooks por ambiente (despacho)', () => {
  it('un webhook de una clave de pruebas no recibe eventos de producción', async () => {
    const { cliente, organizationId, userId } = await nuevaOrganizacion({ emisor: true })
    const test = await nuevaClave(cliente, ['webhooks:manage'], { modo: 'test' })
    const w = await test.cliente.json('POST', '/api/v1/webhooks', {
      url: 'https://receptor.ejemplo.com/hooks/openfactura',
      eventos: ['dte.procesado'],
    })
    expect(w.cuerpo.ambiente).toBe('00')
    const ctx = (await ctxDeMiembro(env, {
      userId,
      organizationId,
      origen: 'api',
      db: crearDb(env.DB),
    }))!
    const cuenta = async () =>
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM webhook_entrega WHERE webhook_id = ?1')
        .bind(w.cuerpo.id)
        .first<{ n: number }>())!.n

    await publicar(ctx, 'dte.procesado', { codigoGeneracion: 'PROD', ambiente: '01' })
    expect(await cuenta()).toBe(0)
    await publicar(ctx, 'dte.procesado', { codigoGeneracion: 'PRUEBA', ambiente: '00' })
    expect(await cuenta()).toBe(1)
    // `ambiente: null` explícito (un evento sin ambiente, de una extensión) llega igual.
    await publicar(ctx, 'dte.procesado', { codigoGeneracion: 'SIN-AMBIENTE', ambiente: null })
    expect(await cuenta()).toBe(2)
  })
})

describe('idempotencia ante un fallo parcial', () => {
  afterEach(() => env.DB.exec('DROP TRIGGER IF EXISTS falla_idempotencia'))

  it('si no se puede guardar la respuesta, el reintento no emite otro DTE', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const llave = { 'Idempotency-Key': 'pedido-parcial-1' }
    // Inyecta el fallo: el UPDATE que guarda la respuesta aborta, la reserva ya existe.
    await env.DB.exec(
      "CREATE TRIGGER falla_idempotencia BEFORE UPDATE ON idempotencia BEGIN SELECT RAISE(ABORT, 'D1 caído'); END",
    )
    const primera = await cliente.json('POST', '/api/v1/dte', FACTURA, llave)
    expect(primera.status).toBe(201) // el DTE se emitió y se le entrega al cliente
    await env.DB.exec('DROP TRIGGER falla_idempotencia')

    const reintento = await cliente.json('POST', '/api/v1/dte', FACTURA, llave)
    expect(reintento.status).toBe(409)
    expect(reintento.cuerpo.error.code).toBe('idempotencia_en_curso')
    expect((await cliente.json('GET', '/api/v1/dte')).cuerpo.total).toBe(1)
  })
})

describe('eventos 17/18 ante un MH que no responde', () => {
  const NIT = '06142907861023'
  const PASSWORD_API = 'api-de-prueba'
  const OPERACIONES = esquemaOperacionesEspeciales.parse({
    tipoDocumento: '02',
    items: [{ descripcion: 'Facturas simplificadas', docDel: '1', docAl: '5', precioUni: 10 }],
  })

  async function entorno() {
    const { organizationId, userId } = await nuevaOrganizacion()
    const mock = crearMockMH({ usuarios: { [NIT]: PASSWORD_API } })
    const estado = { caido: false }
    const mhFetch: typeof fetch = async (input, init) => {
      if (estado.caido) throw new TypeError('fetch failed')
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
    await guardarEmisor(ctx, esquemaEmisor.parse(EMISOR))
    const { xml } = await generarCertificadoPrueba(NIT, 'clave-cert')
    await guardarCredenciales(ctx, '00', {
      apiPassword: PASSWORD_API,
      certificado: xml,
      certificadoPassword: 'clave-cert',
    })
    const informar = (clave: string) =>
      ejecutarUnaVez(ctx, 'operaciones_especiales:00', clave, OPERACIONES, () =>
        informarOperacionesEspeciales(ctx, OPERACIONES),
      )
    return { ctx, estado, informar }
  }

  it('si la conexión cae al transmitir, el reintento con la misma clave no envía otro evento', async () => {
    const { ctx, estado, informar } = await entorno()
    expect((await emitir(ctx, esquemaEmision.parse(FACTURA))).status).toBe(201) // deja un token vigente

    estado.caido = true
    const error = await informar('evento-1').catch((e: unknown) => e)
    expect((error as AppError).code).toBe('evento_incierto')

    estado.caido = false
    const reintento = await informar('evento-1')
    expect(reintento.repetida).toBe(true)
    expect(reintento.status).toBe(502)
    expect(await listarEventos(ctx, 'operaciones_especiales')).toHaveLength(0)
  })

  it('si el MH no responde ni a la autenticación, nada salió y el reintento sí transmite', async () => {
    const { ctx, estado, informar } = await entorno()
    estado.caido = true
    const error = await informar('evento-2').catch((e: unknown) => e)
    expect((error as AppError).code).toBe('mh_no_disponible')

    estado.caido = false
    const reintento = await informar('evento-2')
    expect(reintento.status).toBe(201)
    expect(await listarEventos(ctx, 'operaciones_especiales')).toHaveLength(1)
  })

  it('si no se puede guardar el evento ya sellado, el reintento no lo envía otra vez', async () => {
    const { ctx, informar } = await entorno()
    await env.DB.exec(
      "CREATE TRIGGER falla_evento BEFORE INSERT ON evento BEGIN SELECT RAISE(ABORT, 'D1 caído'); END",
    )
    try {
      const error = await informar('evento-3').catch((e: unknown) => e)
      expect((error as AppError).code).toBe('evento_incierto')
      expect((error as AppError).details).toMatchObject({ selloRecibido: expect.any(String) })
    } finally {
      await env.DB.exec('DROP TRIGGER falla_evento')
    }
    const reintento = await informar('evento-3')
    expect(reintento.repetida).toBe(true)
    expect(await listarEventos(ctx, 'operaciones_especiales')).toHaveLength(0)
  })
})
