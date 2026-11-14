import type { TipoDte } from './types'

/** UUID v4 en mayúsculas (regla 12 "Código de Generación", Anexo I). */
export function generarCodigoGeneracion(): string {
  return crypto.randomUUID().toUpperCase()
}

const RE_ESTABLECIMIENTO = /^[MBSP]\d{3}$/
const RE_PUNTO_VENTA = /^P\d{3}$/

export interface NumeroControlInput {
  tipoDte: TipoDte
  /** Código MH del establecimiento: M001 (matriz), S002 (sucursal), B003 (bodega), P004 (patio). */
  establecimiento: string
  /** Código MH del punto de venta: P001. */
  puntoVenta: string
  /** Correlativo 1..999999999999999; no debe repetirse en un año calendario. */
  correlativo: number
}

/** DTE-01-M001P001-000000000000001 (31 caracteres; Manual Funcional, XI). */
export function construirNumeroControl({ tipoDte, establecimiento, puntoVenta, correlativo }: NumeroControlInput): string {
  if (!RE_ESTABLECIMIENTO.test(establecimiento)) throw new Error(`Código de establecimiento inválido "${establecimiento}": debe ser M|B|S|P + 3 dígitos (ej. M001)`)
  if (!RE_PUNTO_VENTA.test(puntoVenta)) throw new Error(`Código de punto de venta inválido "${puntoVenta}": debe ser P + 3 dígitos (ej. P001)`)
  if (!Number.isSafeInteger(correlativo) || correlativo < 1 || correlativo > 999_999_999_999_999) throw new Error(`Correlativo inválido: ${correlativo}`)
  return `DTE-${tipoDte}-${establecimiento}${puntoVenta}-${String(correlativo).padStart(15, '0')}`
}

export function parsearNumeroControl(numeroControl: string) {
  const m = /^DTE-(\d{2})-([MBSP]\d{3})(P\d{3})-(\d{15})$/.exec(numeroControl)
  if (!m) return null
  return { tipoDte: m[1] as TipoDte, establecimiento: m[2]!, puntoVenta: m[3]!, correlativo: Number(m[4]) }
}

/** El Salvador es UTC-6 todo el año (sin horario de verano). */
const OFFSET_SV_MS = -6 * 60 * 60 * 1000

/** Fecha y hora locales de El Salvador para fecEmi / horEmi. */
export function fechaHoraSV(fecha: Date = new Date()): { fecha: string; hora: string } {
  const iso = new Date(fecha.getTime() + OFFSET_SV_MS).toISOString()
  return { fecha: iso.slice(0, 10), hora: iso.slice(11, 19) }
}

/** URL del QR de consulta pública (Manual Técnico v2, sección 5). */
export function urlConsultaPublica(ambiente: '00' | '01', codigoGeneracion: string, fechaEmision: string): string {
  return `https://admin.factura.gob.sv/consultaPublica?ambiente=${ambiente}&codGen=${codigoGeneracion}&fechaEmi=${fechaEmision}`
}
