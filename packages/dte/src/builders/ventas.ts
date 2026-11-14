import { IVA, r2, r8, sumar } from '../money'
import type { Apendice, Contexto, DocumentoRelacionado, Dte } from '../types'
import {
  calcularLineas, camposLinea, consolidarTributos, construirApendice, construirEmisor, construirIdentificacion, construirPagos,
  construirReceptorIdentificado, construirRelacionados, normalizarDocumento, normalizarNit, normalizarNrc, totalEnLetras, totalizarVentas, totalYSaldo,
  type CondicionPago, type DescuentosGlobales, type ItemInput, type Receptor
} from './comun'

interface VentaBase extends CondicionPago {
  items: ItemInput[]
  descuentos?: DescuentosGlobales
  documentosRelacionados?: DocumentoRelacionado[]
  observaciones?: string | null
  apendice?: Apendice[]
  /** Secciones avanzadas: se envían tal cual (ver estructura oficial). */
  otrosDocumentos?: unknown[] | null
  ventaTercero?: { nit: string | null; nombre: string; codDomiciliado: number | null } | null
}

// ---------------------------------------------------------------------------
// 01 · Factura (consumidor final) — precios CON IVA

export interface FacturaInput extends VentaBase {
  /** Opcional bajo el monto legal; sin receptor se envía null. */
  receptor?: Receptor | null
  /** Retención de IVA 1%: `true` la calcula sobre la base neta, o indica el monto. */
  retencionIva?: boolean | number
}

/** Monto (USD) desde el cual la Factura debe identificar al receptor. */
export const MONTO_IDENTIFICACION_RECEPTOR = 25_000

export function construirFactura(ctx: Contexto, input: FacturaInput): Dte {
  const lineas = calcularLineas(input.items, { preciosConIva: true, ivaComoTributo: false })
  const t = totalizarVentas(lineas, input.descuentos)
  const { tributos, totalTributos } = consolidarTributos(lineas, t.factorGravada)
  const baseNeta = (t.totalGravada - t.descuGravada) / (1 + IVA)
  const ivaRete = r2(input.retencionIva === true ? baseNeta * 0.01 : input.retencionIva || 0)
  const montoTotalOperacion = r2(t.subTotal + totalTributos)
  const { totalPagar, saldoFavor } = totalYSaldo(montoTotalOperacion - ivaRete + t.totalNoGravado)
  const ivaItems = lineas.map(l => r8(l.baseNeta * IVA))
  const r = input.receptor
  const tipoDocumento = r ? (r.tipoDocumento ?? (r.nit ? '36' : null)) : null
  // Bajo 25,000 no se debe exigir identificación al consumidor final (aviso DGII 05/09/2024); desde ese monto es requerida (Anexo IV, campos 38-42).
  if (montoTotalOperacion >= MONTO_IDENTIFICACION_RECEPTOR && !(tipoDocumento && (r?.numDocumento ?? r?.nit) && r?.nombre)) {
    throw new Error(`Factura por ${montoTotalOperacion} USD: desde ${MONTO_IDENTIFICACION_RECEPTOR} USD el receptor requiere tipoDocumento, numDocumento y nombre`)
  }

  return {
    identificacion: construirIdentificacion('01', ctx),
    documentoRelacionado: construirRelacionados(input.documentosRelacionados),
    emisor: construirEmisor(ctx.emisor),
    receptor: r
      ? {
          tipoDocumento,
          numDocumento: normalizarDocumento(tipoDocumento, r.numDocumento ?? r.nit),
          nrc: normalizarNrc(r.nrc),
          nombre: r.nombre ?? null,
          codActividad: r.codActividad ?? null,
          descActividad: r.descActividad ?? null,
          direccion: r.direccion ?? null,
          telefono: r.telefono ?? null,
          correo: r.correo ?? null
        }
      : null,
    otrosDocumentos: input.otrosDocumentos ?? null,
    ventaTercero: input.ventaTercero ?? null,
    cuerpoDocumento: lineas.map((l, i) => ({ ...camposLinea(l), psv: r8(l.entrada.psv ?? 0), noGravado: l.noGravado, ivaItem: ivaItems[i]! })),
    resumen: {
      totalNoSuj: t.totalNoSuj,
      totalExenta: t.totalExenta,
      totalGravada: t.totalGravada,
      subTotalVentas: t.subTotalVentas,
      descuNoSuj: t.descuNoSuj,
      descuExenta: t.descuExenta,
      descuGravada: t.descuGravada,
      porcentajeDescuento: t.porcentajeDescuento,
      totalDescu: t.totalDescu,
      tributos,
      subTotal: t.subTotal,
      ivaRete,
      montoTotalOperacion,
      totalNoGravado: t.totalNoGravado,
      totalPagar,
      totalLetras: totalEnLetras(totalPagar),
      // Σ IVA por ítem − IVA del descuento global a ventas gravadas (Anexo IV, campo 157).
      totalIva: r2(sumar(ivaItems) - (t.descuGravada / (1 + IVA)) * IVA),
      saldoFavor,
      ...construirPagos(input, totalPagar, saldoFavor),
      observaciones: input.observaciones ?? null
    },
    apendice: construirApendice(input.apendice)
  }
}

// ---------------------------------------------------------------------------
// 03 · Comprobante de Crédito Fiscal — precios SIN IVA

export interface CreditoFiscalInput extends VentaBase {
  receptor: Receptor
  /** Percepción de IVA 1% (emisor gran contribuyente). */
  percepcionIva?: boolean | number
  /** Retención de IVA 1% (receptor gran contribuyente). */
  retencionIva?: boolean | number
}

function receptorContribuyente(r: Receptor) {
  const nit = r.nit ?? r.numDocumento
  if (!nit || !r.nrc || !r.nombre || !r.codActividad || !r.descActividad || !r.direccion) throw new Error('El receptor de un CCF requiere nit, nrc, nombre, codActividad, descActividad y direccion')
  return {
    nit: normalizarNit(nit),
    nrc: normalizarNrc(r.nrc),
    nombre: r.nombre,
    codActividad: r.codActividad,
    descActividad: r.descActividad,
    nombreComercial: r.nombreComercial ?? null,
    direccion: r.direccion,
    telefono: r.telefono ?? null,
    correo: r.correo ?? null
  }
}

export function construirCreditoFiscal(ctx: Contexto, input: CreditoFiscalInput): Dte {
  const lineas = calcularLineas(input.items, { preciosConIva: false, ivaComoTributo: true })
  const t = totalizarVentas(lineas, input.descuentos)
  const { tributos, totalTributos } = consolidarTributos(lineas, t.factorGravada)
  const baseNeta = t.totalGravada - t.descuGravada
  const uno = (v?: boolean | number) => r2(v === true ? baseNeta * 0.01 : v || 0)
  const ivaPerci = uno(input.percepcionIva)
  const ivaRete = uno(input.retencionIva)
  const montoTotalOperacion = r2(t.subTotal + totalTributos)
  const { totalPagar, saldoFavor } = totalYSaldo(montoTotalOperacion + ivaPerci - ivaRete + t.totalNoGravado)

  return {
    identificacion: construirIdentificacion('03', ctx),
    documentoRelacionado: construirRelacionados(input.documentosRelacionados),
    emisor: construirEmisor(ctx.emisor),
    receptor: receptorContribuyente(input.receptor),
    otrosDocumentos: input.otrosDocumentos ?? null,
    ventaTercero: input.ventaTercero ?? null,
    cuerpoDocumento: lineas.map(l => ({ ...camposLinea(l), psv: r8(l.entrada.psv ?? 0), noGravado: l.noGravado })),
    resumen: {
      totalNoSuj: t.totalNoSuj,
      totalExenta: t.totalExenta,
      totalGravada: t.totalGravada,
      subTotalVentas: t.subTotalVentas,
      descuNoSuj: t.descuNoSuj,
      descuExenta: t.descuExenta,
      descuGravada: t.descuGravada,
      porcentajeDescuento: t.porcentajeDescuento,
      totalDescu: t.totalDescu,
      tributos,
      subTotal: t.subTotal,
      ivaPerci,
      ivaRete,
      montoTotalOperacion,
      totalNoGravado: t.totalNoGravado,
      totalPagar,
      totalLetras: totalEnLetras(totalPagar),
      saldoFavor,
      ...construirPagos(input, totalPagar, saldoFavor),
      observaciones: input.observaciones ?? null
    },
    apendice: construirApendice(input.apendice)
  }
}

// ---------------------------------------------------------------------------
// 05 / 06 · Nota de Crédito y Nota de Débito — ajustan un CCF (o CR)

export interface NotaInput {
  receptor: Receptor
  /** Documentos que se ajustan (1 a 50). Cada ítem debe indicar su `numeroDocumento`. */
  documentosRelacionados: DocumentoRelacionado[]
  /** Los descuentos globales del documento original se informan aquí por ítem (Manual Funcional, XVIII). */
  items: ItemInput[]
  percepcionIva?: boolean
  retencionIva?: boolean
  /** CAT-016. Por defecto 1. */
  condicionOperacion?: 1 | 2 | 3
  /** CAT-006: sólo cuando se ajusta un Comprobante de Retención. */
  codigoRetencionMH?: string | null
  observaciones?: string | null
  apendice?: Apendice[]
  ventaTercero?: { nit: string | null; nombre: string; codDomiciliado: number | null } | null
  /** NIT del contribuyente absorbido (fusiones). */
  fusion?: string | null
  /** Sólo Nota de Débito. */
  numPagoElectronico?: string | null
}

function construirNota(tipoDte: '05' | '06', ctx: Contexto, input: NotaInput): Dte {
  if (!input.documentosRelacionados?.length) throw new Error('Una nota requiere al menos un documento relacionado')
  const unico = input.documentosRelacionados.length === 1 ? input.documentosRelacionados[0]!.numeroDocumento : null
  const items = input.items.map(item => ({ ...item, numeroDocumento: item.numeroDocumento ?? unico }))
  if (items.some(i => !i.numeroDocumento)) throw new Error('Con varios documentos relacionados, cada ítem debe indicar su numeroDocumento')

  const lineas = calcularLineas(items, { preciosConIva: false, ivaComoTributo: true })
  const t = totalizarVentas(lineas)
  const { tributos, totalTributos } = consolidarTributos(lineas)
  // «IVA 13 %» (campos 100 y 146) sólo aplica al ajustar un Comprobante de Retención (07). Al ajustar
  // un CCF el IVA va como tributo 20 y este campo es 0: con otro valor el MH responde
  // `[resumen.totalIva] CALCULO INCORRECTO`.
  const ajustaRetencion = input.documentosRelacionados.every(d => d.tipoDocumento === '07')
  const cuerpo = lineas.map(l => ({
    ...camposLinea(l),
    noGravado: l.noGravado,
    ivaPerci: r8(input.percepcionIva ? l.ventaGravada * 0.01 : 0),
    totalIva: ajustaRetencion ? r8(l.ventaGravada * IVA) : 0,
    ivaRete: r8(input.retencionIva ? l.ventaGravada * 0.01 : 0)
  }))
  const ivaPerci = r2(sumar(cuerpo.map(c => c.ivaPerci)))
  const ivaRete = r2(sumar(cuerpo.map(c => c.ivaRete)))
  const montoTotalOperacion = r2(t.subTotalVentas + totalTributos)
  const totalPagar = r2(montoTotalOperacion + ivaPerci - ivaRete + t.totalNoGravado)
  if (totalPagar < 0) throw new Error('El total a pagar de la nota no puede ser negativo')

  return {
    identificacion: construirIdentificacion(tipoDte, ctx, { fusion: input.fusion ?? null }),
    documentoRelacionado: input.documentosRelacionados,
    emisor: construirEmisor(ctx.emisor, { conCodigos: false }),
    receptor: construirReceptorIdentificado(input.receptor),
    ventaTercero: input.ventaTercero ?? null,
    cuerpoDocumento: cuerpo,
    resumen: {
      totalNoSuj: t.totalNoSuj,
      totalExenta: t.totalExenta,
      totalGravada: t.totalGravada,
      subTotalVentas: t.subTotalVentas,
      totalDescu: r2(sumar(lineas.map(l => l.montoDescu))),
      tributos,
      montoTotalOperacion,
      ivaPerci,
      totalIva: r2(sumar(cuerpo.map(c => c.totalIva))),
      ivaRete,
      totalNoGravado: t.totalNoGravado,
      totalPagar,
      totalLetras: totalEnLetras(totalPagar),
      condicionOperacion: input.condicionOperacion ?? 1,
      ...(tipoDte === '06' ? { numPagoElectronico: input.numPagoElectronico ?? null } : {}),
      observaciones: input.observaciones ?? null,
      codigoRetencionMH: input.codigoRetencionMH ?? null
    },
    apendice: construirApendice(input.apendice)
  }
}

export const construirNotaCredito = (ctx: Contexto, input: NotaInput) => construirNota('05', ctx, input)
export const construirNotaDebito = (ctx: Contexto, input: NotaInput) => construirNota('06', ctx, input)

// ---------------------------------------------------------------------------
// 04 · Nota de Remisión — traslado de bienes, precios SIN IVA

export interface NotaRemisionInput {
  receptor: Receptor
  /** CAT-025: 01 depósito, 02 propiedad, 03 consignación, 04 traslado, 05 otros. */
  bienTitulo: string
  items: ItemInput[]
  descuentos?: DescuentosGlobales
  documentosRelacionados?: DocumentoRelacionado[]
  observaciones?: string | null
  apendice?: Apendice[]
  ventaTercero?: { nit: string | null; nombre: string; codDomiciliado: number | null } | null
}

export function construirNotaRemision(ctx: Contexto, input: NotaRemisionInput): Dte {
  const lineas = calcularLineas(input.items, { preciosConIva: false, ivaComoTributo: true })
  const t = totalizarVentas(lineas, input.descuentos)
  const { tributos, totalTributos } = consolidarTributos(lineas, t.factorGravada)
  const montoTotalOperacion = r2(t.subTotal + totalTributos)
  return {
    identificacion: construirIdentificacion('04', ctx),
    documentoRelacionado: construirRelacionados(input.documentosRelacionados),
    emisor: construirEmisor(ctx.emisor),
    receptor: { ...construirReceptorIdentificado(input.receptor), bienTitulo: input.bienTitulo },
    ventaTercero: input.ventaTercero ?? null,
    cuerpoDocumento: lineas.map(camposLinea),
    resumen: {
      totalNoSuj: t.totalNoSuj,
      totalExenta: t.totalExenta,
      totalGravada: t.totalGravada,
      subTotalVentas: t.subTotalVentas,
      descuNoSuj: t.descuNoSuj,
      descuExenta: t.descuExenta,
      descuGravada: t.descuGravada,
      porcentajeDescuento: t.porcentajeDescuento,
      totalDescu: t.totalDescu,
      tributos,
      subTotal: t.subTotal,
      montoTotalOperacion,
      totalLetras: totalEnLetras(montoTotalOperacion),
      observaciones: input.observaciones ?? null
    },
    apendice: construirApendice(input.apendice)
  }
}
