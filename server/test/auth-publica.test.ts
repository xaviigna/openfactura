import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { consumir, limpiar } from '../src/services/limites'
import { Cliente, nuevaOrganizacion } from './ayudas'

afterEach(() => vi.restoreAllMocks())

const CLAVE = 'clave-larga-12345'
const nuevoCorreo = () => `persona-${crypto.randomUUID()}@ejemplo.com`

/** Cliente contra el Worker del núcleo con variables extra (p. ej. Turnstile). */
function clienteCon(vars: Record<string, string>) {
  const cliente = new Cliente()
  cliente.despachar = async (peticion) => {
    const contexto = createExecutionContext()
    const r = await worker.fetch(peticion, { ...env, ...vars } as any, contexto)
    await waitOnExecutionContext(contexto)
    return r
  }
  return cliente
}

describe('Turnstile en el registro, el inicio de sesión y la recuperación', () => {
  const VARS = {
    TURNSTILE_SECRET: 'secreto-turnstile-prueba',
    TURNSTILE_SITE_KEY: 'clave-del-sitio',
    TURNSTILE_HOSTNAMES: 'app.ejemplo.com',
  }
  /** Simula siteverify: responde con `resultado` y guarda lo que recibió. */
  function siteverify(resultado: Record<string, unknown> | ((cuerpo: URLSearchParams) => any)) {
    const recibidos: URLSearchParams[] = []
    const original = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (entrada, init) => {
      const url =
        typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
      if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        const cuerpo = new URLSearchParams(String(init?.body))
        recibidos.push(cuerpo)
        return Response.json(typeof resultado === 'function' ? resultado(cuerpo) : resultado)
      }
      return original(entrada as RequestInfo, init)
    })
    return recibidos
  }
  const ok = (action: string) => ({ success: true, action, hostname: 'app.ejemplo.com' })
  const registrar = (cliente: Cliente, encabezados: Record<string, string> = {}) =>
    cliente.json(
      'POST',
      '/api/auth/sign-up/email',
      { name: 'Ana', email: nuevoCorreo(), password: CLAVE },
      encabezados,
    )

  it('sin token se rechaza antes de calcular el hash de la contraseña', async () => {
    const recibidos = siteverify(ok('signup'))
    const hash = vi.spyOn(crypto.subtle, 'deriveBits')
    for (const ruta of [
      '/api/auth/sign-up/email',
      '/api/auth/sign-in/email',
      '/api/auth/request-password-reset',
      '/api/auth/Sign-In/Email/',
    ]) {
      const r = await clienteCon(VARS).json('POST', ruta, {
        name: 'Ana',
        email: nuevoCorreo(),
        password: CLAVE,
      })
      expect(r.status, ruta).toBe(403)
      expect(r.cuerpo.code).toBe('turnstile_invalido')
    }
    expect(hash).not.toHaveBeenCalled()
    expect(recibidos).toHaveLength(0)
  })

  it('con un token válido pasa, y Cloudflare recibe el secreto, el token y la IP', async () => {
    const recibidos = siteverify(ok('signup'))
    const r = await registrar(clienteCon(VARS), { 'x-turnstile-token': 'token-bueno' })
    expect(r.status).toBe(200)
    expect(recibidos).toHaveLength(1)
    expect(recibidos[0]!.get('secret')).toBe(VARS.TURNSTILE_SECRET)
    expect(recibidos[0]!.get('response')).toBe('token-bueno')
    expect(recibidos[0]!.get('remoteip')).toMatch(/^10\./)
  })

  it('cada pantalla tiene su acción: el token de otra se rechaza', async () => {
    siteverify(ok('login'))
    const r = await registrar(clienteCon(VARS), { 'x-turnstile-token': 'token-de-login' })
    expect(r.status).toBe(403)
  })

  it('con las claves de prueba de Cloudflare (sin acción, con la marca de prueba) pasa; sin la marca, no', async () => {
    const prueba = {
      success: true,
      hostname: 'example.com',
      metadata: { result_with_testing_key: true },
    }
    const vars = { ...VARS, TURNSTILE_HOSTNAMES: 'app.ejemplo.com,example.com' }
    siteverify(prueba)
    expect((await registrar(clienteCon(vars), { 'x-turnstile-token': 't' })).status).toBe(200)
    vi.restoreAllMocks()
    siteverify({ success: true, hostname: 'example.com' })
    expect((await registrar(clienteCon(vars), { 'x-turnstile-token': 't' })).status).toBe(403)
    vi.restoreAllMocks()
    // La marca no salva el dominio: example.com sigue necesitando estar en la lista.
    siteverify(prueba)
    expect((await registrar(clienteCon(VARS), { 'x-turnstile-token': 't' })).status).toBe(403)
  })

  it('el token de un dominio fuera de TURNSTILE_HOSTNAMES se rechaza', async () => {
    siteverify({ success: true, action: 'signup', hostname: 'otro.ejemplo' })
    expect((await registrar(clienteCon(VARS), { 'x-turnstile-token': 't' })).status).toBe(403)
  })

  it('un token que Cloudflare no acepta, uno demasiado largo o sin dominios configurados: 403', async () => {
    const recibidos = siteverify({ success: false, 'error-codes': ['invalid-input-response'] })
    expect((await registrar(clienteCon(VARS), { 'x-turnstile-token': 't' })).status).toBe(403)
    expect(
      (await registrar(clienteCon(VARS), { 'x-turnstile-token': 'x'.repeat(2049) })).status,
    ).toBe(403)
    expect(
      (
        await registrar(clienteCon({ ...VARS, TURNSTILE_HOSTNAMES: '' }), {
          'x-turnstile-token': 't',
        })
      ).status,
    ).toBe(403)
    expect(recibidos).toHaveLength(1)
  })

  it('si Cloudflare no responde bien, se rechaza', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    siteverify(() => {
      throw new Error('caído')
    })
    expect((await registrar(clienteCon(VARS), { 'x-turnstile-token': 't' })).status).toBe(403)
  })

  it('las demás rutas de /api/auth no lo piden', async () => {
    siteverify(ok('signup'))
    const cliente = clienteCon(VARS)
    await registrar(cliente, { 'x-turnstile-token': 't' })
    expect((await cliente.json('GET', '/api/auth/get-session')).status).toBe(200)
  })

  it('/api/v1/acceso da la clave del sitio sólo si Turnstile está activo', async () => {
    expect((await clienteCon(VARS).json('GET', '/api/v1/acceso')).cuerpo.turnstile).toBe(
      'clave-del-sitio',
    )
    expect((await new Cliente().json('GET', '/api/v1/acceso')).cuerpo.turnstile).toBeNull()
  })

  it('sin TURNSTILE_SECRET todo sigue como antes', async () => {
    expect((await registrar(new Cliente())).status).toBe(200)
  })
})

describe('organizaciones: cupo por persona y topes de los campos', () => {
  const crear = (cliente: Cliente, datos: Record<string, unknown> = {}) =>
    cliente.json('POST', '/api/auth/organization/create', {
      name: 'Empresa',
      slug: `empresa-${crypto.randomUUID().slice(0, 8)}`,
      ...datos,
    })

  it('una persona es propietaria de 10 organizaciones como mucho', async () => {
    const { cliente } = await nuevaOrganizacion()
    for (let i = 0; i < 9; i++) expect((await crear(cliente)).status).toBe(200)
    const tope = await crear(cliente)
    expect(tope.status).toBe(403)
    expect(tope.cuerpo.code).toBe('YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS')
  })

  it('las organizaciones donde es miembro sin ser propietaria (invitaciones, espacios de clientes de una plataforma) no cuentan', async () => {
    const { cliente, userId } = await nuevaOrganizacion()
    const ahora = Date.now()
    for (let i = 0; i < 12; i++) {
      const org = crypto.randomUUID()
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO organization (id, name, slug, created_at) VALUES (?1, ?2, ?3, ?4)',
        ).bind(org, `Cliente ${i}`, `cliente-${org}`, ahora),
        env.DB.prepare(
          "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?1, ?2, ?3, 'admin', ?4)",
        ).bind(crypto.randomUUID(), org, userId, ahora),
      ])
    }
    expect((await crear(cliente)).status).toBe(200)
  })

  it('nombre, identificador, logo y metadatos tienen tope', async () => {
    const { cliente, organizationId } = await nuevaOrganizacion()
    const casos: Record<string, unknown>[] = [
      { name: 'x'.repeat(121) },
      { slug: 'x'.repeat(61) },
      { metadata: { nota: 'x'.repeat(4100) } },
      { logo: `https://ejemplo.com/${'x'.repeat(2048)}` },
      { logo: 'javascript:alert(1)' },
      { logo: 'data:image/png;base64,AAAA' },
      { logo: 'http://ejemplo.com/logo.png' },
    ]
    for (const datos of casos) {
      const r = await crear(cliente, datos)
      expect(r.status, JSON.stringify(datos).slice(0, 60)).toBe(400)
      expect(r.cuerpo.code).toBe('datos_invalidos')
      const u = await cliente.json('POST', '/api/auth/organization/update', {
        organizationId,
        data: datos,
      })
      expect(u.status, JSON.stringify(datos).slice(0, 60)).toBe(400)
    }
    expect(
      (
        await crear(cliente, {
          name: 'x'.repeat(120),
          logo: 'https://ejemplo.com/logo.png',
          metadata: { nota: 'corta' },
        })
      ).status,
    ).toBe(200)
  })

  it('el nombre y la imagen de la persona tienen tope, y la imagen es https', async () => {
    const { cliente } = await nuevaOrganizacion()
    for (const datos of [
      { name: 'x'.repeat(121) },
      { image: 'javascript:alert(1)' },
      { image: `https://ejemplo.com/${'x'.repeat(2048)}` },
    ]) {
      expect((await cliente.json('POST', '/api/auth/update-user', datos)).status).toBe(400)
    }
    expect(
      (
        await cliente.json('POST', '/api/auth/update-user', {
          name: 'Ana María',
          image: 'https://ejemplo.com/yo.png',
        })
      ).status,
    ).toBe(200)
    const alta = await new Cliente().json('POST', '/api/auth/sign-up/email', {
      name: 'x'.repeat(121),
      email: nuevoCorreo(),
      password: CLAVE,
    })
    expect(alta.status).toBe(400)
  })
})

describe('registro con un correo que ya tiene cuenta', () => {
  // Sin extensión de correo responde Better Auth (USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL); con ella,
  // el gancho (USER_ALREADY_EXISTS, probado en la nube). El panel muestra lo mismo en ambos.
  it('rechaza el alta (422) y no crea nada', async () => {
    const o = await nuevaOrganizacion()
    const antes = await env.DB.prepare('SELECT COUNT(*) AS n FROM user WHERE email = ?1')
      .bind(o.correo)
      .first<{ n: number }>()
    const alta = await new Cliente().json('POST', '/api/auth/sign-up/email', {
      name: 'Otra persona',
      email: o.correo.toUpperCase(),
      password: CLAVE,
    })
    expect(alta.status).toBe(422)
    expect(alta.cuerpo.code).toMatch(/^USER_ALREADY_EXISTS/)
    const despues = await env.DB.prepare('SELECT COUNT(*) AS n FROM user WHERE email = ?1')
      .bind(o.correo)
      .first<{ n: number }>()
    expect(despues?.n).toBe(antes?.n)
  })
})

describe('limpieza de las ventanas del límite', () => {
  it('sólo borra una ventana cuando terminó, sea de un minuto o de un día', async () => {
    const ahora = Math.floor(Date.now() / 1000)
    const largo = `largo-${crypto.randomUUID()}`
    const corto = `corto-${crypto.randomUUID()}`
    await consumir(env.DB, largo, 5, 86_400)
    const fila = await env.DB.prepare('SELECT segundos FROM ventana_limite WHERE bucket = ?1')
      .bind(largo)
      .first<{ segundos: number }>()
    expect(fila?.segundos).toBe(86_400)
    // Una ventana de un día que empezó hace dos horas sigue viva; una de una hora, no.
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO ventana_limite (bucket, ventana_inicio, cuenta, segundos) VALUES (?1, ?2, 3, 86400)',
      ).bind(`${largo}-2h`, ahora - 7200),
      env.DB.prepare(
        'INSERT INTO ventana_limite (bucket, ventana_inicio, cuenta, segundos) VALUES (?1, ?2, 3, 3600)',
      ).bind(corto, ahora - 7200),
    ])
    await limpiar(env.DB)
    const quedan = await env.DB.prepare(
      'SELECT bucket FROM ventana_limite WHERE bucket IN (?1, ?2, ?3)',
    )
      .bind(largo, `${largo}-2h`, corto)
      .all<{ bucket: string }>()
    expect(quedan.results.map((r) => r.bucket).sort()).toEqual([largo, `${largo}-2h`].sort())
  })
})
