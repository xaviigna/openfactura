import { generarCodigoGeneracion } from '../ids'
import type { Ambiente } from '../types'

/** URLs base del Sistema de Transmisión (Manual Técnico v2, sección 4). Sin barra final. */
export const URLS_MH: Record<Ambiente, string> = {
  '00': 'https://apitest.dtes.mh.gob.sv',
  '01': 'https://api.dtes.mh.gob.sv'
}

export interface RespuestaMH {
  estado: 'PROCESADO' | 'RECHAZADO' | 'RECIBIDO' | string
  codigoGeneracion?: string | null
  selloRecibido: string | null
  fhProcesamiento?: string | null
  clasificaMsg?: string | null
  codigoMsg?: string | null
  descripcionMsg?: string | null
  observaciones?: string[] | null
  [campo: string]: unknown
}

export interface RespuestaLote { estado: string; idEnvio: string; codigoLote: string; [campo: string]: unknown }
export interface ResultadoLote { procesados: RespuestaMH[]; rechazados: RespuestaMH[] }

export class ErrorMH extends Error {
  constructor(mensaje: string, public readonly status: number, public readonly cuerpo: unknown) {
    super(mensaje)
    this.name = 'ErrorMH'
  }
}

/** El MH no respondió a tiempo o hubo un fallo de red: aplica la política de reintentos. */
export class ErrorConexionMH extends Error {
  constructor(mensaje: string, options?: ErrorOptions) {
    super(mensaje, options)
    this.name = 'ErrorConexionMH'
  }
}

export interface OpcionesClienteMH {
  ambiente: Ambiente
  /** Usuario de API: el NIT del emisor, sin guiones. */
  usuario: string
  /** Contraseña de API (no la del portal ni la del certificado). */
  password: string
  /** Para apuntar al mock o a un proxy. Por defecto la URL oficial del ambiente. */
  baseUrl?: string
  fetch?: typeof fetch
  userAgent?: string
  /** Umbral de espera de la política de reintentos: 8 s. */
  timeoutMs?: number
  /** Token ya obtenido (dura 24 h en producción, 48 h en pruebas). */
  token?: string
  /** Se invoca al obtener un token nuevo, para guardarlo y reutilizarlo. */
  alRenovarToken?: (token: string) => void | Promise<void>
}

export class ClienteMH {
  readonly ambiente: Ambiente
  private readonly base: string
  private readonly opciones: OpcionesClienteMH
  private token?: string
  private idEnvio = 0

  constructor(opciones: OpcionesClienteMH) {
    this.opciones = opciones
    this.ambiente = opciones.ambiente
    this.base = (opciones.baseUrl ?? URLS_MH[opciones.ambiente]).replace(/\/+$/, '')
    this.token = opciones.token
  }

  private async pedir(ruta: string, init: RequestInit): Promise<{ status: number; cuerpo: any }> {
    const control = new AbortController()
    const temporizador = setTimeout(() => control.abort(), this.opciones.timeoutMs ?? 8000)
    try {
      const respuesta = await (this.opciones.fetch ?? fetch)(`${this.base}${ruta}`, {
        ...init,
        signal: control.signal,
        headers: { 'User-Agent': this.opciones.userAgent ?? 'openfactura-dte/0.1', ...init.headers }
      })
      const texto = await respuesta.text()
      let cuerpo: unknown = texto
      try { cuerpo = JSON.parse(texto) } catch { /* respuesta no JSON */ }
      return { status: respuesta.status, cuerpo }
    } catch (causa) {
      throw new ErrorConexionMH(`Sin respuesta del MH en ${ruta}`, { cause: causa })
    } finally {
      clearTimeout(temporizador)
    }
  }

  /** POST /seguridad/auth — devuelve el token "Bearer …". */
  async autenticar(): Promise<string> {
    const { status, cuerpo } = await this.pedir('/seguridad/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ user: this.opciones.usuario, pwd: this.opciones.password }).toString()
    })
    const token = cuerpo?.body?.token
    if (cuerpo?.status !== 'OK' || typeof token !== 'string') throw new ErrorMH(`Autenticación rechazada por el MH: ${cuerpo?.message ?? cuerpo?.body?.descripcionMsg ?? status}`, status, cuerpo)
    this.token = token.startsWith('Bearer ') ? token : `Bearer ${token}`
    await this.opciones.alRenovarToken?.(this.token)
    return this.token
  }

  private async conToken(ruta: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; cuerpo: any }> {
    const enviar = async () =>
      this.pedir(ruta, {
        method,
        headers: { Authorization: this.token ?? (await this.autenticar()), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    let respuesta = await enviar()
    if (respuesta.status === 401 || respuesta.status === 403) {
      this.token = undefined
      respuesta = await enviar()
    }
    if (respuesta.status >= 500 || typeof respuesta.cuerpo !== 'object' || respuesta.cuerpo === null) throw new ErrorMH(`Respuesta inesperada del MH (${respuesta.status}) en ${ruta}`, respuesta.status, respuesta.cuerpo)
    return respuesta
  }

  /** POST /fesv/recepciondte — transmisión uno a uno. */
  async recepcionDte(envio: { version: number; tipoDte: string; codigoGeneracion: string; documento: string }): Promise<RespuestaMH> {
    return (await this.conToken('/fesv/recepciondte', 'POST', { ambiente: this.ambiente, idEnvio: ++this.idEnvio, ...envio })).cuerpo
  }

  /** POST /fesv/recepcion/consultadte — estado de un DTE transmitido. */
  async consultarDte(consulta: { nitEmisor: string; tipoDte: string; codigoGeneracion: string }): Promise<RespuestaMH> {
    return (await this.conToken('/fesv/recepcion/consultadte', 'POST', { nitEmisor: consulta.nitEmisor, tdte: consulta.tipoDte, codigoGeneracion: consulta.codigoGeneracion })).cuerpo
  }

  /** POST /fesv/recepcionlote — hasta 100 DTE firmados; la respuesta no es inmediata. */
  async recepcionLote(envio: { version: number; nitEmisor: string; documentos: string[] }): Promise<RespuestaLote> {
    if (envio.documentos.length < 1 || envio.documentos.length > 100) throw new Error('Un lote admite de 1 a 100 documentos')
    return (await this.conToken('/fesv/recepcionlote', 'POST', { ambiente: this.ambiente, idEnvio: generarCodigoGeneracion(), ...envio })).cuerpo
  }

  /** GET /fesv/recepcion/consultadtelote/{codigoLote} */
  async consultarLote(codigoLote: string): Promise<ResultadoLote> {
    return (await this.conToken(`/fesv/recepcion/consultadtelote/${codigoLote}`, 'GET')).cuerpo
  }

  /** POST /fesv/anulardte — evento de invalidación firmado. */
  async invalidar(envio: { version: number; documento: string }): Promise<RespuestaMH> {
    return (await this.conToken('/fesv/anulardte', 'POST', { ambiente: this.ambiente, idEnvio: ++this.idEnvio, ...envio })).cuerpo
  }

  /** POST /fesv/contingencia — evento de contingencia firmado. */
  async contingencia(envio: { nit: string; documento: string }): Promise<RespuestaMH> {
    const { cuerpo } = await this.conToken('/fesv/contingencia', 'POST', envio)
    return { ...cuerpo, descripcionMsg: cuerpo.descripcionMsg ?? cuerpo.mensaje, fhProcesamiento: cuerpo.fhProcesamiento ?? cuerpo.fechaHora }
  }
}
