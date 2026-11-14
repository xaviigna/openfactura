import { ClienteMH, ErrorConexionMH, type RespuestaMH } from './mh/client'
import { tipoDeDocumento } from './schemas'
import { firmarConCertificado, firmarDte, type CertificadoMH, type LlavePrivada } from './sign'
import type { ArchivoDte, Dte } from './types'
import { asegurarDteValido } from './validate'

export type Firmante = { certificado: CertificadoMH | string; password: string } | { llavePrivada: LlavePrivada }

export const firmar = (dte: Dte, firmante: Firmante) =>
  'llavePrivada' in firmante ? firmarDte(dte, firmante.llavePrivada) : firmarConCertificado(dte, firmante.certificado, firmante.password)

/** El MH rechazó el documento: corrige según `respuesta.observaciones` y reenvía. */
export class DteRechazadoError extends Error {
  constructor(public readonly respuesta: RespuestaMH) {
    super(`DTE rechazado por el MH [${respuesta.codigoMsg ?? '?'}] ${respuesta.descripcionMsg ?? ''}${respuesta.observaciones?.length ? `: ${respuesta.observaciones.join('; ')}` : ''}`)
    this.name = 'DteRechazadoError'
  }
}

/** Agotada la política de reintentos: corresponde operar en contingencia. */
export class ContingenciaRequeridaError extends Error {
  constructor(public readonly intentos: number, options?: ErrorOptions) {
    super(`El MH no respondió tras ${intentos} intentos: emita en contingencia (modelo diferido) y transmita luego el evento de contingencia`, options)
    this.name = 'ContingenciaRequeridaError'
  }
}

export interface ResultadoEmision {
  /** Archivo DTE para entregar al receptor y resguardar: estructura + firmaElectronica + selloRecibido. */
  archivo: ArchivoDte
  /** JWS transmitido. */
  firma: string
  respuesta: RespuestaMH
}

const archivoDte = (dte: Dte, firma: string, sello: string | null): ArchivoDte => ({ ...dte, firmaElectronica: firma, selloRecibido: sello })

/**
 * Transmite un DTE ya firmado aplicando la política de reintentos del Manual
 * Técnico v2 (3.3): si no hay respuesta en 8 s se consulta el estado y, si no
 * fue recibido, se reenvía hasta 2 veces; después corresponde la contingencia.
 */
export async function transmitirDte(cliente: ClienteMH, dte: Dte, firma: string, opciones: { reintentos?: number } = {}): Promise<RespuestaMH> {
  const tipo = tipoDeDocumento(dte)
  if (tipo === 'invalidacion' || tipo === 'contingencia') throw new Error('Los eventos de invalidación y contingencia se transmiten con transmitirEvento()')
  const id = dte.identificacion
  const envio = { version: id.version, tipoDte: tipo, codigoGeneracion: id.codigoGeneracion, documento: firma }
  const reintentos = opciones.reintentos ?? 2
  let ultimoError: unknown
  for (let intento = 0; intento <= reintentos; intento++) {
    try {
      const respuesta = await cliente.recepcionDte(envio)
      if (respuesta.estado !== 'PROCESADO' || !respuesta.selloRecibido) throw new DteRechazadoError(respuesta)
      return respuesta
    } catch (error) {
      if (!(error instanceof ErrorConexionMH)) throw error
      ultimoError = error
      // Antes de reenviar: ¿el MH lo recibió aunque no obtuvimos la respuesta?
      try {
        const estado = await cliente.consultarDte({ nitEmisor: dte.emisor.nit ?? dte.emisor.numDocumento, tipoDte: tipo, codigoGeneracion: id.codigoGeneracion })
        if (estado.estado === 'PROCESADO' && estado.selloRecibido) return estado
      } catch (errorConsulta) {
        if (!(errorConsulta instanceof ErrorConexionMH)) ultimoError = errorConsulta
      }
    }
  }
  throw new ContingenciaRequeridaError(reintentos + 1, { cause: ultimoError })
}

/** Valida, firma y transmite un DTE. Devuelve el archivo sellado. */
export async function emitirDte(cliente: ClienteMH, dte: Dte, firmante: Firmante): Promise<ResultadoEmision> {
  asegurarDteValido(dte)
  const firma = await firmar(dte, firmante)
  const respuesta = await transmitirDte(cliente, dte, firma)
  return { archivo: archivoDte(dte, firma, respuesta.selloRecibido), firma, respuesta }
}

/** Valida y firma sin transmitir: para emitir en contingencia y entregar el DTE transitorio. */
export async function firmarSinTransmitir(dte: Dte, firmante: Firmante): Promise<{ archivo: ArchivoDte; firma: string }> {
  asegurarDteValido(dte)
  const firma = await firmar(dte, firmante)
  return { archivo: archivoDte(dte, firma, null), firma }
}

/** Valida, firma y transmite un evento de invalidación o de contingencia. */
export async function transmitirEvento(cliente: ClienteMH, evento: Dte, firmante: Firmante): Promise<ResultadoEmision> {
  const tipo = tipoDeDocumento(evento)
  asegurarDteValido(evento)
  const firma = await firmar(evento, firmante)
  let respuesta: RespuestaMH
  if (tipo === 'invalidacion') respuesta = await cliente.invalidar({ version: evento.identificacion.version, documento: firma })
  else if (tipo === 'contingencia') respuesta = await cliente.contingencia({ nit: evento.emisor.nit, documento: firma })
  else respuesta = await transmitirDte(cliente, evento, firma)
  if (!respuesta.selloRecibido) throw new DteRechazadoError(respuesta)
  return { archivo: archivoDte(evento, firma, respuesta.selloRecibido), firma, respuesta }
}

/** Arma el archivo DTE (JSON) que la Normativa 2.0 obliga a entregar junto a la representación gráfica. */
export const construirArchivoDte = archivoDte
