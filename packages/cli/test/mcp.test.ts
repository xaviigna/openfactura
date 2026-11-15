import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CLAVE_PRUEBA } from './ayuda'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOCUMENTO = {
  codigoGeneracion: 'C25227C9-A11D-4757-8626-E4ED9CAFD367',
  estado: 'procesado',
  total: 22.6,
}

interface Herramienta {
  name: string
  title?: string
  inputSchema: { required?: string[] }
  annotations: Record<string, boolean>
}

interface ResultadoLlamada {
  isError?: boolean
  content: Array<{ text: string }>
  structuredContent?: unknown
}

interface Peticion {
  metodo: string
  ruta: string
  headers: IncomingMessage['headers']
  cuerpo: unknown
}

/** Servidor MCP por stdio como proceso hijo, hablando con una API falsa. */
describe('openfactura mcp (stdio)', () => {
  let api: Server
  let hijo: ChildProcessWithoutNullStreams
  let stdout = ''
  let stderr = ''
  const peticiones: Peticion[] = []
  const pendientes = new Map<number, (mensaje: Record<string, unknown>) => void>()
  let siguienteId = 1

  const enviar = (mensaje: object) => hijo.stdin.write(`${JSON.stringify(mensaje)}\n`)
  const pedir = (method: string, params?: object) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = siguienteId++
      const reloj = setTimeout(
        () => reject(new Error(`Sin respuesta a ${method}. stderr: ${stderr}`)),
        15_000,
      )
      pendientes.set(id, (mensaje) => {
        clearTimeout(reloj)
        resolve(mensaje)
      })
      enviar({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
    })

  beforeAll(async () => {
    api = createServer((req, res) => {
      let texto = ''
      req.on('data', (parte) => {
        texto += parte
      })
      req.on('end', () => {
        const ruta = req.url ?? ''
        peticiones.push({
          metodo: req.method ?? '',
          ruta,
          headers: req.headers,
          cuerpo: texto ? JSON.parse(texto) : undefined,
        })
        const responder = (status: number, cuerpo: unknown) => {
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(cuerpo))
        }
        if (req.method === 'POST' && ruta === '/api/v1/dte') return responder(201, DOCUMENTO)
        if (req.method === 'GET' && ruta.startsWith('/api/v1/clientes')) {
          return responder(403, {
            error: {
              code: 'sin_permiso',
              message: 'No tienes permiso',
              details: { permiso: 'clientes:read' },
            },
          })
        }
        responder(404, { error: { code: 'no_encontrado', message: 'No existe' } })
      })
    })
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve))
    const { port } = api.address() as AddressInfo

    hijo = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', 'mcp'], {
      cwd: RAIZ,
      env: {
        PATH: process.env.PATH,
        HOME: RAIZ,
        XDG_CONFIG_HOME: join(RAIZ, 'node_modules', '.cache', 'xdg-inexistente'),
        OPENFACTURA_API_KEY: CLAVE_PRUEBA,
        OPENFACTURA_URL: `http://127.0.0.1:${port}`,
      },
    })
    hijo.stderr.on('data', (parte) => {
      stderr += parte
    })
    let resto = ''
    hijo.stdout.on('data', (parte) => {
      stdout += parte
      resto += parte
      const lineas = resto.split('\n')
      resto = lineas.pop() ?? ''
      for (const linea of lineas.filter(Boolean)) {
        try {
          const mensaje = JSON.parse(linea)
          pendientes.get(mensaje.id)?.(mensaje)
        } catch {
          // Se detecta después: la prueba exige que toda línea de stdout sea JSON-RPC.
        }
      }
    })

    const inicio = await pedir('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'prueba', version: '1.0.0' },
    })
    expect(inicio.result).toMatchObject({
      serverInfo: { name: 'openfactura' },
      capabilities: { tools: {} },
    })
    enviar({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }, 30_000)

  afterAll(async () => {
    hijo?.kill()
    await new Promise((resolve) => api?.close(resolve))
  })

  it('tools/list anuncia las mismas 21 herramientas que el servidor remoto', async () => {
    const { result } = (await pedir('tools/list')) as {
      result: { tools: Herramienta[] }
    }
    expect(result.tools.map((t) => t.name)).toEqual([
      'emisor_obtener',
      'catalogo_buscar',
      'clientes_buscar',
      'cliente_crear',
      'productos_buscar',
      'producto_crear',
      'dte_validar',
      'dte_emitir',
      'dte_listar',
      'dte_obtener',
      'dte_invalidar',
      'certificacion_estado',
      'certificacion_avanzar',
      'dte_retorno',
      'operaciones_especiales_informar',
      'eventos_listar',
      'evento_obtener',
      'webhooks_listar',
      'webhook_crear',
      'webhook_eliminar',
      'webhook_probar',
      'uso_obtener',
      'registros_listar',
    ])
    const emitir = result.tools.find((t) => t.name === 'dte_emitir')
    expect(emitir?.title).toBe('Emitir un DTE')
    expect(emitir?.inputSchema.required).toEqual(['tipoDte', 'datos', 'idempotencyKey'])
    expect(emitir?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    })
    expect(result.tools.find((t) => t.name === 'dte_invalidar')?.annotations.destructiveHint).toBe(
      true,
    )
    expect(result.tools.find((t) => t.name === 'dte_listar')?.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
    })
  })

  it('tools/call dte_emitir llama a POST /dte con la clave y la Idempotency-Key', async () => {
    const datos = { items: [{ descripcion: 'Servicio', cantidad: 2, precioUni: 11.3 }] }
    const { result } = (await pedir('tools/call', {
      name: 'dte_emitir',
      arguments: { tipoDte: '01', datos, idempotencyKey: 'intento-0001' },
    })) as { result: ResultadoLlamada }

    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(DOCUMENTO)
    expect(result.structuredContent).toEqual({ resultado: DOCUMENTO })

    const peticion = peticiones.find((p) => p.ruta === '/api/v1/dte')
    expect(peticion?.metodo).toBe('POST')
    expect(peticion?.headers.authorization).toBe(`Bearer ${CLAVE_PRUEBA}`)
    expect(peticion?.headers['idempotency-key']).toBe('intento-0001')
    expect(peticion?.headers['user-agent']).toMatch(/^openfactura-cli\//)
    expect(peticion?.cuerpo).toEqual({ tipoDte: '01', datos })
  })

  it('un error de la API vuelve como isError con el JSON del error', async () => {
    const { result } = (await pedir('tools/call', {
      name: 'clientes_buscar',
      arguments: { q: 'ana' },
    })) as { result: ResultadoLlamada }
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({
      error: {
        code: 'sin_permiso',
        message: 'No tienes permiso',
        details: { permiso: 'clientes:read' },
      },
    })
    expect(peticiones.at(-1)?.ruta).toBe('/api/v1/clientes?q=ana&limite=25')
  })

  it('stdout lleva sólo JSON-RPC; los registros van a stderr sin la clave', async () => {
    const lineas = stdout.split('\n').filter(Boolean)
    expect(lineas.length).toBeGreaterThanOrEqual(4)
    for (const linea of lineas) expect(JSON.parse(linea)).toMatchObject({ jsonrpc: '2.0' })
    expect(stderr).toContain('openfactura mcp')
    expect(stderr).toContain('of_test_abcdef…')
    expect(stdout + stderr).not.toContain(CLAVE_PRUEBA)
  })

  it('termina cuando el cliente cierra la entrada estándar', async () => {
    const salida = new Promise<number | null>((resolve) => hijo.once('exit', resolve))
    hijo.stdin.end()
    expect(await salida).toBe(0)
  })
})
