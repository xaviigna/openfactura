/**
 * Hash de contraseñas con PBKDF2-SHA256 nativo (WebCrypto).
 *
 * El scrypt en JS puro que Better Auth usa fuera de Node agota la CPU de un Worker, y workerd
 * limita PBKDF2 a 100 000 iteraciones por llamada. Se encadenan RONDAS llamadas (la salida de
 * una es la contraseña de la siguiente) para alcanzar 600 000 iteraciones, la recomendación
 * vigente de OWASP para PBKDF2-HMAC-SHA256.
 *
 * Formato: pbkdf2-sha256$<rondas>$<iteraciones>$<sal hex>$<hash hex>
 */
const ITERACIONES = 100_000
const RONDAS = 6
// Topes al verificar: el costo sale del hash guardado y no debe poder dispararse.
const MAX_RONDAS = 20

const hex = (bytes: Uint8Array) => [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('')
const deHex = (h: string) =>
  new Uint8Array((h.match(/.{2}/g) ?? []).map((x) => Number.parseInt(x, 16)))

async function pbkdf2(
  secreto: Uint8Array<ArrayBuffer>,
  sal: Uint8Array<ArrayBuffer>,
  iteraciones: number,
) {
  const llave = await crypto.subtle.importKey('raw', secreto, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones },
    llave,
    256,
  )
  return new Uint8Array(bits)
}

async function derivar(
  password: string,
  sal: Uint8Array<ArrayBuffer>,
  rondas: number,
  iteraciones: number,
) {
  let salida: Uint8Array<ArrayBuffer> = new Uint8Array(new TextEncoder().encode(password))
  for (let i = 0; i < rondas; i++) salida = await pbkdf2(salida, sal, iteraciones)
  return salida
}

export async function hashPassword(password: string): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivar(password, sal, RONDAS, ITERACIONES)
  return `pbkdf2-sha256$${RONDAS}$${ITERACIONES}$${hex(sal)}$${hex(hash)}`
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string
  password: string
}): Promise<boolean> {
  const [esquema, rondasTexto, iteracionesTexto, sal, esperado] = hash.split('$')
  const rondas = Number(rondasTexto)
  const iteraciones = Number(iteracionesTexto)
  if (
    esquema !== 'pbkdf2-sha256' ||
    !sal ||
    !esperado ||
    !Number.isInteger(rondas) ||
    rondas < 1 ||
    rondas > MAX_RONDAS ||
    !Number.isInteger(iteraciones) ||
    iteraciones < 1 ||
    iteraciones > ITERACIONES
  ) {
    return false
  }
  const obtenido = await derivar(password, deHex(sal), rondas, iteraciones)
  const referencia = deHex(esperado)
  if (obtenido.length !== referencia.length) return false
  let diferencia = 0
  for (let i = 0; i < obtenido.length; i++) diferencia |= obtenido[i]! ^ referencia[i]!
  return diferencia === 0
}
