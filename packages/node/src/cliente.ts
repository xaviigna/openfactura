import { type IdOperacion, type Operaciones, RUTAS } from './generado'

/** Error de la API con su código (contrato público: `dte_rechazado`, `plan_requerido`…). */
export class OpenFacturaError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  /** Segundos que hay que esperar (429), si el servidor lo indicó. */
  readonly retryAfter: number | null
  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown,
    retryAfter: number | null,
  ) {
    super(message)
    this.name = 'OpenFacturaError'
    this.status = status
    this.code = code
    this.details = details
    this.retryAfter = retryAfter
  }
}

export interface OpcionesCliente {
  /** Clave de API (`of_test_…` o `of_live_…`). */
  apiKey: string
  /** Por defecto Open Factura Cloud; quien aloja su servidor pasa su URL. */
  url?: string
  /** Reintentos ante 429, 5xx o fallas de red (sólo lo que es seguro repetir). Por defecto 2. */
  reintentos?: number
  /** Tiempo límite por petición. Por defecto 60 s (Hacienda puede tardar). */
  timeoutMs?: number
  fetch?: typeof fetch
}

export const URL_CLOUD = 'https://app.openfactura.co'

type Op<K extends IdOperacion> = Operaciones[K]
type Llamada<K extends IdOperacion> = ([Op<K>['params']] extends [never]
  ? { params?: never }
  : { params: Op<K>['params'] }) &
  ([Op<K>['query']] extends [never] ? { query?: never } : { query?: Op<K>['query'] }) &
  ([Op<K>['cuerpo']] extends [never] ? { cuerpo?: never } : { cuerpo: Op<K>['cuerpo'] }) & {
    /** Clave de idempotencia (emisión y eventos). Si falta, se genera una por llamada. */
    idempotencyKey?: string
  }

const IDEMPOTENTES = new Set(['GET', 'PUT', 'DELETE'])
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** El transporte: arma la ruta, firma con la clave, reintenta con cuidado y traduce errores. */
export class Transporte {
  readonly url: string
  constructor(private readonly o: OpcionesCliente) {
    if (!/^of_(test|live)_\S+$/.test(o.apiKey)) {
      throw new TypeError('apiKey debe empezar con of_test_ o of_live_')
    }
    this.url = (o.url ?? URL_CLOUD).replace(/\/+$/, '')
  }

  /** Otra clave, mismas opciones (p. ej. la de un cliente de Plataforma). */
  conClave(apiKey: string): Transporte {
    return new Transporte({ ...this.o, apiKey })
  }

  get esProduccion(): boolean {
    return this.o.apiKey.startsWith('of_live_')
  }

  async llamar<K extends IdOperacion>(id: K, l: Llamada<K>): Promise<Op<K>['respuesta']> {
    const { metodo, ruta, binaria } = RUTAS[id]
    const params = (l.params ?? {}) as Record<string, string>
    const camino = ruta.replace(/:(\w+)/g, (_, n: string) => {
      const v = params[n]
      if (v === undefined || v === '') throw new TypeError(`Falta el parámetro «${n}» de ${id}`)
      return encodeURIComponent(v)
    })
    const destino = new URL(`${this.url}${camino}`)
    for (const [k, v] of Object.entries((l.query ?? {}) as Record<string, unknown>)) {
      if (v !== undefined && v !== null) destino.searchParams.set(k, String(v))
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.o.apiKey}`,
      Accept: binaria ? 'application/pdf' : 'application/json',
      'User-Agent': 'openfactura-node/0.1.0',
    }
    const cuerpo = (l as { cuerpo?: unknown }).cuerpo
    if (cuerpo !== undefined) headers['Content-Type'] = 'application/json'
    // POST de emisión y eventos: siempre con clave de idempotencia, la misma en cada reintento,
    // así un reintento nunca emite dos veces.
    const idempotente =
      IDEMPOTENTES.has(metodo) ||
      ruta.startsWith('/api/v1/dte') ||
      ruta.startsWith('/api/v1/eventos')
    if (metodo === 'POST' && idempotente) {
      headers['Idempotency-Key'] = l.idempotencyKey ?? crypto.randomUUID()
    }
    const intentos = 1 + (idempotente ? (this.o.reintentos ?? 2) : 0)
    let ultimo: unknown
    for (let i = 0; i < intentos; i++) {
      let r: Response
      try {
        r = await (this.o.fetch ?? fetch)(destino, {
          method: metodo,
          headers,
          body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
          signal: AbortSignal.timeout(this.o.timeoutMs ?? 60_000),
        })
      } catch (error) {
        ultimo = error
        if (i < intentos - 1) await espera(500 * 2 ** i)
        continue
      }
      if (r.ok) {
        if (binaria) return (await r.arrayBuffer()) as Op<K>['respuesta']
        const texto = await r.text()
        return (texto ? JSON.parse(texto) : null) as Op<K>['respuesta']
      }
      const retry = Number(r.headers.get('Retry-After'))
      const error = await this.error(r, Number.isFinite(retry) ? retry : null)
      if ((r.status === 429 || r.status >= 500) && i < intentos - 1) {
        ultimo = error
        await espera(error.retryAfter !== null ? error.retryAfter * 1000 : 500 * 2 ** i)
        continue
      }
      throw error
    }
    throw ultimo instanceof Error ? ultimo : new Error(String(ultimo))
  }

  private async error(r: Response, retryAfter: number | null): Promise<OpenFacturaError> {
    let datos: { error?: { code?: string; message?: string; details?: unknown } } = {}
    try {
      datos = (await r.json()) as typeof datos
    } catch {}
    return new OpenFacturaError(
      r.status,
      datos.error?.code ?? `http_${r.status}`,
      datos.error?.message ?? `HTTP ${r.status}`,
      datos.error?.details,
      retryAfter,
    )
  }
}
