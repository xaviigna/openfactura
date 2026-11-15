import { describe, expect, it } from 'vitest'
import {
  construirContingencia, construirCreditoFiscal, construirExportacion, construirFactura, construirInvalidacion, construirNotaCredito, construirNotaDebito,
  construirNotaRemision, construirOperacionesEspeciales, construirRetencion, construirRetorno, construirSujetoExcluido, documentoParaInvalidar, limiteRetorno, validarDte, type Dte
} from '../src'
import { contribuyente, ctx, emisor } from './fixtures'

const sinProblemas = (dte: Dte) => expect(validarDte(dte)).toEqual([])

describe('Factura (01, v2)', () => {
  it('calcula IVA incluido y cumple el esquema oficial', () => {
    const dte = construirFactura(ctx(), { items: [{ descripcion: 'Servicio de consultoría', cantidad: 1, precioUni: 113, tipoItem: 2 }] })
    sinProblemas(dte)
    expect(dte.identificacion).toMatchObject({ version: 2, tipoDte: '01', numeroControl: 'DTE-01-M001P001-000000000000001', tipoModelo: 1, tipoOperacion: 1, fecEmi: '2026-11-12', horEmi: '10:30:00' })
    expect(dte.emisor).toMatchObject({ nit: '06142907861023', nrc: '1234567' })
    expect(dte.receptor).toBeNull()
    expect(dte.cuerpoDocumento[0]).toMatchObject({ ventaGravada: 113, ivaItem: 13, tributos: null })
    expect(dte.resumen).toMatchObject({ totalGravada: 113, subTotal: 113, montoTotalOperacion: 113, totalIva: 13, totalPagar: 113, totalLetras: 'CIENTO TRECE 00/100 DÓLARES', condicionOperacion: 1 })
    expect(dte.resumen.pagos).toEqual([{ codigo: '01', montoPago: 113, referencia: null, plazo: null, periodo: null }])
  })

  it('mezcla ventas gravadas, exentas y descuento global porcentual', () => {
    const dte = construirFactura(ctx(), {
      receptor: { tipoDocumento: '13', numDocumento: '01234567-8', nombre: 'Juan Pérez' },
      items: [
        { descripcion: 'A', cantidad: 10, precioUni: 25, descuento: 25 },
        { descripcion: 'B', cantidad: 5, precioUni: 80, descuento: 15 },
        { descripcion: 'C', cantidad: 4, precioUni: 10, descuento: 5, tipoVenta: 'exenta' }
      ],
      descuentos: { porcentaje: 10 }
    })
    sinProblemas(dte)
    // Manual Funcional XVIII, ejemplo de aplicación 2.
    expect(dte.resumen).toMatchObject({ totalExenta: 35, totalGravada: 610, subTotalVentas: 645, descuExenta: 3.5, descuGravada: 61, porcentajeDescuento: 10, totalDescu: 109.5, subTotal: 580.5 })
    expect(dte.receptor.numDocumento).toBe('012345678')
  })

  it('con abonos mayores al total deja saldo a favor y pago 99', () => {
    const dte = construirFactura(ctx(), { items: [{ descripcion: 'X', cantidad: 1, precioUni: 10 }, { descripcion: 'Anticipo', cantidad: 1, precioUni: 0, noGravado: -15 }] })
    sinProblemas(dte)
    expect(dte.resumen).toMatchObject({ totalPagar: 0, saldoFavor: -5, totalNoGravado: -15 })
    expect(dte.resumen.pagos[0].codigo).toBe('99')
    expect(dte.cuerpoDocumento[1].uniMedida).toBe(99)
  })

  it('a crédito informa plazo y periodo', () => {
    const dte = construirFactura(ctx(), { items: [{ descripcion: 'X', cantidad: 1, precioUni: 500 }], condicionOperacion: 2, credito: { plazo: '02', periodo: 6 } })
    sinProblemas(dte)
    expect(dte.resumen.pagos).toEqual([{ codigo: null, montoPago: 0, referencia: null, plazo: '02', periodo: 6 }])
  })

  it('desde 25,000 USD exige identificar al receptor', () => {
    const items = [{ descripcion: 'Vehículo', cantidad: 1, precioUni: 25000 }]
    expect(() => construirFactura(ctx(), { items })).toThrow(/receptor requiere/)
    sinProblemas(construirFactura(ctx(), { items, receptor: { tipoDocumento: '13', numDocumento: '012345678', nombre: 'Juan Pérez' } }))
  })

  it('en contingencia usa modelo diferido', () => {
    const dte = construirFactura(ctx(1, { contingencia: { tipo: 1 } }), { items: [{ descripcion: 'X', cantidad: 1, precioUni: 1 }] })
    sinProblemas(dte)
    expect(dte.identificacion).toMatchObject({ tipoModelo: 2, tipoOperacion: 2, tipoContingencia: 1 })
  })
})

describe('Comprobante de Crédito Fiscal (03, v4)', () => {
  it('reproduce el ejemplo del Manual Funcional (descuento global 10% + retención + pagos no afectos)', () => {
    const dte = construirCreditoFiscal(ctx(), {
      receptor: contribuyente,
      items: [
        { descripcion: 'Camisas/gris', codigo: '00D56', cantidad: 10, precioUni: 11, descuento: 10 },
        { descripcion: 'Centros', codigo: '00C25', cantidad: 15, precioUni: 5 },
        { descripcion: 'Jeans', codigo: '0056D', cantidad: 25, precioUni: 21, descuento: 25 },
        { descripcion: 'Cinturón', codigo: '0D586', cantidad: 5, precioUni: 20 },
        { descripcion: 'Pagos no afectos', cantidad: 1, precioUni: 0, noGravado: -20 }
      ],
      descuentos: { porcentaje: 10 },
      retencionIva: true
    })
    sinProblemas(dte)
    expect(dte.resumen).toMatchObject({ totalGravada: 775, descuGravada: 77.5, subTotal: 697.5, ivaRete: 6.98, montoTotalOperacion: 788.18, totalNoGravado: -20, totalPagar: 761.2 })
    expect(dte.resumen.tributos).toEqual([{ codigo: '20', descripcion: 'Impuesto al Valor Agregado 13%', valor: 90.68 }])
    expect(dte.cuerpoDocumento[0].tributos).toEqual(['20'])
    expect(dte.cuerpoDocumento[4].tributos).toBeNull()
  })

  it('consolida FOVIAL y COTRANS por galón', () => {
    const dte = construirCreditoFiscal(ctx(), { receptor: contribuyente, items: [{ descripcion: 'Diésel', cantidad: 50, precioUni: 4, uniMedida: 22, tributos: ['D1', 'C8'] }] })
    sinProblemas(dte)
    expect(dte.resumen.tributos.map((t: any) => [t.codigo, t.valor])).toEqual([['20', 26], ['D1', 10], ['C8', 5]])
    expect(dte.resumen.montoTotalOperacion).toBe(241)
  })

  it('exige los datos del contribuyente receptor', () => {
    expect(() => construirCreditoFiscal(ctx(), { receptor: { nombre: 'X' }, items: [{ descripcion: 'X', cantidad: 1, precioUni: 1 }] })).toThrow(/nit, nrc/)
  })
})

describe('Notas (05/06, v4)', () => {
  const relacionado = { tipoDocumento: '03', tipoGeneracion: 2 as const, numeroDocumento: 'AC54E9DB-79C5-42CE-B430-EC552C97EFBA', fechaEmision: '2026-05-13' }

  it('nota de crédito del ejemplo del Manual Funcional', () => {
    const dte = construirNotaCredito(ctx(), {
      receptor: contribuyente,
      documentosRelacionados: [relacionado],
      items: [{ descripcion: 'Jeans', codigo: '0056D', cantidad: 5, precioUni: 21, descuento: 15 }, { descripcion: 'Pagos no afectos', cantidad: 1, precioUni: 0, noGravado: -5 }],
      retencionIva: true
    })
    sinProblemas(dte)
    expect(dte.resumen).toMatchObject({ totalGravada: 90, totalDescu: 15, montoTotalOperacion: 101.7, ivaRete: 0.9, totalNoGravado: -5, totalPagar: 95.8, totalIva: 0 })
    // Al ajustar un CCF el IVA va como tributo 20; «IVA 13 %» sólo aplica al ajustar un CR (07).
    expect(dte.cuerpoDocumento[0]).toMatchObject({ numeroDocumento: relacionado.numeroDocumento, totalIva: 0, ivaRete: 0.9 })
    expect(dte.resumen.tributos).toEqual([{ codigo: '20', descripcion: 'Impuesto al Valor Agregado 13%', valor: 11.7 }])
    const sobreRetencion = construirNotaCredito(ctx(), { receptor: contribuyente, documentosRelacionados: [{ ...relacionado, tipoDocumento: '07' }], items: [{ descripcion: 'Ajuste', cantidad: 1, precioUni: 100 }] })
    expect(sobreRetencion.resumen.totalIva).toBe(13)
    expect(dte.receptor).toMatchObject({ tipoDocumento: '36', numDocumento: '06142907861031' })
  })

  it('nota de débito', () => {
    const dte = construirNotaDebito(ctx(), { receptor: contribuyente, documentosRelacionados: [relacionado], items: [{ descripcion: 'Ajuste de precio', cantidad: 1, precioUni: 100 }] })
    sinProblemas(dte)
    expect(dte.identificacion.tipoDte).toBe('06')
    expect(dte.resumen.totalPagar).toBe(113)
  })
})

describe('otros DTE', () => {
  it('nota de remisión (04, v4)', () => {
    const dte = construirNotaRemision(ctx(), { receptor: contribuyente, bienTitulo: '04', items: [{ descripcion: 'Laptop', cantidad: 2, precioUni: 800 }] })
    sinProblemas(dte)
    expect(dte.resumen).toMatchObject({ totalGravada: 1600, montoTotalOperacion: 1808 })
  })

  it('factura de sujeto excluido (14, v2) con retención de renta', () => {
    const dte = construirSujetoExcluido(ctx(), {
      sujetoExcluido: { tipoDocumento: '13', numDocumento: '01234567-8', nombre: 'María López', direccion: emisor.direccion },
      items: [{ descripcion: 'Servicio de jardinería', cantidad: 1, precioUni: 200, tipoItem: 2 }],
      retencionRenta: true
    })
    sinProblemas(dte)
    expect(dte.resumen).toMatchObject({ totalCompra: 200, subTotal: 200, reteRenta: 20, totalPagar: 180 })
  })

  it('factura de exportación (11, v3)', () => {
    const dte = construirExportacion(ctx(), {
      receptor: { nombre: 'ACME Inc.', tipoDocumento: '37', numDocumento: 'US-123456', codPais: 'US', complemento: '1 Main St, Austin TX', tipoPersona: 2, descActividad: 'Software' },
      tipoItemExpor: 1, recintoFiscal: '01', tipoRegimen: 'EX-1', regimen: '1000.000', codIncoterms: '01',
      items: [{ descripcion: 'Café oro', cantidad: 100, precioUni: 3.5, uniMedida: 36 }],
      flete: 50, seguro: 10
    })
    sinProblemas(dte)
    expect(dte.resumen).toMatchObject({ totalGravada: 350, montoTotalOperacion: 410, totalPagar: 410 })
    expect(dte.resumen.tributos).toEqual([{ codigo: 'C3', descripcion: 'Impuesto al Valor Agregado (exportaciones) 0%', valor: 0 }])
    expect(dte.receptor.nombrePais).toBe('Estados Unidos')
  })

  it('comprobante de retención (07, v2)', () => {
    const dte = construirRetencion(ctx(), {
      receptor: contribuyente,
      items: [{ tipoDte: '03', tipoGeneracion: 2, numeroDocumento: 'AC54E9DB-79C5-42CE-B430-EC552C97EFBA', fechaEmision: '2026-11-01', montoSujetoGrav: 1000, codigoRetencionMH: '22', descripcion: 'Retención 1%' }]
    })
    sinProblemas(dte)
    // «IVA 13 %» del resumen sólo se calcula con el código C4; con la retención del 1 % va en 0.
    expect(dte.resumen).toMatchObject({ totalSujetoRetencion: 1000, totalIvaRetenido: 10, totalIva: 0 })
    const trece = construirRetencion(ctx(), {
      receptor: contribuyente,
      items: [{ tipoDte: '03', tipoGeneracion: 2, numeroDocumento: 'AC54E9DB-79C5-42CE-B430-EC552C97EFBA', fechaEmision: '2026-11-01', montoSujetoGrav: 1000, codigoRetencionMH: 'C4', descripcion: 'Retención 13%' }]
    })
    expect(trece.resumen).toMatchObject({ totalIvaRetenido: 130, totalIva: 130 })
  })
})

describe('eventos', () => {
  const persona = { nombre: 'Ana Gómez', tipoDocumento: '13', numDocumento: '01234567-8' }
  const sellado = { tipoDte: '03', codigoGeneracion: 'AC54E9DB-79C5-42CE-B430-EC552C97EFBA', selloRecibido: '2026'.padEnd(40, 'A'), numeroControl: 'DTE-03-M001P001-000000000000001', fecEmi: '2026-10-29' }

  it('invalidación (v3): un CCF usa la fecha de generación del DTE', () => {
    const evento = construirInvalidacion({ ambiente: '00', emisor, documento: sellado, tipoAnulacion: 2, responsable: persona, solicitante: persona, fecha: new Date('2026-11-12T16:30:00Z') })
    sinProblemas(evento)
    expect(evento.identificacion.fecEmi).toBe('2026-10-29')
    expect(evento.documento.codigoGeneracionR).toBeNull()
  })

  it('invalidación por error exige el DTE de reemplazo', () => {
    expect(() => construirInvalidacion({ ambiente: '00', emisor, documento: sellado, tipoAnulacion: 1, responsable: persona, solicitante: persona })).toThrow(/codigoGeneracionReemplazo/)
  })

  it('contingencia (v4)', () => {
    const evento = construirContingencia({
      ambiente: '00', emisor, responsable: persona, tipoContingencia: 3,
      documentos: [{ tipoDte: '01', codigoGeneracion: 'AC54E9DB-79C5-42CE-B430-EC552C97EFBA' }],
      inicio: new Date('2026-11-12T14:00:00Z'), fin: new Date('2026-11-12T16:00:00Z')
    })
    sinProblemas(evento)
    expect(evento.motivo).toMatchObject({ fInicio: '2026-11-12', hInicio: '08:00:00', hFin: '10:00:00' })
  })
})

describe('evento de retorno (18, v1)', () => {
  const fecha = new Date('2026-11-20T16:30:00Z')
  const sellar = (dte: Dte) => ({ ...dte, selloRecibido: '2026'.padEnd(40, 'A') })
  const consumidor = { tipoDocumento: '13', numDocumento: '01234567-8', nombre: 'Juan Pérez', correo: 'juan@correo.sv' }
  const factura = sellar(construirFactura(ctx(), {
    receptor: consumidor,
    items: [{ descripcion: 'Silla', cantidad: 4, precioUni: 22.6 }, { descripcion: 'Mesa', cantidad: 1, precioUni: 113 }]
  }))

  it('retorno parcial de una factura: precios con IVA, receptor copiado del DTE', () => {
    const evento = construirRetorno({ ambiente: '00', emisor, documentos: [factura], items: [{ descripcion: 'Silla', cantidad: 1, precioUni: 22.6 }], fecha })
    sinProblemas(evento)
    expect(evento.identificacion).toMatchObject({ tipoEvento: '18', version: 1, fecEmi: '2026-11-20', tipoModelo: 1 })
    expect(evento.documentoRelacionado).toEqual([{ tipoDocumento: '01', codigoGeneracion: factura.identificacion.codigoGeneracion, fechaEmision: '2026-11-12' }])
    expect(evento.documento).toMatchObject({ tipoDocumento: '13', numDocumento: '012345678', nombre: 'Juan Pérez', codPais: null })
    expect(evento.cuerpoDocumento[0]).toMatchObject({ codigoGeneracion: factura.identificacion.codigoGeneracion, ventaGravada: 22.6, ivaItem: 2.6, compra: 0 })
    expect(evento.resumen).toMatchObject({ totalGravada: 22.6, subTotalVentas: 22.6, montoTotalOperacion: 22.6, totalIva: 2.6, totalPagar: 22.6, tributos: null })
  })

  it('retorno de una factura de sujeto excluido con retención de renta', () => {
    const fse = sellar(construirSujetoExcluido(ctx(), {
      sujetoExcluido: { tipoDocumento: '13', numDocumento: '01234567-8', nombre: 'María López', direccion: emisor.direccion },
      items: [{ descripcion: 'Maíz', cantidad: 10, precioUni: 20 }],
      retencionRenta: true
    }))
    const evento = construirRetorno({ ambiente: '00', emisor, documentos: [fse], items: [{ descripcion: 'Maíz', cantidad: 5, precioUni: 20 }], fecha })
    sinProblemas(evento)
    expect(evento.cuerpoDocumento[0]).toMatchObject({ compra: 100, ventaGravada: 0, reteRenta: 10, tributos: null })
    expect(evento.resumen).toMatchObject({ totalCompraExcluidos: 100, montoTotalOperacion: 100, reteRenta: 10, totalPagar: 90, totalIva: 0 })
  })

  it('retorno de una factura de exportación: copia país y datos aduaneros', () => {
    const fex = sellar(construirExportacion(ctx(), {
      receptor: { nombre: 'ACME Inc.', tipoDocumento: '37', numDocumento: 'US-123456', codPais: 'US', complemento: '1 Main St', tipoPersona: 2, descActividad: 'Software' },
      tipoItemExpor: 1, recintoFiscal: '01', tipoRegimen: 'EX-1', regimen: '1000.000',
      items: [{ descripcion: 'Café oro', cantidad: 100, precioUni: 3.5, uniMedida: 36 }]
    }))
    const evento = construirRetorno({ ambiente: '00', emisor, documentos: [fex], items: [{ descripcion: 'Café oro', cantidad: 10, precioUni: 3.5, uniMedida: 36 }], fecha })
    sinProblemas(evento)
    expect(evento.emisor).toMatchObject({ tipoItemExpor: 1, recintoFiscal: '01', tipoRegimen: 'EX-1', regimen: '1000.000' })
    expect(evento.documento).toMatchObject({ codPais: 'US', nombrePais: 'Estados Unidos' })
    expect(evento.cuerpoDocumento[0]!.tributos).toEqual(['C3'])
    expect(evento.resumen).toMatchObject({ totalGravada: 35, montoTotalOperacion: 35, totalPagar: 35 })
  })

  it('rechaza CCF, DTE sin sello, plazo vencido y fecha anterior al DTE', () => {
    const items = [{ descripcion: 'Silla', cantidad: 1, precioUni: 22.6 }]
    const ccf = sellar(construirCreditoFiscal(ctx(), { receptor: contribuyente, items: [{ descripcion: 'X', cantidad: 1, precioUni: 10 }] }))
    expect(() => construirRetorno({ ambiente: '00', emisor, documentos: [ccf], items, fecha })).toThrow(/sólo se aplica/)
    expect(() => construirRetorno({ ambiente: '00', emisor, documentos: [{ ...factura, selloRecibido: null }], items, fecha })).toThrow(/sello/)
    expect(() => construirRetorno({ ambiente: '00', emisor, documentos: [factura], items, fecha: new Date('2027-02-13T16:30:00Z') })).toThrow(/plazo/)
    expect(() => construirRetorno({ ambiente: '00', emisor, documentos: [factura], items, fecha: new Date('2026-11-11T16:30:00Z') })).toThrow(/anterior/)
  })

  it('con varios DTE cada ítem indica a cuál pertenece', () => {
    const otra = sellar(construirFactura(ctx(2), { receptor: consumidor, items: [{ descripcion: 'Sofá', cantidad: 1, precioUni: 339 }] }))
    expect(() => construirRetorno({ ambiente: '00', emisor, documentos: [factura, otra], items: [{ descripcion: 'Silla', cantidad: 1, precioUni: 22.6 }], fecha })).toThrow(/codigoGeneracion/)
    const evento = construirRetorno({
      ambiente: '00', emisor, documentos: [factura, otra], fecha,
      items: [
        { codigoGeneracion: factura.identificacion.codigoGeneracion, descripcion: 'Silla', cantidad: 1, precioUni: 22.6 },
        { codigoGeneracion: otra.identificacion.codigoGeneracion, descripcion: 'Sofá', cantidad: 1, precioUni: 339 }
      ]
    })
    sinProblemas(evento)
    expect(evento.documentoRelacionado).toHaveLength(2)
    expect(evento.resumen.montoTotalOperacion).toBe(361.6)
  })

  it('un retorno sellado se puede invalidar y tiene representación gráfica', async () => {
    const evento = sellar(construirRetorno({ ambiente: '00', emisor, documentos: [factura], items: [{ descripcion: 'Silla', cantidad: 1, precioUni: 22.6 }], fecha }))
    const persona = { nombre: 'Ana Gómez', tipoDocumento: '13', numDocumento: '01234567-8' }
    const invalidacion = construirInvalidacion({ ambiente: '00', emisor, documento: documentoParaInvalidar(evento), tipoAnulacion: 2, responsable: persona, solicitante: persona, fecha: new Date('2026-11-21T16:30:00Z') })
    sinProblemas(invalidacion)
    expect(invalidacion.documento).toMatchObject({ tipoDte: '18', numeroControl: null, nombre: 'Juan Pérez', fecEmi: '2026-11-20' })
    expect(invalidacion.identificacion.fecEmi).toBe('2026-11-21')
    const { generarPdfDte } = await import('../src/pdf')
    expect((await generarPdfDte(evento)).length).toBeGreaterThan(1000)
  })

  it('plazo: 3 meses desde la generación, 2 años para ciertas actividades en FE y FEXE', () => {
    expect(limiteRetorno('01', '2026-11-30').toISOString()).toBe('2027-03-01T05:59:59.000Z')
    expect(limiteRetorno('01', '2026-11-12', '47721').toISOString()).toBe('2028-11-13T05:59:59.000Z')
    expect(limiteRetorno('14', '2026-11-12', '47721').toISOString()).toBe('2027-02-13T05:59:59.000Z')
  })
})

describe('evento de operaciones especiales (17, v1)', () => {
  const fecha = new Date('2026-03-05T16:30:00Z')

  it('comprobantes de control interno uno a uno (Manual Funcional IX, ejemplo 1)', () => {
    const evento = construirOperacionesEspeciales({
      ambiente: '00', emisor, tipoDocumento: '97', fecha,
      items: [
        { numDocumento: 'DCIXXXXBC', fechaEmision: '2026-02-27', descripcion: 'Comprobante de control interno', precioUni: 200.42 },
        { numDocumento: 'DCIX555C', fechaEmision: '2026-02-28', descripcion: 'Comprobante de control interno', precioUni: 200 }
      ]
    })
    sinProblemas(evento)
    expect(evento.emisor).toEqual({ nit: '06142907861023', nombre: emisor.nombre })
    expect(evento.cuerpoDocumento[0]).toMatchObject({ cantidad: 1, docDel: null, docAl: null, tributos: ['20'] })
    expect(evento.resumen).toMatchObject({ totalGravada: 400.42, subTotal: 400.42, total: 452.47 })
    expect(evento.resumen.tributos).toEqual([{ codigo: '20', descripcion: 'Impuesto al Valor Agregado 13%', valor: 52.05 }])
  })

  it('facturas simplificadas por rangos (Manual Funcional IX, ejemplo con 100 facturas)', () => {
    const d = { descripcion: 'Facturas simplificadas', fechaEmision: '2026-02-27' }
    const evento = construirOperacionesEspeciales({
      ambiente: '00', emisor, tipoDocumento: '02', fecha,
      items: [
        { ...d, docDel: '1', docAl: '25', precioUni: 10 },
        { ...d, docDel: '26', docAl: '27', precioUni: 8.65 },
        { ...d, docDel: '28', docAl: '98', precioUni: 2 },
        { ...d, docDel: '99', docAl: '99', precioUni: 7.5 },
        { ...d, docDel: '100', docAl: '100', precioUni: 10, tipoVenta: 'exenta' }
      ]
    })
    sinProblemas(evento)
    expect(evento.cuerpoDocumento.map((c: any) => c.cantidad)).toEqual([25, 2, 71, 1, 1])
    expect(evento.cuerpoDocumento[4]).toMatchObject({ ventaExenta: 10, ventaGravada: 0, tributos: null })
    expect(evento.resumen).toMatchObject({ totalExenta: 10, totalGravada: 416.8, subTotal: 426.8, total: 480.98 })
    expect(evento.resumen.tributos[0].valor).toBe(54.18)
  })

  it('no mezcla uno a uno con rangos ni acepta facturas simplificadas uno a uno', () => {
    const base = { ambiente: '00' as const, emisor, fecha, tipoDocumento: '97' as const }
    expect(() => construirOperacionesEspeciales({ ...base, items: [
      { numDocumento: 'A1', fechaEmision: '2026-02-01', descripcion: 'x', precioUni: 1 },
      { docDel: '1', docAl: '5', descripcion: 'x', precioUni: 1 }
    ] })).toThrow(/mezclar/)
    expect(() => construirOperacionesEspeciales({ ...base, tipoDocumento: '02', items: [{ numDocumento: 'A1', fechaEmision: '2026-02-01', descripcion: 'x', precioUni: 1 }] })).toThrow(/rangos/)
  })
})
