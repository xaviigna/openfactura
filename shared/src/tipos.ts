export type Ambiente = '00' | '01'
export type EstadoDte = 'pendiente' | 'procesado' | 'rechazado' | 'contingencia' | 'invalidado'
export type ModoClave = 'test' | 'live'

/** Tipos de DTE que la plataforma construye a partir de datos simples. */
export const TIPOS_DTE = {
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
} as const
export type TipoDteSoportado = keyof typeof TIPOS_DTE

export const NOMBRE_ESTADO: Record<EstadoDte, string> = {
  pendiente: 'Pendiente',
  procesado: 'Procesado',
  rechazado: 'Rechazado',
  contingencia: 'En contingencia',
  invalidado: 'Invalidado',
}

export const NOMBRE_AMBIENTE: Record<Ambiente, string> = { '00': 'Pruebas', '01': 'Producción' }

/** Forma de todo error de la API. */
export interface ErrorApi {
  error: { code: string; message: string; details?: unknown }
}

export interface Problema {
  ruta: string
  mensaje: string
  regla?: string
}

/**
 * Pruebas satisfactorias mínimas que exige el MH para autorizar a un emisor del Sistema de
 * Transmisión (Manual Funcional, sección XXIV). Por tipo de DTE y por evento.
 */
export const MINIMOS_MH = {
  dte: {
    '01': 90,
    '03': 75,
    '04': 50,
    '05': 50,
    '06': 25,
    '07': 50,
    '08': 75,
    '09': 50,
    '11': 90,
    '14': 25,
    '15': 25,
  },
  evento: { invalidacion: 5, contingencia: 5, retorno: 5, operaciones_especiales: 5 },
} as const
