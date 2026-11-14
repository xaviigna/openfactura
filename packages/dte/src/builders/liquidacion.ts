import { nombreTributo } from '../catalogs'
import { IVA, r2, r8, sumar } from '../money'
import type { Apendice, Contexto, Direccion, Dte } from '../types'
import { construirApendice, construirEmisor, construirIdentificacionSinContingencia, construirReceptorIdentificado, normalizarNit, normalizarNrc, type Receptor, totalEnLetras } from './comun'

// ---------------------------------------------------------------------------
// 08 · Comprobante de Liquidación — el comisionista liquida al mandante las ventas por cuenta de terceros

export interface LiquidacionInput {
  /** Mandante: el tercero por cuenta de quien se vendió (su NIT va en `numDocumento`). */
  receptor: Receptor & { /** CAT-032: 1 domiciliado, 2 no domiciliado. Por defecto 1. */ codDomiciliado?: 1 | 2 }
  /**
   * Documentos liquidados (1 a 500): F, CCF, NC, ND, FEX o Evento de Retorno (01, 03, 05, 06, 11, 18).
   * Los montos van en positivo, tal como figuran en el documento; el signo lo pone el constructor.
   */
  documentos: Array<{
    tipoDte: '01' | '03' | '05' | '06' | '11' | '18'
    /** CAT-007: 1 físico, 2 electrónico. Por defecto 2. */
    tipoGeneracion?: 1 | 2
    /** Código de generación (electrónico) o correlativo (físico). */
    numeroDocumento: string
    fechaEmision: string
    /** Montos del documento, netos del descuento global. Las gravadas van sin IVA. */
    ventaNoSuj?: number
    ventaExenta?: number
    ventaGravada?: number
    exportaciones?: number
    /** IVA 13 % del documento. Sólo para F y Retorno: en CCF, NC y ND se calcula (gravadas × 13 %). */
    iva?: number
    /** Otros tributos de la sección 1 de CAT-015 aplicados en el documento: 59, 71, D1, C8 o D5. */
    tributos?: Array<{ codigo: string; valor: number }>
    /** IVA percibido en el documento. */
    ivaPercibido?: number
    /** Documento invalidado o anulado: se informa con el signo contrario. */
    anulado?: boolean
    observaciones?: string | null
  }>
  /** CAT-016: 1 contado (defecto), 2 crédito, 3 otro. */
  condicionOperacion?: 1 | 2 | 3
  observaciones?: string | null
  /** NIT de la sociedad fusionada, si la operación viene de una fusión. */
  fusion?: string | null
  apendice?: Apendice[]
}

const TIPOS_LIQUIDABLES = new Set(['01', '03', '05', '06', '11', '18'])
/** NC y Evento de Retorno restan; un documento anulado invierte el signo (Anexo IV, campos 90-93). */
const RESTAN = new Set(['05', '18'])
/** Tributos de CAT-015 sección 1 admitidos en el CLE (Anexo IV, campo 96). */
const TRIBUTOS_CLE = new Set(['20', 'C3', '59', '71', 'D1', 'C8', 'D5'])
const noNegativo = (valor: number) => Math.max(0, r2(valor))

export function construirLiquidacion(ctx: Contexto, input: LiquidacionInput): Dte {
  const docs = input.documentos
  if (!docs.length) throw new Error('El comprobante de liquidación requiere al menos un documento')
  if (docs.length > 500) throw new Error('El comprobante de liquidación admite hasta 500 documentos')
  const otrosTributos = new Map<string, number>()
  const cuerpo = docs.map((d, i) => {
    const n = `Documento ${i + 1}`
    if (!TIPOS_LIQUIDABLES.has(d.tipoDte)) throw new Error(`${n}: el tipo ${d.tipoDte} no se liquida en un CLE (usa 01, 03, 05, 06, 11 o 18)`)
    const montos = [d.ventaNoSuj, d.ventaExenta, d.ventaGravada, d.exportaciones, d.iva, d.ivaPercibido, ...(d.tributos ?? []).map(t => t.valor)]
    if (montos.some(m => m !== undefined && m < 0)) throw new Error(`${n}: indica los montos en positivo; el signo depende del tipo y de \`anulado\``)
    if (d.tipoDte === '11' && (d.ventaNoSuj || d.ventaExenta || d.ventaGravada)) throw new Error(`${n}: una Factura de Exportación se informa sólo en \`exportaciones\``)
    const signo = RESTAN.has(d.tipoDte) !== !!d.anulado ? -1 : 1
    const gravada = d.ventaGravada ?? 0
    const exportaciones = d.exportaciones ?? 0
    const codigos = new Set<string>()
    if (gravada > 0) codigos.add('20')
    if (exportaciones > 0) codigos.add('C3')
    for (const t of d.tributos ?? []) {
      if (!TRIBUTOS_CLE.has(t.codigo) || t.codigo === '20' || t.codigo === 'C3') throw new Error(`${n}: tributo ${t.codigo} no admitido (usa 59, 71, D1, C8 o D5; el IVA se calcula)`)
      codigos.add(t.codigo)
      otrosTributos.set(t.codigo, (otrosTributos.get(t.codigo) ?? 0) + signo * t.valor)
    }
    // FE y Retorno informan el IVA de su resumen; CCF, NC y ND, gravadas × 13 % (campo 102).
    const iva = d.tipoDte === '01' || d.tipoDte === '18' ? (d.iva ?? gravada * IVA) : gravada * IVA
    return {
      numItem: i + 1,
      tipoDte: d.tipoDte,
      tipoGeneracion: d.tipoGeneracion ?? 2,
      numeroDocumento: (d.tipoGeneracion ?? 2) === 2 ? d.numeroDocumento.toUpperCase() : d.numeroDocumento,
      fechaEmision: d.fechaEmision,
      ventaNoSuj: r8(signo * (d.ventaNoSuj ?? 0)),
      ventaExenta: r8(signo * (d.ventaExenta ?? 0)),
      ventaGravada: r8(signo * gravada),
      exportaciones: r8(signo * exportaciones),
      tributos: codigos.size ? [...codigos] : null,
      ivaItem: r8(signo * iva),
      percibido: signo * (d.ivaPercibido ?? 0),
      observaciones: d.observaciones ?? null
    }
  })
  const total = (campo: 'ventaNoSuj' | 'ventaExenta' | 'ventaGravada' | 'exportaciones') => r2(sumar(cuerpo.map(c => c[campo])))
  const totalNoSuj = total('ventaNoSuj')
  const totalExenta = total('ventaExenta')
  const totalGravada = total('ventaGravada')
  const exportacion = total('exportaciones')
  // Si lo que resta supera a lo que suma, la suma de operaciones y cada tributo van en $0.00 (campos 129 y 138).
  const subTotalVentas = noNegativo(totalNoSuj + totalExenta + totalGravada + exportacion)
  const usados = new Set(cuerpo.flatMap(c => c.tributos ?? []))
  const tributos = [...usados].map(codigo => ({
    codigo,
    descripcion: nombreTributo(codigo) ?? `Tributo ${codigo}`,
    valor: codigo === '20' ? noNegativo(totalGravada * IVA) : codigo === 'C3' ? 0 : noNegativo(otrosTributos.get(codigo) ?? 0)
  }))
  const montoTotalOperacion = r2(subTotalVentas + sumar(tributos.map(t => t.valor)))
  const ivaPerci = noNegativo(sumar(cuerpo.map(c => c.percibido)))
  const totalLiquidado = noNegativo(montoTotalOperacion + ivaPerci)
  return {
    identificacion: construirIdentificacionSinContingencia('08', ctx, { fusion: input.fusion ? normalizarNit(input.fusion) : null }),
    emisor: construirEmisor(ctx.emisor),
    receptor: liquidacionReceptor(input.receptor),
    cuerpoDocumento: cuerpo.map(({ percibido: _p, ...c }) => c),
    resumen: {
      totalNoSuj,
      totalExenta,
      totalGravada,
      exportacion,
      subTotalVentas,
      tributos: tributos.length ? tributos : null,
      montoTotalOperacion,
      ivaPerci,
      total: totalLiquidado,
      totalLetras: totalEnLetras(totalLiquidado),
      // Con total en $0.00 la condición debe ser contado (campo 159).
      condicionOperacion: totalLiquidado === 0 ? 1 : (input.condicionOperacion ?? 1),
      observaciones: input.observaciones ?? null
    },
    apendice: construirApendice(input.apendice)
  }
}

function liquidacionReceptor(r: LiquidacionInput['receptor']) {
  const { tipoDocumento, numDocumento, nrc, nombre, codActividad, descActividad, nombreComercial, direccion, telefono, correo } = construirReceptorIdentificado(r)
  if (!codActividad || !descActividad) throw new Error('El mandante requiere codActividad y descActividad')
  if (!direccion) throw new Error('El mandante requiere dirección')
  return { tipoDocumento, numDocumento, codDomiciliado: r.codDomiciliado ?? 1, nrc, nombre, codActividad, descActividad, nombreComercial, direccion, telefono, correo }
}

// ---------------------------------------------------------------------------
// 09 · Documento Contable de Liquidación — el agente perceptor liquida al afiliado

export interface DocumentoContableInput {
  /** Afiliado. */
  receptor: {
    nit: string
    nrc?: string | null
    nombre: string
    /** CAT-019 */ codActividad: string
    descActividad: string
    nombreComercial?: string | null
    /** CAT-009: 01 sucursal, 02 casa matriz (defecto), 04 bodega, 07 patio. */
    tipoEstablecimiento?: string
    direccion?: Direccion | null
    telefono?: string | null
    correo: string
  }
  /** Periodo liquidado (AAAA-MM-DD). */
  periodo: { inicio: string; fin: string }
  /** Valor de las operaciones a liquidar, IVA incluido. */
  valorOperaciones: number
  /** Valores no sujetos a percepción y su descripción. */
  montoSinPercepcion?: number | null
  descripSinPercepcion?: string | null
  /** Comisión cobrada al afiliado, sin IVA. Si se omite, `porcentComision` × valor de las operaciones. */
  comision?: number
  porcentComision?: number
  /** Código interno de la liquidación. */
  codLiquidacion?: string | null
  cantidadDoc?: number | null
  observaciones?: string | null
  /** Responsable de la liquidación (sección extensión). */
  entrega: { nombre: string; documento: string; codEmpleado?: string | null }
  apendice?: Apendice[]
}

/** Percepción de IVA del 2 % (Normativa 2.0, Anexo IV, campo 117). */
const PERCEPCION = 0.02

export function construirDocumentoContableLiquidacion(ctx: Contexto, input: DocumentoContableInput): Dte {
  const { periodo, receptor: r } = input
  if (!r.nit) throw new Error('El afiliado requiere NIT')
  if (!r.correo) throw new Error('El afiliado requiere correo electrónico')
  if (!r.codActividad || !r.descActividad) throw new Error('El afiliado requiere codActividad y descActividad')
  if (periodo.fin < periodo.inicio) throw new Error('La fecha fin del periodo no puede anteceder a la fecha de inicio')
  const valorOperaciones = r2(input.valorOperaciones)
  const montoSinPercepcion = input.montoSinPercepcion == null ? null : r2(input.montoSinPercepcion)
  const porcentComision = r2(input.porcentComision ?? 0)
  if (porcentComision < 0 || porcentComision > 100) throw new Error('El porcentaje de comisión debe estar entre 0 y 100')
  // Anexo IV, campos 114-121.
  const subTotal = r2(valorOperaciones - (montoSinPercepcion ?? 0))
  const montoSujetoPercepcion = r2(subTotal / (1 + IVA))
  const iva = r2(subTotal - montoSujetoPercepcion)
  const ivaPercibido = r2(montoSujetoPercepcion * PERCEPCION)
  const comision = r2(input.comision ?? (valorOperaciones * porcentComision) / 100)
  const ivaComision = r2(comision * IVA)
  const liquidoApagar = r2(valorOperaciones - comision - ivaPercibido - ivaComision)
  const positivos = { valorOperaciones, subTotal, iva, montoSujetoPercepcion, ivaPercibido, liquidoApagar }
  for (const [campo, valor] of Object.entries(positivos)) {
    if (!(valor > 0)) throw new Error(`${campo} debe ser mayor que 0 (resultó ${valor})`)
  }
  if (comision < 0) throw new Error('La comisión no puede ser negativa')
  return {
    identificacion: construirIdentificacionSinContingencia('09', ctx),
    emisor: construirEmisor(ctx.emisor),
    receptor: {
      nit: normalizarNit(r.nit),
      nrc: normalizarNrc(r.nrc),
      nombre: r.nombre,
      codActividad: r.codActividad,
      descActividad: r.descActividad,
      nombreComercial: r.nombreComercial ?? null,
      tipoEstablecimiento: r.tipoEstablecimiento ?? '02',
      direccion: r.direccion ?? null,
      telefono: r.telefono ?? null,
      correo: r.correo
    },
    cuerpoDocumento: {
      periodoLiquidacionFechaInicio: periodo.inicio,
      periodoLiquidacionFechaFin: periodo.fin,
      codLiquidacion: input.codLiquidacion ?? null,
      cantidadDoc: input.cantidadDoc ?? null,
      valorOperaciones,
      montoSinPercepcion,
      descripSinPercepcion: input.descripSinPercepcion ?? null,
      subTotal,
      iva,
      montoSujetoPercepcion,
      ivaPercibido,
      comision,
      porcentComision,
      ivaComision,
      liquidoApagar,
      totalLetras: totalEnLetras(liquidoApagar),
      observaciones: input.observaciones ?? null
    },
    extension: {
      nombEntrega: input.entrega.nombre,
      docuEntrega: input.entrega.documento,
      codEmpleado: input.entrega.codEmpleado ?? null
    },
    apendice: construirApendice(input.apendice)
  }
}
