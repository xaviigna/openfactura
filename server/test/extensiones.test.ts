import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Extension } from '../src/extensiones'
import { ctxDeMiembro } from '../src/extensiones'
import { crearWorker } from '../src/index'
import { AppError } from '../src/lib/errors'
import { responder } from '../src/mcp'
import { emitir } from '../src/services/dte'
import { ambienteActivo } from '../src/services/emisor'
import { Cliente, FACTURA, nuevaClave, nuevaOrganizacion } from './ayudas'

/**
 * Extensión de prueba: una ruta pública, una autenticada, un cron, enlaces del panel, una capacidad y
 * una herramienta del MCP.
 */
const llamadasCron: string[] = []
const publicados: { evento: string; codigos: unknown[] }[] = []
const demo: Extension = {
  id: 'demo',
  capacidades: ['demo'],
  eventos: { 'demo.listo': 'Algo de la extensión quedó listo' },
  async alPublicar(_ctx, evento, datos) {
    publicados.push({ evento, codigos: datos.map((d) => d.codigoGeneracion) })
  },
  mcp(servidor, ctx) {
    servidor.registerTool(
      'demo_quien',
      { title: 'Quién llama', description: 'Organización del actor', inputSchema: {} },
      () => responder(() => ({ organizationId: ctx.actor.organizationId })),
    )
  },
  rutas(app) {
    app.get('/demo/publica', (c) => c.text('hola'))
  },
  api(router) {
    router.get('/quien', async (c) => {
      const { actor } = c.var.ctx
      return c.json({
        organizationId: actor.organizationId,
        tipo: actor.tipo,
        permisos: [...actor.permisos],
        ambiente: await ambienteActivo(c.var.ctx),
      })
    })
  },
  async cron() {
    llamadasCron.push('demo')
  },
  panel: [
    { titulo: 'Demo', ruta: '/demo/pagina', icono: 'extension', permiso: 'dte:read' },
    {
      titulo: 'Solo admin',
      ruta: '/demo/admin',
      permiso: 'auditoria:read',
      grupo: 'administracion',
    },
  ],
}
const rota: Extension = {
  id: 'rota',
  async cron() {
    throw new Error('falla a propósito')
  },
  // Repite el nombre de una herramienta del núcleo: el SDK lanza al registrarla.
  mcp(servidor) {
    servidor.registerTool('dte_listar', { description: 'repetida' }, () => ({ content: [] }))
  },
}

const worker = crearWorker([demo, rota])
const despachar = async (peticion: Request) => {
  const contexto = createExecutionContext()
  const respuesta = await worker.fetch(peticion, env, contexto)
  await waitOnExecutionContext(contexto)
  return respuesta
}

/** Cliente del Worker con extensiones que reutiliza la sesión de otro. */
const conExtensiones = (cliente: Cliente) => {
  cliente.despachar = despachar
  return cliente
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('extensiones', () => {
  it('monta rutas públicas en la raíz', async () => {
    const r = await despachar(new Request('http://localhost/demo/publica'))
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('hola')
  })

  it('las rutas de /api/v1/ext exigen autenticación y reciben el ctx del actor', async () => {
    const sinSesion = await despachar(new Request('http://localhost/api/v1/ext/demo/quien'))
    expect(sinSesion.status).toBe(401)

    const { cliente, organizationId } = await nuevaOrganizacion({ emisor: true })
    const r = await conExtensiones(cliente).json('GET', '/api/v1/ext/demo/quien')
    expect(r.status).toBe(200)
    expect(r.cuerpo).toMatchObject({ organizationId, tipo: 'usuario', ambiente: '00' })
    expect(r.cuerpo.permisos).toContain('auditoria:read')

    // Con clave de API: sólo los permisos de la clave.
    const { clave } = await nuevaClave(cliente, ['dte:read'])
    const conClave = conExtensiones(new Cliente(clave))
    const r2 = await conClave.json('GET', '/api/v1/ext/demo/quien')
    expect(r2.cuerpo).toMatchObject({ organizationId, tipo: 'clave', permisos: ['dte:read'] })

    // Una ruta de extensión inexistente cae en el 404 común.
    const r3 = await conExtensiones(cliente).json('GET', '/api/v1/ext/demo/nada')
    expect(r3.status).toBe(404)
  })

  it('los enlaces del panel aparecen en /yo según los permisos', async () => {
    const { cliente, organizationId } = await nuevaOrganizacion()
    conExtensiones(cliente)
    const dueno = await cliente.json('GET', '/api/v1/yo')
    expect(dueno.cuerpo.extensiones).toEqual([
      { titulo: 'Demo', ruta: '/demo/pagina', icono: 'extension', grupo: 'mas' },
      { titulo: 'Solo admin', ruta: '/demo/admin', icono: null, grupo: 'administracion' },
    ])
    expect(dueno.cuerpo.cuenta).toBeNull()
    expect(dueno.cuerpo.capacidades).toEqual(['demo'])

    await env.DB.prepare("UPDATE member SET role = 'member' WHERE organization_id = ?1")
      .bind(organizationId)
      .run()
    const facturador = await cliente.json('GET', '/api/v1/yo')
    expect(facturador.cuerpo.extensiones).toEqual([
      { titulo: 'Demo', ruta: '/demo/pagina', icono: 'extension', grupo: 'mas' },
    ])
  })

  it('el cron llama a las extensiones y un fallo no detiene a las demás', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Una ventana de límite vieja: la limpieza del núcleo debe borrarla igual.
    await env.DB.prepare(
      "INSERT INTO ventana_limite (bucket, ventana_inicio, cuenta) VALUES ('vieja', 1, 1)",
    ).run()
    llamadasCron.length = 0
    const contexto = createExecutionContext()
    worker.scheduled({} as ScheduledController, env, contexto)
    await waitOnExecutionContext(contexto)
    expect(llamadasCron).toEqual(['demo'])
    expect(error).toHaveBeenCalledWith('Falló el cron de la extensión rota', expect.any(Error))
    const fila = await env.DB.prepare("SELECT 1 FROM ventana_limite WHERE bucket = 'vieja'").first()
    expect(fila).toBeNull()
  })

  it('ctxDeMiembro actúa con los permisos del rol y rechaza a quien no es miembro', async () => {
    const a = await nuevaOrganizacion()
    const b = await nuevaOrganizacion()
    const ctx = await ctxDeMiembro(env, {
      userId: a.userId,
      organizationId: a.organizationId,
      origen: 'demo',
    })
    expect(ctx?.actor).toMatchObject({ tipo: 'usuario', id: a.userId, origen: 'demo' })
    expect(ctx?.actor.permisos.has('dte:emit')).toBe(true)
    const ajeno = await ctxDeMiembro(env, {
      userId: a.userId,
      organizationId: b.organizationId,
      origen: 'demo',
    })
    expect(ajeno).toBeNull()
  })

  it('crearWorker valida los identificadores y las rutas del panel', () => {
    expect(() => crearWorker([{ id: 'Mal Id' }])).toThrow()
    expect(() => crearWorker([{ id: 'x' }, { id: 'x' }])).toThrow()
    expect(() =>
      crearWorker([{ id: 'x', panel: [{ titulo: 'Fuera', ruta: 'https://otro.com' }] }]),
    ).toThrow()
    for (const ruta of ['//otro.com', '/\\otro.com', '/\\/otro.com']) {
      expect(() => crearWorker([{ id: 'x', panel: [{ titulo: 'Fuera', ruta }] }]), ruta).toThrow()
    }
    expect(() =>
      crearWorker([{ id: 'x', panel: [{ titulo: 'Dentro', ruta: '/cloud/x?y=1' }] }]),
    ).not.toThrow()
    expect(() =>
      crearWorker([
        { id: 'x', panel: [{ titulo: 'Mal grupo', ruta: '/x', grupo: 'otro' as 'mas' }] },
      ]),
    ).toThrow()
  })

  it('la instalación estándar no tiene extensiones', async () => {
    const { cliente } = await nuevaOrganizacion()
    const yo = await cliente.json('GET', '/api/v1/yo')
    expect(yo.cuerpo.extensiones).toEqual([])
    expect(yo.cuerpo.cuenta).toBeNull()
    expect(yo.cuerpo.capacidades).toEqual([])
    const r = await cliente.json('GET', '/api/v1/ext/demo/quien')
    expect(r.status).toBe(404)
  })

  it('una extensión declara eventos de webhook: /yo los lista y sólo con ella se aceptan', async () => {
    const { cliente } = await nuevaOrganizacion()
    const hook = { url: 'https://ejemplo.com/hook', eventos: ['dte.procesado', 'demo.listo'] }
    // Instalación estándar: el evento no existe.
    const sin = await cliente.json('POST', '/api/v1/webhooks', hook)
    expect(sin.status).toBe(400)
    expect((await cliente.json('GET', '/api/v1/yo')).cuerpo.eventosWebhook).toEqual([])

    conExtensiones(cliente)
    expect((await cliente.json('GET', '/api/v1/yo')).cuerpo.eventosWebhook).toEqual([
      { evento: 'demo.listo', descripcion: 'Algo de la extensión quedó listo' },
    ])
    const con = await cliente.json('POST', '/api/v1/webhooks', hook)
    expect(con.status).toBe(201)
    expect(con.cuerpo.eventos).toEqual(['dte.procesado', 'demo.listo'])
    expect(
      (await cliente.json('POST', '/api/v1/webhooks', { ...hook, eventos: ['otro.cosa'] })).status,
    ).toBe(400)

    // Al componer: ni un nombre del núcleo ni un formato inválido.
    expect(() => crearWorker([{ id: 'x', eventos: { 'dte.procesado': 'x' } }])).toThrow()
    expect(() => crearWorker([{ id: 'x', eventos: { Malo: 'x' } }])).toThrow()
  })

  it('alPublicar recibe los eventos aunque no haya webhooks suscritos', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    conExtensiones(cliente)
    publicados.length = 0
    const r = await cliente.json('POST', '/api/v1/dte', FACTURA, {
      'Idempotency-Key': crypto.randomUUID(),
    })
    expect(r.status).toBe(201)
    expect(publicados).toEqual([{ evento: 'dte.procesado', codigos: [r.cuerpo.codigoGeneracion] }])
  })

  it('las herramientas MCP de una extensión actúan con el ctx de la clave; sin ella no existen', async () => {
    const { cliente, organizationId } = await nuevaOrganizacion()
    const { cliente: conClave } = await nuevaClave(cliente, ['dte:read'])
    const mcp = async (c: Cliente, cuerpo: unknown) => {
      const r = await c.pedir('POST', '/mcp', cuerpo, {
        Accept: 'application/json, text/event-stream',
      })
      const texto = await r.text()
      return JSON.parse(texto.includes('data:') ? texto.split('data:').pop()! : texto)
    }
    const lista = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    const nombres = (r: { result: { tools: { name: string }[] } }) =>
      r.result.tools.map((t) => t.name)

    expect(nombres(await mcp(conClave, lista))).not.toContain('demo_quien')

    conExtensiones(conClave)
    // La extensión `rota` falla al registrar; el núcleo y las demás siguen funcionando.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(nombres(await mcp(conClave, lista))).toEqual(
      expect.arrayContaining(['demo_quien', 'dte_listar', 'dte_emitir']),
    )
    const r = await mcp(conClave, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'demo_quien', arguments: {} },
    })
    expect(r.result.structuredContent.resultado).toEqual({ organizationId })
  })
})

describe('ganchos de cuenta y de emisión', () => {
  const CUENTA = {
    plan: { id: 'free', nombre: 'Free' },
    uso: [{ etiqueta: 'DTE del mes', usado: 3, limite: 50 }],
    mejorar: { titulo: 'Mejora tu plan', detalle: 'Más documentos al mes', ruta: '/app/plan' },
  }
  const estado = { bloquear: false, llamadas: [] as Array<{ ambiente: string; tipoDte: string }> }
  const plan: Extension = {
    id: 'plan',
    cuenta: async () => CUENTA,
    async antesDeEmitir(ctx, datos) {
      estado.llamadas.push({ ...datos, organizationId: ctx.actor.organizationId } as never)
      if (estado.bloquear) {
        throw new AppError(402, 'plan_requerido', 'Tu plan no incluye emitir en producción')
      }
    },
  }
  const cuentaRota: Extension = {
    id: 'cuenta-rota',
    async cuenta() {
      throw new Error('falla a propósito')
    },
  }
  const conWorker = (extensiones: Extension[], cliente: Cliente) => {
    const w = crearWorker(extensiones)
    cliente.despachar = async (peticion) => {
      const contexto = createExecutionContext()
      const respuesta = await w.fetch(peticion, env, contexto)
      await waitOnExecutionContext(contexto)
      return respuesta
    }
    return cliente
  }

  it('la cuenta de la extensión aparece en /yo', async () => {
    const { cliente } = await nuevaOrganizacion()
    const yo = await conWorker([plan], cliente).json('GET', '/api/v1/yo')
    expect(yo.status).toBe(200)
    expect(yo.cuerpo.cuenta).toEqual(CUENTA)
  })

  it('una cuenta que falla no rompe /yo: devuelve null', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { cliente } = await nuevaOrganizacion()
    const yo = await conWorker([cuentaRota], cliente).json('GET', '/api/v1/yo')
    expect(yo.status).toBe(200)
    expect(yo.cuerpo.cuenta).toBeNull()
    expect(yo.cuerpo.permisos).toContain('dte:emit')
    expect(error).toHaveBeenCalledWith(
      'Falló la cuenta de la extensión cuenta-rota',
      expect.any(Error),
    )
  })

  it('antesDeEmitir con 402 impide la emisión y no consume número de control', async () => {
    const { cliente, organizationId, userId } = await nuevaOrganizacion({ emisor: true })
    conWorker([plan], cliente)
    const filas = async (tabla: 'documento' | 'correlativo') =>
      (
        await env.DB.prepare(`SELECT count(*) AS n FROM ${tabla} WHERE organization_id = ?1`)
          .bind(organizationId)
          .first<{ n: number }>()
      )?.n

    estado.bloquear = true
    estado.llamadas.length = 0
    const idem = { 'Idempotency-Key': 'gancho-1' }
    const bloqueada = await cliente.json('POST', '/api/v1/dte', FACTURA, idem)
    expect(bloqueada.status).toBe(402)
    expect(bloqueada.cuerpo.error).toMatchObject({ code: 'plan_requerido' })
    expect(estado.llamadas).toEqual([{ ambiente: '00', tipoDte: '01', organizationId }])
    expect(await filas('documento')).toBe(0)
    expect(await filas('correlativo')).toBe(0)

    // Por MCP y con clave de API pasa por el mismo gancho.
    const clave = await nuevaClave(cliente, ['dte:emit', 'dte:read'])
    conWorker([plan], clave.cliente)
    expect((await clave.cliente.pedir('POST', '/api/v1/dte', FACTURA)).status).toBe(402)
    const mcp = await clave.cliente.pedir(
      'POST',
      '/mcp',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'dte_emitir', arguments: { ...FACTURA, idempotencyKey: 'gancho-mcp' } },
      },
      { Accept: 'application/json, text/event-stream' },
    )
    expect(await mcp.text()).toContain('plan_requerido')
    // Y fuera de HTTP, con un `Ctx` de `ctxDeMiembro` que lleva las extensiones.
    const ctx = await ctxDeMiembro(env, {
      userId,
      organizationId,
      origen: 'demo',
      extensiones: [plan],
    })
    await expect(emitir(ctx!, FACTURA as never)).rejects.toMatchObject({ status: 402 })
    expect(await filas('correlativo')).toBe(0)

    // Un documento inválido no llega al gancho.
    const llamadas = estado.llamadas.length
    const invalida = await cliente.json('POST', '/api/v1/dte', {
      tipoDte: '01',
      datos: { items: [] },
    })
    expect(invalida.status).toBe(400)
    expect(estado.llamadas).toHaveLength(llamadas)

    // Al dejar de bloquear, el mismo reintento emite con el primer número de la serie.
    estado.bloquear = false
    const emitida = await cliente.json('POST', '/api/v1/dte', FACTURA, idem)
    expect(emitida.status).toBe(201)
    expect(emitida.cuerpo.numeroControl).toMatch(/-000000000000001$/)
  })

  it('sin extensiones la emisión no cambia', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    estado.bloquear = true
    estado.llamadas.length = 0
    try {
      const r = await cliente.json('POST', '/api/v1/dte', FACTURA)
      expect(r.status).toBe(201)
      expect(estado.llamadas).toHaveLength(0)
    } finally {
      estado.bloquear = false
    }
  })
})
