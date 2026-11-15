/**
 * «Ingresar con GitHub» mediante una GitHub App (su flujo de autorización de usuario). Sólo sirve
 * para identificar a la persona: no se piden permisos sobre repositorios ni se conserva el token.
 * La app necesita un único permiso de cuenta: «Email addresses: Read-only».
 */
import type { GithubProfile } from 'better-auth/social-providers'
import type { Bindings } from '../env'

type EnvGithub = Pick<Bindings, 'GITHUB_CLIENT_ID' | 'GITHUB_CLIENT_SECRET'>

export const githubConfigurado = (env: EnvGithub) =>
  Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)

const API = 'https://api.github.com'

async function pedir<T>(ruta: string, token: string): Promise<T | null> {
  const r = await fetch(`${API}${ruta}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'open-factura',
    },
    // Una redirección podría llevarse el token a otro origen: no se sigue (un 3xx no es `ok`).
    // Workers no admite `redirect: 'error'`: lanza un TypeError al hacer la petición.
    redirect: 'manual',
  })
  return r.ok ? ((await r.json()) as T) : null
}

interface Correo {
  email: string
  primary: boolean
  verified: boolean
}

/**
 * Quién es la persona según GitHub, o `null` para rechazar el ingreso. Sólo vale su correo principal
 * y verificado: el correo público del perfil y los no verificados los escribe quien quiera, y una
 * cuenta de GitHub recién creada tiene sin verificar el suyo.
 */
export async function usuarioDeGithub(token: { accessToken?: string }) {
  if (!token.accessToken) return null
  const [perfil, correos] = await Promise.all([
    pedir<GithubProfile>('/user', token.accessToken),
    pedir<Correo[]>('/user/emails', token.accessToken),
  ])
  const correo = Array.isArray(correos) ? correos.find((c) => c.primary && c.verified) : undefined
  if (!perfil?.id || !correo) return null
  return {
    user: {
      name: perfil.name || perfil.login,
      email: correo.email.toLowerCase(),
      image: perfil.avatar_url ?? undefined,
      emailVerified: true,
    },
    // Better Auth toma de aquí el id numérico de GitHub como identidad de la cuenta: el `login` y
    // el correo pueden cambiar de dueño.
    data: perfil,
  }
}

/** Opciones del proveedor para Better Auth, o `undefined` si no está configurado. */
export function proveedorGithub(env: EnvGithub) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return undefined
  return {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    // Una GitHub App ignora los `scope` de OAuth: sus permisos se fijan al registrarla.
    disableDefaultScope: true,
    getUserInfo: usuarioDeGithub,
  }
}

/** Campos de `account` que guardan credenciales del proveedor: nunca se conservan. */
export const SIN_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
} as const
