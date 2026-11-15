import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { Cliente, FACTURA, nuevaClave, nuevaOrganizacion } from './ayudas'

/** Despacha contra el Worker esperando sus `waitUntil`: los registros se anotan después de responder. */
const despachar = async (peticion: Request) => {
  const contexto = createExecutionContext()
  const respuesta = await worker.fetch(peticion, env, contexto)
  await waitOnExecutionContext(contexto)
  return respuesta
}
const esperando = (cliente: Cliente) => {
  cliente.despachar = despachar
  return cliente
}

describe('uso', () => {
  it('agrega por día los documentos del ambiente activo', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const vacio = await cliente.json('GET', '/api/v1/uso')
    expect(vacio.status).toBe(200)
    expect(vacio.cuerpo).toMatchObject({
      ambiente: '00',
      totales: { emitidos: 0, procesados: 0, rechazados: 0, monto: 0 },
      dias: [],
    })
    expect(vacio.cuerpo.desde < vacio.cuerpo.hasta).toBe(true)

    await cliente.json('POST', '/api/v1/dte', FACTURA)
    await cliente.json('POST', '/api/v1/dte', FACTURA)
    const { cuerpo } = await cliente.json('GET', '/api/v1/uso')
    expect(cuerpo.totales).toEqual({ emitidos: 2, procesados: 2, rechazados: 0, monto: 45.2 })
    expect(cuerpo.dias).toEqual([
      { fecha: cuerpo.hasta, emitidos: 2, procesados: 2, rechazados: 0, monto: 45.2 },
    ])

    // Un rango anterior no incluye lo de hoy.
    const antes = await cliente.json('GET', '/api/v1/uso?desde=2020-01-01&hasta=2020-01-31')
    expect(antes.cuerpo.totales.emitidos).toBe(0)
  })

  it('valida el rango y exige dte:read', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    for (const consulta of [
      'desde=2026-02-01&hasta=2026-01-01',
      'desde=2020-01-01&hasta=2026-01-01',
      'desde=ayer',
      'desde=2026-13-45',
    ]) {
      expect((await cliente.pedir('GET', `/api/v1/uso?${consulta}`)).status, consulta).toBe(400)
    }
    const { cliente: sinPermiso } = await nuevaClave(cliente, ['clientes:read'])
    expect((await sinPermiso.pedir('GET', '/api/v1/uso')).status).toBe(403)
  })

  it('una clave live sólo cuenta producción', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    await cliente.json('POST', '/api/v1/dte', FACTURA)
    const { cliente: live } = await nuevaClave(cliente, ['dte:read'], { modo: 'live' })
    const { cuerpo } = await live.json('GET', '/api/v1/uso')
    expect(cuerpo).toMatchObject({ ambiente: '01', totales: { emitidos: 0 } })
  })
})

describe('registros de la API', () => {
  it('anota las peticiones con clave: patrón de ruta, estado y origen, sin datos de la petición', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const { cuerpo: doc } = await cliente.json('POST', '/api/v1/dte', FACTURA)
    const clave = await nuevaClave(cliente, ['dte:read', 'registros:read'])
    const conClave = esperando(clave.cliente)

    await conClave.pedir('GET', `/api/v1/dte/${doc.codigoGeneracion}`)
    await conClave.pedir('GET', '/api/v1/dte?q=secreto-del-cliente')
    await conClave.pedir('GET', '/api/v1/dte/no-existe')
    await conClave.pedir('GET', '/api/v1/clientes') // 403: la clave no tiene clientes:read
    await conClave.pedir('GET', '/api/v1/ruta/inventada/123')
    await conClave.pedir(
      'POST',
      '/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { Accept: 'application/json, text/event-stream' },
    )

    // Las peticiones del panel (sesión) no se anotan.
    const { status, cuerpo } = await cliente.json('GET', '/api/v1/registros')
    expect(status).toBe(200)
    expect(cuerpo.map((r: any) => [r.metodo, r.ruta, r.estado, r.origen]).reverse()).toEqual([
      ['GET', '/api/v1/dte/:codigo', 200, 'api'],
      ['GET', '/api/v1/dte', 200, 'api'],
      ['GET', '/api/v1/dte/:codigo', 404, 'api'],
      ['GET', '/api/v1/clientes', 403, 'api'],
      ['GET', '/api/*', 404, 'api'],
      ['POST', '/mcp', 200, 'mcp'],
    ])
    expect(cuerpo[0].clave).toEqual({ id: clave.id, prefijo: expect.any(String), nombre: 'Prueba' })
    expect(cuerpo[0].clave.prefijo).toHaveLength(14)
    expect(cuerpo[0].duracionMs).toBeGreaterThanOrEqual(0)
    // Ni identificadores, ni consulta, ni la clave completa.
    const todo = JSON.stringify(cuerpo)
    expect(todo).not.toContain(doc.codigoGeneracion)
    expect(todo).not.toContain('secreto-del-cliente')
    expect(todo).not.toContain(clave.clave)
    const columnas = await env.DB.prepare('SELECT * FROM registro_api LIMIT 1').first()
    expect(Object.keys(columnas!).sort()).toEqual(
      [
        'id',
        'organization_id',
        'clave_id',
        'metodo',
        'ruta',
        'estado',
        'duracion_ms',
        'origen',
        'creado',
      ].sort(),
    )

    // Filtros.
    const errores = await cliente.json('GET', '/api/v1/registros?estado=error')
    expect(errores.cuerpo.map((r: any) => r.estado)).toEqual([404, 403, 404])
    const mcp = await cliente.json('GET', '/api/v1/registros?origen=mcp')
    expect(mcp.cuerpo).toHaveLength(1)
    const pagina = await cliente.json(
      'GET',
      `/api/v1/registros?limite=2&antesDe=${cuerpo[1].creado}`,
    )
    expect(pagina.cuerpo.length).toBeLessThanOrEqual(2)
    expect(pagina.cuerpo.every((r: any) => r.creado < cuerpo[1].creado)).toBe(true)

    // La propia clave los lee con registros:read (CLI y MCP), y esa lectura también queda anotada.
    const propios = await conClave.json('GET', '/api/v1/registros?limite=1')
    expect(propios.status).toBe(200)
    const tras = await cliente.json('GET', '/api/v1/registros?limite=1')
    expect(tras.cuerpo[0]).toMatchObject({ ruta: '/api/v1/registros', estado: 200 })
  })

  it('exige registros:read y no muestra los de otra organización', async () => {
    const a = await nuevaOrganizacion({ emisor: true })
    const b = await nuevaOrganizacion({ emisor: true })
    const claveA = await nuevaClave(a.cliente, ['dte:read'])
    await esperando(claveA.cliente).pedir('GET', '/api/v1/dte')
    expect((await a.cliente.json('GET', '/api/v1/registros')).cuerpo).toHaveLength(1)

    expect((await b.cliente.json('GET', '/api/v1/registros')).cuerpo).toHaveLength(0)
    const filtrando = await b.cliente.json('GET', `/api/v1/registros?claveId=${claveA.id}`)
    expect(filtrando.cuerpo).toHaveLength(0)
    expect((await b.cliente.json('GET', '/api/v1/uso')).cuerpo.totales.emitidos).toBe(0)

    // Sin el permiso: ni una clave ni un facturador.
    expect((await claveA.cliente.pedir('GET', '/api/v1/registros')).status).toBe(403)
    await env.DB.prepare("UPDATE member SET role = 'member' WHERE organization_id = ?1")
      .bind(a.organizationId)
      .run()
    expect((await a.cliente.pedir('GET', '/api/v1/registros')).status).toBe(403)
  })

  it('una clave inválida no deja registro y el cron borra lo que pasa de 30 días', async () => {
    const { cliente, organizationId } = await nuevaOrganizacion()
    const clave = await nuevaClave(cliente, ['dte:read'])
    const falsa = esperando(new Cliente(`of_test_${'x'.repeat(40)}`))
    expect((await falsa.pedir('GET', '/api/v1/dte')).status).toBe(401)
    expect((await cliente.json('GET', '/api/v1/registros')).cuerpo).toHaveLength(0)

    const insertar = (id: string, creado: number) =>
      env.DB.prepare(
        `INSERT INTO registro_api (id, organization_id, clave_id, metodo, ruta, estado, duracion_ms, origen, creado)
         VALUES (?1, ?2, ?3, 'GET', '/api/v1/dte', 200, 5, 'api', ?4)`,
      )
        .bind(id, organizationId, clave.id, creado)
        .run()
    await insertar('viejo', Date.now() - 31 * 86_400_000)
    await insertar('reciente', Date.now() - 29 * 86_400_000)
    const contexto = createExecutionContext()
    worker.scheduled({} as ScheduledController, env, contexto)
    await waitOnExecutionContext(contexto)
    const { cuerpo } = await cliente.json('GET', '/api/v1/registros')
    expect(cuerpo.map((r: any) => r.id)).toEqual(['reciente'])
  })

  it('al exceder el límite anota un solo 429 por ventana', async () => {
    const { cliente } = await nuevaOrganizacion()
    const clave = await nuevaClave(cliente, ['dte:read'])
    const conClave = esperando(clave.cliente)
    // Todas en la misma ventana de un minuto: el límite de pruebas es 40.
    vi.useFakeTimers({ toFake: ['Date'], now: Math.floor(Date.now() / 60_000) * 60_000 + 1000 })
    try {
      const estados: number[] = []
      for (let i = 0; i < 45; i++) estados.push((await conClave.pedir('GET', '/api/v1/dte')).status)
      expect(estados.filter((e) => e === 429)).toHaveLength(5)
    } finally {
      vi.useRealTimers()
    }
    const { cuerpo } = await cliente.json('GET', '/api/v1/registros?limite=200')
    expect(cuerpo).toHaveLength(41)
    expect(cuerpo.filter((r: any) => r.estado === 429)).toHaveLength(1)
  })

  it('el último uso de la clave se actualiza al usarla', async () => {
    const { cliente } = await nuevaOrganizacion()
    const clave = await nuevaClave(cliente, ['dte:read'])
    const antes = await cliente.json('GET', '/api/v1/claves')
    expect(antes.cuerpo[0]).toMatchObject({ estado: 'activa', ultimoUso: null })
    await clave.cliente.pedir('GET', '/api/v1/dte')
    const despues = await cliente.json('GET', '/api/v1/claves')
    expect(despues.cuerpo[0].ultimoUso).toBeGreaterThan(Date.now() - 60_000)
  })
})
