export type Ambiente = '00' | '01'

/** CAT-002: tipos de DTE. */
export type TipoDte = '01' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '11' | '14' | '15'
/** Eventos: no llevan número de control. */
export type TipoEvento = 'invalidacion' | 'contingencia' | '17' | '18'
export type TipoDocumento = TipoDte | TipoEvento

export const NOMBRES_DTE: Record<TipoDocumento, string> = {
  '01': 'Factura',
  '03': 'Comprobante de Crédito Fiscal',
  '04': 'Nota de Remisión',
  '05': 'Nota de Crédito',
  '06': 'Nota de Débito',
  '07': 'Comprobante de Retención',
  '08': 'Comprobante de Liquidación',
  '09': 'Documento Contable de Liquidación',
  '11': 'Factura de Exportación',
  '14': 'Factura de Sujeto Excluido',
  '15': 'Comprobante de Donación',
  '17': 'Evento de Operaciones Especiales',
  '18': 'Evento de Retorno',
  invalidacion: 'Evento de Invalidación',
  contingencia: 'Evento de Contingencia'
}

/** Versión de estructura vigente por documento (Normativa 2.0). */
export const VERSIONES: Record<TipoDocumento, number> = {
  '01': 2, '03': 4, '04': 4, '05': 4, '06': 4, '07': 2, '08': 2, '09': 2, '11': 3, '14': 2, '15': 2,
  '17': 1, '18': 1, invalidacion: 3, contingencia: 4
}

export interface Direccion {
  /** CAT-012 */ departamento: string
  /** CAT-013 */ municipio: string
  /** CAT-008 (nuevo en Normativa 2.0) */ distrito: string
  complemento: string
}

export interface Emisor {
  nit: string
  nrc: string
  nombre: string
  /** CAT-019 */ codActividad: string
  descActividad: string
  nombreComercial?: string | null
  /** CAT-009: 01 sucursal, 02 casa matriz, 04 bodega, 07 patio. */
  tipoEstablecimiento: string
  direccion: Direccion
  telefono: string
  correo: string
  /** Código MH del establecimiento (M001…). Forma parte del número de control. */
  codEstableMH: string
  /** Código MH del punto de venta (P001…). Forma parte del número de control. */
  codPuntoVentaMH: string
  /** Códigos internos del contribuyente (opcionales). */
  codEstable?: string | null
  codPuntoVenta?: string | null
}

export interface Contingencia {
  /** CAT-005 */ tipo: 1 | 2 | 3 | 4 | 5
  /** Obligatorio cuando tipo = 5. */ motivo?: string | null
}

/** Datos comunes para construir cualquier DTE. */
export interface Contexto {
  ambiente: Ambiente
  emisor: Emisor
  /** Correlativo del número de control para este tipo de DTE. */
  correlativo: number
  /** Momento de emisión (por defecto, ahora). Se convierte a hora de El Salvador. */
  fecha?: Date
  /** Si se omite se genera un UUID v4. */
  codigoGeneracion?: string
  /** Emisión en contingencia: modelo diferido + transmisión por contingencia. */
  contingencia?: Contingencia
}

export interface Pago {
  /** CAT-017 */ codigo: string | null
  montoPago: number
  referencia?: string | null
  /** CAT-018 */ plazo?: string | null
  periodo?: number | null
}

export interface Apendice { campo: string; etiqueta: string; valor: string }

export interface DocumentoRelacionado {
  /** CAT-002 */ tipoDocumento: string
  /** CAT-007: 1 físico, 2 electrónico */ tipoGeneracion: 1 | 2
  /** Código de generación (electrónico) o número de documento (físico). */
  numeroDocumento: string
  fechaEmision: string
}

/** Un DTE o evento ya construido (estructura oficial del MH). */
export interface Dte {
  identificacion: {
    version: number
    ambiente: Ambiente
    codigoGeneracion: string
    tipoDte?: TipoDte
    tipoEvento?: '17' | '18'
    numeroControl?: string
    fecEmi?: string
    horEmi?: string
    [campo: string]: unknown
  }
  [seccion: string]: any
}

/** "Archivo DTE" que se entrega al receptor (Manual Técnico v2, 6.5). */
export type ArchivoDte = Dte & { firmaElectronica: string; selloRecibido: string | null }
