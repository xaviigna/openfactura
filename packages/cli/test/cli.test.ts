import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ejecutar, VERSION } from '../src/cli'
import { rutaConfig } from '../src/config'
import { CLAVE_PRODUCCION, CLAVE_PRUEBA, crearEntorno, errorApi, json } from './ayuda'

const conClave = { OPENFACTURA_API_KEY: CLAVE_PRUEBA }
const FACTURA = {
  tipoDte: '01',
  datos: { items: [{ descripcion: 'Servicio', cantidad: 2, precioUni: 11.3 }] },
}
const DOCUMENTO = {
  id: 'd1',
  codigoGeneracion: 'C25227C9-A11D-4757-8626-E4ED9CAFD367',
  numeroControl: 'DTE-01-M001P001-000000000000001',
  tipoDte: '01',
  ambiente: '00',
  estado: 'procesado',
  fechaEmision: '2026-11-12',
  horaEmision: '01:38:12',
  total: 22.6,
  selloRecibido: 'SELLO123',
}
const YO = {
  usuario: null,
  rol: null,
  actor: 'clave',
  organizationId: 'org1',
  permisos: ['dte:read', 'dte:emit'],
  ambiente: '00',
  simulador: true,
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function conFactura(opciones: Parameters<typeof crearEntorno>[0]) {
  const t = crearEntorno(opciones)
  writeFileSync(join(t.carpeta, 'factura.json'), JSON.stringify(FACTURA))
  return t
}

describe('uso incorrecto → salida 2', () => {
  const casos: Array<[string, string[], RegExp]> = [
    ['sin comando', [], /Falta el comando/],
    ['comando desconocido', ['facturar'], /Comando desconocido: facturar/],
    ['subcomando ausente', ['dte'], /Falta el subcomando/],
    ['subcomando desconocido', ['dte', 'borrar'], /Subcomando desconocido/],
    ['opción desconocida', ['whoami', '--nope'], /Opción desconocida: --nope/],
    ['opción que no aplica', ['whoami', '--tipo', '01'], /--tipo no aplica/],
    ['opción sin su valor', ['dte', 'list', '--tipo'], /--tipo/],
    ['falta el archivo', ['dte', 'emitir'], /Faltan argumentos/],
    ['sobran argumentos', ['dte', 'get', 'a', 'b'], /Sobran argumentos/],
    ['invalidar sin --tipo', ['dte', 'invalidar', 'ABC'], /--tipo 1\|2\|3/],
    ['invalidar con tipo inválido', ['dte', 'invalidar', 'ABC', '--tipo', '9'], /--tipo 1\|2\|3/],
    ['página no numérica', ['dte', 'list', '--pagina', 'dos'], /--pagina/],
    ['estado inválido', ['dte', 'list', '--estado', 'listo'], /--estado/],
    ['fecha mal formada', ['dte', 'list', '--desde', '12/11/2026'], /AAAA-MM-DD/],
    ['uso con fecha mal formada', ['uso', '--hasta', 'hoy'], /AAAA-MM-DD/],
    ['registros con estado inválido', ['registros', 'list', '--estado', '500'], /ok o error/],
    ['registros con origen inválido', ['registros', 'list', '--origen', 'cli'], /api o mcp/],
    ['registros con límite excesivo', ['registros', 'list', '--limite', '500'], /200/],
    ['clientes add sin datos', ['clientes', 'add'], /--file/],
    [
      'clientes add con archivo y opciones',
      ['clientes', 'add', '--file', 'c.json', '--nombre', 'Ana'],
      /no ambas/,
    ],
    ['precio no numérico', ['productos', 'add', '--codigo', 'A', '--precio', 'caro'], /--precio/],
    ['archivo inexistente', ['dte', 'validar', 'no-existe.json'], /No se pudo leer/],
    ['URL inválida', ['whoami', '--url', 'no-es-url'], /URL del servidor inválida/],
  ]
  for (const [nombre, argv, mensaje] of casos) {
    it(nombre, async () => {
      const t = crearEntorno({ env: conClave })
      expect(await ejecutar(argv, t.ent)).toBe(2)
      expect(t.stderr).toMatch(mensaje)
      expect(t.llamadas).toHaveLength(0)
      expect(t.stdout).toBe('')
    })
  }

  it('JSON inválido por la entrada estándar', async () => {
    const t = crearEntorno({ env: conClave, entrada: '{ roto' })
    expect(await ejecutar(['dte', 'emitir', '-'], t.ent)).toBe(2)
    expect(t.stderr).toMatch(/no es un JSON válido/)
    expect(t.llamadas).toHaveLength(0)
  })

  it('el archivo de emisión debe traer tipoDte y datos', async () => {
    const t = crearEntorno({ env: conClave, entrada: '{"items":[]}' })
    expect(await ejecutar(['dte', 'emitir', '-'], t.ent)).toBe(2)
    expect(t.stderr).toMatch(/tipoDte/)
  })
})

describe('ayuda y versión', () => {
  it('--version', async () => {
    const t = crearEntorno()
    expect(await ejecutar(['--version'], t.ent)).toBe(0)
    expect(t.stdout).toBe(VERSION)
  })

  it('--help general, de grupo y de comando', async () => {
    const general = crearEntorno()
    expect(await ejecutar(['--help'], general.ent)).toBe(0)
    expect(general.stdout).toMatch(/dte emitir/)
    expect(general.stdout).toMatch(/contingencia transmitir/)

    const grupo = crearEntorno()
    expect(await ejecutar(['dte', '--help'], grupo.ent)).toBe(0)
    expect(grupo.stdout).toMatch(/dte invalidar/)
    expect(grupo.stdout).not.toMatch(/clientes list/)

    const comando = crearEntorno()
    expect(await ejecutar(['dte', 'emitir', '--help'], comando.ent)).toBe(0)
    expect(comando.stdout).toMatch(/--idempotency-key/)
  })
})

describe('autenticación', () => {
  it('sin clave → salida 3, sin tocar la red', async () => {
    const t = crearEntorno()
    expect(await ejecutar(['whoami'], t.ent)).toBe(3)
    expect(t.stderr).toMatch(/Error \[no_autenticado\]/)
    expect(t.llamadas).toHaveLength(0)
  })

  it('whoami envía la clave y el User-Agent, y nunca imprime la clave completa', async () => {
    const t = crearEntorno({ env: conClave, respuestas: [json(YO)] })
    expect(await ejecutar(['whoami', '--url', 'https://factura.ejemplo.sv/'], t.ent)).toBe(0)
    const [llamada] = t.llamadas
    expect(llamada?.url.href).toBe('https://factura.ejemplo.sv/api/v1/yo')
    expect(llamada?.headers.get('Authorization')).toBe(`Bearer ${CLAVE_PRUEBA}`)
    expect(llamada?.headers.get('User-Agent')).toBe(`openfactura-cli/${VERSION}`)
    expect(t.stdout).toContain('of_test_abcdef…')
    expect(t.stdout).toContain('00 Pruebas')
    expect(t.stdout).toContain('dte:read, dte:emit')
    expect(t.stdout + t.stderr).not.toContain(CLAVE_PRUEBA)
  })

  it('--json imprime el JSON de la API tal cual', async () => {
    const t = crearEntorno({ env: conClave, respuestas: [json(YO)] })
    expect(await ejecutar(['whoami', '--json'], t.ent)).toBe(0)
    expect(JSON.parse(t.stdout)).toEqual(YO)
  })

  it('login verifica la clave, la guarda con modo 0600 y no la imprime', async () => {
    const t = crearEntorno({ respuestas: [json(YO)] })
    expect(
      await ejecutar(
        ['login', '--url', 'https://factura.ejemplo.sv', '--key', CLAVE_PRUEBA],
        t.ent,
      ),
    ).toBe(0)
    const ruta = rutaConfig(t.ent.env)
    expect(JSON.parse(readFileSync(ruta, 'utf8'))).toEqual({
      perfiles: { default: { url: 'https://factura.ejemplo.sv', apiKey: CLAVE_PRUEBA } },
    })
    expect(statSync(ruta).mode & 0o777).toBe(0o600)
    expect(t.llamadas[0]?.headers.get('Authorization')).toBe(`Bearer ${CLAVE_PRUEBA}`)
    expect(t.stdout + t.stderr).not.toContain(CLAVE_PRUEBA)

    // La sesión guardada sirve para los comandos siguientes; logout la borra.
    const despues = crearEntorno({
      env: t.ent.env as Record<string, string>,
      respuestas: [json(YO)],
    })
    expect(await ejecutar(['whoami'], despues.ent)).toBe(0)
    expect(despues.llamadas[0]?.url.origin).toBe('https://factura.ejemplo.sv')
    expect(await ejecutar(['logout'], despues.ent)).toBe(0)
    expect(await ejecutar(['whoami'], despues.ent)).toBe(3)
  })

  it('alta crea la organización y una clave con el ADMIN_TOKEN, y guarda sólo la clave', async () => {
    const TOKEN = 'token-de-administracion-de-mi-servidor-0123456789'
    const t = crearEntorno({
      env: { OPENFACTURA_ADMIN_TOKEN: TOKEN },
      respuestas: [
        json({ id: 'org-1', nombre: 'Mi Empresa', slug: 'mi-empresa-abc123' }, 201),
        json({ id: 'clave-1', nombre: 'CLI', modo: 'test', clave: CLAVE_PRUEBA }, 201),
      ],
    })
    expect(
      await ejecutar(['alta', 'Mi Empresa', '--url', 'https://factura.ejemplo.sv'], t.ent),
    ).toBe(0)
    const [org, clave] = t.llamadas
    expect(org?.url.href).toBe('https://factura.ejemplo.sv/api/admin/organizaciones')
    expect(org?.cuerpo).toEqual({ nombre: 'Mi Empresa' })
    expect(org?.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(clave?.url.pathname).toBe('/api/v1/claves')
    expect(clave?.headers.get('X-Organizacion')).toBe('org-1')
    expect(clave?.cuerpo).toMatchObject({ modo: 'test' })
    expect(JSON.parse(readFileSync(rutaConfig(t.ent.env), 'utf8'))).toEqual({
      perfiles: { default: { url: 'https://factura.ejemplo.sv', apiKey: CLAVE_PRUEBA } },
    })
    expect(t.stdout + t.stderr).not.toContain(TOKEN)
    expect(t.stdout + t.stderr).not.toContain(CLAVE_PRUEBA)
  })

  it('login pide la clave oculta en una terminal y usa perfiles', async () => {
    const t = crearEntorno({
      esTTY: true,
      respuestasTerminal: [`${CLAVE_PRODUCCION}\n`],
      respuestas: [json({ ...YO, ambiente: '01' })],
    })
    expect(await ejecutar(['login', '--profile', 'prod'], t.ent)).toBe(0)
    expect(t.preguntas).toEqual([
      { pregunta: expect.stringContaining('Clave de API'), oculto: true },
    ])
    expect(JSON.parse(readFileSync(rutaConfig(t.ent.env), 'utf8')).perfiles.prod.apiKey).toBe(
      CLAVE_PRODUCCION,
    )
  })

  it('login no guarda una clave rechazada (401 → salida 3) ni una mal formada (salida 2)', async () => {
    const t = crearEntorno({ respuestas: [errorApi(401, 'no_autenticado', 'Clave inválida')] })
    expect(await ejecutar(['login', '--key', CLAVE_PRUEBA], t.ent)).toBe(3)
    expect(() => readFileSync(rutaConfig(t.ent.env))).toThrow()

    const mala = crearEntorno()
    expect(await ejecutar(['login', '--key', 'sk_123'], mala.ent)).toBe(2)
    expect(mala.llamadas).toHaveLength(0)
  })
})

describe('errores de la API', () => {
  it('401 → salida 3', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [errorApi(401, 'no_autenticado', 'La clave no es válida')],
    })
    expect(await ejecutar(['dte', 'list'], t.ent)).toBe(3)
    expect(t.stderr).toMatch(/^Error \[no_autenticado\]: La clave no es válida/)
  })

  it('429 → salida 4 e imprime Retry-After', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [
        errorApi(429, 'limite_excedido', 'Demasiadas peticiones', undefined, {
          'Retry-After': '17',
        }),
      ],
    })
    expect(await ejecutar(['dte', 'list'], t.ent)).toBe(4)
    expect(t.stderr).toMatch(/Error \[limite_excedido\]/)
    expect(t.stderr).toMatch(/Retry-After: 17/)
  })

  it('dte_invalido → salida 1 y lista cada problema como «ruta: mensaje»', async () => {
    const problemas = [
      { ruta: '/receptor/nrc', mensaje: 'debe tener de 2 a 8 dígitos', regla: 'pattern' },
      { ruta: '/resumen/pagos', mensaje: 'es obligatorio', regla: 'required' },
    ]
    const t = conFactura({
      env: conClave,
      respuestas: [errorApi(400, 'dte_invalido', 'El DTE no cumple el esquema', { problemas })],
    })
    expect(await ejecutar(['dte', 'emitir', 'factura.json'], t.ent)).toBe(1)
    expect(t.stderr).toContain('Error [dte_invalido]: El DTE no cumple el esquema')
    expect(t.stderr).toContain('/receptor/nrc: debe tener de 2 a 8 dígitos')
    expect(t.stderr).toContain('/resumen/pagos: es obligatorio')
  })

  it('dte_rechazado → salida 1 y lista las observaciones del MH', async () => {
    const mh = {
      codigo: '020',
      mensaje: 'RECHAZADO',
      observaciones: ['NIT del receptor no existe', 'Monto inconsistente'],
    }
    const t = conFactura({
      env: conClave,
      respuestas: [errorApi(422, 'dte_rechazado', 'El MH rechazó el documento', { mh })],
    })
    expect(await ejecutar(['dte', 'emitir', 'factura.json'], t.ent)).toBe(1)
    expect(t.stderr).toContain('Error [dte_rechazado]')
    expect(t.stderr).toContain('MH 020: RECHAZADO')
    expect(t.stderr).toContain('- NIT del receptor no existe')
    expect(t.stderr).toContain('- Monto inconsistente')
  })

  it('datos_invalidos y sin_permiso muestran sus detalles', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [
        errorApi(400, 'datos_invalidos', 'Datos inválidos', [
          { ruta: 'nombre', mensaje: 'requerido' },
        ]),
      ],
    })
    expect(await ejecutar(['clientes', 'add', '--tipo-documento', '13'], t.ent)).toBe(1)
    expect(t.stderr).toContain('nombre: requerido')

    const p = crearEntorno({
      env: conClave,
      respuestas: [errorApi(403, 'sin_permiso', 'No tienes permiso', { permiso: 'clientes:read' })],
    })
    expect(await ejecutar(['clientes', 'list'], p.ent)).toBe(1)
    expect(p.stderr).toContain('clientes:read')
  })

  it('con --json el error de la API va a stderr como JSON', async () => {
    const cuerpo = {
      error: { code: 'no_encontrado', message: 'No existe', details: { codigo: 'X' } },
    }
    const t = crearEntorno({ env: conClave, respuestas: [json(cuerpo, 404)] })
    expect(await ejecutar(['dte', 'get', 'X', '--json'], t.ent)).toBe(1)
    expect(JSON.parse(t.stderr)).toEqual(cuerpo)
    expect(t.stdout).toBe('')

    const limite = crearEntorno({
      env: conClave,
      respuestas: [errorApi(429, 'limite_excedido', 'Espera', undefined, { 'Retry-After': '9' })],
    })
    expect(await ejecutar(['dte', 'list', '--json'], limite.ent)).toBe(4)
    expect(JSON.parse(limite.stderr)).toEqual({
      error: { code: 'limite_excedido', message: 'Espera' },
      retryAfter: 9,
    })
  })

  it('un error que no es JSON informa el estado HTTP', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [new Response('<html>Bad Gateway</html>', { status: 502 })],
    })
    expect(await ejecutar(['emisor'], t.ent)).toBe(1)
    expect(t.stderr).toMatch(/Error \[http_502\]/)
  })

  it('sin conexión → salida 1', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [
        Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
      ],
    })
    expect(await ejecutar(['emisor'], t.ent)).toBe(1)
    expect(t.stderr).toMatch(/Error \[sin_conexion\].*ECONNREFUSED/)
  })
})

describe('dte emitir', () => {
  it('genera una Idempotency-Key (UUID), la envía y la muestra', async () => {
    const t = conFactura({ env: conClave, respuestas: [json(DOCUMENTO, 201)] })
    expect(await ejecutar(['dte', 'emitir', 'factura.json'], t.ent)).toBe(0)
    const [llamada] = t.llamadas
    const clave = llamada?.headers.get('Idempotency-Key') ?? ''
    expect(clave).toMatch(UUID)
    expect(t.stderr).toContain(`Idempotency-Key: ${clave}`)
    expect(llamada?.metodo).toBe('POST')
    expect(llamada?.url.pathname).toBe('/api/v1/dte')
    expect(llamada?.cuerpo).toEqual(FACTURA)
    expect(t.stdout).toContain('DTE-01-M001P001-000000000000001')
    expect(t.stdout).toContain('$22.60')
  })

  it('respeta --idempotency-key, lee de stdin y avisa cuando la respuesta es repetida', async () => {
    const t = crearEntorno({
      env: conClave,
      entrada: JSON.stringify(FACTURA),
      respuestas: [json(DOCUMENTO, 201, { 'Idempotent-Replayed': 'true' })],
    })
    expect(
      await ejecutar(['dte', 'emitir', '-', '--idempotency-key', 'pedido-1042', '--json'], t.ent),
    ).toBe(0)
    expect(t.llamadas[0]?.headers.get('Idempotency-Key')).toBe('pedido-1042')
    expect(t.llamadas[0]?.cuerpo).toEqual(FACTURA)
    expect(JSON.parse(t.stdout)).toEqual(DOCUMENTO)
    expect(t.stderr).toMatch(/Respuesta repetida/)
  })

  it('si la red falla, indica cómo reintentar con la misma clave', async () => {
    const t = conFactura({ env: conClave, respuestas: [new TypeError('fetch failed')] })
    expect(await ejecutar(['dte', 'emitir', 'factura.json'], t.ent)).toBe(1)
    const clave = t.llamadas[0]?.headers.get('Idempotency-Key')
    expect(t.stderr).toContain(`openfactura dte emitir factura.json --idempotency-key ${clave}`)
  })

  it('avisa cuando el documento queda en contingencia (202)', async () => {
    const t = conFactura({
      env: conClave,
      respuestas: [json({ ...DOCUMENTO, estado: 'contingencia', selloRecibido: null }, 202)],
    })
    expect(await ejecutar(['dte', 'emitir', 'factura.json'], t.ent)).toBe(0)
    expect(t.stderr).toMatch(/contingencia/)
  })
})

describe('eventos', () => {
  const RETORNO = { items: [{ descripcion: 'Silla', cantidad: 1, precioUni: 22.6 }] }
  const EVENTO = {
    tipo: 'retorno',
    tipoEvento: '18',
    codigoGeneracion: 'B1C2D3E4-0000-4000-8000-000000000018',
    ambiente: '00',
    estado: 'procesado',
    selloRecibido: '2026ABC',
    creado: Date.UTC(2026, 10, 20),
  }

  it('dte retorno envía el archivo con Idempotency-Key y muestra el evento', async () => {
    const t = crearEntorno({
      env: conClave,
      entrada: JSON.stringify(RETORNO),
      respuestas: [json(EVENTO, 201)],
    })
    expect(await ejecutar(['dte', 'retorno', 'ABC-123', '-'], t.ent)).toBe(0)
    const [llamada] = t.llamadas
    expect(llamada?.url.pathname).toBe('/api/v1/dte/ABC-123/retorno')
    expect(llamada?.cuerpo).toEqual(RETORNO)
    expect(llamada?.headers.get('Idempotency-Key')).toMatch(UUID)
    expect(t.stdout).toContain('18 Retorno')
    expect(t.stdout).toContain(EVENTO.codigoGeneracion)
  })

  it('eventos list valida --tipo y muestra la tabla', async () => {
    const mal = crearEntorno({ env: conClave })
    expect(await ejecutar(['eventos', 'list', '--tipo', 'otro'], mal.ent)).toBe(2)
    expect(mal.llamadas).toHaveLength(0)
    const t = crearEntorno({ env: conClave, respuestas: [json([EVENTO])] })
    expect(await ejecutar(['eventos', 'list', '--tipo', 'retorno'], t.ent)).toBe(0)
    expect(t.llamadas[0]?.url.search).toBe('?tipo=retorno')
    expect(t.stdout).toContain('2026-11-20')
  })

  it('con clave de producción, retorno y operaciones especiales piden --yes sin terminal', async () => {
    for (const argv of [
      ['dte', 'retorno', 'ABC', '-'],
      ['eventos', 'operaciones-especiales', '-'],
    ]) {
      const t = crearEntorno({
        env: { OPENFACTURA_API_KEY: CLAVE_PRODUCCION },
        esTTY: false,
        entrada: JSON.stringify({ tipoDocumento: '02', ...RETORNO }),
      })
      expect(await ejecutar(argv, t.ent)).toBe(2)
      expect(t.llamadas).toHaveLength(0)
    }
  })
})

describe('webhooks', () => {
  const WEBHOOK = {
    id: 'w1',
    url: 'https://erp.ejemplo.com/hooks',
    descripcion: null,
    eventos: ['dte.procesado'],
    activo: true,
  }
  const SECRETO = 'whsec_prueba-de-la-cli'

  it('add envía la URL y todos los eventos por defecto, y muestra el secreto una vez', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [json({ ...WEBHOOK, secreto: SECRETO }, 201)],
    })
    expect(await ejecutar(['webhooks', 'add', WEBHOOK.url, '--descripcion', 'ERP'], t.ent)).toBe(0)
    const [llamada] = t.llamadas
    expect(llamada?.metodo).toBe('POST')
    expect(llamada?.url.pathname).toBe('/api/v1/webhooks')
    expect(llamada?.cuerpo).toEqual({
      url: WEBHOOK.url,
      descripcion: 'ERP',
      eventos: [
        'dte.procesado',
        'dte.rechazado',
        'dte.contingencia',
        'dte.invalidado',
        'retorno.procesado',
        'retorno.invalidado',
        'operaciones_especiales.procesado',
        'operaciones_especiales.invalidado',
      ],
    })
    expect(t.stdout).toContain(SECRETO)
    expect(t.stdout).toMatch(/no se vuelve a mostrar/)
  })

  it('add valida --eventos sin llamar a la API', async () => {
    const t = crearEntorno({ env: conClave })
    expect(
      await ejecutar(
        ['webhooks', 'add', WEBHOOK.url, '--eventos', 'dte.procesado,dte.otro'],
        t.ent,
      ),
    ).toBe(2)
    expect(t.stderr).toMatch(/--eventos/)
    expect(t.llamadas).toHaveLength(0)

    const bien = crearEntorno({
      env: conClave,
      respuestas: [json({ ...WEBHOOK, secreto: SECRETO })],
    })
    await ejecutar(
      ['webhooks', 'add', WEBHOOK.url, '--eventos', 'dte.rechazado, dte.invalidado'],
      bien.ent,
    )
    expect((bien.llamadas[0]?.cuerpo as { eventos?: string[] } | undefined)?.eventos).toEqual([
      'dte.rechazado',
      'dte.invalidado',
    ])
  })

  it('list, remove, deliveries y rotate llaman a sus rutas', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [
        json([WEBHOOK]),
        json({ eliminado: true }),
        json([
          {
            id: 'e1',
            evento: 'dte.procesado',
            estado: 'pendiente',
            intentos: 2,
            ultimoStatus: 500,
            ultimoError: 'El destino respondió HTTP 500',
            proximoIntento: Date.UTC(2026, 10, 12, 10, 0),
            creado: Date.UTC(2026, 10, 12, 9, 0),
          },
        ]),
        json({ ...WEBHOOK, secreto: SECRETO }),
      ],
    })
    expect(await ejecutar(['webhooks', 'list'], t.ent)).toBe(0)
    expect(await ejecutar(['webhooks', 'remove', 'w1'], t.ent)).toBe(0)
    expect(await ejecutar(['webhooks', 'deliveries', 'w1'], t.ent)).toBe(0)
    expect(await ejecutar(['webhooks', 'rotate', 'w1'], t.ent)).toBe(0)
    expect(t.llamadas.map((l) => `${l.metodo} ${l.url.pathname}`)).toEqual([
      'GET /api/v1/webhooks',
      'DELETE /api/v1/webhooks/w1',
      'GET /api/v1/webhooks/w1/entregas',
      'POST /api/v1/webhooks/w1/rotar-secreto',
    ])
    expect(t.stdout).toContain(WEBHOOK.url)
    expect(t.stdout).toContain('El destino respondió HTTP 500')
    expect(t.stdout).toContain(SECRETO)
  })

  it('test: salida 0 si se entregó, 1 si no', async () => {
    const bien = crearEntorno({
      env: conClave,
      respuestas: [json({ entregado: true, status: 200, error: null })],
    })
    expect(await ejecutar(['webhooks', 'test', 'w1'], bien.ent)).toBe(0)
    expect(bien.llamadas[0]?.url.pathname).toBe('/api/v1/webhooks/w1/probar')
    expect(bien.stdout).toMatch(/HTTP 200/)

    const mal = crearEntorno({
      env: conClave,
      respuestas: [json({ entregado: false, status: 500, error: 'El destino respondió HTTP 500' })],
    })
    expect(await ejecutar(['webhooks', 'test', 'w1'], mal.ent)).toBe(1)
    expect(mal.stdout).toMatch(/No se entregó/)
  })
})

describe('certificación', () => {
  const metas = (hechas: number) => [
    { id: 'facturas', nombre: 'Factura', meta: 90, hechas },
    { id: 'ccf', nombre: 'Comprobante de Crédito Fiscal', meta: 75, hechas: 0 },
  ]
  const estado = (extra: object) => ({
    estado: 'en_curso',
    disponible: true,
    requisitos: { simuladas: false },
    metas: metas(0),
    ultimoError: null,
    ...extra,
  })

  it('ejecutar inicia y avanza hasta completar', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [
        json(estado({})),
        json(estado({ metas: metas(5), operaciones: [{}], aviso: null })),
        json(estado({ estado: 'completa', metas: metas(90), operaciones: [], aviso: null })),
      ],
    })
    expect(await ejecutar(['certificacion', 'ejecutar'], t.ent)).toBe(0)
    expect(t.llamadas.map((l) => new URL(l.url).pathname)).toEqual([
      '/api/v1/ext/certificacion/iniciar',
      '/api/v1/ext/certificacion/avanzar',
      '/api/v1/ext/certificacion/avanzar',
    ])
    expect(t.stderr).toMatch(/Factura 5\/90/)
    expect(t.stdout).toMatch(/Completa/)
  })

  it('se detiene y sale con 1 cuando el MH rechaza una prueba', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [
        json(estado({})),
        json(
          estado({
            estado: 'detenida',
            ultimoError: {
              operacion: 'factura',
              codigo: '096',
              mensaje: 'DOCUMENTO NO CUMPLE ESQUEMA JSON',
              observaciones: ['Campo #/resumen/totalPagar no coincide'],
            },
          }),
        ),
      ],
    })
    expect(await ejecutar(['certificacion', 'ejecutar'], t.ent)).toBe(1)
    expect(t.llamadas).toHaveLength(2)
    expect(t.stdout).toMatch(/096 DOCUMENTO NO CUMPLE/)
    expect(t.stdout).toMatch(/totalPagar/)
  })
})

describe('claves de producción (of_live_)', () => {
  const produccion = { OPENFACTURA_API_KEY: CLAVE_PRODUCCION }

  it('sin terminal y sin --yes se niega (salida 2) y no llama a la API', async () => {
    for (const argv of [
      ['dte', 'emitir', 'factura.json'],
      ['dte', 'invalidar', 'ABC', '--tipo', '2'],
      ['contingencia', 'transmitir'],
    ]) {
      const t = conFactura({ env: produccion, esTTY: false })
      expect(await ejecutar(argv, t.ent)).toBe(2)
      expect(t.stderr).toMatch(/--yes/)
      expect(t.llamadas).toHaveLength(0)
      expect(t.preguntas).toHaveLength(0)
    }
  })

  it('con --yes procede sin preguntar', async () => {
    const t = conFactura({ env: produccion, respuestas: [json(DOCUMENTO, 201)] })
    expect(await ejecutar(['dte', 'emitir', 'factura.json', '--yes'], t.ent)).toBe(0)
    expect(t.preguntas).toHaveLength(0)
    expect(t.llamadas).toHaveLength(1)
  })

  it('en una terminal pregunta: «n» cancela, «s» procede', async () => {
    const no = conFactura({ env: produccion, esTTY: true, respuestasTerminal: ['n'] })
    expect(await ejecutar(['dte', 'emitir', 'factura.json'], no.ent)).toBe(1)
    expect(no.preguntas[0]?.pregunta).toMatch(/PRODUCCIÓN/)
    expect(no.llamadas).toHaveLength(0)

    const si = conFactura({
      env: produccion,
      esTTY: true,
      respuestasTerminal: ['s'],
      respuestas: [json({ ...DOCUMENTO, estado: 'invalidado' })],
    })
    expect(
      await ejecutar(
        ['dte', 'invalidar', 'ABC', '--tipo', '2', '--motivo', 'Operación rescindida'],
        si.ent,
      ),
    ).toBe(0)
    expect(si.llamadas[0]?.url.pathname).toBe('/api/v1/dte/ABC/invalidar')
    expect(si.llamadas[0]?.cuerpo).toEqual({
      tipoAnulacion: 2,
      motivoAnulacion: 'Operación rescindida',
    })
  })

  it('leyendo el DTE de stdin no puede preguntar: exige --yes', async () => {
    const t = crearEntorno({ env: produccion, esTTY: true, entrada: JSON.stringify(FACTURA) })
    expect(await ejecutar(['dte', 'emitir', '-'], t.ent)).toBe(2)
    expect(t.llamadas).toHaveLength(0)
  })

  it('las claves de prueba no piden confirmación', async () => {
    const t = conFactura({ env: conClave, respuestas: [json(DOCUMENTO, 201)] })
    expect(await ejecutar(['dte', 'emitir', 'factura.json'], t.ent)).toBe(0)
    expect(t.preguntas).toHaveLength(0)
  })
})

describe('otros comandos', () => {
  it('dte validar: salida 1 cuando hay problemas, 0 cuando no', async () => {
    const malo = conFactura({
      env: conClave,
      respuestas: [
        json({
          dte: {},
          problemas: [{ ruta: '/receptor', mensaje: 'es obligatorio' }],
          total: 22.6,
          receptorNombre: null,
        }),
      ],
    })
    expect(await ejecutar(['dte', 'validar', 'factura.json'], malo.ent)).toBe(1)
    expect(malo.stdout).toContain('/receptor: es obligatorio')
    expect(malo.llamadas[0]?.url.pathname).toBe('/api/v1/dte/validar')

    const bueno = conFactura({
      env: conClave,
      respuestas: [
        json({
          dte: { resumen: { totalGravada: 22.6, totalIva: 2.6 } },
          problemas: [],
          total: 22.6,
          receptorNombre: null,
        }),
      ],
    })
    expect(await ejecutar(['dte', 'validar', 'factura.json'], bueno.ent)).toBe(0)
    expect(bueno.stdout).toContain('$22.60')
  })

  it('dte list traduce las opciones a parámetros de consulta', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [
        json({ items: [DOCUMENTO], total: 1, pagina: 2, porPagina: 25, ambiente: '00' }),
      ],
    })
    expect(
      await ejecutar(
        [
          'dte',
          'list',
          '--tipo',
          '01',
          '--estado',
          'procesado',
          '--q',
          'ana',
          '--desde',
          '2026-11-01',
          '--hasta',
          '2026-11-30',
          '--pagina',
          '2',
        ],
        t.ent,
      ),
    ).toBe(0)
    expect(Object.fromEntries(t.llamadas[0]?.url.searchParams ?? [])).toEqual({
      tipo: '01',
      estado: 'procesado',
      q: 'ana',
      desde: '2026-11-01',
      hasta: '2026-11-30',
      pagina: '2',
    })
    expect(t.stdout).toContain('C25227C9-A11D-4757-8626-E4ED9CAFD367')
  })

  it('uso y registros list traducen las opciones y muestran las tablas', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [
        json({
          ambiente: '00',
          desde: '2026-11-01',
          hasta: '2026-11-12',
          totales: { emitidos: 3, procesados: 2, rechazados: 1, monto: 45.2 },
          dias: [{ fecha: '2026-11-12', emitidos: 3, procesados: 2, rechazados: 1, monto: 45.2 }],
        }),
        json([
          {
            id: 'r1',
            creado: Date.UTC(2026, 10, 12, 9, 0),
            metodo: 'POST',
            ruta: '/api/v1/dte',
            estado: 422,
            duracionMs: 87,
            origen: 'api',
            clave: { id: 'k1', prefijo: 'of_test_AbCdEf', nombre: 'Ventas' },
          },
        ]),
        json([]),
      ],
    })
    expect(await ejecutar(['uso', '--desde', '2026-11-01', '--hasta', '2026-11-12'], t.ent)).toBe(0)
    expect(
      await ejecutar(
        ['registros', 'list', '--estado', 'error', '--origen', 'api', '--limite', '10'],
        t.ent,
      ),
    ).toBe(0)
    expect(await ejecutar(['registros', 'list'], t.ent)).toBe(0)
    expect(t.llamadas.map((l) => `${l.metodo} ${l.url.pathname}${l.url.search}`)).toEqual([
      'GET /api/v1/uso?desde=2026-11-01&hasta=2026-11-12',
      'GET /api/v1/registros?estado=error&origen=api&limite=10',
      'GET /api/v1/registros',
    ])
    expect(t.stdout).toContain('$45.20')
    expect(t.stdout).toContain('/api/v1/dte')
    expect(t.stdout).toContain('of_test_AbCdEf…')
    expect(t.stdout).toContain('No hay peticiones registradas')
  })

  it('dte pdf guarda <codigo>.pdf en el directorio actual', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 falso')
    const t = crearEntorno({
      env: conClave,
      respuestas: [new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } })],
    })
    expect(await ejecutar(['dte', 'pdf', 'ABC-123'], t.ent)).toBe(0)
    expect(t.llamadas[0]?.url.pathname).toBe('/api/v1/dte/ABC-123/pdf')
    expect(readFileSync(join(t.carpeta, 'ABC-123.pdf'), 'utf8')).toBe('%PDF-1.7 falso')
  })

  it('productos add convierte los números; clientes add acepta --file', async () => {
    const p = crearEntorno({
      env: conClave,
      respuestas: [json({ id: 'p1', codigo: 'SRV', precioUnitario: 10 }, 201)],
    })
    expect(
      await ejecutar(
        [
          'productos',
          'add',
          '--codigo',
          'SRV',
          '--descripcion',
          'Servicio',
          '--precio',
          '10',
          '--tipo-item',
          '2',
        ],
        p.ent,
      ),
    ).toBe(0)
    expect(p.llamadas[0]?.cuerpo).toEqual({
      codigo: 'SRV',
      descripcion: 'Servicio',
      precioUnitario: 10,
      tipoItem: 2,
    })

    const cliente = { tipoDocumento: '13', numDocumento: '012345678', nombre: 'Ana' }
    const c = crearEntorno({ env: conClave, respuestas: [json({ id: 'c1', ...cliente }, 201)] })
    writeFileSync(join(c.carpeta, 'cliente.json'), JSON.stringify(cliente))
    expect(await ejecutar(['clientes', 'add', '--file', 'cliente.json'], c.ent)).toBe(0)
    expect(c.llamadas[0]?.cuerpo).toEqual(cliente)
  })

  it('catalogos pasa el id en mayúsculas y los filtros', async () => {
    const t = crearEntorno({
      env: conClave,
      respuestas: [
        json({
          id: 'CAT-013',
          nombre: 'Municipio',
          total: 45,
          valores: [{ codigo: '23', valor: 'San Salvador Centro', departamento: '06' }],
        }),
      ],
    })
    expect(await ejecutar(['catalogos', 'cat-013', '--departamento', '06'], t.ent)).toBe(0)
    expect(t.llamadas[0]?.url.pathname).toBe('/api/v1/catalogos/CAT-013')
    expect(t.llamadas[0]?.url.searchParams.get('departamento')).toBe('06')
    expect(t.stdout).toContain('San Salvador Centro')
  })

  it('avisa si la clave viajaría sin cifrar a un servidor remoto', async () => {
    const t = crearEntorno({ env: conClave, respuestas: [json(YO)] })
    expect(await ejecutar(['whoami', '--url', 'http://factura.ejemplo.sv'], t.ent)).toBe(0)
    expect(t.stderr).toMatch(/no usa HTTPS/)
  })
})
