import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { crearWorker } from '../src/index'
import { Cliente, EMISOR, FACTURA, nuevaOrganizacion } from './ayudas'

const TOKEN = 'token-de-administracion-solo-para-pruebas-0123456789'

/** Worker de una instalación propia con ADMIN_TOKEN (o sin él, con `token: undefined`). */
function clienteDe(token: string | undefined, credencial?: string) {
  const worker = crearWorker([])
  const cliente = new Cliente(credencial)
  cliente.despachar = async (peticion) => {
    const contexto = createExecutionContext()
    const r = await worker.fetch(peticion, { ...env, ADMIN_TOKEN: token }, contexto)
    await waitOnExecutionContext(contexto)
    return r
  }
  return cliente
}

/** Cliente con ADMIN_TOKEN que actúa sobre una organización. */
const operador = (organizationId: string) => {
  const c = clienteDe(TOKEN, TOKEN)
  const pedir = c.pedir.bind(c)
  c.pedir = (metodo, ruta, cuerpo, encabezados = {}) =>
    pedir(metodo, ruta, cuerpo, { 'X-Organizacion': organizationId, ...encabezados })
  return c
}

describe('administración de una instalación propia (ADMIN_TOKEN)', () => {
  it('sin ADMIN_TOKEN las rutas de administración no existen y el token no vale en /api/v1', async () => {
    const sin = clienteDe(undefined, TOKEN)
    expect((await sin.json('GET', '/api/admin/organizaciones')).status).toBe(404)
    expect((await sin.json('GET', '/api/v1/emisor')).status).toBe(401)
    // Un ADMIN_TOKEN corto tampoco activa nada.
    const corto = clienteDe('corto', 'corto')
    expect((await corto.json('GET', '/api/admin/organizaciones')).status).toBe(404)
  })

  it('exige el token correcto', async () => {
    expect((await clienteDe(TOKEN).json('GET', '/api/admin/organizaciones')).status).toBe(401)
    const malo = clienteDe(TOKEN, `${TOKEN}x`)
    expect((await malo.json('POST', '/api/admin/organizaciones', { nombre: 'X' })).status).toBe(401)
  })

  it('alta sin panel: organización, emisor, credenciales de prueba, clave de API y primer DTE', async () => {
    const creada = await clienteDe(TOKEN, TOKEN).json('POST', '/api/admin/organizaciones', {
      nombre: 'Café Ñandú',
    })
    expect(creada.status).toBe(201)
    expect(creada.cuerpo.slug).toMatch(/^cafe-nandu-[a-z0-9]{6}$/)
    const org = creada.cuerpo.id as string

    const lista = await clienteDe(TOKEN, TOKEN).json('GET', '/api/admin/organizaciones')
    expect(lista.cuerpo.map((o: { id: string }) => o.id)).toContain(org)

    const op = operador(org)
    expect((await op.json('PUT', '/api/v1/emisor', EMISOR)).status).toBe(200)
    expect((await op.json('POST', '/api/v1/emisor/credenciales-prueba')).status).toBe(200)
    const clave = await op.json('POST', '/api/v1/claves', {
      nombre: 'Integración',
      modo: 'test',
      scopes: ['dte:read', 'dte:emit'],
    })
    expect(clave.status).toBe(201)

    // La clave creada por el operador emite como cualquier otra.
    const integrador = clienteDe(TOKEN, clave.cuerpo.clave)
    const dte = await integrador.json('POST', '/api/v1/dte', FACTURA, {
      'Idempotency-Key': crypto.randomUUID(),
    })
    expect(dte.status).toBe(201)

    // Queda en la auditoría como el operador.
    const auditoria = await op.json('GET', '/api/v1/auditoria')
    const acciones = auditoria.cuerpo.map((a: { accion: string; actorId: string }) => [
      a.accion,
      a.actorId,
    ])
    expect(acciones).toContainEqual(['organizacion.crear', 'admin'])
    expect(acciones).toContainEqual(['clave.crear', 'admin'])
  })

  it('con ADMIN_TOKEN hay que decir la organización, y debe existir', async () => {
    const sinOrg = clienteDe(TOKEN, TOKEN)
    const r = await sinOrg.json('GET', '/api/v1/emisor')
    expect(r.status).toBe(400)
    expect(r.cuerpo.error.code).toBe('organizacion_requerida')
    expect((await operador('no-existe').json('GET', '/api/v1/emisor')).status).toBe(404)
  })

  it('el ADMIN_TOKEN no vale en el MCP', async () => {
    const r = await operador((await nuevaOrganizacion()).organizationId).pedir(
      'POST',
      '/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { Accept: 'application/json, text/event-stream' },
    )
    expect(r.status).toBe(401)
  })
})
