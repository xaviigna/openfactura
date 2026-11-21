import { env } from 'cloudflare:test'
import { ClienteMH, ErrorConexionMH, ErrorMH } from '@openfactura/dte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FACTURA, nuevaClave, nuevaOrganizacion } from './ayudas'

const NIT_EMISOR = '06142907861023'
const INEXISTENTE = '00000000-0000-4000-8000-000000000000'
const nuevoCodigo = () => crypto.randomUUID().toUpperCase()

/**
 * El simulador del MH es por credencial: sólo la organización que emitió ve el documento en él. Con
 * credenciales reales cualquier organización lo vería; el servicio usa las del que consulta en ambos casos.
 */
async function escenario(scopes = ['dte:read']) {
  const emisora = await nuevaOrganizacion({ emisor: true })
  const emision = await emisora.cliente.json('POST', '/api/v1/dte', FACTURA)
  expect(emision.status).toBe(201)
  const consultora = emisora
  const clave = await nuevaClave(consultora.cliente, scopes)
  return {
    codigo: emision.cuerpo.codigoGeneracion as string,
    sello: emision.cuerpo.selloRecibido as string,
    c: clave.cliente,
    consultora,
  }
}
const consulta = (codigoGeneracion: string, extra: Record<string, unknown> = {}) => ({
  nitEmisor: NIT_EMISOR,
  tipoDte: '01',
  codigoGeneracion,
  ...extra,
})

afterEach(() => vi.restoreAllMocks())

describe('POST /dte/consultar-mh', () => {
  it('encuentra un documento de otro emisor y no guarda nada de él', async () => {
    const { codigo, c } = await escenario()
    const antes = await env.DB.prepare('SELECT COUNT(*) AS n FROM documento').first<{ n: number }>()
    const r = await c.json('POST', '/api/v1/dte/consultar-mh', consulta(codigo))
    expect(r.status).toBe(200)
    expect(r.cuerpo).toMatchObject({
      veredicto: 'encontrado',
      estado: 'procesado',
      selloCoincide: null,
      ambiente: '00',
      cache: false,
    })
    expect(JSON.stringify(r.cuerpo)).not.toContain(codigo)
    const despues = await env.DB.prepare('SELECT COUNT(*) AS n FROM documento').first<{
      n: number
    }>()
    expect(despues?.n).toBe(antes?.n)
  })

  it('compara el sello sin devolverlo: coincide, o discrepancia', async () => {
    const { codigo, sello, c } = await escenario()
    const bien = await c.json(
      'POST',
      '/api/v1/dte/consultar-mh',
      consulta(codigo, { selloRecibido: sello.toLowerCase() }),
    )
    expect(bien.cuerpo).toMatchObject({ veredicto: 'encontrado', selloCoincide: true })
    const mal = await c.json(
      'POST',
      '/api/v1/dte/consultar-mh',
      consulta(codigo, { selloRecibido: 'A'.repeat(40) }),
    )
    expect(mal.cuerpo).toMatchObject({ veredicto: 'discrepancia', selloCoincide: false })
    expect(mal.cuerpo.cache).toBe(true) // la segunda consulta sale de la caché
    expect(JSON.stringify([bien.cuerpo, mal.cuerpo])).not.toContain(sello)
  })

  it('un documento que el MH no registra es no_encontrado', async () => {
    const { c } = await escenario()
    const r = await c.json('POST', '/api/v1/dte/consultar-mh', consulta(INEXISTENTE))
    expect(r.status).toBe(200)
    expect(r.cuerpo).toMatchObject({
      veredicto: 'no_encontrado',
      estado: null,
      selloCoincide: null,
    })
  })

  it('valida la entrada antes de llamar al MH', async () => {
    const { c } = await escenario()
    const espia = vi.spyOn(ClienteMH.prototype, 'consultarDte')
    for (const malo of [
      consulta('no-es-uuid'),
      consulta(nuevoCodigo(), { tipoDte: '99' }),
      consulta(nuevoCodigo(), { nitEmisor: '123' }),
      consulta(nuevoCodigo(), { selloRecibido: 'corto' }),
    ]) {
      expect((await c.json('POST', '/api/v1/dte/consultar-mh', malo)).status).toBe(400)
    }
    expect(espia).not.toHaveBeenCalled()
  })

  it('exige dte:read', async () => {
    const { c } = await escenario(['clientes:read'])
    const r = await c.json('POST', '/api/v1/dte/consultar-mh', consulta(nuevoCodigo()))
    expect(r.status).toBe(403)
  })

  it('sin credenciales propias no consulta (nunca usa las de otro)', async () => {
    const { cliente } = await nuevaOrganizacion()
    await cliente.json('PUT', '/api/v1/emisor', { ...(await import('./ayudas')).EMISOR })
    const k = await nuevaClave(cliente, ['dte:read'])
    const r = await k.cliente.json('POST', '/api/v1/dte/consultar-mh', consulta(nuevoCodigo()))
    expect(r.status).toBe(409)
    expect(r.cuerpo.error.code).toBe('credenciales_incompletas')
  })
})

describe('consultar-mh: fallos del MH (cliente MH simulado)', () => {
  it('con el MH caído reintenta una vez y responde 502 mh_no_disponible', async () => {
    const { c } = await escenario()
    const espia = vi
      .spyOn(ClienteMH.prototype, 'consultarDte')
      .mockRejectedValue(new ErrorConexionMH('fetch failed'))
    const r = await c.json('POST', '/api/v1/dte/consultar-mh', consulta(nuevoCodigo()))
    expect(r.status).toBe(502)
    expect(r.cuerpo.error.code).toBe('mh_no_disponible')
    expect(espia).toHaveBeenCalledTimes(2)
  })

  it('un fallo transitorio seguido de éxito se recupera dentro del tope de intentos', async () => {
    const { c } = await escenario()
    const espia = vi
      .spyOn(ClienteMH.prototype, 'consultarDte')
      .mockRejectedValueOnce(new ErrorConexionMH('timeout'))
      .mockResolvedValueOnce({
        estado: 'PROCESADO',
        selloRecibido: 'S'.repeat(40),
        fhProcesamiento: '17/11/2026 10:00:00',
      })
    const r = await c.json('POST', '/api/v1/dte/consultar-mh', consulta(nuevoCodigo()))
    expect(r.status).toBe(200)
    expect(r.cuerpo).toMatchObject({
      veredicto: 'encontrado',
      fechaProcesamiento: '17/11/2026 10:00:00',
    })
    expect(espia).toHaveBeenCalledTimes(2)
  })

  it('credenciales rechazadas y respuestas que no son un veredicto no se confunden con no_encontrado', async () => {
    const { c } = await escenario()
    const espia = vi.spyOn(ClienteMH.prototype, 'consultarDte')
    espia.mockRejectedValueOnce(new ErrorMH('Autenticación rechazada', 401, {}))
    const a = await c.json('POST', '/api/v1/dte/consultar-mh', consulta(nuevoCodigo()))
    expect(a.cuerpo.error.code).toBe('mh_credenciales_rechazadas')
    espia.mockResolvedValueOnce({
      estado: 'RECHAZADO',
      codigoMsg: '020',
      descripcionMsg: 'PARAMETROS NO SON VALIDOS',
    } as never)
    const b = await c.json('POST', '/api/v1/dte/consultar-mh', consulta(nuevoCodigo()))
    expect(b.status).toBe(502)
    expect(b.cuerpo.error.code).toBe('mh_respuesta_inesperada')
    expect(espia).toHaveBeenCalledTimes(2) // sin reintento: no es un fallo de red
  })

  it('marca un documento invalidado', async () => {
    const { c } = await escenario()
    vi.spyOn(ClienteMH.prototype, 'consultarDte').mockResolvedValue({
      estado: 'INVALIDADO',
      selloRecibido: 'S'.repeat(40),
    })
    const r = await c.json('POST', '/api/v1/dte/consultar-mh', consulta(nuevoCodigo()))
    expect(r.cuerpo).toMatchObject({ veredicto: 'encontrado', estado: 'invalidado' })
  })
})

describe('consultar-mh: topes y caché', () => {
  it('la caché evita repetir la llamada al MH y está aislada por organización', async () => {
    const { c } = await escenario()
    const otra = await escenario()
    const codigo = nuevoCodigo()
    const espia = vi
      .spyOn(ClienteMH.prototype, 'consultarDte')
      .mockResolvedValue({ estado: 'PROCESADO', selloRecibido: 'S'.repeat(40) })
    await c.json('POST', '/api/v1/dte/consultar-mh', consulta(codigo))
    const segunda = await c.json('POST', '/api/v1/dte/consultar-mh', consulta(codigo))
    expect(segunda.cuerpo.cache).toBe(true)
    expect(espia).toHaveBeenCalledTimes(1)
    const ajena = await otra.c.json('POST', '/api/v1/dte/consultar-mh', consulta(codigo))
    expect(ajena.cuerpo.cache).toBe(false)
    expect(espia).toHaveBeenCalledTimes(2)
  })

  it('por clave: pasado el tope responde 429 limite_excedido sin tocar al MH', async () => {
    const { c } = await escenario()
    const espia = vi
      .spyOn(ClienteMH.prototype, 'consultarDte')
      .mockResolvedValue({ codigoMsg: '014', estado: 'RECHAZADO' } as never)
    let ultimo = 0
    let cuerpo: any
    for (let i = 0; i < 21; i++) {
      const r = await c.json('POST', '/api/v1/dte/consultar-mh', consulta(nuevoCodigo()))
      ultimo = r.status
      cuerpo = r.cuerpo
    }
    expect(ultimo).toBe(429)
    expect(cuerpo.error.code).toBe('limite_excedido')
    expect(espia).toHaveBeenCalledTimes(20)
  })

  it('por organización y día: otra clave de la misma organización comparte el tope', async () => {
    const { c, consultora } = await escenario()
    const k2 = await nuevaClave(consultora.cliente, ['dte:read'])
    const espia = vi
      .spyOn(ClienteMH.prototype, 'consultarDte')
      .mockResolvedValue({ codigoMsg: '014', estado: 'RECHAZADO' } as never)
    // El tope del día se fija bajo por entorno en las pruebas de servicio; aquí basta comprobar el contador compartido.
    await c.json('POST', '/api/v1/dte/consultar-mh', consulta(nuevoCodigo()))
    await k2.cliente.json('POST', '/api/v1/dte/consultar-mh', consulta(nuevoCodigo()))
    const fila = await env.DB.prepare('SELECT cuenta FROM ventana_limite WHERE bucket = ?1')
      .bind(`consulta-tercero-dia:${consultora.organizationId}`)
      .first<{ cuenta: number }>()
    expect(fila?.cuenta).toBe(2)
    expect(espia).toHaveBeenCalledTimes(2)
  })
})
