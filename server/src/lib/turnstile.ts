import type { Bindings } from '../env'

/**
 * Cloudflare Turnstile (opcional) en el registro, el inicio de sesión y la petición del enlace para
 * recuperar la contraseña. Con `TURNSTILE_SECRET` definido, esas rutas exigen el token del widget en
 * el encabezado `x-turnstile-token`, y se comprueba con Cloudflare antes de tocar la contraseña. Sin
 * el secreto, todo funciona como antes.
 */
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Acción que el widget declara en cada pantalla; Cloudflare la devuelve y debe coincidir. */
const ACCIONES: Record<string, string> = {
  '/api/auth/sign-up/email': 'signup',
  '/api/auth/sign-in/email': 'login',
  '/api/auth/request-password-reset': 'password_reset',
}

export const ENCABEZADO_TURNSTILE = 'x-turnstile-token'

type EnvTurnstile = Pick<Bindings, 'TURNSTILE_SECRET' | 'TURNSTILE_HOSTNAMES'>

/**
 * Acción esperada si esta petición necesita el token, o `null`. Normaliza la ruta para que una
 * variante (mayúsculas, barras de más) no la esquive.
 */
export function accionTurnstile(env: EnvTurnstile, peticion: Request): string | null {
  if (!env.TURNSTILE_SECRET || peticion.method !== 'POST') return null
  const ruta = new URL(peticion.url).pathname
    .toLowerCase()
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
  return ACCIONES[ruta] ?? null
}

const rechazo = () =>
  Response.json(
    {
      code: 'turnstile_invalido',
      message:
        'No pudimos verificar que eres una persona. Completa la verificación e inténtalo de nuevo.',
    },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  )

/**
 * Comprueba el token con Cloudflare: `success`, la acción de la pantalla y que el dominio esté en
 * `TURNSTILE_HOSTNAMES`. Devuelve la respuesta de rechazo (403) o `null` si pasa. Ante cualquier
 * duda (sin dominios configurados, Cloudflare no responde, respuesta rara) se rechaza. El secreto
 * nunca se registra.
 */
export async function verificarTurnstile(
  env: EnvTurnstile,
  peticion: Request,
  accion: string,
): Promise<Response | null> {
  const secreto = env.TURNSTILE_SECRET
  const dominios = (env.TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  const token = peticion.headers.get(ENCABEZADO_TURNSTILE) ?? ''
  if (!secreto || !dominios.length || !token || token.length > 2048) return rechazo()
  const formulario = new URLSearchParams({ secret: secreto, response: token })
  const ip = peticion.headers.get('cf-connecting-ip')
  if (ip) formulario.set('remoteip', ip)
  try {
    const r = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formulario.toString(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return rechazo()
    const resultado = (await r.json()) as {
      success?: unknown
      action?: unknown
      hostname?: unknown
      metadata?: { result_with_testing_key?: unknown }
    }
    // Las claves de prueba de Cloudflare no devuelven `action`: sólo entonces se acepta sin ella. La
    // marca viene de Cloudflare en respuesta a nuestro secreto; el navegador no puede inventarla.
    const dePrueba =
      resultado.action === undefined && resultado.metadata?.result_with_testing_key === true
    const valido =
      resultado.success === true &&
      (resultado.action === accion || dePrueba) &&
      typeof resultado.hostname === 'string' &&
      dominios.includes(resultado.hostname.toLowerCase())
    return valido ? null : rechazo()
  } catch {
    console.error('No se pudo verificar el token de Turnstile')
    return rechazo()
  }
}
