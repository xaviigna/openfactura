import type { Bindings } from '../env'

const aBase64 = (bytes: Uint8Array) => {
  let binario = ''
  for (const b of bytes) binario += String.fromCharCode(b)
  return btoa(binario)
}
const deBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function sha256Hex(texto: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))))
}

/** HMAC-SHA256 en hexadecimal (firma de los webhooks). */
export async function hmacSha256Hex(clave: string, texto: string): Promise<string> {
  const llave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(clave),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(
    new Uint8Array(await crypto.subtle.sign('HMAC', llave, new TextEncoder().encode(texto))),
  )
}

/** Texto aleatorio en base62 con `largo` caracteres (≈5.95 bits por carácter). */
export function aleatorioBase62(largo: number): string {
  const alfabeto = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let salida = ''
  while (salida.length < largo) {
    for (const b of crypto.getRandomValues(new Uint8Array(largo))) {
      // Se descartan los bytes ≥ 248 para no sesgar la distribución.
      if (b < 248 && salida.length < largo) salida += alfabeto[b % 62]
    }
  }
  return salida
}

export const nuevoId = () => crypto.randomUUID()

/** Versiones de llave maestra disponibles, de mayor a menor. */
function llavesMaestras(env: Bindings): Array<{ version: number; b64: string }> {
  const llaves: Array<{ version: number; b64: string }> = []
  for (const [nombre, valor] of Object.entries(env as unknown as Record<string, unknown>)) {
    const m = /^CRED_KEK_V(\d+)$/.exec(nombre)
    if (m && typeof valor === 'string' && valor) llaves.push({ version: Number(m[1]), b64: valor })
  }
  if (!llaves.length) throw new Error('Falta el secreto CRED_KEK_V1 (32 bytes en base64)')
  return llaves.sort((a, b) => b.version - a.version)
}

async function importar(b64: string) {
  const bytes = deBase64(b64)
  if (bytes.length !== 32) throw new Error('La llave maestra debe medir 32 bytes (AES-256)')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/**
 * Cifra con AES-256-GCM. `contexto` (organización + campo) se autentica como AAD:
 * un texto cifrado copiado a otra fila u organización no descifra.
 * Formato: v<versión>.<iv b64>.<cifrado b64>
 */
export async function cifrar(env: Bindings, contexto: string, claro: string): Promise<string> {
  const { version, b64 } = llavesMaestras(env)[0]!
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cifrado = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(contexto) },
    await importar(b64),
    new TextEncoder().encode(claro),
  )
  return `v${version}.${aBase64(iv)}.${aBase64(new Uint8Array(cifrado))}`
}

export async function descifrar(env: Bindings, contexto: string, sobre: string): Promise<string> {
  const [v, iv, cifrado] = sobre.split('.')
  const version = Number(v?.slice(1))
  const llave = llavesMaestras(env).find((l) => l.version === version)
  if (!llave || !iv || !cifrado) throw new Error(`No hay llave maestra v${version} para descifrar`)
  const claro = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: deBase64(iv), additionalData: new TextEncoder().encode(contexto) },
    await importar(llave.b64),
    deBase64(cifrado),
  )
  return new TextDecoder().decode(claro)
}
