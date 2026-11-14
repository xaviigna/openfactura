/**
 * Firma electrónica de DTE: JWS compacto con RS512 (RSASSA-PKCS1-v1_5 + SHA-512),
 * equivalente al firmador oficial `svfe-api-firmador` (jose4j). Usa WebCrypto, por
 * lo que funciona en Node 20+, Cloudflare Workers, Deno y navegadores.
 */

const codificador = new TextEncoder()
const decodificador = new TextDecoder()
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' } as const

export function base64ABytes(base64: string): Uint8Array<ArrayBuffer> {
  const binario = atob(base64.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, ''))
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return bytes
}

export function bytesABase64(bytes: Uint8Array): string {
  let binario = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binario)
}

const base64Url = (bytes: Uint8Array) => bytesABase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function sha512Hex(texto: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-512', codificador.encode(texto)))
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// Certificado del MH (.crt): XML <CertificadoMH> con las llaves en base64.

export interface CertificadoMH {
  nit: string
  /** Llave privada PKCS#8 (DER). */
  llavePrivada: Uint8Array<ArrayBuffer>
  /** Llave pública SPKI (DER), si viene en el archivo. */
  llavePublica: Uint8Array<ArrayBuffer> | null
  /** SHA-512 (hex) de la contraseña de la llave privada. */
  hashClavePrivada: string
}

const etiqueta = (xml: string, nombre: string) => new RegExp(`<${nombre}>([\\s\\S]*?)</${nombre}>`).exec(xml)?.[1]?.trim()

/** Lee el archivo .crt descargado del portal de Hacienda. */
export function leerCertificadoMH(xml: string): CertificadoMH {
  const privada = etiqueta(xml, 'privateKey')
  const nit = etiqueta(xml.replace(/<(privateKey|publicKey|certificate)>[\s\S]*?<\/\1>/g, ''), 'nit')
  const encodied = privada && etiqueta(privada, 'encodied')
  const clave = privada && etiqueta(privada, 'clave')
  if (!nit || !encodied || !clave) throw new Error('Certificado inválido: se esperaba el XML <CertificadoMH> del MH con <nit> y <privateKey><encodied>/<clave>')
  const publica = etiqueta(xml, 'publicKey')
  const publicaB64 = publica && etiqueta(publica, 'encodied')
  return { nit, llavePrivada: base64ABytes(encodied), llavePublica: publicaB64 ? base64ABytes(publicaB64) : null, hashClavePrivada: clave }
}

/** Comprueba la contraseña de la llave privada (igual que el firmador oficial). */
export async function verificarClaveCertificado(certificado: CertificadoMH, password: string): Promise<boolean> {
  return (await sha512Hex(password)) === certificado.hashClavePrivada.toLowerCase()
}

// ---------------------------------------------------------------------------
// Firma

export type LlavePrivada = CryptoKey | Uint8Array<ArrayBuffer> | string

/** Acepta CryptoKey, PKCS#8 DER, base64 o PEM. */
export async function importarLlavePrivada(llave: LlavePrivada): Promise<CryptoKey> {
  if (typeof llave !== 'string' && !(llave instanceof Uint8Array)) return llave
  const der = typeof llave === 'string' ? base64ABytes(llave.replace(/-----[^-]+-----/g, '')) : llave
  return crypto.subtle.importKey('pkcs8', der, ALGORITMO, false, ['sign'])
}

export async function importarLlavePublica(llave: CryptoKey | Uint8Array<ArrayBuffer> | string): Promise<CryptoKey> {
  if (typeof llave !== 'string' && !(llave instanceof Uint8Array)) return llave
  const der = typeof llave === 'string' ? base64ABytes(llave.replace(/-----[^-]+-----/g, '')) : llave
  return crypto.subtle.importKey('spki', der, ALGORITMO, false, ['verify'])
}

/** Firma un DTE/evento y devuelve el JWS compacto que se transmite al MH. */
export async function firmarDte(documento: object | string, llave: LlavePrivada): Promise<string> {
  const contenido = typeof documento === 'string' ? documento : JSON.stringify(documento)
  const porFirmar = `${base64Url(codificador.encode('{"alg":"RS512"}'))}.${base64Url(codificador.encode(contenido))}`
  const firma = await crypto.subtle.sign(ALGORITMO, await importarLlavePrivada(llave), codificador.encode(porFirmar))
  return `${porFirmar}.${base64Url(new Uint8Array(firma))}`
}

/** Firma con el .crt del MH validando la contraseña de la llave privada. */
export async function firmarConCertificado(documento: object | string, certificado: CertificadoMH | string, password: string): Promise<string> {
  const cert = typeof certificado === 'string' ? leerCertificadoMH(certificado) : certificado
  if (!(await verificarClaveCertificado(cert, password))) throw new Error('Contraseña de la llave privada incorrecta')
  return firmarDte(documento, cert.llavePrivada)
}

/** Decodifica el contenido (payload) de un JWS sin verificar la firma. */
export function leerJws<T = any>(jws: string): { encabezado: { alg: string }; contenido: T } {
  const partes = jws.split('.')
  if (partes.length !== 3) throw new Error('JWS inválido: se esperaban 3 segmentos')
  const json = (segmento: string) => JSON.parse(decodificador.decode(base64ABytes(segmento)))
  return { encabezado: json(partes[0]!), contenido: json(partes[1]!) }
}

export async function verificarFirma(jws: string, llavePublica: CryptoKey | Uint8Array<ArrayBuffer> | string): Promise<boolean> {
  const [encabezado, contenido, firma] = jws.split('.')
  if (!encabezado || !contenido || !firma) return false
  return crypto.subtle.verify(ALGORITMO, await importarLlavePublica(llavePublica), base64ABytes(firma), codificador.encode(`${encabezado}.${contenido}`))
}

/** Genera un certificado de PRUEBA con el formato del MH (para desarrollo y tests; no sirve ante Hacienda). */
export async function generarCertificadoPrueba(nit: string, password: string): Promise<{ xml: string; certificado: CertificadoMH }> {
  const par = (await crypto.subtle.generateKey({ ...ALGORITMO, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'])) as CryptoKeyPair
  const privada = bytesABase64(new Uint8Array((await crypto.subtle.exportKey('pkcs8', par.privateKey)) as ArrayBuffer))
  const publica = bytesABase64(new Uint8Array((await crypto.subtle.exportKey('spki', par.publicKey)) as ArrayBuffer))
  const xml = `<CertificadoMH><nit>${nit}</nit><publicKey><keyType>PUBLIC</keyType><algorithm>RSA</algorithm><encodied>${publica}</encodied><format>X.509</format></publicKey><privateKey><keyType>PRIVATE</keyType><algorithm>RSA</algorithm><encodied>${privada}</encodied><format>PKCS#8</format><clave>${await sha512Hex(password)}</clave></privateKey><activo>true</activo></CertificadoMH>`
  return { xml, certificado: leerCertificadoMH(xml) }
}
