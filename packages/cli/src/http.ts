import { type CuerpoError, ErrorApi, ErrorCli } from './errores'

export interface OpcionesCliente {
  url: string
  apiKey: string
  version: string
  fetch?: typeof fetch
  timeoutMs?: number
  /** Prefijo de las rutas. Por defecto `/api/v1`; `alta` usa `/api/admin`. */
  base?: string
}

export interface Peticion {
  query?: Record<string, string | number | undefined | null>
  cuerpo?: unknown
  headers?: Record<string, string>
}

export interface Respuesta<T> {
  status: number
  headers: Headers
  datos: T
}

/** La emisión puede tardar ~50 s cuando el MH responde lento. */
const TIEMPO_LIMITE_MS = 60_000

/** Cliente HTTP de la API REST (`/api/v1`). Es el único módulo que habla con el servidor. */
export class ClienteApi {
  readonly url: string
  private readonly opciones: OpcionesCliente

  constructor(opciones: OpcionesCliente) {
    this.opciones = opciones
    this.url = opciones.url
  }

  async pedir<T = unknown>(
    metodo: string,
    ruta: string,
    peticion: Peticion = {},
  ): Promise<Respuesta<T>> {
    const respuesta = await this.enviar(metodo, ruta, peticion)
    const texto = await respuesta.text()
    let datos: unknown = null
    if (texto) {
      try {
        datos = JSON.parse(texto)
      } catch {
        throw new ErrorCli(
          `El servidor respondió algo que no es JSON (HTTP ${respuesta.status}). Revisa la URL: ${this.url}`,
          'respuesta_invalida',
        )
      }
    }
    return { status: respuesta.status, headers: respuesta.headers, datos: datos as T }
  }

  /** Descarga binaria (PDF). */
  async descargar(ruta: string): Promise<Uint8Array> {
    const respuesta = await this.enviar('GET', ruta, {})
    return new Uint8Array(await respuesta.arrayBuffer())
  }

  private async enviar(
    metodo: string,
    ruta: string,
    { query, cuerpo, headers }: Peticion,
  ): Promise<Response> {
    const destino = new URL(`${this.url}${this.opciones.base ?? '/api/v1'}${ruta}`)
    for (const [clave, valor] of Object.entries(query ?? {})) {
      if (valor !== undefined && valor !== null && valor !== '')
        destino.searchParams.set(clave, String(valor))
    }
    const { apiKey, version, timeoutMs = TIEMPO_LIMITE_MS } = this.opciones
    const hacerFetch = this.opciones.fetch ?? fetch

    let respuesta: Response
    try {
      respuesta = await hacerFetch(destino, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': `openfactura-cli/${version}`,
          Accept: 'application/json',
          ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const nombre = (error as Error)?.name
      if (nombre === 'TimeoutError' || nombre === 'AbortError') {
        throw new ErrorCli(
          `El servidor no respondió en ${Math.round(timeoutMs / 1000)} s (${this.url})`,
          'tiempo_agotado',
        )
      }
      const causa = (error as { cause?: { code?: string; message?: string } })?.cause
      const detalle = causa?.code || causa?.message || (error as Error)?.message || 'error de red'
      throw new ErrorCli(`No se pudo conectar con ${this.url} (${detalle})`, 'sin_conexion')
    }

    if (!respuesta.ok) throw await leerError(respuesta)
    return respuesta
  }
}

async function leerError(respuesta: Response): Promise<ErrorApi> {
  const texto = await respuesta.text().catch(() => '')
  let cuerpo: CuerpoError | null = null
  try {
    const json = JSON.parse(texto) as Partial<CuerpoError> | null
    const e = json?.error
    if (e && typeof e.code === 'string' && typeof e.message === 'string') {
      cuerpo = {
        error: {
          code: e.code,
          message: e.message,
          ...(e.details === undefined ? {} : { details: e.details }),
        },
      }
    }
  } catch {
    // No es JSON: se informa el estado HTTP.
  }
  cuerpo ??= {
    error: {
      code: `http_${respuesta.status}`,
      message: `El servidor respondió HTTP ${respuesta.status}${respuesta.statusText ? ` ${respuesta.statusText}` : ''}`,
    },
  }
  const espera = Number.parseInt(respuesta.headers.get('Retry-After') ?? '', 10)
  return new ErrorApi(respuesta.status, cuerpo, Number.isFinite(espera) ? espera : null)
}
