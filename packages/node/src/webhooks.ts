/** Un evento de webhook ya verificado. */
export interface EventoWebhook<D = Record<string, unknown>> {
  id: string
  evento: string
  creado: string
  ambiente: '00' | '01' | null
  organizacion: string
  /** Con Plataforma, los eventos de tus clientes traen `datos.cliente`. */
  datos: D & {
    cliente?: { id: string; externalId: string | null; nombre: string; organizationId: string }
  }
}

export class FirmaInvalida extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmaInvalida'
  }
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Compara dos textos en tiempo constante. */
function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/**
 * Verifica un webhook de Open Factura y devuelve el evento. Lanza `FirmaInvalida` si la firma no
 * coincide o si el envío es más viejo que `toleranciaSegundos` (protege contra repeticiones).
 *
 * @param cuerpoCrudo el cuerpo EXACTO recibido (texto, antes de parsearlo)
 * @param firma el encabezado `OpenFactura-Signature` (`t=…,v1=…`)
 * @param secreto el `whsec_…` del webhook
 */
export async function verificarWebhook<D = Record<string, unknown>>(
  cuerpoCrudo: string,
  firma: string | null | undefined,
  secreto: string,
  opciones: { toleranciaSegundos?: number; ahora?: number } = {},
): Promise<EventoWebhook<D>> {
  if (!firma) throw new FirmaInvalida('Falta el encabezado OpenFactura-Signature')
  const partes = Object.fromEntries(
    firma.split(',').map((p) => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  )
  const t = Number(partes.t)
  const v1 = partes.v1
  if (!Number.isFinite(t) || !v1) throw new FirmaInvalida('Encabezado de firma mal formado')
  const ahora = Math.floor((opciones.ahora ?? Date.now()) / 1000)
  if (Math.abs(ahora - t) > (opciones.toleranciaSegundos ?? 300)) {
    throw new FirmaInvalida('El envío es demasiado viejo (o el reloj está desfasado)')
  }
  const llave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const esperada = hex(
    await crypto.subtle.sign('HMAC', llave, new TextEncoder().encode(`${t}.${cuerpoCrudo}`)),
  )
  if (!igual(esperada, v1)) throw new FirmaInvalida('La firma no coincide')
  return JSON.parse(cuerpoCrudo) as EventoWebhook<D>
}
