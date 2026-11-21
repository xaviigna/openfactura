import { env } from 'cloudflare:test'
import { problemaUrlWebhook } from 'shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDb } from '../src/db'
import {
  entregarPendientes,
  hostsPermitidos,
  hostsPropios,
  MAX_INTENTOS,
  RETRASOS_MINUTOS,
} from '../src/services/webhooks'
import { type Cliente, FACTURA, nuevaClave, nuevaOrganizacion } from './ayudas'

interface Recibido {
  url: string
  headers: Headers
  cuerpo: string
}

interface FilaEntrega {
  id: string
  evento: string
  estado: string
  intentos: number
  ultimo_status: number | null
  ultimo_error: string | null
  proximo_intento: number | null
  payload: string
}

/** Receptor falso: intercepta el `fetch` saliente del Worker (mismo aislado que las pruebas). */
let recibidos: Recibido[] = []

beforeEach(() => {
  recibidos = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (entrada, init) => {
    const url = entrada instanceof Request ? entrada.url : String(entrada)
    recibidos.push({ url, headers: new Headers(init?.headers), cuerpo: String(init?.body) })
    if (url.includes('/falla')) return new Response('error interno del receptor', { status: 500 })
    if (url.includes('b.ejemplo.com')) return new Response('ok')
    if (url.includes('/redirige')) {
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://169.254.169.254/latest/meta-data' },
      })
    }
    return new Response('ok')
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

const URL_OK = 'https://receptor.ejemplo.com/hooks/openfactura'
const URL_FALLA = 'https://receptor.ejemplo.com/falla'

async function nuevoWebhook(cliente: Cliente, extra: Record<string, unknown> = {}) {
  const r = await cliente.json('POST', '/api/v1/webhooks', {
    url: URL_OK,
    eventos: ['dte.procesado', 'dte.invalidado'],
    ...extra,
  })
  if (r.status !== 201) throw new Error(`Webhook falló: ${JSON.stringify(r.cuerpo)}`)
  return r.cuerpo as { id: string; secreto: string; url: string; eventos: string[] }
}

const entregasDe = async (webhookId: string) =>
  (
    await env.DB.prepare('SELECT * FROM webhook_entrega WHERE webhook_id = ?1 ORDER BY creado')
      .bind(webhookId)
      .all<FilaEntrega>()
  ).results

/** El primer intento corre en `waitUntil`, después de responder: se espera a que termine. */
async function esperarEntregas(webhookId: string, cuantas: number) {
  const limite = Date.now() + 5000
  for (;;) {
    const filas = await entregasDe(webhookId)
    if (filas.length >= cuantas && filas.every((f) => f.intentos > 0)) return filas
    if (Date.now() > limite) throw new Error(`Entregas sin terminar: ${JSON.stringify(filas)}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function hmacHex(secreto: string, texto: string) {
  const codificar = (t: string) => new TextEncoder().encode(t)
  const llave = await crypto.subtle.importKey(
    'raw',
    codificar(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', llave, codificar(texto)))
  return [...firma].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('webhooks: alta y secreto', () => {
  it('muestra el secreto sólo al crear y lo guarda cifrado', async () => {
    const { cliente } = await nuevaOrganizacion()
    const w = await nuevoWebhook(cliente, { descripcion: 'ERP' })
    expect(w.secreto).toMatch(/^whsec_[0-9A-Za-z]{40}$/)

    const lista = await cliente.pedir('GET', '/api/v1/webhooks')
    const texto = await lista.text()
    expect(texto).not.toContain(w.secreto)
    expect(texto).not.toContain('secreto')
    expect(JSON.parse(texto)).toEqual([
      expect.objectContaining({
        id: w.id,
        url: URL_OK,
        descripcion: 'ERP',
        eventos: ['dte.procesado', 'dte.invalidado'],
        activo: true,
      }),
    ])
    const fila = await env.DB.prepare('SELECT secreto_enc FROM webhook WHERE id = ?1')
      .bind(w.id)
      .first<{ secreto_enc: string }>()
    expect(fila?.secreto_enc).toMatch(/^v1\./)
    expect(fila?.secreto_enc).not.toContain(w.secreto)

    const auditoria = await cliente.pedir('GET', '/api/v1/auditoria')
    const textoAuditoria = await auditoria.text()
    expect(textoAuditoria).toContain('webhook.crear')
    expect(textoAuditoria).not.toContain(w.secreto)
  })

  it('rotar el secreto devuelve uno nuevo y las firmas lo usan', async () => {
    const { cliente } = await nuevaOrganizacion()
    const w = await nuevoWebhook(cliente)
    const r = await cliente.json('POST', `/api/v1/webhooks/${w.id}/rotar-secreto`)
    expect(r.status).toBe(200)
    expect(r.cuerpo.secreto).toMatch(/^whsec_/)
    expect(r.cuerpo.secreto).not.toBe(w.secreto)

    const prueba = await cliente.json('POST', `/api/v1/webhooks/${w.id}/probar`)
    expect(prueba.cuerpo).toMatchObject({ entregado: true, status: 200, error: null })
    const [envio] = recibidos
    const [t, v1] = (envio?.headers.get('OpenFactura-Signature') ?? '').split(',')
    const marca = t?.slice(2) ?? ''
    expect(v1).toBe(`v1=${await hmacHex(r.cuerpo.secreto, `${marca}.${envio?.cuerpo}`)}`)
    expect(v1).not.toBe(`v1=${await hmacHex(w.secreto, `${marca}.${envio?.cuerpo}`)}`)
    expect(JSON.parse(envio?.cuerpo ?? '')).toMatchObject({ evento: 'webhook.prueba' })
  })

  it('limita a 10 webhooks por organización', async () => {
    const { cliente } = await nuevaOrganizacion()
    for (let i = 0; i < 10; i++) await nuevoWebhook(cliente)
    const r = await cliente.json('POST', '/api/v1/webhooks', {
      url: URL_OK,
      eventos: ['dte.procesado'],
    })
    expect(r.status).toBe(409)
    expect(r.cuerpo.error.code).toBe('limite_webhooks')
  })
})

describe('webhooks: entregas', () => {
  it('notifica la emisión y la invalidación con cuerpo y firma verificables', async () => {
    const { cliente, organizationId } = await nuevaOrganizacion({ emisor: true })
    const w = await nuevoWebhook(cliente)
    const { cuerpo: doc, status } = await cliente.json('POST', '/api/v1/dte', FACTURA)
    expect(status).toBe(201)

    const [entrega] = await esperarEntregas(w.id, 1)
    expect(entrega).toMatchObject({ evento: 'dte.procesado', estado: 'entregado', intentos: 1 })
    expect(recibidos).toHaveLength(1)
    const envio = recibidos[0]!
    expect(envio.url).toBe(URL_OK)
    expect(envio.headers.get('Content-Type')).toBe('application/json')
    expect(envio.headers.get('User-Agent')).toBe('OpenFactura-Webhooks/1')
    expect(envio.headers.get('OpenFactura-Event')).toBe('dte.procesado')
    expect(envio.headers.get('OpenFactura-Delivery')).toBe(entrega?.id)

    const firma = envio.headers.get('OpenFactura-Signature') ?? ''
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(firma) ?? []
    expect(Math.abs(Number(t) - Date.now() / 1000)).toBeLessThan(60)
    expect(v1).toBe(await hmacHex(w.secreto, `${t}.${envio.cuerpo}`))
    // Un cuerpo alterado no verifica.
    expect(v1).not.toBe(await hmacHex(w.secreto, `${t}.${envio.cuerpo} `))

    const cuerpo = JSON.parse(envio.cuerpo)
    expect(cuerpo).toMatchObject({
      id: entrega?.id,
      evento: 'dte.procesado',
      ambiente: '00',
      organizacion: organizationId,
      datos: {
        codigoGeneracion: doc.codigoGeneracion,
        numeroControl: doc.numeroControl,
        estado: 'procesado',
        selloRecibido: doc.selloRecibido,
      },
    })
    expect(new Date(cuerpo.creado).toISOString()).toBe(cuerpo.creado)
    // Nunca el JSON del DTE, su firma ni nada de las credenciales.
    expect(cuerpo.datos.dte).toBeUndefined()
    expect(envio.cuerpo).not.toContain('firmaElectronica')
    expect(envio.cuerpo).not.toContain('identificacion')

    const inv = await cliente.json('POST', `/api/v1/dte/${doc.codigoGeneracion}/invalidar`, {
      tipoAnulacion: 2,
      motivoAnulacion: 'Operación rescindida',
    })
    expect(inv.status).toBe(200)
    const [, invalidacion] = await esperarEntregas(w.id, 2)
    expect(invalidacion).toMatchObject({ evento: 'dte.invalidado', estado: 'entregado' })
    expect(JSON.parse(recibidos[1]!.cuerpo).datos).toMatchObject({
      codigoGeneracion: doc.codigoGeneracion,
      estado: 'invalidado',
    })
  })

  it('sólo notifica los eventos suscritos y nada si el webhook está inactivo', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const soloRetornos = await nuevoWebhook(cliente, { eventos: ['retorno.procesado'] })
    const inactivo = await nuevoWebhook(cliente, { activo: false })
    const { cuerpo: doc } = await cliente.json('POST', '/api/v1/dte', FACTURA)
    expect(await entregasDe(soloRetornos.id)).toHaveLength(0)
    expect(await entregasDe(inactivo.id)).toHaveLength(0)

    const retorno = await cliente.json('POST', `/api/v1/dte/${doc.codigoGeneracion}/retorno`, {
      items: [{ descripcion: 'Servicio', cantidad: 1, precioUni: 11.3 }],
    })
    expect(retorno.status).toBe(201)
    const [entrega] = await esperarEntregas(soloRetornos.id, 1)
    expect(entrega?.evento).toBe('retorno.procesado')
    expect(JSON.parse(entrega?.payload ?? '').datos).toMatchObject({
      codigoGeneracion: retorno.cuerpo.codigoGeneracion,
      tipoEvento: '18',
    })

    // Al reactivarlo vuelve a recibir.
    const patch = await cliente.json('PATCH', `/api/v1/webhooks/${inactivo.id}`, { activo: true })
    expect(patch.cuerpo.activo).toBe(true)
    await cliente.json('POST', '/api/v1/dte', FACTURA)
    expect((await esperarEntregas(inactivo.id, 1))[0]?.evento).toBe('dte.procesado')
  })

  it('reintenta con espera creciente y queda fallido tras el último intento', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const w = await nuevoWebhook(cliente, { url: URL_FALLA })
    expect((await cliente.json('POST', '/api/v1/dte', FACTURA)).status).toBe(201)

    const antes = Date.now()
    let [entrega] = await esperarEntregas(w.id, 1)
    expect(entrega).toMatchObject({
      estado: 'pendiente',
      intentos: 1,
      ultimo_status: 500,
      ultimo_error: 'El destino respondió HTTP 500',
    })
    const primera = (entrega?.proximo_intento ?? 0) - antes
    expect(primera).toBeGreaterThan(55_000)
    expect(primera).toBeLessThan(65_000)
    // El cron no la toma antes de tiempo.
    await entregarPendientes(env, crearDb(env.DB), Date.now())
    expect((await entregasDe(w.id))[0]?.intentos).toBe(1)

    const db = crearDb(env.DB)
    let ahora = Date.now()
    for (let intento = 2; intento <= MAX_INTENTOS; intento++) {
      ahora += 3 * 86_400_000
      await entregarPendientes(env, db, ahora)
      ;[entrega] = await entregasDe(w.id)
      expect(entrega?.intentos).toBe(intento)
      if (intento < MAX_INTENTOS) {
        expect(entrega?.estado).toBe('pendiente')
        expect(entrega?.proximo_intento).toBe(ahora + RETRASOS_MINUTOS[intento - 1]! * 60_000)
      }
    }
    expect(entrega).toMatchObject({ estado: 'fallido', intentos: MAX_INTENTOS })
    expect(entrega?.proximo_intento).toBeNull()
    expect(recibidos.filter((r) => r.url === URL_FALLA)).toHaveLength(MAX_INTENTOS)

    // Un fallido ya no se reintenta solo…
    await entregarPendientes(env, db, ahora + 30 * 86_400_000)
    expect((await entregasDe(w.id))[0]?.intentos).toBe(MAX_INTENTOS)

    // …pero se puede reenviar a mano tras corregir el destino.
    await cliente.json('PATCH', `/api/v1/webhooks/${w.id}`, { url: URL_OK })
    const reenvio = await cliente.json('POST', `/api/v1/webhooks/entregas/${entrega?.id}/reenviar`)
    expect(reenvio.status).toBe(200)
    expect(reenvio.cuerpo).toMatchObject({ estado: 'entregado', intentos: 1 })

    const log = await cliente.json('GET', `/api/v1/webhooks/${w.id}/entregas`)
    expect(log.cuerpo).toHaveLength(1)
    expect(log.cuerpo[0]).toMatchObject({ id: entrega?.id, estado: 'entregado' })
    expect(log.cuerpo[0].payload).toBeUndefined()
  })

  it('no sigue redirecciones', async () => {
    const { cliente } = await nuevaOrganizacion()
    const w = await nuevoWebhook(cliente, { url: 'https://receptor.ejemplo.com/redirige' })
    const r = await cliente.json('POST', `/api/v1/webhooks/${w.id}/probar`)
    expect(r.cuerpo).toMatchObject({
      entregado: false,
      status: null,
      error: 'La prueba no se pudo entregar',
    })
    expect(recibidos).toHaveLength(1)
  })

  it('un fallo al publicar no afecta a la emisión', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const w = await nuevoWebhook(cliente)
    await env.DB.prepare("UPDATE webhook SET secreto_enc = 'v1.roto.roto' WHERE id = ?1")
      .bind(w.id)
      .run()
    expect((await cliente.json('POST', '/api/v1/dte', FACTURA)).status).toBe(201)
    const [entrega] = await esperarEntregas(w.id, 1)
    expect(entrega).toMatchObject({
      estado: 'pendiente',
      ultimo_error: 'No se pudo preparar la firma',
    })
    expect(recibidos).toHaveLength(0)
  })
})

describe('webhooks: seguridad', () => {
  it('rechaza destinos que no son https públicos (SSRF)', async () => {
    const { cliente } = await nuevaOrganizacion()
    for (const url of [
      'http://receptor.ejemplo.com/hook',
      'ftp://receptor.ejemplo.com/hook',
      'https://localhost/hook',
      'https://api.localhost/hook',
      'https://127.0.0.1/hook',
      'https://2130706433/hook',
      'https://0x7f.0.0.1/hook',
      'https://10.0.0.5/hook',
      'https://172.20.1.1/hook',
      'https://192.168.1.10/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.0.1/hook',
      'https://0.0.0.0/hook',
      'https://[::1]/hook',
      'https://[fd00::1]/hook',
      'https://[fe80::1]/hook',
      'https://[::ffff:127.0.0.1]/hook',
      'https://impresora.local/hook',
      'https://metadata.google.internal/hook',
      'https://usuario:clave@receptor.ejemplo.com/hook',
      'https://intranet/hook',
      'no es una url',
    ]) {
      const r = await cliente.json('POST', '/api/v1/webhooks', { url, eventos: ['dte.procesado'] })
      expect(r.status, url).toBe(400)
      expect(r.cuerpo.error.code, url).toBe('datos_invalidos')
    }
    const w = await nuevoWebhook(cliente)
    const patch = await cliente.json('PATCH', `/api/v1/webhooks/${w.id}`, {
      url: 'https://10.1.1.1/hook',
    })
    expect(patch.status).toBe(400)
    // http://localhost sólo en desarrollo (WEBHOOKS_LOCAL=1 en las pruebas).
    const local = await cliente.json('POST', '/api/v1/webhooks', {
      url: 'http://localhost:8080/hook',
      eventos: ['dte.procesado'],
    })
    expect(local.status).toBe(201)
  })

  it('exige webhooks:manage: un facturador o una clave sin el permiso reciben 403', async () => {
    const { cliente, organizationId } = await nuevaOrganizacion()
    const w = await nuevoWebhook(cliente)
    const sinPermiso = await nuevaClave(cliente, ['dte:read'])
    const conPermiso = await nuevaClave(cliente, ['webhooks:manage'])

    // La clave (modo test) no ve el webhook de la persona, que vale para ambos ambientes.
    expect((await conPermiso.cliente.json('GET', '/api/v1/webhooks')).cuerpo).toHaveLength(0)
    const creado = await conPermiso.cliente.json('POST', '/api/v1/webhooks', {
      url: URL_OK,
      eventos: ['dte.rechazado'],
    })
    expect(creado.status).toBe(201)
    expect(creado.cuerpo.secreto).toMatch(/^whsec_/)

    await env.DB.prepare("UPDATE member SET role = 'member' WHERE organization_id = ?1")
      .bind(organizationId)
      .run()
    for (const c of [sinPermiso.cliente, cliente]) {
      for (const [metodo, ruta, cuerpo] of [
        ['GET', '/api/v1/webhooks'],
        ['POST', '/api/v1/webhooks', { url: URL_OK, eventos: ['dte.procesado'] }],
        ['PATCH', `/api/v1/webhooks/${w.id}`, { activo: false }],
        ['DELETE', `/api/v1/webhooks/${w.id}`],
        ['POST', `/api/v1/webhooks/${w.id}/probar`],
        ['POST', `/api/v1/webhooks/${w.id}/rotar-secreto`],
        ['GET', `/api/v1/webhooks/${w.id}/entregas`],
      ] as Array<[string, string, unknown?]>) {
        const r = await c.json(metodo, ruta, cuerpo)
        expect(r.status, `${metodo} ${ruta}`).toBe(403)
        expect(r.cuerpo.error.details.permiso).toBe('webhooks:manage')
      }
    }
  })

  it('eliminar borra el webhook y sus entregas', async () => {
    const { cliente } = await nuevaOrganizacion()
    const w = await nuevoWebhook(cliente)
    await cliente.json('POST', `/api/v1/webhooks/${w.id}/probar`)
    expect(await entregasDe(w.id)).toHaveLength(1)
    const r = await cliente.json('DELETE', `/api/v1/webhooks/${w.id}`)
    expect(r.cuerpo).toEqual({ eliminado: true })
    expect(await entregasDe(w.id)).toHaveLength(0)
    expect((await cliente.json('GET', '/api/v1/webhooks')).cuerpo).toHaveLength(0)
  })
})

describe('ambiente de las claves (F02)', () => {
  it('una clave live sólo ve y administra los webhooks de su ambiente', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const delPanel = await nuevoWebhook(cliente)
    const live = await nuevaClave(cliente, ['webhooks:manage'], { modo: 'live' })
    const test = await nuevaClave(cliente, ['webhooks:manage'], { modo: 'test' })
    const creado = await live.cliente.json('POST', '/api/v1/webhooks', {
      url: URL_OK,
      eventos: ['dte.procesado'],
    })
    expect(creado.status).toBe(201)
    expect(creado.cuerpo.ambiente).toBe('01')

    // La clave live no toca el webhook del panel (ambos ambientes) ni el de la clave test.
    for (const ajeno of [delPanel.id]) {
      expect(
        (
          await live.cliente.json('PATCH', `/api/v1/webhooks/${ajeno}`, {
            url: 'https://x.ejemplo.com/h',
          })
        ).status,
      ).toBe(404)
      expect(
        (await live.cliente.json('POST', `/api/v1/webhooks/${ajeno}/rotar-secreto`)).status,
      ).toBe(404)
      expect((await live.cliente.json('POST', `/api/v1/webhooks/${ajeno}/probar`)).status).toBe(404)
      expect((await live.cliente.json('GET', `/api/v1/webhooks/${ajeno}/entregas`)).status).toBe(
        404,
      )
      expect((await live.cliente.json('DELETE', `/api/v1/webhooks/${ajeno}`)).status).toBe(404)
    }
    expect(
      (await live.cliente.json('GET', '/api/v1/webhooks')).cuerpo.map((w: { id: string }) => w.id),
    ).toEqual([creado.cuerpo.id])
    expect((await test.cliente.json('GET', '/api/v1/webhooks')).cuerpo).toHaveLength(0)
    expect((await test.cliente.json('DELETE', `/api/v1/webhooks/${creado.cuerpo.id}`)).status).toBe(
      404,
    )
    // La sesión de la persona ve todos.
    expect((await cliente.json('GET', '/api/v1/webhooks')).cuerpo).toHaveLength(2)
  })

  it('un webhook de ambiente live no recibe documentos del ambiente de pruebas', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const live = await nuevaClave(cliente, ['webhooks:manage'], { modo: 'live' })
    const w = await live.cliente.json('POST', '/api/v1/webhooks', {
      url: URL_OK,
      eventos: ['dte.procesado'],
    })
    const emisor = await nuevaClave(cliente, ['dte:emit'], { modo: 'test' })
    expect((await emisor.cliente.json('POST', '/api/v1/dte', FACTURA)).status).toBe(201)
    await new Promise((r) => setTimeout(r, 300))
    expect(await entregasDe(w.cuerpo.id)).toHaveLength(0)
    expect(recibidos).toHaveLength(0)
  })
})

describe('reparto justo del cron (F13)', () => {
  it('50 entregas vencidas de una organización no dejan sin turno a otra', async () => {
    const insertar = async (
      org: { cliente: Cliente; organizationId: string },
      n: number,
      url: string,
    ) => {
      const w = await nuevoWebhook(org.cliente, { url })
      for (let i = 0; i < n; i++) {
        await env.DB.prepare(
          `INSERT INTO webhook_entrega (id, organization_id, webhook_id, evento, payload, estado, intentos, proximo_intento, creado) VALUES (?1, ?2, ?3, 'dte.procesado', '{}', 'pendiente', 1, ?4, 1)`,
        )
          .bind(crypto.randomUUID(), org.organizationId, w.id, 1000 + i)
          .run()
      }
    }
    const a = await nuevaOrganizacion()
    const b = await nuevaOrganizacion()
    await insertar(a, 50, 'https://a.ejemplo.com/falla')
    await insertar(b, 1, 'https://b.ejemplo.com/hook')
    await entregarPendientes(env, crearDb(env.DB), Date.now() + 60_000)
    expect(recibidos.filter((r) => r.url.includes('b.ejemplo.com'))).toHaveLength(1)
    expect(recibidos.length).toBeLessThanOrEqual(20)
  })
})

describe('filtro de destinos (NV04)', () => {
  it('rechaza IPv6 internas, nombres engañosos y el host propio', () => {
    const rechazadas = [
      'https://[::7f00:1]/x',
      'https://[::127.0.0.1]/x',
      'https://[::ffff:127.0.0.1]/x',
      'https://[fec0::1]/x',
      'https://[ff02::1]/x',
      'https://a..ejemplo.com/x',
      'https://ejemplo.com./x',
      'https://127.0.0.1.nip.io/x',
      'https://a.b.sslip.io/x',
      'https://localtest.me/x',
      'https://x.lvh.me/x',
      'https://openfactura.co/x',
      'https://api.openfactura.co/x',
    ]
    for (const u of rechazadas) {
      expect(
        problemaUrlWebhook(u, { permitirLocal: false, hostsPropios: ['openfactura.co'] }),
        u,
      ).not.toBeNull()
    }
    expect(
      problemaUrlWebhook('https://receptor.ejemplo.com/h', {
        permitirLocal: false,
        hostsPropios: ['openfactura.co'],
      }),
    ).toBeNull()
  })

  it('WEBHOOKS_HOSTS_PERMITIDOS exime sólo esos hosts exactos del bloqueo del dominio propio', () => {
    const permitidos = hostsPermitidos({
      WEBHOOKS_HOSTS_PERMITIDOS: ' Facturas.openfactura.co , mal/ruta, https://x.y, ,',
    })
    expect(permitidos).toEqual(['facturas.openfactura.co'])
    const o = {
      permitirLocal: false,
      hostsPropios: hostsPropios({ APP_URL: 'https://app.openfactura.co' }),
      hostsPermitidos: permitidos,
    }
    expect(
      problemaUrlWebhook('https://facturas.openfactura.co/api/webhooks/openfactura', o),
    ).toBeNull()
    // Sólo el host exacto: ni el padre, ni hermanos, ni hijos.
    for (const u of [
      'https://openfactura.co/x',
      'https://app.openfactura.co/x',
      'https://x.facturas.openfactura.co/x',
    ])
      expect(problemaUrlWebhook(u, o), u).not.toBeNull()
    // Las demás reglas siguen: https obligatorio.
    expect(problemaUrlWebhook('http://facturas.openfactura.co/x', o)).not.toBeNull()
    expect(hostsPermitidos({})).toEqual([])
  })

  it('bloquea el dominio del despliegue y su padre, no otros', () => {
    const propios = hostsPropios({ APP_URL: 'https://app.openfactura.co' })
    expect(propios).toEqual(['app.openfactura.co', 'openfactura.co'])
    const o = { permitirLocal: false, hostsPropios: propios }
    expect(problemaUrlWebhook('https://openfactura.co/x', o)).not.toBeNull()
    expect(problemaUrlWebhook('https://api.openfactura.co/x', o)).not.toBeNull()
    expect(problemaUrlWebhook('https://example.com/hook', o)).toBeNull()
    // Un sufijo público no se bloquea entero.
    expect(hostsPropios({ APP_URL: 'https://ejemplo.com.sv' })).toEqual(['ejemplo.com.sv'])
    expect(hostsPropios({ APP_URL: 'http://localhost:8788' })).toEqual([])
    expect(hostsPropios({ APP_URL: 'http://127.0.0.1:8788' })).toEqual([])
  })

  it('probar no distingue conexión, tiempo ni código HTTP', async () => {
    const { cliente } = await nuevaOrganizacion()
    const w = await nuevoWebhook(cliente, { url: URL_FALLA })
    const r = await cliente.json('POST', `/api/v1/webhooks/${w.id}/probar`)
    expect(r.cuerpo).toMatchObject({
      entregado: false,
      status: null,
      error: 'La prueba no se pudo entregar',
    })
    expect(r.cuerpo.entrega).toMatchObject({
      ultimoStatus: null,
      ultimoError: 'La prueba no se pudo entregar',
    })
  })
})
