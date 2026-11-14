/**
 * Representación gráfica (PDF) de un DTE o evento, en la disposición de los diseños sugeridos por el
 * Manual Funcional (XXII): identificación con QR, emisor y receptor, cuerpo con las columnas de venta,
 * resumen y apéndices. Los nombres de campo son los de los Anexos de la Normativa 2.0 y los valores se
 * toman tal cual del JSON (no se recalcula nada).
 * pdf-lib y qrcode-generator son JS puro: funciona en Node y Cloudflare Workers.
 */
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib'
import qrcode from 'qrcode-generator'
import { distritosDe, municipiosDe, valorCatalogo } from '../catalogs'
import { urlConsultaPublica } from '../ids'
import { tipoDeDocumento } from '../schemas'
import { NOMBRES_DTE, type Dte } from '../types'

export interface OpcionesPdf {
  /** Logo PNG o JPG del emisor. */
  logo?: { bytes: Uint8Array; tipo: 'png' | 'jpg' }
}

type Color = ReturnType<typeof rgb>
const A4: [number, number] = [595.28, 841.89]
const MARGEN = 28
const ANCHO = A4[0] - MARGEN * 2
const TINTA = rgb(0.16, 0.17, 0.19)
const NEGRO = rgb(0.07, 0.08, 0.1)
const GRIS = rgb(0.4, 0.42, 0.46)
const LINEA = rgb(0.7, 0.72, 0.75)
const BLANCO = rgb(1, 1, 1)

/** Helvetica estándar usa WinAnsi: se sustituye lo que no puede codificar. */
const limpiar = (texto: unknown) => String(texto ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF€–—‘’“”•…]/g, '?')
const dinero = (v: unknown) => `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const numero = (v: unknown) => Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })
const vacio = (v: unknown) => v === null || v === undefined || v === ''

function partir(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const lineas: string[] = []
  let actual = ''
  for (const palabra of limpiar(texto).split(' ')) {
    let resto = palabra
    while (fuente.widthOfTextAtSize(resto, tamano) > ancho) {
      let corte = resto.length - 1
      while (corte > 1 && fuente.widthOfTextAtSize(resto.slice(0, corte), tamano) > ancho) corte--
      if (actual) { lineas.push(actual); actual = '' }
      lineas.push(resto.slice(0, corte))
      resto = resto.slice(corte)
    }
    const candidato = actual ? `${actual} ${resto}` : resto
    if (fuente.widthOfTextAtSize(candidato, tamano) > ancho) { lineas.push(actual); actual = resto } else actual = candidato
  }
  if (actual) lineas.push(actual)
  return lineas.length ? lineas : ['']
}

/** Complemento, distrito, municipio y departamento con sus nombres de catálogo. */
function direccion(d: any): string | null {
  if (!d) return null
  const depto = d.departamento as string | undefined
  const distrito = depto ? distritosDe(depto).find(v => v.codigo === d.distrito)?.valor : undefined
  const municipio = depto ? municipiosDe(depto).find(v => v.codigo === d.municipio)?.valor : undefined
  return [d.complemento, distrito, municipio, depto ? valorCatalogo('CAT-012', depto) : undefined].filter(Boolean).join(', ') || null
}

const nombreDocumento = (codigo: unknown) => (vacio(codigo) ? null : (valorCatalogo('CAT-022', String(codigo)) ?? String(codigo)))
const nombreTipo = (codigo: unknown) => NOMBRES_DTE[codigo as keyof typeof NOMBRES_DTE] ?? valorCatalogo('CAT-002', String(codigo)) ?? String(codigo ?? '')

// --- Cuerpo: columnas posibles. Las de venta se muestran si el tipo las exige o si traen valores.
interface Columna { titulo: string; ancho: number; valor: (it: any) => string; derecha?: boolean; total?: string }
const COLUMNAS_VENTA: Array<[clave: string, titulo: string, total: string]> = [
  ['noGravado', 'Otros montos no afectos', ''],
  ['ventaNoSuj', 'Ventas no sujetas', 'totalNoSuj'],
  ['ventaExenta', 'Ventas exentas', 'totalExenta'],
  ['ventaGravada', 'Ventas gravadas', 'totalGravada'],
  ['compra', 'Compras', 'totalCompra'],
  ['montoSujetoGrav', 'Monto sujeto a retención', 'totalSujetoRetencion'],
  ['ivaRetenido', 'IVA retenido', 'totalIvaRetenido'],
  ['exportaciones', 'Exportaciones', 'exportacion'],
  ['ivaItem', 'IVA', ''],
  ['tipoDepreciacion', 'Depreciación', ''],
  ['valor', 'Valor donado', 'valorTotal']
]
/** Columnas que sólo aparecen en los tipos que las exigen (la FE también trae ivaItem). */
const SOLO_SI_EXIGE = new Set(['ivaItem', 'tipoDepreciacion'])
const VENTAS = ['ventaNoSuj', 'ventaExenta', 'ventaGravada']
const COLUMNAS_SIEMPRE: Record<string, string[]> = {
  '01': ['noGravado', ...VENTAS], '03': ['noGravado', ...VENTAS], '04': VENTAS, '05': ['noGravado', ...VENTAS], '06': ['noGravado', ...VENTAS],
  '11': ['noGravado', 'ventaGravada'], '14': ['compra'], '07': ['montoSujetoGrav', 'ivaRetenido'], '17': VENTAS,
  '08': [...VENTAS, 'exportaciones', 'ivaItem'], '15': ['tipoDepreciacion', 'valor']
}
/** Rol de emisor y receptor en los documentos de liquidación y donación (Manual Funcional, representación gráfica). */
const ROLES: Record<string, [emisor: string, receptor: string]> = {
  '08': ['Comisionista (Emisor)', 'Mandante (Receptor)'], '09': ['Agente perceptor (Emisor)', 'Afiliado (Receptor)'],
  '15': ['Donatario (Emisor)', 'Donante (Receptor)']
}

// --- Resumen: [campo, nombre oficial, se muestra aunque sea 0]
const RESUMEN: Array<[string, string, boolean]> = [
  ['totalNoSuj', 'Total de operaciones no sujetas', true], ['totalExenta', 'Total de operaciones exentas', true],
  ['totalGravada', 'Total de operaciones gravadas', true], ['exportacion', 'Total de operaciones de exportación', false], ['totalCompra', 'Total de operaciones', true],
  ['totalCompraExcluidos', 'Total de compras a sujetos excluidos', false], ['totalSujetoRetencion', 'Total monto sujeto a retención', true],
  ['subTotalVentas', 'Suma de operaciones', true], ['descuNoSuj', 'Descuento global a ventas no sujetas', true],
  ['descuExenta', 'Descuento global a ventas exentas', true], ['descuGravada', 'Descuento global a ventas gravadas', true],
  ['descu', 'Descuento global al total de operaciones', true], ['@tributos', '', false], ['seguro', 'Seguro', false], ['flete', 'Flete', false],
  ['totalSeguro', 'Seguro', false], ['totalFlete', 'Flete', false], ['subTotal', 'Sub-Total', true], ['ivaPerci', 'IVA Percibido', false],
  ['ivaRete', 'IVA Retenido', true], ['totalIva', 'IVA 13%', false], ['reteRenta', 'Retención Renta', true],
  ['montoTotalOperacion', 'Monto Total de la Operación', true], ['totalNoGravado', 'Total cargos / abonos que no afectan la base imponible', true],
  ['totalNoOnerosas', 'Transferencias de bienes no onerosas', false], ['saldoFavor', 'Saldo a favor', false],
  ['totalIvaRetenido', 'Total IVA retenido', true], ['totalPagar', 'Total a Pagar', true], ['total', 'Total', true],
  ['valorTotal', 'Total de la donación', true]
]
const FINALES = new Set(['totalPagar', 'total', 'totalIvaRetenido', 'valorTotal'])

const ETIQUETAS_MOTIVO: Record<string, string> = {
  tipoAnulacion: 'Tipo de invalidación', motivoAnulacion: 'Motivo de la invalidación',
  nombreResponsable: 'Responsable', numDocResponsable: 'N° de documento del responsable',
  nombreSolicita: 'Solicitante', numDocSolicita: 'N° de documento del solicitante',
  fInicio: 'Fecha de inicio', hInicio: 'Hora de inicio', fFin: 'Fecha de fin', hFin: 'Hora de fin',
  tipoContingencia: 'Tipo de contingencia', motivoContingencia: 'Motivo de la contingencia'
}

/** Genera el PDF de un DTE o evento (sellado, o transitorio emitido en contingencia). */
export async function generarPdfDte(archivo: Dte & { selloRecibido?: string | null }, opciones: OpcionesPdf = {}): Promise<Uint8Array> {
  const tipo = tipoDeDocumento(archivo)
  const esEvento = !/^\d+$/.test(tipo) || Number(tipo) >= 16
  const id = archivo.identificacion
  const pdf = await PDFDocument.create()
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold)
  const nombre = NOMBRES_DTE[tipo] ?? tipo
  pdf.setTitle(`${nombre} ${id.codigoGeneracion}`)
  pdf.setProducer('Open Factura')

  let pagina!: PDFPage
  let y = 0
  const texto = (t: unknown, x: number, yy: number, o: { tam?: number; fuente?: PDFFont; color?: Color; alinear?: 'derecha' | 'centro' } = {}) => {
    const tam = o.tam ?? 7.5
    const f = o.fuente ?? normal
    const s = limpiar(t)
    const w = f.widthOfTextAtSize(s, tam)
    pagina.drawText(s, { x: o.alinear === 'derecha' ? x - w : o.alinear === 'centro' ? x - w / 2 : x, y: yy, size: tam, font: f, color: o.color ?? NEGRO })
  }
  const banda = (x: number, yy: number, w: number, h: number, color: Color = TINTA) => pagina.drawRectangle({ x, y: yy - h, width: w, height: h, color })
  const cajaRedonda = (x: number, yy: number, w: number, h: number) => {
    const r = 9
    pagina.drawSvgPath(`M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`, { x, y: yy, borderColor: LINEA, borderWidth: 0.8 })
  }
  /** "Etiqueta: valor" con la etiqueta en negrita; devuelve el alto usado. Sin dibujar si `medir`. */
  const campo = (x: number, yy: number, w: number, etiqueta: string, valor: unknown, medir = false, tam = 7.5) => {
    const pre = `${etiqueta}: `
    const anchoPre = negrita.widthOfTextAtSize(pre, tam)
    const v = vacio(valor) ? '' : limpiar(valor)
    const primera = partir(v, normal, tam, Math.max(20, w - anchoPre))
    const [inicio = '', ...resto] = primera
    const siguientes = resto.length ? partir(resto.join(' '), normal, tam, w) : []
    if (!medir) {
      texto(pre, x, yy, { tam, fuente: negrita })
      texto(inicio, x + anchoPre, yy, { tam })
      siguientes.forEach((l, i) => texto(l, x, yy - (i + 1) * (tam + 2), { tam }))
    }
    return (1 + siguientes.length) * (tam + 2)
  }
  const nuevaPagina = () => {
    pagina = pdf.addPage(A4)
    y = A4[1] - MARGEN
    if (id.ambiente === '00') {
      banda(0, A4[1], A4[0], 16, rgb(0.99, 0.93, 0.76))
      texto('DOCUMENTO DE PRUEBA — SIN VALIDEZ LEGAL (AMBIENTE DE PRUEBAS)', A4[0] / 2, A4[1] - 11.5, { tam: 7.5, fuente: negrita, color: rgb(0.55, 0.33, 0), alinear: 'centro' })
      y -= 6
    }
  }
  const asegurar = (alto: number) => { if (y - alto < MARGEN + 22) { nuevaPagina(); return true } return false }
  nuevaPagina()

  // === Encabezado =========================================================
  const e = archivo.emisor ?? {}
  const centro = MARGEN + ANCHO / 2
  if (!esEvento) texto('DOCUMENTO TRIBUTARIO ELECTRÓNICO', centro, y - 10, { tam: 10, fuente: negrita, alinear: 'centro' })
  texto(nombre.toUpperCase(), centro, y - (esEvento ? 10 : 23), { tam: 10, fuente: negrita, alinear: 'centro' })
  texto(`Ver. ${id.version}`, MARGEN + ANCHO, y - 10, { tam: 9, fuente: negrita, alinear: 'derecha' })
  if (opciones.logo) {
    const img = opciones.logo.tipo === 'png' ? await pdf.embedPng(opciones.logo.bytes) : await pdf.embedJpg(opciones.logo.bytes)
    const escala = Math.min(110 / img.width, 46 / img.height)
    pagina.drawImage(img, { x: MARGEN, y: y - img.height * escala, width: img.width * escala, height: img.height * escala })
  } else {
    partir(e.nombreComercial ?? e.nombre ?? '', negrita, 11, 170).slice(0, 3).forEach((l, i) => texto(l, MARGEN, y - 11 - i * 13, { tam: 11, fuente: negrita }))
  }
  y -= 56

  const fecha = (id.fecEmi ?? id.fTransmision) as string | undefined
  const par = (x: number, yy: number, etiqueta: string, valor: unknown) => {
    texto(`${etiqueta}:`, x, yy, { tam: 7.5, fuente: negrita })
    texto(vacio(valor) ? '-' : valor, x, yy - 9.5, { tam: 7.5 })
  }
  const izquierda: Array<[string, unknown]> = [
    ['Código de Generación', id.codigoGeneracion],
    // Los eventos no tienen número de control.
    ...(id.numeroControl === undefined ? [] : [['Número de Control', id.numeroControl] as [string, unknown]]),
    ['Sello de Recepción', archivo.selloRecibido ?? (archivo.identificacion.tipoContingencia ? 'Pendiente (documento emitido en contingencia)' : 'Pendiente')]
  ]
  // Los eventos de invalidación y contingencia no llevan modelo ni tipo de transmisión.
  const derecha: Array<[string, unknown]> = [
    ...(id.tipoModelo ? [['Modelo de Facturación', valorCatalogo('CAT-003', id.tipoModelo as number)] as [string, unknown]] : []),
    ...(id.tipoOperacion ? [['Tipo de Transmisión', valorCatalogo('CAT-004', id.tipoOperacion as number)] as [string, unknown]] : []),
    ['Fecha y Hora de Generación', `${fecha ?? '-'} ${(id.horEmi ?? id.hTransmision ?? '') as string}`]
  ]
  izquierda.forEach(([k, v], i) => par(MARGEN, y - i * 22, k, v))
  derecha.forEach(([k, v], i) => par(MARGEN + ANCHO - 170, y - i * 22, k, v))
  if (fecha) {
    const qr = qrcode(0, 'M')
    qr.addData(urlConsultaPublica(id.ambiente, id.codigoGeneracion, fecha))
    qr.make()
    const n = qr.getModuleCount()
    const lado = 74
    const m = lado / n
    const x0 = centro - lado / 2
    const y0 = y + 8
    for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (qr.isDark(f, c)) pagina.drawRectangle({ x: x0 + c * m, y: y0 - (f + 1) * m, width: m + 0.05, height: m + 0.05, color: NEGRO })
  }
  y -= 76

  // === Emisor y receptor ==================================================
  const r = archivo.receptor ?? archivo.sujetoExcluido ?? (tipo === '18' ? archivo.documento : null)
  const tercero = archivo.ventaTercero
  const camposEmisor: Array<[string, unknown]> = [
    ['NIT', e.nit ?? e.numDocumento], ['NRC', e.nrc], ['Actividad económica', e.descActividad], ['Dirección', direccion(e.direccion)],
    ['Número de teléfono', e.telefono], ['Correo electrónico', e.correo], ['Nombre comercial', e.nombreComercial],
    ['Tipo de establecimiento', e.tipoEstablecimiento ? valorCatalogo('CAT-009', e.tipoEstablecimiento) : null],
    ['Recinto fiscal', e.recintoFiscal], ['Régimen de exportación', e.regimen]
  ]
  let derechaTitulo = ROLES[tipo]?.[1] ?? 'Receptor'
  let derechaNombre: unknown = r?.nombre
  let camposDerecha: Array<[string, unknown]> = []
  if (r) {
    camposDerecha = [
      [r.nit && !r.numDocumento ? 'NIT' : 'Tipo de documento de identificación', r.nit && !r.numDocumento ? r.nit : nombreDocumento(r.tipoDocumento)],
      ...(r.numDocumento ? [['Número de documento de identificación', r.numDocumento] as [string, unknown]] : []),
      ['NRC', r.nrc], ['Actividad económica', r.descActividad],
      ['Dirección', direccion(r.direccion) ?? r.complemento], ['País destino de la exportación', r.nombrePais],
      ['País', tipo === '15' && r.codPais ? valorCatalogo('CAT-020', r.codPais) : undefined],
      ['Domicilio fiscal', r.codDomiciliado ? valorCatalogo('CAT-032', r.codDomiciliado) : undefined],
      ['Tipo de establecimiento', tipo === '09' && r.tipoEstablecimiento ? valorCatalogo('CAT-009', r.tipoEstablecimiento) : undefined],
      ['Correo electrónico', r.correo], ['Teléfono', r.telefono]
    ]
  } else if (tipo === 'invalidacion' && archivo.documento) {
    const d = archivo.documento
    derechaTitulo = 'Documento que se invalida'
    derechaNombre = nombreTipo(d.tipoDte)
    camposDerecha = [
      ['Código de generación', d.codigoGeneracion], ['Número de control', d.numeroControl], ['Sello de recepción', d.selloRecibido],
      ['Fecha de generación', d.fecEmi], ['Código de generación del documento que lo reemplaza', d.codigoGeneracionR],
      ['Receptor', [d.nombre, nombreDocumento(d.tipoDocumento), d.numDocumento].filter(Boolean).join(' · ') || null]
    ]
  } else if (archivo.motivo) {
    derechaTitulo = tipo === 'contingencia' ? 'Motivo de la contingencia' : 'Motivo'
    derechaNombre = null
  }
  const motivo = archivo.motivo as Record<string, unknown> | undefined
  if (motivo) {
    for (const [k, v] of Object.entries(motivo)) {
      if (vacio(v) || k.startsWith('tipDoc') || k.startsWith('tipoDoc')) continue
      const valor = k === 'tipoAnulacion' ? `${v}. ${valorCatalogo('CAT-024', v as number) ?? ''}` : k === 'tipoContingencia' ? `${v}. ${valorCatalogo('CAT-005', v as number) ?? ''}` : v
      camposDerecha.push([ETIQUETAS_MOTIVO[k] ?? k, valor])
    }
  }
  const hayDerecha = !!r || camposDerecha.length > 0
  const anchoCaja = hayDerecha ? (ANCHO - 14) / 2 : ANCHO
  const contenido = (titulo: unknown, campos: Array<[string, unknown]>, x: number, yy: number, medir: boolean) => {
    let h = 0
    if (!vacio(titulo)) {
      const lineas = partir(String(titulo), negrita, 9.5, anchoCaja - 20)
      if (!medir) lineas.forEach((l, i) => texto(l, x, yy - i * 11.5, { tam: 9.5, fuente: negrita }))
      h += lineas.length * 11.5 + 2
    }
    for (const [k, v] of campos) {
      // Un campo que el tipo de documento no tiene (undefined) no se muestra; uno vacío del receptor, sí.
      if (v === undefined || (vacio(v) && !['NRC', 'Actividad económica', 'Correo electrónico', 'Teléfono', 'Número de teléfono'].includes(k))) continue
      h += campo(x, yy - h, anchoCaja - 20, k, v, medir)
    }
    return h
  }
  const altoCajas = Math.max(contenido(e.nombre, camposEmisor, 0, 0, true), hayDerecha ? contenido(derechaNombre, camposDerecha, 0, 0, true) : 0) + 30
  asegurar(altoCajas)
  const cajas: Array<[string, unknown, Array<[string, unknown]>, number]> = [[ROLES[tipo]?.[0] ?? 'Emisor', e.nombre, camposEmisor, MARGEN]]
  if (hayDerecha) cajas.push([derechaTitulo, derechaNombre, camposDerecha, MARGEN + anchoCaja + 14])
  for (const [titulo, nombreCaja, campos, x] of cajas) {
    cajaRedonda(x, y, anchoCaja, altoCajas)
    texto(titulo, x + anchoCaja / 2, y - 11, { tam: 8, color: GRIS, alinear: 'centro' })
    contenido(nombreCaja, campos, x + 10, y - 26, false)
  }
  y -= altoCajas + 10

  // === Secciones condicionales ===========================================
  const seccion = (titulo: string, filas: Array<Array<[string, unknown]>>) => {
    asegurar(18 + filas.length * 11)
    banda(MARGEN, y, ANCHO, 13, rgb(0.92, 0.93, 0.94))
    texto(titulo, MARGEN + 6, y - 9.5, { tam: 7.5, fuente: negrita })
    y -= 22
    for (const fila of filas) {
      const w = ANCHO / fila.length
      const alto = Math.max(...fila.map(([k, v], i) => campo(MARGEN + 6 + i * w, y, w - 10, k, v, true)))
      fila.forEach(([k, v], i) => campo(MARGEN + 6 + i * w, y, w - 10, k, v))
      y -= alto + 2
    }
    y -= 4
  }
  if (tercero) seccion('VENTA A CUENTA DE TERCEROS', [[['NIT', tercero.nit], ['Nombre, denominación o razón social', tercero.nombre]]])
  if (archivo.compraTercero) seccion('COMPRA POR CUENTA DE TERCEROS', [[['N° de documento', archivo.compraTercero.numDocumento], ['Nombre', archivo.compraTercero.nombre]]])
  const relacionados = (archivo.documentoRelacionado ?? []) as any[]
  if (relacionados.length) {
    seccion('DOCUMENTOS RELACIONADOS', relacionados.map(d => [
      ['Tipo de documento', nombreTipo(d.tipoDocumento)], ['N° de documento', d.numeroDocumento ?? d.codigoGeneracion], ['Fecha del documento', d.fechaEmision]
    ]))
  }
  const otros = (archivo.otrosDocumentos ?? []) as any[]
  if (otros.length) seccion('OTROS DOCUMENTOS ASOCIADOS', otros.map(d => [['Identificación del documento', d.codDocAsociado], ['Descripción', [d.descDocumento, d.detalleDocumento].filter(v => !vacio(v)).join(': ')]]))
  // El DCLE no tiene ítems ni resumen: su cuerpo es una sola liquidación.
  if (tipo === '09' && archivo.cuerpoDocumento) {
    const l = archivo.cuerpoDocumento
    seccion('LIQUIDACIÓN', [
      [['Fecha inicio del periodo', l.periodoLiquidacionFechaInicio], ['Fecha fin del periodo', l.periodoLiquidacionFechaFin], ['Código de liquidación', l.codLiquidacion]],
      [['Cantidad de documentos', l.cantidadDoc], ['Valor de las operaciones a liquidar', dinero(l.valorOperaciones)], ['Valores no sujetos a percepción', vacio(l.montoSinPercepcion) ? null : dinero(l.montoSinPercepcion)]],
      [['Descripción del monto no sujeto a percepción', l.descripSinPercepcion], ['Subtotal', dinero(l.subTotal)], ['IVA de las operaciones a liquidar', dinero(l.iva)]],
      [['Montos sujetos a percepción sin IVA', dinero(l.montoSujetoPercepcion)], ['IVA percibido (2%)', dinero(l.ivaPercibido)], ['Comisión', dinero(l.comision)]],
      [['Porcentaje de comisión', `${l.porcentComision}%`], ['IVA de la comisión', dinero(l.ivaComision)], ['Valor líquido a pagar al afiliado', dinero(l.liquidoApagar)]],
      [['Valor en letras', l.totalLetras], ['Observaciones', l.observaciones]]
    ])
  }

  // === Cuerpo =============================================================
  const cuerpo = archivo.cuerpoDocumento ?? archivo.detalleDTE
  const items: any[] = Array.isArray(cuerpo) ? cuerpo : []
  const res = archivo.resumen ?? null
  const enBanda = new Set<string>()
  if (items.length) {
    const tiene = (k: string) => items.some(it => it[k] !== undefined)
    const conValor = (k: string) => items.some(it => !vacio(it[k]) && Number(it[k]) !== 0)
    const origen = relacionados[0]?.tipoDocumento
    const siempre = new Set(tipo === '18' ? (origen === '14' ? ['compra'] : VENTAS) : (COLUMNAS_SIEMPRE[tipo] ?? []))
    const cols: Columna[] = [{ titulo: 'N°', ancho: 20, valor: it => String(it.numItem ?? it.noItem ?? '') }]
    if (tiene('tipoDte') || tiene('tipoDoc') || (tipo === '17' && tiene('tipoDocumento'))) cols.push({ titulo: 'Tipo de documento', ancho: 62, valor: it => nombreTipo(it.tipoDte ?? it.tipoDoc ?? it.tipoDocumento) })
    if (tipo === 'contingencia') cols.push({ titulo: 'Código de generación', ancho: 0, valor: it => it.codigoGeneracion })
    if (tiene('tipoDonacion')) cols.push({ titulo: 'Tipo de donación', ancho: 48, valor: it => valorCatalogo('CAT-026', it.tipoDonacion) ?? String(it.tipoDonacion) })
    if (tipo === '07' || tipo === '08') cols.push({ titulo: 'N° de documento', ancho: 120, valor: it => it.numeroDocumento ?? it.numDocumento }, { titulo: 'Fecha', ancho: 48, valor: it => it.fechaEmision })
    if (tipo === '17') cols.push({ titulo: 'Documento / rango', ancho: 74, valor: it => it.numDocumento ?? `${it.docDel} – ${it.docAl}` }, { titulo: 'Fecha', ancho: 48, valor: it => it.fechaEmision ?? '' })
    if (tiene('cantidad')) cols.push({ titulo: 'Cantidad', ancho: 38, valor: it => numero(it.cantidad), derecha: true })
    if (tiene('uniMedida')) cols.push({ titulo: 'Unidad', ancho: 46, valor: it => valorCatalogo('CAT-014', it.uniMedida) ?? String(it.uniMedida) })
    if (tiene('descripcion')) {
      cols.push({
        titulo: 'Descripción', ancho: 0,
        valor: it => `${it.codigo ? `[${it.codigo}] ` : ''}${it.descripcion}${it.numeroDocumento && tipo !== '07' && tipo !== '17' ? ` (Doc. relacionado: ${it.numeroDocumento})` : ''}`
      })
    }
    if (tiene('valorUni')) cols.push({ titulo: 'Valor unitario', ancho: 50, valor: it => dinero(it.valorUni), derecha: true })
    if (tiene('precioUni')) cols.push({ titulo: 'Precio unitario', ancho: 50, valor: it => dinero(it.precioUni), derecha: true })
    if (tiene('montoDescu')) cols.push({ titulo: 'Descuento por ítem', ancho: 46, valor: it => dinero(it.montoDescu), derecha: true })
    for (const [clave, titulo, total] of COLUMNAS_VENTA) {
      if (!tiene(clave) || !(siempre.has(clave) || (!SOLO_SI_EXIGE.has(clave) && conValor(clave)))) continue
      const totalResumen = clave === 'compra' && res?.totalCompra === undefined ? 'totalCompraExcluidos' : total
      cols.push({ titulo, ancho: 50, valor: it => dinero(it[clave]), derecha: true, total: totalResumen })
    }
    const fijo = cols.reduce((s, c) => s + c.ancho, 0)
    const flexibles = cols.filter(c => c.ancho === 0)
    for (const c of flexibles) c.ancho = Math.max(80, (ANCHO - fijo) / flexibles.length)
    const xs: number[] = []
    cols.reduce((x, c) => { xs.push(x); return x + c.ancho }, MARGEN)

    const encabezado = () => {
      const lineas = cols.map(c => partir(c.titulo, negrita, 6.8, c.ancho - 6))
      const alto = Math.max(...lineas.map(l => l.length)) * 8 + 8
      banda(MARGEN, y, ANCHO, alto)
      cols.forEach((c, i) => lineas[i]!.forEach((l, j) => texto(l, c.derecha ? xs[i]! + c.ancho - 3 : xs[i]! + 3, y - 9.5 - j * 8, { tam: 6.8, fuente: negrita, color: BLANCO, alinear: c.derecha ? 'derecha' : undefined })))
      y -= alto
    }
    asegurar(40)
    encabezado()
    for (const it of items) {
      const celdas = cols.map(c => partir(c.valor(it) ?? '', normal, 7, c.ancho - 6))
      const alto = Math.max(...celdas.map(l => l.length)) * 8.5 + 6
      if (asegurar(alto)) encabezado()
      cols.forEach((c, i) => celdas[i]!.forEach((l, j) => texto(l, c.derecha ? xs[i]! + c.ancho - 3 : xs[i]! + 3, y - 9 - j * 8.5, { tam: 7, alinear: c.derecha ? 'derecha' : undefined })))
      y -= alto
      pagina.drawLine({ start: { x: MARGEN, y }, end: { x: MARGEN + ANCHO, y }, thickness: 0.3, color: LINEA })
    }
    const conTotal = cols.map((c, i) => [c, i] as const).filter(([c]) => c.total && typeof res?.[c.total] === 'number')
    if (conTotal.length) {
      asegurar(16)
      banda(MARGEN, y, ANCHO, 14)
      const primera = conTotal[0]![1]
      texto(tipo === '14' ? 'SUMA DE COMPRAS:' : tipo === '07' || tipo === '08' || tipo === '15' ? 'TOTALES:' : 'SUMA DE VENTAS:', xs[primera]! - 6, y - 10, { tam: 7, fuente: negrita, color: BLANCO, alinear: 'derecha' })
      for (const [c, i] of conTotal) {
        texto(dinero(res[c.total!]), xs[i]! + c.ancho - 3, y - 10, { tam: 7, fuente: negrita, color: BLANCO, alinear: 'derecha' })
        enBanda.add(c.total!)
      }
      y -= 14
    }
    y -= 10
  }

  // === Resumen ============================================================
  if (res) {
    const filas: Array<[string, string, boolean]> = []
    for (const [clave, etiqueta, siempre] of RESUMEN) {
      if (clave === '@tributos') {
        for (const t of res.tributos ?? []) filas.push([t.descripcion ?? `Tributo ${t.codigo}`, dinero(t.valor), false])
        continue
      }
      const v = res[clave]
      if (typeof v !== 'number' || enBanda.has(clave) || (!siempre && v === 0)) continue
      filas.push([etiqueta, dinero(v), FINALES.has(clave)])
    }
    asegurar(filas.length * 11.5 + 8)
    const xValor = MARGEN + ANCHO - 3
    const xEtiqueta = xValor - 72
    for (const [etiqueta, valor, final] of filas) {
      texto(`${etiqueta}:`, xEtiqueta, y - 8, { tam: final ? 8.5 : 7.5, fuente: final ? negrita : normal, alinear: 'derecha' })
      texto(valor, xValor, y - 8, { tam: final ? 8.5 : 7.5, fuente: final ? negrita : normal, alinear: 'derecha' })
      y -= final ? 13 : 11.5
    }
    y -= 8

    // Banda: valor en letras, condición de la operación y observaciones
    const condicion = res.condicionOperacion ? valorCatalogo('CAT-016', res.condicionOperacion) : null
    const observaciones = vacio(res.observaciones) ? null : partir(String(res.observaciones), normal, 7.5, ANCHO - 100)
    if (res.totalLetras || condicion || observaciones) {
      const alto = 16 + (observaciones ? observaciones.length * 9.5 + 3 : 0)
      asegurar(alto)
      banda(MARGEN, y, ANCHO, alto)
      if (res.totalLetras) texto(`Valor en letras: ${res.totalLetras}`, MARGEN + 6, y - 11, { tam: 7.5, color: BLANCO })
      if (condicion) texto(`Condición de la operación: ${condicion}`, MARGEN + ANCHO / 2 + 20, y - 11, { tam: 7.5, color: BLANCO })
      observaciones?.forEach((l, i) => texto(i ? l : `Observaciones: ${l}`, MARGEN + 6, y - 23 - i * 9.5, { tam: 7.5, color: BLANCO }))
      y -= alto + 8
    }
  }

  // === Responsables (extensión) ==========================================
  const ext = archivo.extension as Record<string, unknown> | null | undefined
  if (ext && Object.values(ext).some(v => !vacio(v))) {
    asegurar(30)
    banda(MARGEN, y, ANCHO, 28)
    texto(`Responsable por parte del Emisor: ${ext.nombEntrega ?? ''}`, MARGEN + 6, y - 11, { tam: 7.5, color: BLANCO })
    texto(`N° de documento: ${ext.docuEntrega ?? ''}`, MARGEN + ANCHO / 2 + 20, y - 11, { tam: 7.5, color: BLANCO })
    // El DCLE sólo tiene al responsable de la liquidación (y su código de empleado).
    if (tipo === '09') texto(`Código de empleado: ${ext.codEmpleado ?? ''}`, MARGEN + 6, y - 22, { tam: 7.5, color: BLANCO })
    else {
      texto(`Responsable por parte del Receptor: ${ext.nombRecibe ?? ''}`, MARGEN + 6, y - 22, { tam: 7.5, color: BLANCO })
      texto(`N° de documento: ${ext.docuRecibe ?? ''}`, MARGEN + ANCHO / 2 + 20, y - 22, { tam: 7.5, color: BLANCO })
    }
    y -= 36
  }

  // === Apéndices ==========================================================
  const apendice = (archivo.apendice ?? []) as Array<{ etiqueta: string; valor: string }>
  if (apendice.length) {
    asegurar(20 + Math.ceil(apendice.length / 2) * 11)
    banda(MARGEN, y, ANCHO, 14)
    texto('APÉNDICES', MARGEN + 6, y - 10, { tam: 7.5, fuente: negrita, color: BLANCO })
    y -= 22
    for (let i = 0; i < apendice.length; i += 2) {
      const alto = Math.max(...apendice.slice(i, i + 2).map((a, j) => campo(MARGEN + 6 + j * (ANCHO / 2), y, ANCHO / 2 - 12, a.etiqueta, a.valor, true)))
      apendice.slice(i, i + 2).forEach((a, j) => campo(MARGEN + 6 + j * (ANCHO / 2), y, ANCHO / 2 - 12, a.etiqueta, a.valor))
      y -= alto + 2
    }
  }

  // === Pie ================================================================
  const paginas = pdf.getPages()
  paginas.forEach((p, i) => {
    pagina = p
    pagina.drawLine({ start: { x: MARGEN, y: MARGEN - 2 }, end: { x: MARGEN + ANCHO, y: MARGEN - 2 }, thickness: 0.4, color: LINEA })
    texto('Consulta este documento en admin.factura.gob.sv/consultaPublica', MARGEN, MARGEN - 12, { tam: 6.5, color: GRIS })
    texto(`Página ${i + 1} de ${paginas.length}`, MARGEN + ANCHO, MARGEN - 12, { tam: 6.5, color: GRIS, alinear: 'derecha' })
  })
  return pdf.save()
}
