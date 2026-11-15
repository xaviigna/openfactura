import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CorreoCuenta, Extension } from '../src/extensiones'
import worker, { crearWorker } from '../src/index'
import { Cliente } from './ayudas'

// «Ingresar con GitHub»: GitHub se sustituye en `fetch`; lo demás corre de verdad (estado, PKCE,
// creación de la cuenta y de la sesión).

const VARS = { GITHUB_CLIENT_ID: 'Iv1.prueba', GITHUB_CLIENT_SECRET: 'secreto-de-prueba' }

interface Persona {
  id: number
  login: string
  name: string | null
  correos: { email: string; primary: boolean; verified: boolean }[] | null
  /** Correo público del perfil: nunca debe usarse. */
  publico?: string
}
let persona: Persona
let intercambios: URLSearchParams[] = []

beforeEach(() => {
  intercambios = []
  const original = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (entrada, init) => {
    const url =
      typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    if (url === 'https://github.com/login/oauth/access_token') {
      intercambios.push(new URLSearchParams(String(init?.body)))
      return Response.json({
        access_token: 'ghu_token_de_usuario',
        refresh_token: 'ghr_token_de_refresco',
        expires_in: 28800,
        refresh_token_expires_in: 15897600,
        token_type: 'bearer',
        scope: '',
      })
    }
    // workerd rechaza `redirect: 'error'` en un fetch real (TypeError): el doble hace lo mismo.
    if (url.startsWith('https://api.github.com/') && init?.redirect === 'error')
      throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"')
    if (url === 'https://api.github.com/user') {
      return Response.json({
        id: persona.id,
        login: persona.login,
        name: persona.name,
        email: persona.publico ?? null,
        avatar_url: `https://avatars.githubusercontent.com/u/${persona.id}`,
      })
    }
    if (url === 'https://api.github.com/user/emails') {
      return persona.correos
        ? Response.json(persona.correos)
        : Response.json({ message: 'Resource not accessible by integration' }, { status: 403 })
    }
    return original(entrada as RequestInfo, init)
  })
})
afterEach(() => vi.restoreAllMocks())

/** Instalación que sí envía correos de cuenta: los deja en `correos`. */
const correos: CorreoCuenta[] = []
const conCorreo: Extension = {
  id: 'correo-de-prueba',
  correosDeCuenta: () => async (m) => {
    correos.push(m)
  },
}
const workerConCorreo = crearWorker([conCorreo])

function nuevoCliente(vars: Record<string, string> = VARS, w: typeof worker = worker) {
  const cliente = new Cliente()
  cliente.despachar = async (peticion) => {
    const contexto = createExecutionContext()
    const r = await w.fetch(peticion, { ...env, ...vars } as any, contexto)
    await waitOnExecutionContext(contexto)
    return r
  }
  return cliente
}

let serie = 0
const nuevaPersona = (cambios: Partial<Persona> = {}): Persona => {
  const id = 1000 + ++serie
  return {
    id,
    login: `persona${id}`,
    name: 'Ana Prueba',
    correos: [{ email: `ana-${crypto.randomUUID()}@ejemplo.com`, primary: true, verified: true }],
    ...cambios,
  }
}

/** Empieza el ingreso: devuelve la URL de GitHub a la que el panel manda a la persona. */
async function empezar(cliente: Cliente, cuerpo: Record<string, unknown> = {}) {
  const r = await cliente.json('POST', '/api/auth/sign-in/social', {
    provider: 'github',
    callbackURL: '/app',
    newUserCallbackURL: '/onboarding',
    errorCallbackURL: '/auth/login',
    ...cuerpo,
  })
  return { status: r.status, url: r.cuerpo?.url ? new URL(r.cuerpo.url) : null }
}

/** GitHub devuelve a la persona con el código. Devuelve adónde la manda el servidor. */
async function volver(cliente: Cliente, state: string, code = 'codigo-de-github') {
  const r = await cliente.pedir('GET', `/api/auth/callback/github?code=${code}&state=${state}`)
  return { status: r.status, destino: r.headers.get('location') ?? '' }
}

async function ingresar(cliente: Cliente) {
  const { url } = await empezar(cliente)
  return volver(cliente, url!.searchParams.get('state')!)
}

const sesion = async (cliente: Cliente) =>
  (await cliente.json('GET', '/api/auth/get-session')).cuerpo
const cuentas = (userId: string) =>
  env.DB.prepare(
    `SELECT provider_id, account_id, access_token, refresh_token, id_token
       FROM account WHERE user_id = ?1 ORDER BY provider_id`,
  )
    .bind(userId)
    .all<Record<string, string | null>>()
    .then((r) => r.results)

describe('GET /api/v1/acceso', () => {
  it('dice si esta instalación ofrece GitHub, sin sesión', async () => {
    expect((await nuevoCliente().json('GET', '/api/v1/acceso')).cuerpo).toEqual({
      github: true,
      correo: false,
    })
    expect((await nuevoCliente({}).json('GET', '/api/v1/acceso')).cuerpo).toEqual({
      github: false,
      correo: false,
    })
    expect(
      (await nuevoCliente({ GITHUB_CLIENT_ID: 'Iv1.prueba' }).json('GET', '/api/v1/acceso')).cuerpo,
    ).toEqual({ github: false, correo: false })
  })
})

describe('ingresar con GitHub', () => {
  it('sin configurar, el proveedor no existe', async () => {
    const { status, url } = await empezar(nuevoCliente({}))
    expect(status).toBeGreaterThanOrEqual(400)
    expect(url).toBeNull()
  })

  it('manda a GitHub con estado y PKCE, hacia la URL de retorno de esta instalación', async () => {
    const { status, url } = await empezar(nuevoCliente())
    expect(status).toBe(200)
    expect(`${url!.origin}${url!.pathname}`).toBe('https://github.com/login/oauth/authorize')
    expect(url!.searchParams.get('client_id')).toBe('Iv1.prueba')
    expect(url!.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/callback/github')
    expect(url!.searchParams.get('state')).toBeTruthy()
    expect(url!.searchParams.get('code_challenge')).toBeTruthy()
    expect(url!.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url!.toString()).not.toContain('secreto-de-prueba')
  })

  it('persona nueva: crea la cuenta verificada, abre sesión y no guarda tokens', async () => {
    persona = nuevaPersona({ publico: 'publico@ejemplo.com' })
    const cliente = nuevoCliente()
    const r = await ingresar(cliente)
    expect(r.status).toBe(302)
    expect(r.destino).toBe('/onboarding')

    expect(intercambios).toHaveLength(1)
    expect(intercambios[0]!.get('code')).toBe('codigo-de-github')
    expect(intercambios[0]!.get('code_verifier')).toBeTruthy()

    const s = await sesion(cliente)
    expect(s.user).toMatchObject({
      email: persona.correos![0]!.email,
      emailVerified: true,
      name: 'Ana Prueba',
    })
    // La identidad es el id numérico de GitHub; del token no queda nada.
    expect(await cuentas(s.user.id)).toEqual([
      {
        provider_id: 'github',
        account_id: String(persona.id),
        access_token: null,
        refresh_token: null,
        id_token: null,
      },
    ])
  })

  it('con correos de cuenta, la persona nueva recibe la bienvenida una vez (su correo ya llega confirmado)', async () => {
    persona = nuevaPersona()
    correos.length = 0
    expect((await ingresar(nuevoCliente(VARS, workerConCorreo))).destino).toBe('/onboarding')
    expect(correos).toEqual([
      { tipo: 'bienvenida', correo: persona.correos![0]!.email, nombre: 'Ana Prueba' },
    ])
    expect((await ingresar(nuevoCliente(VARS, workerConCorreo))).destino).toBe('/app')
    expect(correos).toHaveLength(1)
  })

  it('quien vuelve entra a la misma cuenta aunque haya cambiado de usuario y de correo en GitHub', async () => {
    persona = nuevaPersona()
    const primera = nuevoCliente()
    await ingresar(primera)
    const antes = await sesion(primera)

    persona = {
      ...persona,
      login: 'otro-nombre',
      correos: [
        { email: `nuevo-${crypto.randomUUID()}@ejemplo.com`, primary: true, verified: true },
      ],
    }
    const segunda = nuevoCliente()
    const r = await ingresar(segunda)
    expect(r.destino).toBe('/app')
    const despues = await sesion(segunda)
    expect(despues.user.id).toBe(antes.user.id)
    expect(await cuentas(despues.user.id)).toHaveLength(1)
    expect((await cuentas(despues.user.id))[0]!.access_token).toBeNull()
  })

  it('rechaza a quien no tiene un correo principal verificado en GitHub', async () => {
    for (const correos of [
      [{ email: 'sin-verificar@ejemplo.com', primary: true, verified: false }],
      [{ email: 'secundario@ejemplo.com', primary: false, verified: true }],
      [],
      null, // la app no tiene el permiso «Email addresses»
    ]) {
      persona = nuevaPersona({ correos, publico: 'publico@ejemplo.com' })
      const cliente = nuevoCliente()
      const r = await ingresar(cliente)
      expect(r.status).toBe(302)
      expect(r.destino).toMatch(/^\/auth\/login\?error=/)
      expect(await sesion(cliente)).toBeNull()
    }
  })

  it('no se une a una cuenta local con ese correo sin confirmar: la contraseña pudo ponerla otra persona', async () => {
    persona = nuevaPersona()
    const correo = persona.correos![0]!.email
    const intrusa = nuevoCliente()
    const registro = await intrusa.json('POST', '/api/auth/sign-up/email', {
      name: 'Intrusa',
      email: correo,
      password: 'clave-de-la-intrusa-1',
    })
    expect(registro.status).toBe(200)

    const duena = nuevoCliente()
    const r = await ingresar(duena)
    expect(r.destino).toBe('/auth/login?error=account_not_linked')
    expect(await sesion(duena)).toBeNull()
    expect(await cuentas(registro.cuerpo.user.id)).toMatchObject([{ provider_id: 'credential' }])
  })

  it('sí se une a una cuenta local cuyo correo ya está confirmado', async () => {
    persona = nuevaPersona()
    const correo = persona.correos![0]!.email
    const local = nuevoCliente()
    const registro = await local.json('POST', '/api/auth/sign-up/email', {
      name: 'Ana Prueba',
      email: correo,
      password: 'clave-larga-12345',
    })
    await env.DB.prepare('UPDATE user SET email_verified = 1 WHERE id = ?1')
      .bind(registro.cuerpo.user.id)
      .run()

    const cliente = nuevoCliente()
    expect((await ingresar(cliente)).destino).toBe('/app')
    expect((await sesion(cliente)).user.id).toBe(registro.cuerpo.user.id)
    expect((await cuentas(registro.cuerpo.user.id)).map((c) => c.provider_id)).toEqual([
      'credential',
      'github',
    ])
  })

  it('un retorno con el estado de otro navegador no abre sesión', async () => {
    persona = nuevaPersona()
    const { url } = await empezar(nuevoCliente())
    const otro = nuevoCliente()
    const r = await volver(otro, url!.searchParams.get('state')!)
    expect(r.status).toBe(302)
    expect(r.destino).toContain('error=')
    expect(await sesion(otro)).toBeNull()
    expect(intercambios).toHaveLength(0)
  })

  it('no acepta volver a otro sitio', async () => {
    const { status, url } = await empezar(nuevoCliente(), {
      callbackURL: 'https://malo.ejemplo/robar',
    })
    expect(status).toBe(403)
    expect(url).toBeNull()
  })
})
