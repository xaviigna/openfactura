import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generar } from '../scripts/generar'
import { FirmaInvalida, OpenFactura, OpenFacturaError, verificarWebhook } from '../src/index'

const CLAVE = 'of_test_abcdefghijklmnopqrstuvwxyz0123456789'
type Llamada = { url: URL; metodo: string; headers: Headers; cuerpo: unknown }

/** Cliente con un `fetch` falso que responde en orden. */
function cliente(respuestas: Array<Response | Error>, opciones: { reintentos?: number } = {}) {
  const llamadas: Llamada[] = []
  const of = new OpenFactura({
    apiKey: CLAVE,
    url: 'https://factura.ejemplo.sv/',
    reintentos: opciones.reintentos ?? 2,
    fetch: (async (entrada: URL, init: RequestInit) => {
      llamadas.push({
        url: new URL(String(entrada)),
        metodo: init.method ?? 'GET',
        headers: new Headers(init.headers),
        cuerpo: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      const r = respuestas.shift()
      if (!r) throw new Error('fetch inesperado')
      if (r instanceof Error) throw r
      return r
    }) as typeof fetch,
  })
  return { of, llamadas }
}
const json = (cuerpo: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

describe('tipos generados', () => {
  it('src/generado.ts está al día con las especificaciones OpenAPI (bun run generar)', () => {
    const archivo = readFileSync(
      fileURLToPath(new URL('../src/generado.ts', import.meta.url)),
      'utf8',
    )
    expect(archivo).toBe(generar())
  })
})

describe('cliente', () => {
  it('emitir: POST /api/v1/dte con la clave y una clave de idempotencia', async () => {
    const { of, llamadas } = cliente([json({ codigoGeneracion: 'ABC', estado: 'procesado' }, 201)])
    const r = await of.dte.emitir({ tipoDte: '01', datos: {} } as never)
    expect(r).toMatchObject({ codigoGeneracion: 'ABC' })
    const [l] = llamadas
    expect(l?.url.href).toBe('https://factura.ejemplo.sv/api/v1/dte')
    expect(l?.metodo).toBe('POST')
    expect(l?.headers.get('Authorization')).toBe(`Bearer ${CLAVE}`)
    expect(l?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reintenta 5xx y 429 con LA MISMA clave de idempotencia (nunca emite dos veces)', async () => {
    const { of, llamadas } = cliente([
      json({ error: { code: 'mh_no_disponible', message: 'x' } }, 503),
      json({ error: { code: 'limite', message: 'x' } }, 429, { 'Retry-After': '0' }),
      json({ codigoGeneracion: 'ABC' }, 201),
    ])
    await of.dte.emitir({ tipoDte: '01', datos: {} } as never, { idempotencyKey: 'venta-1' })
    expect(llamadas.map((l) => l.headers.get('Idempotency-Key'))).toEqual([
      'venta-1',
      'venta-1',
      'venta-1',
    ])
  })

  it('no reintenta lo que no es seguro repetir (crear un cliente de Plataforma)', async () => {
    const { of, llamadas } = cliente([json({ error: { code: 'x', message: 'caído' } }, 503)])
    await expect(of.plataforma.clientes.crear({ nombre: 'Casa Barista' })).rejects.toBeInstanceOf(
      OpenFacturaError,
    )
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0]?.url.pathname).toBe('/cloud/plataforma/clientes')
  })

  it('errores con su código; parámetros de ruta escapados; consulta en la URL', async () => {
    const { of, llamadas } = cliente([
      json(
        { error: { code: 'plan_requerido', message: 'Activa un plan', details: { plan: 'free' } } },
        402,
      ),
      json({ datos: [], total: 0 }),
    ])
    const error = await of.dte.obtener('a/b').catch((e) => e)
    expect(error).toMatchObject({ status: 402, code: 'plan_requerido', details: { plan: 'free' } })
    expect(llamadas[0]?.url.pathname).toBe('/api/v1/dte/a%2Fb')
    await of.dte.listar({ estado: 'procesado' } as never)
    expect(llamadas[1]?.url.search).toBe('?estado=procesado')
  })

  it('comoCliente usa la clave del cliente para la API', async () => {
    const otra = 'of_test_clienteCasaBarista0123456789abcdef'
    const { of, llamadas } = cliente([json({ organizationId: 'org_cb' })])
    await of.comoCliente(otra).yo()
    expect(llamadas[0]?.headers.get('Authorization')).toBe(`Bearer ${otra}`)
  })

  it('pdf devuelve los bytes', async () => {
    const { of } = cliente([new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 })])
    const bytes = new Uint8Array(await of.dte.pdf('ABC'))
    expect(new TextDecoder().decode(bytes)).toBe('%PDF')
  })

  it('rechaza una clave mal formada', () => {
    expect(() => new OpenFactura({ apiKey: 'sk_123' })).toThrow(TypeError)
  })
})

describe('verificarWebhook', () => {
  const secreto = 'whsec_prueba'
  async function firmar(cuerpo: string, t: number) {
    const llave = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secreto),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const firma = await crypto.subtle.sign(
      'HMAC',
      llave,
      new TextEncoder().encode(`${t}.${cuerpo}`),
    )
    return `t=${t},v1=${[...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
  }
  const cuerpo = JSON.stringify({
    id: 'evt_1',
    evento: 'dte.procesado',
    datos: { codigoGeneracion: 'ABC' },
  })

  it('acepta la firma del servidor y devuelve el evento', async () => {
    const t = Math.floor(Date.now() / 1000)
    const e = await verificarWebhook(cuerpo, await firmar(cuerpo, t), secreto)
    expect(e.evento).toBe('dte.procesado')
  })

  it('rechaza un cuerpo alterado, otra clave, un envío viejo o sin encabezado', async () => {
    const t = Math.floor(Date.now() / 1000)
    const firma = await firmar(cuerpo, t)
    await expect(verificarWebhook(`${cuerpo} `, firma, secreto)).rejects.toBeInstanceOf(
      FirmaInvalida,
    )
    await expect(verificarWebhook(cuerpo, firma, 'whsec_otra')).rejects.toBeInstanceOf(
      FirmaInvalida,
    )
    const vieja = await firmar(cuerpo, t - 3600)
    await expect(verificarWebhook(cuerpo, vieja, secreto)).rejects.toThrow(/viejo/)
    await expect(verificarWebhook(cuerpo, null, secreto)).rejects.toBeInstanceOf(FirmaInvalida)
  })
})
