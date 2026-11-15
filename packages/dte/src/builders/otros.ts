import { nombreTributo, valorCatalogo } from '../catalogs'
import { r2, r8, sumar } from '../money'
import type { Apendice, Contexto, Direccion, DocumentoRelacionado, Dte } from '../types'
import {
  calcularLineas, construirApendice, construirEmisor, construirIdentificacion, construirIdentificacionSinContingencia, construirPagos, construirReceptorIdentificado, construirRelacionados,
  normalizarDocumento, totalEnLetras, totalYSaldo, type CondicionPago, type ItemInput, type Receptor
} from './comun'

// ---------------------------------------------------------------------------
// 14 · Factura de Sujeto Excluido — el emisor es quien COMPRA

export interface SujetoExcluidoInput extends CondicionPago {
  /** El sujeto excluido (vendedor no contribuyente). */
  sujetoExcluido: { tipoDocumento: string; numDocumento: string; nombre: string; codActividad?: string | null; descActividad?: string | null; direccion: Direccion; telefono?: string | null; correo?: string | null }
  items: Array<Pick<ItemInput, 'descripcion' | 'cantidad' | 'precioUni' | 'tipoItem' | 'codigo' | 'uniMedida' | 'descuento'>>
  /** Descuento global al total de operaciones. */
  descuento?: number
  /** Retención de renta: `true` aplica 10% sobre el subtotal, o indica el monto. */
  retencionRenta?: boolean | number
  observaciones?: string | null
  apendice?: Apendice[]
}

export function construirSujetoExcluido(ctx: Contexto, input: SujetoExcluidoInput): Dte {
  if (!input.items.length) throw new Error('El documento requiere al menos un ítem')
  const cuerpo = input.items.map((e, i) => {
    const montoDescu = r8(e.descuento ?? 0)
    return {
      numItem: i + 1,
      tipoItem: e.tipoItem ?? 1,
      cantidad: r8(e.cantidad),
      codigo: e.codigo ?? null,
      uniMedida: e.uniMedida ?? 59,
      descripcion: e.descripcion,
      precioUni: r8(e.precioUni),
      montoDescu,
      compra: r8(e.cantidad * e.precioUni - montoDescu)
    }
  })
  const totalCompra = r2(sumar(cuerpo.map(c => c.compra)))
  const descu = r2(input.descuento ?? 0)
  const subTotal = r2(totalCompra - descu)
  const reteRenta = r2(input.retencionRenta === true ? subTotal * 0.1 : input.retencionRenta || 0)
  const totalPagar = r2(subTotal - reteRenta)
  const s = input.sujetoExcluido
  const { nombreComercial: _omitido, ...emisor } = construirEmisor(ctx.emisor)

  return {
    identificacion: construirIdentificacion('14', ctx),
    emisor,
    receptor: {
      tipoDocumento: s.tipoDocumento,
      numDocumento: normalizarDocumento(s.tipoDocumento, s.numDocumento),
      nombre: s.nombre,
      codActividad: s.codActividad ?? null,
      descActividad: s.descActividad ?? null,
      direccion: s.direccion,
      telefono: s.telefono ?? null,
      correo: s.correo ?? null
    },
    cuerpoDocumento: cuerpo,
    resumen: {
      totalCompra,
      descu,
      totalDescu: r2(sumar(cuerpo.map(c => c.montoDescu)) + descu),
      subTotal,
      reteRenta,
      totalPagar,
      totalLetras: totalEnLetras(totalPagar),
      ...(({ numPagoElectronico: _n, ...pagos }) => pagos)(construirPagos(input, totalPagar)),
      observaciones: input.observaciones ?? null
    },
    apendice: construirApendice(input.apendice)
  }
}

// ---------------------------------------------------------------------------
// 11 · Factura de Exportación

export interface ExportacionInput extends CondicionPago {
  receptor: {
    nombre: string
    tipoDocumento: string
    numDocumento: string
    /** CAT-020 (ISO 3166-1 alfa-2). */
    codPais: string
    complemento: string
    /** CAT-029: 1 natural, 2 jurídica. */
    tipoPersona: 1 | 2
    descActividad: string
    nombreComercial?: string | null
    telefono?: string | null
    correo?: string | null
  }
  /** CAT-011 aplicado a la exportación: 1 bienes, 2 servicios, 3 ambos. */
  tipoItemExpor: 1 | 2 | 3
  /** CAT-027; null para servicios. */
  recintoFiscal?: string | null
  /** CAT-033 (EX-1, EX-2, EX-3, TA-1); null para servicios. */
  tipoRegimen?: string | null
  /** CAT-028; null para servicios. */
  regimen?: string | null
  items: ItemInput[]
  /** Descuento global a ventas gravadas. */
  descuento?: number
  porcentajeDescuento?: number
  seguro?: number
  flete?: number
  /** CAT-031 */
  codIncoterms?: string | null
  totalNoOnerosas?: number
  documentosRelacionados?: DocumentoRelacionado[]
  otrosDocumentos?: unknown[] | null
  ventaTercero?: { nit: string | null; nombre: string; codDomiciliado: number | null } | null
  compraTercero?: { numDocumento: string; nombre: string } | null
  observaciones?: string | null
  apendice?: Apendice[]
}

export function construirExportacion(ctx: Contexto, input: ExportacionInput): Dte {
  // Exportaciones: IVA 0% (tributo C3) en toda línea gravada.
  const lineas = calcularLineas(input.items.map(i => ({ ...i, tributos: i.tributos ?? ['C3'] })), { preciosConIva: false, ivaComoTributo: false })
  const totalGravada = r2(sumar(lineas.map(l => l.ventaGravada)))
  const descuGravada = r2(input.descuento ?? 0)
  const seguro = r2(input.seguro ?? 0)
  const flete = r2(input.flete ?? 0)
  const totalNoGravado = r2(sumar(lineas.map(l => l.noGravado)))
  const codigos = [...new Set(lineas.flatMap(l => l.tributos ?? []))]
  const tributos = codigos.length ? codigos.map(codigo => ({ codigo, descripcion: nombreTributo(codigo) ?? codigo, valor: r2(sumar(lineas.map(l => l.valoresTributo[codigo] ?? 0))) })) : null
  const montoTotalOperacion = r2(totalGravada - descuGravada + seguro + flete + sumar((tributos ?? []).filter(t => t.codigo !== 'C3').map(t => t.valor)))
  const { totalPagar, saldoFavor } = totalYSaldo(montoTotalOperacion + totalNoGravado)
  const r = input.receptor
  const nombrePais = valorCatalogo('CAT-020', r.codPais)
  if (!nombrePais) throw new Error(`País desconocido en CAT-020: ${r.codPais}`)

  return {
    identificacion: construirIdentificacion('11', ctx),
    documentoRelacionado: construirRelacionados(input.documentosRelacionados),
    emisor: { ...construirEmisor(ctx.emisor), tipoItemExpor: input.tipoItemExpor, recintoFiscal: input.recintoFiscal ?? null, tipoRegimen: input.tipoRegimen ?? null, regimen: input.regimen ?? null },
    receptor: {
      nombre: r.nombre,
      tipoDocumento: r.tipoDocumento,
      numDocumento: normalizarDocumento(r.tipoDocumento, r.numDocumento),
      descActividad: r.descActividad,
      nombreComercial: r.nombreComercial ?? null,
      codPais: r.codPais,
      nombrePais,
      complemento: r.complemento,
      tipoPersona: r.tipoPersona,
      telefono: r.telefono ?? null,
      correo: r.correo ?? null
    },
    otrosDocumentos: input.otrosDocumentos ?? null,
    ventaTercero: input.ventaTercero ?? null,
    compraTercero: input.compraTercero ?? null,
    cuerpoDocumento: lineas.map(l => ({
      numItem: l.numItem,
      tipoItem: l.entrada.tipoItem ?? 1,
      numeroDocumento: l.entrada.numeroDocumento ?? null,
      cantidad: r8(l.entrada.cantidad),
      codigo: l.entrada.codigo ?? null,
      codTributo: l.entrada.codTributo ?? null,
      uniMedida: l.entrada.uniMedida ?? (l.entrada.precioUni === 0 && l.noGravado !== 0 ? 99 : 59),
      descripcion: l.entrada.descripcion,
      precioUni: r8(l.entrada.precioUni),
      montoDescu: l.montoDescu,
      ventaGravada: l.ventaGravada,
      tributos: l.ventaGravada > 0 ? l.tributos : null,
      noGravado: l.noGravado
    })),
    resumen: {
      totalGravada,
      descuGravada,
      porcentajeDescuento: r2(input.porcentajeDescuento ?? 0),
      totalDescu: r2(sumar(lineas.map(l => l.montoDescu)) + descuGravada),
      seguro,
      flete,
      tributos,
      montoTotalOperacion,
      totalNoGravado,
      totalNoOnerosas: r2(input.totalNoOnerosas ?? 0),
      totalPagar,
      totalLetras: totalEnLetras(totalPagar),
      saldoFavor,
      ...construirPagos(input, totalPagar, saldoFavor),
      codIncoterms: input.codIncoterms ?? null,
      descIncoterms: input.codIncoterms ? (valorCatalogo('CAT-031', input.codIncoterms) ?? null) : null,
      observaciones: input.observaciones ?? null
    },
    apendice: construirApendice(input.apendice)
  }
}

// ---------------------------------------------------------------------------
// 07 · Comprobante de Retención — el emisor es el agente de retención

export interface RetencionInput {
  /** Sujeto de retención. */
  receptor: Receptor
  items: Array<{
    /** Documento sobre el que se retiene; null si no se relaciona ninguno. */
    tipoDte?: string | null
    tipoGeneracion?: 1 | 2 | null
    numeroDocumento?: string | null
    fechaEmision?: string | null
    /** Monto sujeto a retención, sin IVA. */
    montoSujetoGrav: number
    /** CAT-006: 22 (1%), C4 (13%), C9 (otros: indica `ivaRetenido`). */
    codigoRetencionMH: string
    ivaRetenido?: number
    descripcion?: string | null
  }>
  observaciones?: string | null
  apendice?: Apendice[]
  fusion?: string | null
}

const TASA_RETENCION: Record<string, number> = { '22': 0.01, C4: 0.13 }

export function construirRetencion(ctx: Contexto, input: RetencionInput): Dte {
  if (!input.items.length) throw new Error('El documento requiere al menos un ítem')
  const cuerpo = input.items.map((e, i) => {
    const tasa = TASA_RETENCION[e.codigoRetencionMH]
    if (e.ivaRetenido === undefined && tasa === undefined) throw new Error(`Ítem ${i + 1}: indica ivaRetenido para el código de retención ${e.codigoRetencionMH}`)
    return {
      numItem: i + 1,
      tipoDte: e.tipoDte ?? null,
      tipoGeneracion: e.tipoGeneracion ?? null,
      numeroDocumento: e.numeroDocumento ?? null,
      fechaEmision: e.fechaEmision ?? null,
      montoSujetoGrav: r2(e.montoSujetoGrav),
      codigoRetencionMH: e.codigoRetencionMH,
      ivaRetenido: r2(e.ivaRetenido ?? e.montoSujetoGrav * tasa!),
      descripcion: e.descripcion ?? null
    }
  })
  const totalIvaRetenido = r2(sumar(cuerpo.map(c => c.ivaRetenido)))
  return {
    identificacion: construirIdentificacion('07', ctx, { fusion: input.fusion ?? null }),
    emisor: construirEmisor(ctx.emisor),
    receptor: construirReceptorIdentificado(input.receptor),
    cuerpoDocumento: cuerpo,
    resumen: {
      totalSujetoRetencion: r2(sumar(cuerpo.map(c => c.montoSujetoGrav))),
      // Campo 157: sólo con el código C4 (retención del 13 %) es «monto sujeto» × 13 %; con los demás va
      // en 0. Con otro valor el MH responde `[resumen.totalIva] CALCULO INCORRECTO`.
      totalIva: r2(sumar(cuerpo.filter(c => c.codigoRetencionMH === 'C4').map(c => c.montoSujetoGrav * 0.13))),
      totalIvaRetenido,
      totalLetras: totalEnLetras(totalIvaRetenido),
      observaciones: input.observaciones ?? null
    },
    apendice: construirApendice(input.apendice)
  }
}

// ---------------------------------------------------------------------------
// 15 · Comprobante de Donación — el emisor es el donatario y el receptor, el donante

export interface DonacionInput {
  /** Donante. */
  receptor: Receptor & {
    /** CAT-032: 1 domiciliado (defecto), 2 no domiciliado. */
    codDomiciliado?: 1 | 2
    /** CAT-020. Por defecto SV. */
    codPais?: string
  }
  /**
   * Resolución que autoriza al donatario (art. 6 LISR): obligatoria, de 1 a 10 documentos.
   * Ej.: `{ descripcion: 'Resolución', detalle: 'RES-01-2026' }`.
   */
  documentosAsociados: Array<{ descripcion: string; detalle: string }>
  items: Array<{
    /** CAT-026: 1 efectivo, 2 bien, 3 servicio. */
    tipoDonacion: 1 | 2 | 3
    descripcion: string
    /** En efectivo la cantidad es 1. */
    cantidad?: number
    valorUni: number
    /** Depreciación del bien donado, que se resta del valor. */
    depreciacion?: number
    codigo?: string | null
    /** CAT-014. Por defecto 99 (otra). */
    uniMedida?: number
  }>
  /**
   * Formas de pago de lo donado en efectivo (CAT-017). Si se omite: 01 por el total en efectivo.
   * Con una sola forma de pago el monto puede omitirse: se toma el total en efectivo.
   */
  pagos?: Array<{ codigo: string; montoPago?: number; referencia?: string | null }>
  apendice?: Apendice[]
}

export function construirDonacion(ctx: Contexto, input: DonacionInput): Dte {
  if (!input.items.length) throw new Error('El comprobante de donación requiere al menos un ítem')
  if (input.items.length > 2000) throw new Error('El comprobante de donación admite hasta 2000 ítems')
  const asociados = input.documentosAsociados
  if (!asociados.length || asociados.length > 10) throw new Error('Indica de 1 a 10 documentos asociados (la resolución del donatario)')
  const cuerpo = input.items.map((e, i) => {
    const cantidad = e.cantidad ?? 1
    if (e.tipoDonacion === 1 && cantidad !== 1) throw new Error(`Ítem ${i + 1}: una donación en efectivo lleva cantidad 1`)
    const depreciacion = e.depreciacion ?? 0
    // Anexo IV, campo 94: (valor unitario × cantidad) − depreciación, mayor que $0.00.
    const valor = r8(e.valorUni * cantidad - depreciacion)
    if (!(e.valorUni > 0) || !(cantidad > 0) || depreciacion < 0 || !(valor > 0)) throw new Error(`Ítem ${i + 1}: el valor donado debe ser mayor que 0`)
    return {
      numItem: i + 1,
      tipoDonacion: e.tipoDonacion,
      cantidad: r8(cantidad),
      codigo: e.codigo ?? null,
      uniMedida: e.uniMedida ?? 99,
      descripcion: e.descripcion,
      tipoDepreciacion: r8(depreciacion),
      valorUni: r8(e.valorUni),
      valor
    }
  })
  const valorTotal = r2(sumar(cuerpo.map(c => c.valor)))
  const efectivo = r2(sumar(cuerpo.filter(c => c.tipoDonacion === 1).map(c => c.valor)))
  // Formas de pago sólo para lo donado en efectivo; sin efectivo la sección va null (campos 160-162).
  const pagos = efectivo > 0
    ? (input.pagos?.length ? input.pagos : [{ codigo: '01', montoPago: efectivo }]).map(p => ({ codigo: p.codigo, montoPago: r2(p.montoPago ?? (input.pagos?.length === 1 ? efectivo : 0)), referencia: p.codigo === '01' ? null : (p.referencia ?? null) }))
    : null
  if (pagos && r2(sumar(pagos.map(p => p.montoPago))) !== efectivo) throw new Error(`Las formas de pago deben sumar lo donado en efectivo (${efectivo.toFixed(2)})`)
  const r = construirReceptorIdentificado(input.receptor)
  const codDomiciliado = input.receptor.codDomiciliado ?? 1
  // El esquema admite null, pero el MH rechaza el comprobante de un donante domiciliado sin estos
  // datos («#/receptor/codActividad contiene un valor inválido»).
  if (codDomiciliado === 1 && (!r.codActividad || !r.descActividad || !r.direccion)) {
    throw new Error('El donante domiciliado requiere actividad económica y dirección')
  }
  const { nit, codEstable, codPuntoVenta, ...emisor } = construirEmisor(ctx.emisor)
  return {
    identificacion: construirIdentificacionSinContingencia('15', ctx),
    // El donatario se identifica sólo con NIT (36) y su NRC va null (Anexo IV, campos 19-21).
    emisor: { tipoDocumento: '36', numDocumento: nit, ...emisor, nrc: null, codEstable, codPuntoVenta },
    receptor: {
      tipoDocumento: r.tipoDocumento,
      numDocumento: r.numDocumento,
      nrc: r.nrc,
      nombre: r.nombre,
      // Un donante no domiciliado no informa actividad económica (campo 43).
      codActividad: codDomiciliado === 2 ? null : r.codActividad,
      descActividad: codDomiciliado === 2 ? null : r.descActividad,
      direccion: r.direccion,
      telefono: r.telefono,
      correo: r.correo,
      codDomiciliado,
      codPais: input.receptor.codPais ?? 'SV'
    },
    otrosDocumentos: asociados.map(d => ({ codDocAsociado: 1, descDocumento: d.descripcion, detalleDocumento: d.detalle })),
    cuerpoDocumento: cuerpo,
    resumen: { valorTotal, totalLetras: totalEnLetras(valorTotal), pagos },
    apendice: construirApendice(input.apendice)
  }
}
