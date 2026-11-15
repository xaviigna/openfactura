import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { ErrorCli, ErrorUso } from './errores'

/** Open Factura Cloud. Quien aloja su propio servidor usa `--url`, `OPENFACTURA_URL` o `login --url`. */
export const URL_POR_DEFECTO = 'https://app.openfactura.co'

/** URL canónica del MCP remoto de la nube: el dominio corto. También responde `<URL_POR_DEFECTO>/mcp`. */
export const URL_MCP_CLOUD = 'https://openfactura.co/mcp'

export type Env = Record<string, string | undefined>

export interface Perfil {
  url?: string
  apiKey?: string
  /**
   * Plataforma (Open Factura Cloud): la clave de cada cliente en su propio espacio, creada una vez
   * por `openfactura usar`. Por id de cliente.
   */
  clientes?: Record<string, { nombre: string; apiKey: string }>
  /** El cliente con el que se está actuando (`openfactura usar`); sin él, tu propia cuenta. */
  usando?: string
}

export interface Config {
  perfiles: Record<string, Perfil>
}

export interface Resuelto {
  perfil: string
  url: string
  origenUrl: 'opción' | 'entorno' | 'config' | 'defecto'
  /** La clave con la que se actúa: la del cliente en uso, o la tuya. */
  apiKey: string | null
  origenClave: 'entorno' | 'config' | 'cliente' | null
  /** Tu propia clave (la de la plataforma): `openfactura plataforma …` siempre usa ésta. */
  apiKeyPropia: string | null
  /** El cliente con el que se está actuando, si hay. */
  cliente: { id: string; nombre: string } | null
}

/** `$XDG_CONFIG_HOME/openfactura/config.json`, o `~/.config/openfactura/config.json`. */
export function rutaConfig(env: Env): string {
  const xdg = env.XDG_CONFIG_HOME
  const base = xdg && isAbsolute(xdg) ? xdg : join(env.HOME || homedir(), '.config')
  return join(base, 'openfactura', 'config.json')
}

export function leerConfig(env: Env): Config {
  const ruta = rutaConfig(env)
  let texto: string
  try {
    texto = readFileSync(ruta, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { perfiles: {} }
    throw new ErrorCli(`No se pudo leer ${ruta}: ${(error as Error).message}`, 'config_ilegible')
  }
  try {
    const datos = JSON.parse(texto) as Partial<Config> | null
    const perfiles =
      datos && typeof datos.perfiles === 'object' && datos.perfiles ? datos.perfiles : {}
    return { perfiles: { ...perfiles } }
  } catch {
    throw new ErrorCli(`${ruta} no es un JSON válido. Corrígelo o bórralo.`, 'config_ilegible')
  }
}

/** Guarda la configuración: directorio 0700 y archivo 0600, escrito de forma atómica. */
export function guardarConfig(env: Env, config: Config): string {
  const ruta = rutaConfig(env)
  const carpeta = dirname(ruta)
  mkdirSync(carpeta, { recursive: true, mode: 0o700 })
  chmodSync(carpeta, 0o700)
  const temporal = `${ruta}.${process.pid}.tmp`
  rmSync(temporal, { force: true })
  writeFileSync(temporal, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  chmodSync(temporal, 0o600)
  renameSync(temporal, ruta)
  return ruta
}

/** Valida la URL del servidor y la deja sin `/` final ni sufijo `/api/v1`. */
export function normalizarUrl(valor: string): string {
  let url: URL
  try {
    url = new URL(valor.trim())
  } catch {
    throw new ErrorUso(`URL del servidor inválida: ${valor}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ErrorUso(`La URL del servidor debe empezar con http:// o https://: ${valor}`)
  }
  if (url.username || url.password) {
    throw new ErrorUso('La URL del servidor no debe llevar usuario ni contraseña')
  }
  const ruta = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '')
  return `${url.origin}${ruta}`
}

export function nombrePerfil(env: Env, opcion?: string): string {
  const nombre = opcion || env.OPENFACTURA_PROFILE || 'default'
  if (!/^[\w.-]{1,64}$/.test(nombre) || nombre === '__proto__') {
    throw new ErrorUso(`Nombre de perfil inválido: ${nombre}`)
  }
  return nombre
}

/**
 * URL: `--url` > `OPENFACTURA_URL` > perfil guardado > localhost.
 * Clave: `OPENFACTURA_API_KEY` > perfil guardado.
 */
export function resolver(env: Env, opciones: { url?: string; perfil?: string } = {}): Resuelto {
  const perfil = nombrePerfil(env, opciones.perfil)
  const guardado: Perfil = leerConfig(env).perfiles[perfil] ?? {}

  let url = URL_POR_DEFECTO
  let origenUrl: Resuelto['origenUrl'] = 'defecto'
  if (opciones.url) {
    url = opciones.url
    origenUrl = 'opción'
  } else if (env.OPENFACTURA_URL) {
    url = env.OPENFACTURA_URL
    origenUrl = 'entorno'
  } else if (guardado.url) {
    url = guardado.url
    origenUrl = 'config'
  }

  const deEntorno = env.OPENFACTURA_API_KEY?.trim()
  const propia = deEntorno || guardado.apiKey || null
  // Con OPENFACTURA_API_KEY manda esa clave: se ignora el cliente en uso.
  const enUso = !deEntorno && guardado.usando ? guardado.clientes?.[guardado.usando] : undefined
  return {
    perfil,
    url: normalizarUrl(url),
    origenUrl,
    apiKey: enUso?.apiKey ?? propia,
    origenClave: deEntorno ? 'entorno' : enUso ? 'cliente' : propia ? 'config' : null,
    apiKeyPropia: propia,
    cliente: enUso && guardado.usando ? { id: guardado.usando, nombre: enUso.nombre } : null,
  }
}

/** Nunca se imprime la clave completa: sólo sus primeros 14 caracteres. */
export function enmascarar(clave: string): string {
  return `${clave.slice(0, 14)}…`
}

export const esClaveValida = (clave: string) => /^of_(test|live)_\S+$/.test(clave)
export const esClaveDeProduccion = (clave: string) => clave.startsWith('of_live_')
