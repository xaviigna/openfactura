import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { ESQUEMAS, construirDocumentoContableLiquidacion, construirDonacion, construirLiquidacion, validarDte, type Dte } from '../src'
import { contribuyente, ctx } from './fixtures'

// multipleOf se excluye: Ajv lo evalúa en coma flotante y da falsos negativos.
const sinMultipleOf = (n: any): any => Array.isArray(n) ? n.map(sinMultipleOf) : n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'multipleOf').map(([k, v]) => [k, sinMultipleOf(v)])) : n
const ajv = new Ajv({ allErrors: true, strict: false, formats: { date: /^\d{4}-\d{2}-\d{2}$/ } })
const cumpleEsquema = (dte: Dte) => {
  expect(validarDte(dte)).toEqual([])
  const tipo = dte.identificacion.tipoDte!
  const validar = ajv.getSchema(tipo) ?? ajv.addSchema(sinMultipleOf(ESQUEMAS[tipo]), tipo).getSchema(tipo)!
  expect(validar(dte), JSON.stringify(validar.errors)).toBe(true)
}

describe('Documento Contable de Liquidación (09, v2)', () => {
  const afiliado = { ...contribuyente, tipoEstablecimiento: '02', correo: 'pagos@cliente.com.sv' }
  const base = {
    receptor: afiliado,
    periodo: { inicio: '2026-11-01', fin: '2026-11-07' },
    valorOperaciones: 1130,
    porcentComision: 3,
    entrega: { nombre: 'Ana López', documento: '01234567-8' }
  }

  it('calcula subtotal, IVA, percepción del 2 %, comisión y líquido (Anexo IV, 114-121)', () => {
    const dte = construirDocumentoContableLiquidacion(ctx(), base)
    cumpleEsquema(dte)
    expect(dte.identificacion).toMatchObject({ tipoDte: '09', version: 2, numeroControl: 'DTE-09-M001P001-000000000000001', tipoModelo: 1, tipoOperacion: 1 })
    expect(dte.identificacion).not.toHaveProperty('tipoContingencia')
    expect(dte.resumen).toBeUndefined()
    expect(dte.cuerpoDocumento).toMatchObject({
      valorOperaciones: 1130, subTotal: 1130, montoSujetoPercepcion: 1000, iva: 130, ivaPercibido: 20,
      comision: 33.9, porcentComision: 3, ivaComision: 4.41, liquidoApagar: 1071.69, totalLetras: 'MIL SETENTA Y UNO 69/100 DÓLARES'
    })
    expect(dte.extension).toEqual({ nombEntrega: 'Ana López', docuEntrega: '01234567-8', codEmpleado: null })
    expect(dte.receptor).toMatchObject({ nit: '06142907861031', tipoEstablecimiento: '02', correo: 'pagos@cliente.com.sv' })
  })

  it('resta los valores no sujetos a percepción y respeta una comisión explícita', () => {
    const dte = construirDocumentoContableLiquidacion(ctx(), { ...base, montoSinPercepcion: 130, descripSinPercepcion: 'Propinas', comision: 10, porcentComision: undefined })
    cumpleEsquema(dte)
    expect(dte.cuerpoDocumento).toMatchObject({ subTotal: 1000, montoSujetoPercepcion: 884.96, iva: 115.04, ivaPercibido: 17.7, comision: 10, porcentComision: 0, ivaComision: 1.3, liquidoApagar: 1101 })
  })

  it('rechaza contingencia, periodos invertidos y montos sin percepción', () => {
    expect(() => construirDocumentoContableLiquidacion(ctx(1, { contingencia: { tipo: 1 } }), base)).toThrow(/contingencia/)
    expect(() => construirDocumentoContableLiquidacion(ctx(), { ...base, periodo: { inicio: '2026-11-07', fin: '2026-11-01' } })).toThrow(/periodo/)
    expect(() => construirDocumentoContableLiquidacion(ctx(), { ...base, montoSinPercepcion: 1130 })).toThrow(/subTotal/)
  })
})

describe('Comprobante de Liquidación (08, v2)', () => {
  const mandante = { ...contribuyente, codDomiciliado: 1 as const }
  const cg = (n: number) => `0C46FF18-49CB-4155-85E5-7C9576E14C${String(n).padStart(2, '0')}`
  const ccf = (extra = {}) => ({ tipoDte: '03' as const, numeroDocumento: cg(1), fechaEmision: '2026-11-03', ventaGravada: 500, ...extra })

  it('liquida un CCF con percepción (Manual de Usuario, p. 33)', () => {
    const dte = construirLiquidacion(ctx(), { receptor: mandante, documentos: [ccf({ ivaPercibido: 5 })] })
    cumpleEsquema(dte)
    expect(dte.identificacion).toMatchObject({ tipoDte: '08', version: 2, fusion: null, tipoModelo: 1, tipoOperacion: 1 })
    expect(dte.receptor).toMatchObject({ tipoDocumento: '36', numDocumento: '06142907861031', codDomiciliado: 1 })
    expect(dte.cuerpoDocumento[0]).toMatchObject({ tipoGeneracion: 2, ventaGravada: 500, ivaItem: 65, tributos: ['20'] })
    expect(dte.resumen).toMatchObject({ totalGravada: 500, subTotalVentas: 500, montoTotalOperacion: 565, ivaPerci: 5, total: 570, condicionOperacion: 1 })
    expect(dte.resumen.tributos).toEqual([{ codigo: '20', descripcion: expect.any(String), valor: 65 }])
  })

  it('suma FOVIAL y COTRANS de los documentos (Manual de Usuario, p. 34)', () => {
    const dte = construirLiquidacion(ctx(), { receptor: mandante, documentos: [ccf({ ventaGravada: 100, tributos: [{ codigo: 'D1', valor: 0.2 }, { codigo: 'C8', valor: 0.1 }] })] })
    cumpleEsquema(dte)
    expect(dte.cuerpoDocumento[0].tributos).toEqual(['20', 'D1', 'C8'])
    expect(dte.resumen).toMatchObject({ subTotalVentas: 100, montoTotalOperacion: 113.3, total: 113.3 })
  })

  it('resta NC y anulados, y deja en $0.00 lo que quede negativo (Anexo IV, 90-154)', () => {
    const dte = construirLiquidacion(ctx(), { receptor: mandante, documentos: [
      ccf(),
      ccf({ anulado: true }),
      { tipoDte: '05', numeroDocumento: cg(2), fechaEmision: '2026-11-04', ventaGravada: 100 },
      { tipoDte: '01', tipoGeneracion: 1, numeroDocumento: '22FA000123', fechaEmision: '2026-11-05', ventaExenta: 40 }
    ] })
    cumpleEsquema(dte)
    expect(dte.cuerpoDocumento.map((c: any) => [c.ventaGravada, c.ivaItem])).toEqual([[500, 65], [-500, -65], [-100, -13], [0, 0]])
    expect(dte.cuerpoDocumento[3]).toMatchObject({ ventaExenta: 40, tributos: null, numeroDocumento: '22FA000123' })
    expect(dte.resumen).toMatchObject({ totalGravada: -100, totalExenta: 40, subTotalVentas: 0, montoTotalOperacion: 0, total: 0, condicionOperacion: 1 })
    expect(dte.resumen.tributos[0].valor).toBe(0)
  })

  it('informa exportaciones con C3 en $0.00', () => {
    const dte = construirLiquidacion(ctx(), { receptor: mandante, documentos: [{ tipoDte: '11', numeroDocumento: cg(3), fechaEmision: '2026-11-06', exportaciones: 250 }] })
    cumpleEsquema(dte)
    expect(dte.cuerpoDocumento[0]).toMatchObject({ exportaciones: 250, ivaItem: 0, tributos: ['C3'] })
    expect(dte.resumen).toMatchObject({ exportacion: 250, montoTotalOperacion: 250, total: 250 })
  })

  it('rechaza contingencia, tipos no liquidables, montos negativos y más de 500 documentos', () => {
    const una = { receptor: mandante, documentos: [ccf()] }
    expect(() => construirLiquidacion(ctx(1, { contingencia: { tipo: 1 } }), una)).toThrow(/contingencia/)
    expect(() => construirLiquidacion(ctx(), { receptor: mandante, documentos: [ccf({ tipoDte: '07' })] })).toThrow(/no se liquida/)
    expect(() => construirLiquidacion(ctx(), { receptor: mandante, documentos: [ccf({ ventaGravada: -1 })] })).toThrow(/positivo/)
    expect(() => construirLiquidacion(ctx(), { receptor: mandante, documentos: Array.from({ length: 501 }, () => ccf()) })).toThrow(/500/)
    expect(() => construirLiquidacion(ctx(), { receptor: mandante, documentos: [] })).toThrow(/al menos/)
  })
})

describe('Comprobante de Donación (15, v2)', () => {
  const donante = { tipoDocumento: '13', numDocumento: '01234567-8', nombre: 'María Gómez', correo: 'maria@correo.sv', codActividad: '10005', descActividad: 'Otros', direccion: { departamento: '06', municipio: '23', distrito: '14', complemento: 'Colonia Escalón' } }
  const resolucion = [{ descripcion: 'Resolución', detalle: 'RES-01-2026' }]

  it('un donante domiciliado sin actividad o dirección se rechaza antes de transmitir', () => {
    const { codActividad: _a, descActividad: _d, direccion: _dir, ...incompleto } = donante
    expect(() => construirDonacion(ctx(), { receptor: incompleto, documentosAsociados: resolucion, items: [{ tipoDonacion: 1, descripcion: 'x', valorUni: 10 }] })).toThrow(/actividad económica y dirección/)
  })

  it('identifica al donatario por NIT, calcula valor con depreciación y paga sólo lo donado en efectivo', () => {
    const dte = construirDonacion(ctx(), { receptor: donante, documentosAsociados: resolucion, items: [
      { tipoDonacion: 1, descripcion: 'Donación en efectivo', valorUni: 100 },
      { tipoDonacion: 2, descripcion: 'Computadoras usadas', cantidad: 3, valorUni: 400, depreciacion: 150, uniMedida: 59 }
    ] })
    cumpleEsquema(dte)
    expect(dte.identificacion).toMatchObject({ tipoDte: '15', version: 2, numeroControl: 'DTE-15-M001P001-000000000000001' })
    expect(dte.emisor).toMatchObject({ tipoDocumento: '36', numDocumento: '06142907861023', nrc: null })
    expect(dte.emisor).not.toHaveProperty('nit')
    expect(dte.receptor).toMatchObject({ tipoDocumento: '13', numDocumento: '012345678', codDomiciliado: 1, codPais: 'SV' })
    expect(dte.otrosDocumentos).toEqual([{ codDocAsociado: 1, descDocumento: 'Resolución', detalleDocumento: 'RES-01-2026' }])
    expect(dte.cuerpoDocumento.map((c: any) => [c.cantidad, c.tipoDepreciacion, c.valor])).toEqual([[1, 0, 100], [3, 150, 1050]])
    expect(dte.resumen).toEqual({ valorTotal: 1150, totalLetras: 'MIL CIENTO CINCUENTA 00/100 DÓLARES', pagos: [{ codigo: '01', montoPago: 100, referencia: null }] })
  })

  it('sin efectivo no lleva formas de pago; no domiciliado sin actividad', () => {
    const dte = construirDonacion(ctx(), {
      receptor: { ...donante, tipoDocumento: '03', numDocumento: 'X1234567', codDomiciliado: 2, codPais: 'US', codActividad: '62010', descActividad: 'Programación' },
      documentosAsociados: resolucion,
      items: [{ tipoDonacion: 3, descripcion: 'Asesoría legal', valorUni: 250 }]
    })
    cumpleEsquema(dte)
    expect(dte.resumen.pagos).toBeNull()
    expect(dte.receptor).toMatchObject({ codDomiciliado: 2, codPais: 'US', codActividad: null, descActividad: null })
  })

  it('valida cantidad en efectivo, valor positivo, documentos asociados y pagos', () => {
    const base = { receptor: donante, documentosAsociados: resolucion }
    expect(() => construirDonacion(ctx(), { ...base, items: [{ tipoDonacion: 1, descripcion: 'x', cantidad: 2, valorUni: 10 }] })).toThrow(/cantidad 1/)
    expect(() => construirDonacion(ctx(), { ...base, items: [{ tipoDonacion: 2, descripcion: 'x', valorUni: 10, depreciacion: 10 }] })).toThrow(/mayor que 0/)
    expect(() => construirDonacion(ctx(), { ...base, documentosAsociados: [], items: [{ tipoDonacion: 3, descripcion: 'x', valorUni: 1 }] })).toThrow(/documentos asociados/)
    expect(() => construirDonacion(ctx(), { ...base, items: [{ tipoDonacion: 1, descripcion: 'x', valorUni: 10 }], pagos: [{ codigo: '04', montoPago: 5, referencia: 'CHQ-1' }] })).toThrow(/sumar/)
    const cheque = construirDonacion(ctx(), { ...base, items: [{ tipoDonacion: 1, descripcion: 'x', valorUni: 75 }], pagos: [{ codigo: '04', referencia: 'CHQ-1' }] })
    expect(cheque.resumen.pagos).toEqual([{ codigo: '04', montoPago: 75, referencia: 'CHQ-1' }])
    expect(() => construirDonacion(ctx(1, { contingencia: { tipo: 1 } }), { ...base, items: [{ tipoDonacion: 3, descripcion: 'x', valorUni: 1 }] })).toThrow(/contingencia/)
  })
})

describe('representación gráfica de 08, 09 y 15', () => {
  const cg = '0C46FF18-49CB-4155-85E5-7C9576E14C01'
  const documentos: Record<string, Dte> = {
    '08': construirLiquidacion(ctx(), { receptor: { ...contribuyente, codDomiciliado: 1 }, documentos: [
      { tipoDte: '03', numeroDocumento: cg, fechaEmision: '2026-11-03', ventaGravada: 500, ivaPercibido: 5 },
      { tipoDte: '05', numeroDocumento: cg.replace('01', '02'), fechaEmision: '2026-11-04', ventaGravada: 100, tributos: [{ codigo: 'D1', valor: 0.2 }] }
    ] }),
    '09': construirDocumentoContableLiquidacion(ctx(), { receptor: { ...contribuyente, tipoEstablecimiento: '02' }, periodo: { inicio: '2026-11-01', fin: '2026-11-07' }, valorOperaciones: 1130, porcentComision: 3, entrega: { nombre: 'Ana López', documento: '01234567-8', codEmpleado: 'E-15' } }),
    '15': construirDonacion(ctx(), { receptor: { tipoDocumento: '13', numDocumento: '01234567-8', nombre: 'María Gómez', codActividad: '10005', descActividad: 'Otros', direccion: { departamento: '06', municipio: '23', distrito: '14', complemento: 'Colonia Escalón' } }, documentosAsociados: [{ descripcion: 'Resolución', detalle: 'RES-01-2026' }], items: [
      { tipoDonacion: 1, descripcion: 'Donación en efectivo', valorUni: 100 },
      { tipoDonacion: 2, descripcion: 'Computadoras usadas', cantidad: 3, valorUni: 400, depreciacion: 150, uniMedida: 59 }
    ] })
  }
  it.each(Object.keys(documentos))('genera el PDF del tipo %s', async tipo => {
    const { generarPdfDte } = await import('../src/pdf')
    const pdf = await generarPdfDte(documentos[tipo]!)
    expect(pdf.length).toBeGreaterThan(1000)
    if (process.env.GUARDAR_PDF) (await import('node:fs')).writeFileSync(`${process.env.GUARDAR_PDF}/dte-${tipo}.pdf`, pdf)
  })
})
