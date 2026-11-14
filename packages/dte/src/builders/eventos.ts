import { nombreTributo } from '../catalogs'
import { fechaHoraSV, generarCodigoGeneracion } from '../ids'
import { IVA, r2, r8, sumar } from '../money'
import { limiteRetorno } from '../plazos'
import { VERSIONES, type Ambiente, type Apendice, type Dte, type Emisor } from '../types'
import { calcularLineas, consolidarTributos, construirApendice, type ItemInput, normalizarDocumento, normalizarNit, totalEnLetras, totalYSaldo } from './comun'

export interface Persona { nombre: string; /** CAT-022 */ tipoDocumento: string; numDocumento: string }

// ---------------------------------------------------------------------------
// Evento de Invalidación (v3)

/** Documentos cuyo reemplazo NO se informa aunque el motivo sea 1 o 3 (Manual Funcional, VII). */
const SIN_REEMPLAZO = new Set(['05', '08', '17', '18'])
/** FE, FEXE, FSEE y eventos: la fecha de la invalidación es la del día, no la del documento (Anexo V, campo 9). */
const FECHA_EVENTO_LIBRE = new Set(['01', '11', '14', '17', '18'])

export interface InvalidacionInput {
  ambiente: Ambiente
  emisor: Emisor
  /** El DTE sellado que se invalida. */
  documento: {
    tipoDte: string
    codigoGeneracion: string
    selloRecibido: string
    numeroControl?: string | null
    fecEmi: string
    /** Datos del receptor tal como constan en el DTE (null si no se identificó). */
    tipoDocumento?: string | null
    numDocumento?: string | null
    nombre?: string | null
    telefono?: string | null
    correo?: string | null
  }
  /** CAT-024: 1 error en la información, 2 rescindir la operación, 3 otro. */
  tipoAnulacion: 1 | 2 | 3
  motivoAnulacion?: string | null
  /** Código de generación del DTE que reemplaza al invalidado (requerido para motivos 1 y 3). */
  codigoGeneracionReemplazo?: string | null
  /** Quien realiza la invalidación. */
  responsable: Persona
  /** Quien la solicita. */
  solicitante: Persona
  fecha?: Date
  codigoGeneracion?: string
  fusion?: string | null
}

export function construirInvalidacion(input: InvalidacionInput): Dte {
  const d = input.documento
  const requiereReemplazo = input.tipoAnulacion !== 2 && !SIN_REEMPLAZO.has(d.tipoDte)
  if (requiereReemplazo && !input.codigoGeneracionReemplazo) throw new Error('Los motivos 1 y 3 requieren `codigoGeneracionReemplazo`: primero emita y selle el DTE que corrige la operación')
  if (input.tipoAnulacion === 3 && !input.motivoAnulacion) throw new Error('El motivo 3 (otro) requiere `motivoAnulacion`')
  const { fecha, hora } = fechaHoraSV(input.fecha)
  const persona = (p: Persona) => normalizarDocumento(p.tipoDocumento, p.numDocumento)!
  return {
    identificacion: {
      version: VERSIONES.invalidacion,
      ambiente: input.ambiente,
      codigoGeneracion: input.codigoGeneracion ?? generarCodigoGeneracion(),
      // Para CCF, notas, CR, CL, DCL, NR y CD la fecha del evento es la de generación del DTE.
      fecEmi: FECHA_EVENTO_LIBRE.has(d.tipoDte) ? fecha : d.fecEmi,
      horEmi: hora,
      fusion: input.fusion ?? null
    },
    emisor: {
      nit: normalizarNit(input.emisor.nit),
      nombre: input.emisor.nombre,
      codEstableMH: input.emisor.codEstableMH,
      codEstable: input.emisor.codEstable ?? null,
      codPuntoVentaMH: input.emisor.codPuntoVentaMH,
      codPuntoVenta: input.emisor.codPuntoVenta ?? null,
      telefono: input.emisor.telefono,
      correo: input.emisor.correo
    },
    documento: {
      tipoDte: d.tipoDte,
      codigoGeneracion: d.codigoGeneracion,
      selloRecibido: d.selloRecibido,
      numeroControl: d.numeroControl ?? null,
      fecEmi: d.fecEmi,
      codigoGeneracionR: requiereReemplazo ? input.codigoGeneracionReemplazo! : null,
      tipoDocumento: d.tipoDocumento ?? null,
      numDocumento: normalizarDocumento(d.tipoDocumento, d.numDocumento),
      nombre: d.nombre ?? null,
      telefono: d.telefono ?? null,
      correo: d.correo ?? null
    },
    motivo: {
      tipoAnulacion: input.tipoAnulacion,
      motivoAnulacion: input.motivoAnulacion ?? null,
      nombreResponsable: input.responsable.nombre,
      tipDocResponsable: input.responsable.tipoDocumento,
      numDocResponsable: persona(input.responsable),
      nombreSolicita: input.solicitante.nombre,
      tipDocSolicita: input.solicitante.tipoDocumento,
      numDocSolicita: persona(input.solicitante)
    }
  }
}

/** Extrae de un DTE sellado los datos que pide el evento de invalidación. */
export function documentoParaInvalidar(dte: Dte & { selloRecibido?: string | null }): InvalidacionInput['documento'] {
  if (!dte.selloRecibido) throw new Error('Sólo se puede invalidar un DTE con sello de recepción')
  const id = dte.identificacion
  // En el evento de retorno el receptor viaja en la sección `documento`.
  const r = dte.receptor ?? (id.tipoEvento === '18' ? dte.documento : null) ?? {}
  const tipoDocumento = r.tipoDocumento ?? (r.nit ? '36' : null)
  return {
    tipoDte: (id.tipoDte ?? id.tipoEvento)!,
    codigoGeneracion: id.codigoGeneracion,
    selloRecibido: dte.selloRecibido,
    numeroControl: id.numeroControl ?? null,
    fecEmi: id.fecEmi!,
    tipoDocumento,
    numDocumento: r.numDocumento ?? r.nit ?? null,
    nombre: r.nombre ?? null,
    telefono: r.telefono ?? null,
    correo: r.correo ?? null
  }
}

// ---------------------------------------------------------------------------
// Evento de Contingencia (v4)

export interface ContingenciaInput {
  ambiente: Ambiente
  emisor: Emisor
  responsable: Persona
  /** DTE emitidos en contingencia (1 a 1000). */
  documentos: Array<{ tipoDte: string; codigoGeneracion: string }>
  /** Inicio y fin de la contingencia. */
  inicio: Date
  fin: Date
  /** CAT-005 */
  tipoContingencia: 1 | 2 | 3 | 4 | 5
  /** Obligatorio cuando tipoContingencia = 5. */
  motivoContingencia?: string | null
  fecha?: Date
  codigoGeneracion?: string
}

export function construirContingencia(input: ContingenciaInput): Dte {
  if (!input.documentos.length || input.documentos.length > 1000) throw new Error('El evento de contingencia admite de 1 a 1000 documentos')
  if (input.tipoContingencia === 5 && !input.motivoContingencia) throw new Error('El tipo de contingencia 5 (otro) requiere `motivoContingencia`')
  if (input.fin < input.inicio) throw new Error('La contingencia no puede terminar antes de iniciar')
  const ahora = fechaHoraSV(input.fecha)
  const inicio = fechaHoraSV(input.inicio)
  const fin = fechaHoraSV(input.fin)
  return {
    identificacion: {
      version: VERSIONES.contingencia,
      ambiente: input.ambiente,
      codigoGeneracion: input.codigoGeneracion ?? generarCodigoGeneracion(),
      fTransmision: ahora.fecha,
      hTransmision: ahora.hora
    },
    emisor: {
      nit: normalizarNit(input.emisor.nit),
      nombre: input.emisor.nombre,
      nombreResponsable: input.responsable.nombre,
      tipoDocResponsable: input.responsable.tipoDocumento,
      numeroDocResponsable: normalizarDocumento(input.responsable.tipoDocumento, input.responsable.numDocumento)!,
      tipoEstablecimiento: input.emisor.tipoEstablecimiento,
      codEstableMH: input.emisor.codEstableMH,
      codPuntoVentaMH: input.emisor.codPuntoVentaMH,
      telefono: input.emisor.telefono,
      correo: input.emisor.correo
    },
    detalleDTE: input.documentos.map((d, i) => ({ noItem: i + 1, tipoDoc: d.tipoDte, codigoGeneracion: d.codigoGeneracion })),
    motivo: {
      fInicio: inicio.fecha,
      fFin: fin.fecha,
      hInicio: inicio.hora,
      hFin: fin.hora,
      tipoContingencia: input.tipoContingencia,
      motivoContingencia: input.motivoContingencia ?? null
    }
  }
}

// ---------------------------------------------------------------------------
// Evento de Retorno (18, v1) — Manual Funcional X; Normativa 2.0, Anexo V

/** DTE a los que se aplica un retorno: FE, FEXE y FSEE. */
const RETORNABLES = new Set(['01', '11', '14'])

export interface ItemRetorno extends Pick<ItemInput, 'descripcion' | 'cantidad' | 'precioUni' | 'tipoItem' | 'codigo' | 'uniMedida' | 'descuento' | 'tipoVenta' | 'tributos' | 'codTributo' | 'psv' | 'noGravado'> {
  /** Código de generación del DTE al que pertenece el bien. Puede omitirse si se retorna un solo DTE. */
  codigoGeneracion?: string
  /** Sólo FEXE. */
  seguro?: number
  flete?: number
}

export interface RetornoInput {
  ambiente: Ambiente
  emisor: Emisor
  /**
   * DTE sellados (1 a 50) del mismo tipo — FE (01), FEXE (11) o FSEE (14) —, mismo emisor y receptor.
   * El receptor, los terceros y los datos de exportación del evento se copian de ellos.
   */
  documentos: Array<Dte & { selloRecibido?: string | null }>
  /**
   * Bienes que se retornan. En FE `precioUni` incluye IVA, como en la factura; en FEXE y FSEE va sin IVA.
   * Las retenciones (IVA 1 % en FE, renta 10 % en FSEE) se aplican si el DTE original las tuvo.
   */
  items: ItemRetorno[]
  /** Sólo FEXE: operaciones no onerosas (informativo). */
  totalNoOnerosas?: number
  apendice?: Apendice[]
  /** Contingencia por fuerza mayor (modelo diferido). */
  contingencia?: { tipo: 1 | 2 | 3 | 4 | 5; motivo?: string | null }
  /** Fecha del evento (por defecto, ahora). */
  fecha?: Date
  codigoGeneracion?: string
  fusion?: string | null
}

const mismo = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function construirRetorno(input: RetornoInput): Dte {
  const docs = input.documentos
  if (!docs.length || docs.length > 50) throw new Error('El evento de retorno se aplica a entre 1 y 50 DTE')
  if (!input.items.length || input.items.length > 2000) throw new Error('El evento de retorno admite de 1 a 2000 ítems')
  const tipo = docs[0]!.identificacion.tipoDte!
  if (!RETORNABLES.has(tipo)) throw new Error('El evento de retorno sólo se aplica a Factura (01), Factura de Exportación (11) o Sujeto Excluido (14)')
  const original = docs[0]!
  const nit = normalizarNit(input.emisor.nit)
  const { fecha, hora } = fechaHoraSV(input.fecha)
  const ahora = input.fecha ?? new Date()
  for (const d of docs) {
    const id = d.identificacion
    if (id.tipoDte !== tipo) throw new Error('Todos los DTE de un retorno deben ser del mismo tipo')
    if (!d.selloRecibido) throw new Error(`El DTE ${id.codigoGeneracion} no tiene sello de recepción: no admite retorno`)
    if (d.emisor.nit !== nit) throw new Error(`El DTE ${id.codigoGeneracion} es de otro emisor`)
    if (!mismo(d.receptor, original.receptor) || !mismo(d.ventaTercero, original.ventaTercero) || !mismo(d.compraTercero, original.compraTercero)) {
      throw new Error('Todos los DTE de un retorno deben tener el mismo receptor y el mismo tercero')
    }
    if (fecha < id.fecEmi!) throw new Error(`La fecha del evento no puede ser anterior a la del DTE ${id.codigoGeneracion}`)
    if (ahora > limiteRetorno(tipo, id.fecEmi!, d.emisor.codActividad)) throw new Error(`Venció el plazo para aplicar un retorno al DTE ${id.codigoGeneracion}`)
  }
  const codigos = new Set(docs.map(d => d.identificacion.codigoGeneracion))
  const items = input.items.map((item, i) => {
    const codigo = item.codigoGeneracion?.toUpperCase() ?? (docs.length === 1 ? original.identificacion.codigoGeneracion : undefined)
    if (!codigo || !codigos.has(codigo)) throw new Error(`Ítem ${i + 1}: indica en codigoGeneracion a cuál de los DTE pertenece`)
    return { ...item, codigoGeneracion: codigo }
  })
  for (const codigo of codigos) if (!items.some(i => i.codigoGeneracion === codigo)) throw new Error(`El DTE ${codigo} no tiene ningún ítem en el retorno`)

  const fe = tipo === '01'
  const fexe = tipo === '11'
  const fsee = tipo === '14'
  const conRetencionIva = fe && Number(original.resumen.ivaRete ?? 0) > 0
  const conRetencionRenta = fsee && Number(original.resumen.reteRenta ?? 0) > 0
  // FE: precios con IVA y tributos sin el 20. FEXE: tributo C3 en lo gravado. FSEE: compras sin tributos.
  const lineas = calcularLineas(
    items.map(i => ({ ...i, tipoVenta: fe ? i.tipoVenta : 'gravada', tributos: fsee ? undefined : fexe ? (i.tributos ?? ['C3']) : i.tributos })),
    { preciosConIva: fe, ivaComoTributo: false }
  )
  const cuerpo = lineas.map((l, i) => {
    const e = items[i]!
    const venta = l.ventaNoSuj + l.ventaExenta + l.ventaGravada
    return {
      numItem: l.numItem,
      tipoItem: e.tipoItem ?? 1,
      codigoGeneracion: e.codigoGeneracion,
      cantidad: r8(e.cantidad),
      precioUni: r8(e.precioUni),
      descripcion: e.descripcion,
      codigo: e.codigo ?? null,
      uniMedida: e.uniMedida ?? (e.precioUni === 0 && l.noGravado !== 0 ? 99 : 59),
      montoDescu: l.montoDescu,
      codTributo: fsee ? null : (e.codTributo ?? null),
      ventaNoSuj: fsee ? 0 : l.ventaNoSuj,
      ventaExenta: fsee ? 0 : l.ventaExenta,
      ventaGravada: fsee ? 0 : l.ventaGravada,
      compra: fsee ? venta : 0,
      tributos: fsee || (fexe && l.ventaGravada === 0) ? null : l.tributos,
      psv: fe ? r8(e.psv ?? 0) : 0,
      ivaItem: fe ? r8(l.baseNeta * IVA) : 0,
      noGravado: fsee ? 0 : l.noGravado,
      seguro: fexe ? r8(e.seguro ?? 0) : 0,
      flete: fexe ? r8(e.flete ?? 0) : 0,
      ivaRete: conRetencionIva ? r2(l.baseNeta * 0.01) : 0,
      reteRenta: conRetencionRenta ? r2(venta * 0.1) : 0
    }
  })
  const suma = (campo: keyof (typeof cuerpo)[number]) => r2(sumar(cuerpo.map(c => Number(c[campo]))))
  const totalNoSuj = suma('ventaNoSuj')
  const totalExenta = suma('ventaExenta')
  const totalGravada = suma('ventaGravada')
  const totalCompraExcluidos = suma('compra')
  const subTotalVentas = r2(totalNoSuj + totalExenta + totalGravada + totalCompraExcluidos)
  const { tributos, totalTributos } = fsee ? { tributos: null, totalTributos: 0 } : consolidarTributos(lineas)
  const totalSeguro = suma('seguro')
  const totalFlete = suma('flete')
  const montoTotalOperacion = r2(subTotalVentas + totalTributos + totalSeguro + totalFlete)
  if (montoTotalOperacion <= 0) throw new Error('El monto del retorno debe ser mayor que cero')
  const ivaRete = suma('ivaRete')
  const reteRenta = suma('reteRenta')
  const totalNoGravado = suma('noGravado')
  const { totalPagar, saldoFavor } = totalYSaldo(montoTotalOperacion - ivaRete - reteRenta + totalNoGravado)

  const r = original.receptor ?? {}
  const tipoDocumento = r.tipoDocumento ?? (r.nit ? '36' : null)
  const e = original.emisor
  return {
    identificacion: {
      version: VERSIONES['18'],
      ambiente: input.ambiente,
      tipoModelo: input.contingencia ? 2 : 1,
      tipoOperacion: input.contingencia ? 2 : 1,
      tipoEvento: '18',
      tipoContingencia: input.contingencia?.tipo ?? null,
      motivoContin: input.contingencia?.tipo === 5 ? (input.contingencia.motivo ?? null) : null,
      codigoGeneracion: input.codigoGeneracion ?? generarCodigoGeneracion(),
      fecEmi: fecha,
      horEmi: hora,
      fusion: input.fusion ?? null,
      tipoMoneda: 'USD'
    },
    documentoRelacionado: docs.map(d => ({ tipoDocumento: tipo, codigoGeneracion: d.identificacion.codigoGeneracion, fechaEmision: d.identificacion.fecEmi! })),
    emisor: {
      nit,
      nombre: input.emisor.nombre,
      codEstableMH: input.emisor.codEstableMH,
      codEstable: input.emisor.codEstable ?? null,
      codPuntoVentaMH: input.emisor.codPuntoVentaMH,
      codPuntoVenta: input.emisor.codPuntoVenta ?? null,
      // Datos de exportación: los mismos de la FEXE (Manual Funcional X, notas).
      recintoFiscal: fexe ? (e.recintoFiscal ?? null) : null,
      tipoRegimen: fexe ? (e.tipoRegimen ?? null) : null,
      regimen: fexe ? (e.regimen ?? null) : null,
      tipoItemExpor: fexe ? (e.tipoItemExpor ?? null) : null
    },
    documento: {
      tipoDocumento,
      numDocumento: normalizarDocumento(tipoDocumento, r.numDocumento ?? r.nit),
      nombre: r.nombre ?? null,
      codPais: fexe ? (r.codPais ?? null) : null,
      nombrePais: fexe ? (r.nombrePais ?? null) : null,
      telefono: r.telefono ?? null,
      correo: r.correo ?? null
    },
    ventaTercero: fsee ? null : (original.ventaTercero ?? null),
    compraTercero: fexe ? (original.compraTercero ?? null) : null,
    cuerpoDocumento: cuerpo,
    resumen: {
      totalNoSuj,
      totalExenta,
      totalGravada,
      totalCompraExcluidos,
      subTotalVentas,
      tributos,
      totalSeguro,
      totalFlete,
      montoTotalOperacion,
      ivaRete,
      reteRenta,
      totalNoGravado,
      totalPagar,
      totalLetras: totalEnLetras(totalPagar),
      totalNoOnerosas: fexe ? r2(input.totalNoOnerosas ?? 0) : 0,
      totalIva: fe ? suma('ivaItem') : 0,
      saldoFavor
    },
    apendice: construirApendice(input.apendice)
  }
}

// ---------------------------------------------------------------------------
// Evento de Operaciones Especiales (17, v1) — Manual Funcional IX; Normativa 2.0, Anexo V

export interface ItemOperacionEspecial {
  descripcion: string
  /** Precio unitario SIN IVA, también en facturas simplificadas. */
  precioUni: number
  /** Por defecto 1 si se indica numDocumento, o docAl − docDel + 1 en un rango numérico. */
  cantidad?: number
  /** Comprobante de control interno (97) informado uno a uno. */
  numDocumento?: string | null
  /** Rango de correlativos (obligatorio en facturas simplificadas, 02). */
  docDel?: string | null
  docAl?: string | null
  fechaEmision?: string | null
  /** Por defecto 'gravada'. */
  tipoVenta?: 'gravada' | 'exenta' | 'noSujeta'
  /** Documentos anulados: código del evento 17 donde se informaron activos. */
  codigoGeneracionRef?: string | null
}

export interface OperacionesEspecialesInput {
  ambiente: Ambiente
  emisor: Emisor
  /** CAT-023: 02 factura de venta simplificada, 97 comprobante de control interno. */
  tipoDocumento: '02' | '97'
  items: ItemOperacionEspecial[]
  apendice?: Apendice[]
  /** Fecha del evento: define el periodo que se informa (por defecto, ahora). */
  fecha?: Date
  codigoGeneracion?: string
}

export function construirOperacionesEspeciales(input: OperacionesEspecialesInput): Dte {
  const { tipoDocumento, items } = input
  if (tipoDocumento !== '02' && tipoDocumento !== '97') throw new Error('tipoDocumento debe ser 02 (factura simplificada) o 97 (comprobante de control interno)')
  if (!items.length || items.length > 2000) throw new Error('El evento de operaciones especiales admite de 1 a 2000 ítems')
  const unoAUno = items.filter(i => i.numDocumento).length
  if (tipoDocumento === '02' && unoAUno) throw new Error('Las facturas simplificadas se informan por rangos (docDel y docAl), no con numDocumento')
  if (unoAUno && unoAUno !== items.length) throw new Error('No se pueden mezclar documentos uno a uno y por rangos en el mismo evento')
  const conRef = items.filter(i => i.codigoGeneracionRef).length
  if (conRef && conRef !== items.length) throw new Error('Los documentos anulados se informan en un evento aparte: todos los ítems llevan codigoGeneracionRef o ninguno')

  const cuerpo = items.map((item, i) => {
    const n = i + 1
    const rango = !item.numDocumento
    if (rango && (!item.docDel || !item.docAl)) throw new Error(`Ítem ${n}: indica numDocumento o el rango docDel–docAl`)
    let cantidad = item.cantidad
    if (cantidad === undefined) {
      if (!rango) cantidad = 1
      else if (/^\d+$/.test(item.docDel!) && /^\d+$/.test(item.docAl!)) cantidad = Number(BigInt(item.docAl!) - BigInt(item.docDel!) + 1n)
      else throw new Error(`Ítem ${n}: indica la cantidad de documentos del rango`)
    }
    if (!Number.isInteger(cantidad) || cantidad < 1) throw new Error(`Ítem ${n}: la cantidad debe ser un entero mayor que cero`)
    if (!rango && cantidad !== 1) throw new Error(`Ítem ${n}: un documento informado uno a uno lleva cantidad 1`)
    if ((item.codigoGeneracionRef || !rango) && !item.fechaEmision) throw new Error(`Ítem ${n}: indica fechaEmision del documento`)
    const venta = r8(item.precioUni * cantidad)
    const tipoVenta = item.tipoVenta ?? 'gravada'
    return {
      numItem: n,
      codigoGeneracionRef: item.codigoGeneracionRef?.toUpperCase() ?? null,
      tipoDocumento,
      numDocumento: rango ? null : item.numDocumento!,
      fechaEmision: item.fechaEmision ?? null,
      cantidad,
      descripcion: item.descripcion,
      docDel: rango ? item.docDel! : null,
      docAl: rango ? item.docAl! : null,
      precioUni: r8(item.precioUni),
      ventaNoSuj: tipoVenta === 'noSujeta' ? venta : 0,
      ventaExenta: tipoVenta === 'exenta' ? venta : 0,
      ventaGravada: tipoVenta === 'gravada' ? venta : 0,
      tributos: tipoVenta === 'gravada' && venta > 0 ? ['20'] : null
    }
  })
  const totalNoSuj = r2(sumar(cuerpo.map(c => c.ventaNoSuj)))
  const totalExenta = r2(sumar(cuerpo.map(c => c.ventaExenta)))
  const totalGravada = r2(sumar(cuerpo.map(c => c.ventaGravada)))
  const subTotal = r2(totalNoSuj + totalExenta + totalGravada)
  const iva = r2(totalGravada * IVA)
  const total = r2(subTotal + iva)
  const { fecha, hora } = fechaHoraSV(input.fecha)
  return {
    identificacion: {
      version: VERSIONES['17'],
      ambiente: input.ambiente,
      tipoModelo: 1,
      tipoOperacion: 1,
      tipoEvento: '17',
      codigoGeneracion: input.codigoGeneracion ?? generarCodigoGeneracion(),
      fecEmi: fecha,
      horEmi: hora,
      tipoMoneda: 'USD'
    },
    emisor: { nit: normalizarNit(input.emisor.nit), nombre: input.emisor.nombre },
    cuerpoDocumento: cuerpo,
    resumen: {
      totalNoSuj,
      totalExenta,
      totalGravada,
      subTotal,
      tributos: totalGravada > 0 ? [{ codigo: '20', descripcion: nombreTributo('20') ?? 'Impuesto al Valor Agregado 13%', valor: iva }] : null,
      total,
      totalLetras: totalEnLetras(total)
    },
    apendice: construirApendice(input.apendice)
  }
}
