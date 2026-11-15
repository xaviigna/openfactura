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
 * ¿El MH rechazó el envío porque ya tiene un registro con ese dato? Fuente: el simulador incluido
 * (`mh/mock.ts`), que responde `004 … YA EXISTE UN REGISTRO CON ESE VALOR` tanto para el código de
 * generación como para el número de control. El código y el texto exactos del MH real NO están
 * verificados ni figuran en la documentación del repositorio; por eso basta cualquiera de los dos
 * y quien decide es la consulta de estado, nunca este filtro.
 */
const esRechazoPorDuplicado = (r: RespuestaMH) => r.codigoMsg === '004' || /YA EXISTE/i.test(`${r.descripcionMsg ?? ''} ${r.observaciones?.join(' ') ?? ''}`)

/**
 * Transmite un DTE ya firmado aplicando la política de reintentos del Manual
 * Técnico v2 (3.3): si no hay respuesta en 8 s se consulta el estado y, si no
 * fue recibido, se reenvía hasta 2 veces; después corresponde la contingencia.
 * Si un envío se rechaza porque el documento ya existe en el MH (un reenvío tras
 * una respuesta perdida), se consulta su estado y se devuelve el sello ya otorgado:
 * no se retransmite ni se da por rechazado lo que ya tiene respuesta de recepción
 * (Normativa 2.0, regla 10).
 */
export async function transmitirDte(cliente: ClienteMH, dte: Dte, firma: string, opciones: { reintentos?: number } = {}): Promise<RespuestaMH> {
  const tipo = tipoDeDocumento(dte)
  if (tipo === 'invalidacion' || tipo === 'contingencia') throw new Error('Los eventos de invalidación y contingencia se transmiten con transmitirEvento()')
  const id = dte.identificacion
  const envio = { version: id.version, tipoDte: tipo, codigoGeneracion: id.codigoGeneracion, documento: firma }
  const reintentos = opciones.reintentos ?? 2
  const consultar = () => cliente.consultarDte({ nitEmisor: dte.emisor.nit ?? dte.emisor.numDocumento, tipoDte: tipo, codigoGeneracion: id.codigoGeneracion })
  const sellado = (r: RespuestaMH | null) => !!r && r.estado === 'PROCESADO' && !!r.selloRecibido
  let ultimoError: unknown
  for (let intento = 0; intento <= reintentos; intento++) {
    try {
      const respuesta = await cliente.recepcionDte(envio)
      if (sellado(respuesta)) return respuesta
      // Si la consulta no confirma el sello (o falla), el rechazo se propaga tal cual.
      const estado = esRechazoPorDuplicado(respuesta) ? await consultar().catch(() => null) : null
      if (estado && sellado(estado)) return estado
      throw new DteRechazadoError(respuesta)
    } catch (error) {
      if (!(error instanceof ErrorConexionMH)) throw error
      ultimoError = error
      // Antes de reenviar: ¿el MH lo recibió aunque no obtuvimos la respuesta?
      try {
        const estado = await consultar()
        if (sellado(estado)) return estado
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
