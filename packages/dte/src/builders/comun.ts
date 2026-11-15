import { esTributoInformativo, nombreTributo } from '../catalogs'
import { construirNumeroControl, fechaHoraSV, generarCodigoGeneracion } from '../ids'
import { numeroALetras } from '../letras'
import { IVA, r2, r8, sumar } from '../money'
import { VERSIONES, type Apendice, type Contexto, type Direccion, type DocumentoRelacionado, type Emisor, type Pago, type TipoDte } from '../types'

// ---------------------------------------------------------------------------
// Entradas compartidas

export type TipoVenta = 'gravada' | 'exenta' | 'noSujeta'

export interface ItemInput {
  descripcion: string
  cantidad: number
  /** Precio unitario. En Factura (01) incluye IVA; en CCF, notas y remisión va sin IVA. */
  precioUni: number
  /** CAT-011: 1 bien, 2 servicio, 3 ambos, 4 otros tributos por ítem. Por defecto 1. */
  tipoItem?: 1 | 2 | 3 | 4
  codigo?: string | null
  /** CAT-014. Por defecto 59 (Unidad). */
  uniMedida?: number
  /** Descuento total de la línea (no por unidad). */
  descuento?: number
  /** Por defecto 'gravada'. */
  tipoVenta?: TipoVenta
  /**
   * Tributos adicionales al IVA (CAT-015). 59, 71, D1 y C8 se calculan solos;
   * para el resto indica el valor: `{ codigo: 'C5', valor: 6.4 }`.
   */
  tributos?: Array<string | { codigo: string; valor: number }>
  /** Tributo sujeto a cálculo de IVA (CAT-015 sección 2), para ítems tipo 4. */
  codTributo?: string | null
  /** Precio sugerido de venta (informativo). */
  psv?: number
  /** Cargo (+) o abono (−) que no afecta la base imponible. */
  noGravado?: number
  /** Código de generación / número del documento relacionado a esta línea. */
  numeroDocumento?: string | null
}

export interface Receptor {
  /** CAT-022: 36 NIT, 13 DUI, 03 pasaporte, 02 carné de residente, 37 otro. */
  tipoDocumento?: string | null
  numDocumento?: string | null
  /** Atajo para contribuyentes: equivale a tipoDocumento 36. */
  nit?: string | null
  nrc?: string | null
  nombre?: string | null
  codActividad?: string | null
  descActividad?: string | null
  nombreComercial?: string | null
  direccion?: Direccion | null
  telefono?: string | null
  correo?: string | null
}

export interface DescuentosGlobales {
  gravada?: number
  exenta?: number
  noSujeta?: number
  /** Si se indica, se aplica a los tres tipos de venta y se informa en porcentajeDescuento. */
  porcentaje?: number
}

export interface CondicionPago {
  /** CAT-016: 1 contado (defecto), 2 crédito, 3 otro. */
  condicionOperacion?: 1 | 2 | 3
  /** Si se omite: contado en efectivo por el total a pagar. */
  pagos?: Pago[]
  /** Plazo del crédito cuando condicionOperacion = 2 y no se envían `pagos`. */
  credito?: { /** CAT-018: 01 días, 02 meses, 03 años */ plazo: string; periodo: number }
  numPagoElectronico?: string | null
}

// ---------------------------------------------------------------------------
// Secciones comunes

const soloAlfanumerico = (texto: string) => texto.replace(/[^0-9A-Za-z]/g, '')

/** NIT, DUI y NRC viajan sin guiones (Normativa 2.0, Anexo IV). */
export function normalizarDocumento(tipoDocumento: string | null | undefined, numero: string | null | undefined): string | null {
  if (!numero) return null
  return tipoDocumento === '36' || tipoDocumento === '13' ? soloAlfanumerico(numero) : numero.trim()
}
export const normalizarNit = (nit: string) => soloAlfanumerico(nit)
export const normalizarNrc = (nrc: string | null | undefined) => (nrc ? soloAlfanumerico(nrc) : null)

export function construirIdentificacion(tipoDte: TipoDte, ctx: Contexto, extra: Record<string, unknown> = {}) {
  const { fecha, hora } = fechaHoraSV(ctx.fecha)
  const enContingencia = !!ctx.contingencia
  if (ctx.contingencia?.tipo === 5 && !ctx.contingencia.motivo) throw new Error('El tipo de contingencia 5 (otro) requiere indicar el motivo')
  return {
    version: VERSIONES[tipoDte],
    ambiente: ctx.ambiente,
    tipoDte,
    numeroControl: construirNumeroControl({ tipoDte, establecimiento: ctx.emisor.codEstableMH, puntoVenta: ctx.emisor.codPuntoVentaMH, correlativo: ctx.correlativo }),
    codigoGeneracion: ctx.codigoGeneracion ?? generarCodigoGeneracion(),
    // Modelo previo + transmisión normal, o diferido + contingencia (Manual Funcional, VIII).
    tipoModelo: enContingencia ? 2 : 1,
    tipoOperacion: enContingencia ? 2 : 1,
    tipoContingencia: ctx.contingencia?.tipo ?? null,
    motivoContin: ctx.contingencia?.motivo ?? null,
    fecEmi: fecha,
    horEmi: hora,
    tipoMoneda: 'USD' as const,
    ...extra
  }
}

/**
 * Identificación de los DTE que no admiten modelo diferido ni contingencia (CLE, DCLE y CDE,
 * Normativa 2.0): sus esquemas no tienen tipoContingencia ni motivoContin.
 */
export function construirIdentificacionSinContingencia(tipoDte: TipoDte, ctx: Contexto, extra: Record<string, unknown> = {}) {
  if (ctx.contingencia) throw new Error(`El DTE ${tipoDte} no puede emitirse en contingencia`)
  const { tipoContingencia: _t, motivoContin: _m, ...identificacion } = construirIdentificacion(tipoDte, ctx, extra)
  return identificacion
}

export function construirEmisor(emisor: Emisor, opciones: { conCodigos?: boolean } = { conCodigos: true }) {
  return {
    nit: normalizarNit(emisor.nit),
    nrc: normalizarNrc(emisor.nrc),
    nombre: emisor.nombre,
    codActividad: emisor.codActividad,
    descActividad: emisor.descActividad,
    nombreComercial: emisor.nombreComercial ?? null,
    direccion: emisor.direccion,
    telefono: emisor.telefono,
    correo: emisor.correo,
    ...(opciones.conCodigos ? { codEstable: emisor.codEstable ?? emisor.codEstableMH, codPuntoVenta: emisor.codPuntoVenta ?? emisor.codPuntoVentaMH } : {})
  }
}

/** Receptor con documento de identificación (NC, ND, NR, CR). */
export function construirReceptorIdentificado(r: Receptor) {
  const tipoDocumento = r.tipoDocumento ?? (r.nit ? '36' : null)
  const numDocumento = normalizarDocumento(tipoDocumento, r.numDocumento ?? r.nit)
  if (!tipoDocumento || !numDocumento) throw new Error('El receptor requiere tipoDocumento y numDocumento (o nit)')
  if (!r.nombre) throw new Error('El receptor requiere nombre')
  return {
    tipoDocumento,
    numDocumento,
    nrc: normalizarNrc(r.nrc),
    nombre: r.nombre,
    codActividad: r.codActividad ?? null,
    descActividad: r.descActividad ?? null,
    nombreComercial: r.nombreComercial ?? null,
    direccion: r.direccion ?? null,
    telefono: r.telefono ?? null,
    correo: r.correo ?? null
  }
}

export const construirRelacionados = (docs?: DocumentoRelacionado[] | null) => (docs?.length ? docs : null)
export const construirApendice = (apendice?: Apendice[] | null) => (apendice?.length ? apendice : null)

// ---------------------------------------------------------------------------
// Cálculo de líneas

/** Tributos cuyo valor depende del monto (se reducen con el descuento global). */
const TRIBUTOS_PORCENTUALES: Record<string, number> = { '20': IVA, C3: 0, '59': 0.05 }
/** Tributos de monto fijo por unidad. */
const TRIBUTOS_POR_UNIDAD: Record<string, number> = { '71': 7, D1: 0.2, C8: 0.1 }

export interface LineaCalculada {
  numItem: number
  entrada: ItemInput
  tipoVenta: TipoVenta
  ventaNoSuj: number
  ventaExenta: number
  ventaGravada: number
  montoDescu: number
  noGravado: number
  /** Base imponible de la línea, sin IVA. */
  baseNeta: number
  /** Códigos de tributo de la línea (null si no aplica ninguno). */
  tributos: string[] | null
  /** Valor de cada tributo de la línea, sin redondear a 2 decimales. */
  valoresTributo: Record<string, number>
}

export interface OpcionesLineas {
  /** Factura: los precios ya incluyen IVA. */
  preciosConIva: boolean
  /** Agregar el tributo 20 a toda línea gravada (CCF, NC, ND, NR). */
  ivaComoTributo: boolean
}

export function calcularLineas(items: ItemInput[], { preciosConIva, ivaComoTributo }: OpcionesLineas): LineaCalculada[] {
  if (!items.length) throw new Error('El documento requiere al menos un ítem')
  return items.map((entrada, i) => {
    const tipoVenta = entrada.tipoVenta ?? 'gravada'
    const montoDescu = r8(entrada.descuento ?? 0)
    const noGravado = r8(entrada.noGravado ?? 0)
    const venta = r8(entrada.cantidad * entrada.precioUni - montoDescu)
    if (venta < 0) throw new Error(`Ítem ${i + 1}: el descuento (${montoDescu}) supera el valor de la línea`)
    const gravada = tipoVenta === 'gravada' ? venta : 0
    const baseNeta = preciosConIva ? gravada / (1 + IVA) : gravada

    const valoresTributo: Record<string, number> = {}
    if (gravada > 0 && ivaComoTributo) valoresTributo['20'] = baseNeta * IVA
    for (const t of entrada.tributos ?? []) {
      const codigo = typeof t === 'string' ? t : t.codigo
      if (typeof t !== 'string') valoresTributo[codigo] = t.valor
      else if (codigo in TRIBUTOS_PORCENTUALES) valoresTributo[codigo] = baseNeta * TRIBUTOS_PORCENTUALES[codigo]!
      else if (codigo in TRIBUTOS_POR_UNIDAD) valoresTributo[codigo] = entrada.cantidad * TRIBUTOS_POR_UNIDAD[codigo]!
      else throw new Error(`Ítem ${i + 1}: indica el valor del tributo ${codigo} como { codigo: '${codigo}', valor }`)
    }
    const codigos = Object.keys(valoresTributo)
    return {
      numItem: i + 1,
      entrada,
      tipoVenta,
      ventaNoSuj: tipoVenta === 'noSujeta' ? venta : 0,
      ventaExenta: tipoVenta === 'exenta' ? venta : 0,
      ventaGravada: gravada,
      montoDescu,
      noGravado,
      baseNeta,
      tributos: codigos.length ? codigos : null,
      valoresTributo
    }
  })
}

/** Campos de cuerpo comunes a FE, CCF, NR, NC, ND. */
export function camposLinea(l: LineaCalculada) {
  const e = l.entrada
  return {
    numItem: l.numItem,
    tipoItem: e.tipoItem ?? 1,
    numeroDocumento: e.numeroDocumento ?? null,
    cantidad: r8(e.cantidad),
    codigo: e.codigo ?? null,
    codTributo: e.codTributo ?? null,
    // Cargos/abonos sin precio se informan con unidad 99 (Manual Funcional, XII).
    uniMedida: e.uniMedida ?? (e.precioUni === 0 && l.noGravado !== 0 ? 99 : 59),
    descripcion: e.descripcion,
    precioUni: r8(e.precioUni),
    montoDescu: l.montoDescu,
    ventaNoSuj: l.ventaNoSuj,
    ventaExenta: l.ventaExenta,
    ventaGravada: l.ventaGravada,
    tributos: l.tributos
  }
}

export interface TotalesVentas {
  totalNoSuj: number
  totalExenta: number
  totalGravada: number
  subTotalVentas: number
  descuNoSuj: number
  descuExenta: number
  descuGravada: number
  porcentajeDescuento: number
  /** Descuentos por ítem + descuentos globales (informativo). */
  totalDescu: number
  /** Sumatoria de ventas − descuentos globales. */
  subTotal: number
  totalNoGravado: number
  /** Proporción de la venta gravada que queda tras el descuento global (0..1). */
  factorGravada: number
}

export function totalizarVentas(lineas: LineaCalculada[], descuentos: DescuentosGlobales = {}): TotalesVentas {
  const totalNoSuj = r2(sumar(lineas.map(l => l.ventaNoSuj)))
  const totalExenta = r2(sumar(lineas.map(l => l.ventaExenta)))
  const totalGravada = r2(sumar(lineas.map(l => l.ventaGravada)))
  const pct = descuentos.porcentaje
  const global = (total: number, monto?: number) => r2(pct !== undefined ? (total * pct) / 100 : (monto ?? 0))
  const descuNoSuj = global(totalNoSuj, descuentos.noSujeta)
  const descuExenta = global(totalExenta, descuentos.exenta)
  const descuGravada = global(totalGravada, descuentos.gravada)
  if (descuNoSuj > totalNoSuj || descuExenta > totalExenta || descuGravada > totalGravada) throw new Error('Un descuento global no puede superar el total del tipo de venta al que se aplica')
  const subTotalVentas = r2(totalNoSuj + totalExenta + totalGravada)
  return {
    totalNoSuj,
    totalExenta,
    totalGravada,
    subTotalVentas,
    descuNoSuj,
    descuExenta,
    descuGravada,
    porcentajeDescuento: r2(pct ?? 0),
    totalDescu: r2(sumar(lineas.map(l => l.montoDescu)) + descuNoSuj + descuExenta + descuGravada),
    subTotal: r2(subTotalVentas - descuNoSuj - descuExenta - descuGravada),
    totalNoGravado: r2(sumar(lineas.map(l => l.noGravado))),
    factorGravada: totalGravada > 0 ? (totalGravada - descuGravada) / totalGravada : 1
  }
}

export interface TributosResumen {
  /** Sección `resumen.tributos` (null si ninguna línea lleva tributos). */
  tributos: Array<{ codigo: string; descripcion: string; valor: number }> | null
  /** Suma de los tributos que sí afectan el total (excluye los informativos, sección 3 del CAT-015). */
  totalTributos: number
}

/** Consolida los tributos por código (Manual Funcional, XIV). */
export function consolidarTributos(lineas: LineaCalculada[], factorGravada = 1): TributosResumen {
  const porCodigo = new Map<string, number>()
  for (const l of lineas) {
    for (const [codigo, valor] of Object.entries(l.valoresTributo)) {
      const ajustado = codigo in TRIBUTOS_PORCENTUALES ? valor * factorGravada : valor
      porCodigo.set(codigo, (porCodigo.get(codigo) ?? 0) + ajustado)
    }
  }
  if (!porCodigo.size) return { tributos: null, totalTributos: 0 }
  const tributos = [...porCodigo].map(([codigo, valor]) => ({ codigo, descripcion: nombreTributo(codigo) ?? `Tributo ${codigo}`, valor: r2(valor) }))
  return { tributos, totalTributos: r2(sumar(tributos.filter(t => !esTributoInformativo(t.codigo)).map(t => t.valor))) }
}

/**
 * Reparte un total que podría ser negativo: si los abonos superan el monto, el
 * total a pagar es 0 y la diferencia va a saldoFavor en negativo (Anexo IV, campos 153 y 158).
 */
export function totalYSaldo(total: number): { totalPagar: number; saldoFavor: number } {
  const t = r2(total)
  return t < 0 ? { totalPagar: 0, saldoFavor: t } : { totalPagar: t, saldoFavor: 0 }
}

/** Sección de pagos (Manual Funcional XIX; Anexo IV campos 159-161). */
export function construirPagos(c: CondicionPago, totalPagar: number, saldoFavor = 0) {
  const base = { numPagoElectronico: c.numPagoElectronico ?? null }
  const pago = (p: Pago) => ({ codigo: p.codigo, montoPago: r2(p.montoPago), referencia: p.referencia ?? null, plazo: p.plazo ?? null, periodo: p.periodo ?? null })
  if (c.pagos?.length) return { condicionOperacion: c.condicionOperacion ?? 1, pagos: c.pagos.map(pago), ...base }
  // Total 0 o saldo a favor: condición contado con forma de pago 99 (otros).
  if (saldoFavor < 0 || totalPagar === 0) return { condicionOperacion: 1, pagos: [pago({ codigo: '99', montoPago: 0 })], ...base }
  const condicion = c.condicionOperacion ?? 1
  if (condicion === 1) return { condicionOperacion: 1, pagos: [pago({ codigo: '01', montoPago: totalPagar })], ...base }
  if (condicion === 2) {
    if (!c.credito) throw new Error('Operación al crédito: indica `credito: { plazo, periodo }` o el arreglo `pagos`')
    // A crédito el código de forma de pago va null y el monto en 0 (Anexo IV, 160.5 y 161.6).
    return { condicionOperacion: 2, pagos: [pago({ codigo: null, montoPago: 0, plazo: c.credito.plazo, periodo: c.credito.periodo })], ...base }
  }
  throw new Error('Condición de operación 3 (otro): indica el arreglo `pagos` con cada forma de pago')
}

export const totalEnLetras = numeroALetras
