import Ajv from 'ajv'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ClienteMH, ContingenciaRequeridaError, DteInvalidoError, DteRechazadoError, ESQUEMAS, construirContingencia, construirCreditoFiscal, construirFactura,
  construirInvalidacion, documentoParaInvalidar, emitirDte, firmarConCertificado, firmarSinTransmitir, generarCertificadoPrueba, leerCertificadoMH, leerJws,
  limiteInvalidacion, numeroALetras, redondear, transmitirDte, transmitirEvento, validarEstructura, verificarFirma, type CertificadoMH, type Firmante
} from '../src'
import { crearMockMH, type MockMH } from '../src/mh/mock'
import { contribuyente, ctx, emisor } from './fixtures'

const NIT = '06142907861023'
const PASSWORD_API = 'Api-Password-2026!'
let cert: CertificadoMH
let xml: string
let firmante: Firmante
let mock: MockMH
let cliente: ClienteMH

beforeAll(async () => {
  ;({ certificado: cert, xml } = await generarCertificadoPrueba(NIT, 'clave-privada'))
  firmante = { certificado: xml, password: 'clave-privada' }
})

const nuevoEntorno = () => {
  mock = crearMockMH({ usuarios: { [NIT]: PASSWORD_API }, llavesPublicas: { [NIT]: cert.llavePublica! } })
  cliente = new ClienteMH({ ambiente: '00', usuario: NIT, password: PASSWORD_API, fetch: mock.fetch, timeoutMs: 500 })
}
const factura = (correlativo: number, extra = {}) => construirFactura(ctx(correlativo, extra), { items: [{ descripcion: 'Producto', cantidad: 2, precioUni: 11.3 }] })

describe('firma electrónica', () => {
  it('produce un JWS RS512 verificable cuyo contenido es el DTE', async () => {
    const dte = factura(1)
    const jws = await firmarConCertificado(dte, xml, 'clave-privada')
    expect(leerJws(jws)).toEqual({ encabezado: { alg: 'RS512' }, contenido: dte })
    expect(await verificarFirma(jws, cert.llavePublica!)).toBe(true)
    expect(await verificarFirma(jws.slice(0, -4) + 'AAAA', cert.llavePublica!)).toBe(false)
  })
  it('rechaza una contraseña de llave privada incorrecta', async () => {
    await expect(firmarConCertificado(factura(1), xml, 'otra')).rejects.toThrow(/Contraseña/)
  })
  it('lee el formato .crt del MH', () => {
    expect(leerCertificadoMH(xml).nit).toBe(NIT)
    expect(() => leerCertificadoMH('<x/>')).toThrow(/Certificado inválido/)
  })
})

describe('emisión contra el MH simulado', () => {
  it('emite, sella y arma el archivo DTE con firmaElectronica y selloRecibido', async () => {
    nuevoEntorno()
    const { archivo, respuesta } = await emitirDte(cliente, factura(1), firmante)
    expect(respuesta.estado).toBe('PROCESADO')
    expect(archivo.selloRecibido).toHaveLength(40)
    expect(archivo.firmaElectronica.split('.')).toHaveLength(3)
    expect(Object.keys(archivo).slice(-2)).toEqual(['firmaElectronica', 'selloRecibido'])
  })

  it('no transmite un DTE que no cumple el esquema', async () => {
    nuevoEntorno()
    const dte = factura(1)
    dte.resumen.totalPagar = 'mucho'
    await expect(emitirDte(cliente, dte, firmante)).rejects.toBeInstanceOf(DteInvalidoError)
    expect(mock.recibidos.size).toBe(0)
  })

  it('propaga el rechazo del MH (número de control repetido)', async () => {
    nuevoEntorno()
    await emitirDte(cliente, factura(7), firmante)
    await expect(emitirDte(cliente, factura(7), firmante)).rejects.toBeInstanceOf(DteRechazadoError)
  })

  it('rechaza credenciales de API inválidas', async () => {
    nuevoEntorno()
    const malo = new ClienteMH({ ambiente: '00', usuario: NIT, password: 'x', fetch: mock.fetch })
    await expect(malo.autenticar()).rejects.toThrow(/Autenticación rechazada/)
  })

  it('política de reintentos: reenvía tras una caída y obtiene el sello', async () => {
    nuevoEntorno()
    mock.simularCaida(2)
    const { archivo } = await emitirDte(cliente, factura(1), firmante)
    expect(archivo.selloRecibido).toBeTruthy()
  })

  it('política de reintentos: si el MH sí lo recibió, la consulta recupera el sello sin duplicar', async () => {
    nuevoEntorno()
    mock.simularCaida(1, { procesar: true })
    const { archivo } = await emitirDte(cliente, factura(1), firmante)
    expect(archivo.selloRecibido).toBe(mock.recibidos.get(archivo.identificacion.codigoGeneracion)!.sello)
    expect(mock.recibidos.size).toBe(1)
  })

  it('tras 3 intentos sin respuesta pide operar en contingencia', async () => {
    nuevoEntorno()
    mock.simularCaida(3)
    await expect(emitirDte(cliente, factura(1), firmante)).rejects.toBeInstanceOf(ContingenciaRequeridaError)
  })

  it('flujo de contingencia: DTE diferido -> evento -> transmisión', async () => {
    nuevoEntorno()
    const dte = factura(1, { contingencia: { tipo: 3 } })
    const { firma } = await firmarSinTransmitir(dte, firmante)
    await expect(transmitirDte(cliente, dte, firma)).rejects.toThrow(/NO EXISTE EVENTO DE CONTINGENCIA/)
    const evento = construirContingencia({
      ambiente: '00', emisor, responsable: { nombre: 'Ana Gómez', tipoDocumento: '13', numDocumento: '012345678' }, tipoContingencia: 3,
      documentos: [{ tipoDte: '01', codigoGeneracion: dte.identificacion.codigoGeneracion }], inicio: new Date('2026-11-12T14:00:00Z'), fin: new Date('2026-11-12T16:00:00Z')
    })
    expect((await transmitirEvento(cliente, evento, firmante)).archivo.selloRecibido).toBeTruthy()
    expect((await transmitirDte(cliente, dte, firma)).selloRecibido).toBeTruthy()
  })

  it('invalidación con reemplazo', async () => {
    nuevoEntorno()
    const items = [{ descripcion: 'Servicio', cantidad: 1, precioUni: 100 }]
    const original = await emitirDte(cliente, construirCreditoFiscal(ctx(1), { receptor: contribuyente, items }), firmante)
    const reemplazo = await emitirDte(cliente, construirCreditoFiscal(ctx(2), { receptor: contribuyente, items }), firmante)
    const persona = { nombre: 'Ana Gómez', tipoDocumento: '13', numDocumento: '012345678' }
    const evento = construirInvalidacion({ ambiente: '00', emisor, documento: documentoParaInvalidar(original.archivo), tipoAnulacion: 1, motivoAnulacion: 'Error en el precio', codigoGeneracionReemplazo: reemplazo.archivo.identificacion.codigoGeneracion, responsable: persona, solicitante: persona })
    const { respuesta } = await transmitirEvento(cliente, evento, firmante)
    expect(respuesta.estado).toBe('PROCESADO')
    expect(mock.recibidos.get(original.archivo.identificacion.codigoGeneracion)!.invalidado).toBe(true)
    await expect(transmitirEvento(cliente, { ...evento, identificacion: { ...evento.identificacion, codigoGeneracion: crypto.randomUUID().toUpperCase() } }, firmante)).rejects.toThrow(/INVALIDADO/)
  })

  it('invalidación de un documento que recibió otra instancia: 014, salvo con aceptarDesconocidos', async () => {
    nuevoEntorno()
    const items = [{ descripcion: 'Servicio', cantidad: 1, precioUni: 100 }]
    const original = await emitirDte(cliente, construirCreditoFiscal(ctx(1), { receptor: contribuyente, items }), firmante)
    const persona = { nombre: 'Ana Gómez', tipoDocumento: '13', numDocumento: '012345678' }
    const evento = construirInvalidacion({ ambiente: '00', emisor, documento: documentoParaInvalidar(original.archivo), tipoAnulacion: 2, motivoAnulacion: 'Operación cancelada', responsable: persona, solicitante: persona })
    // Otra instancia del simulador: no conoce el documento.
    const otra = crearMockMH({ usuarios: { [NIT]: PASSWORD_API } })
    const conOtra = new ClienteMH({ ambiente: '00', usuario: NIT, password: PASSWORD_API, fetch: otra.fetch, timeoutMs: 500 })
    await expect(transmitirEvento(conOtra, evento, firmante)).rejects.toThrow(/NO EXISTE/)
    const tolerante = crearMockMH({ usuarios: { [NIT]: PASSWORD_API }, aceptarDesconocidos: true })
    const conTolerante = new ClienteMH({ ambiente: '00', usuario: NIT, password: PASSWORD_API, fetch: tolerante.fetch, timeoutMs: 500 })
    expect((await transmitirEvento(conTolerante, evento, firmante)).respuesta.estado).toBe('PROCESADO')
  })

  it('lotes', async () => {
    nuevoEntorno()
    const firmas = await Promise.all([1, 2, 3].map(async n => (await firmarSinTransmitir(factura(n), firmante)).firma))
    const lote = await cliente.recepcionLote({ version: 2, nitEmisor: NIT, documentos: [...firmas, firmas[0]!] })
    const resultado = await cliente.consultarLote(lote.codigoLote)
    expect([resultado.procesados.length, resultado.rechazados.length]).toEqual([3, 1])
  })
})

describe('validador propio frente a Ajv (esquemas oficiales)', () => {
  // multipleOf se excluye: Ajv lo evalúa en coma flotante y da falsos negativos.
  const sinMultipleOf = (n: any): any => Array.isArray(n) ? n.map(sinMultipleOf) : n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'multipleOf').map(([k, v]) => [k, sinMultipleOf(v)])) : n
  const ajv = new Ajv({ allErrors: true, strict: false, formats: { date: /^\d{4}-\d{2}-\d{2}$/ } })
  const mutaciones: Array<[string, (d: any) => void]> = [
    ['válido', () => {}],
    ['campo extra', d => { d.resumen.inventado = 1 }],
    ['campo faltante', d => { delete d.identificacion.horEmi }],
    ['tipo incorrecto', d => { d.cuerpoDocumento[0].cantidad = '2' }],
    ['patrón', d => { d.identificacion.codigoGeneracion = 'abc' }],
    ['enum', d => { d.identificacion.ambiente = '02' }],
    ['rango', d => { d.cuerpoDocumento[0].cantidad = 0 }],
    ['longitud', d => { d.emisor.telefono = '123' }],
    ['arreglo vacío', d => { d.cuerpoDocumento = [] }],
    ['null no permitido', d => { d.emisor = null }]
  ]
  it.each(mutaciones)('coincide con Ajv: %s', (_nombre, mutar) => {
    for (const dte of [factura(1), construirCreditoFiscal(ctx(1), { receptor: contribuyente, items: [{ descripcion: 'X', cantidad: 1, precioUni: 1 }] })]) {
      const copia = structuredClone(dte)
      mutar(copia)
      const tipo = dte.identificacion.tipoDte!
      const validar = ajv.getSchema(tipo) ?? ajv.addSchema(sinMultipleOf(ESQUEMAS[tipo]), tipo).getSchema(tipo)!
      expect(validarEstructura(copia).length === 0).toBe(validar(copia))
    }
  })
  it('limita decimales: 8 en el cuerpo, 2 en el resumen', () => {
    const dte = factura(1)
    dte.resumen.totalPagar = 22.601
    dte.cuerpoDocumento[0].precioUni = 1.123456789
    expect(validarEstructura(dte).map(p => p.ruta)).toEqual(['cuerpoDocumento[0].precioUni', 'resumen.totalPagar'])
    dte.resumen.totalPagar = 0.1
    dte.cuerpoDocumento[0].precioUni = 0.00000001
    expect(validarEstructura(dte)).toEqual([])
  })
})

describe('utilidades', () => {
  it('redondeo medio hacia arriba (Manual Funcional XXI)', () => {
    expect([5.664, 5.665, 5.666].map(v => redondear(v))).toEqual([5.66, 5.67, 5.67])
    expect(redondear(1.87654321987654, 8)).toBe(1.87654322)
    expect(redondear(3.555555554, 8)).toBe(3.55555555)
    expect(redondear(-5.665)).toBe(-5.67)
  })
  it('valor en letras', () => {
    expect(numeroALetras(2260)).toBe('DOS MIL DOSCIENTOS SESENTA 00/100 DÓLARES')
    expect(numeroALetras(1)).toBe('UNO 00/100 DÓLAR')
    expect(numeroALetras(21001.5)).toBe('VEINTIÚN MIL UNO 50/100 DÓLARES')
    expect(numeroALetras(1_000_100.99)).toBe('UN MILLÓN CIEN 99/100 DÓLARES')
    expect(numeroALetras(0.07)).toBe('CERO 07/100 DÓLARES')
  })
  it('plazo de invalidación (ejemplos del Manual Funcional VII)', () => {
    const sv = (d: Date) => new Date(d.getTime() - 6 * 3600_000).toISOString().slice(0, 19)
    expect(sv(limiteInvalidacion('01', new Date('2025-11-11T13:30:00Z')))).toBe('2026-02-11T23:59:59')
    expect(sv(limiteInvalidacion('03', new Date('2026-04-25T06:30:00Z'), ['2026-05-01']))).toBe('2026-05-15T23:59:59')
    expect(sv(limiteInvalidacion('01', new Date('2025-11-30T18:00:00Z')))).toBe('2026-02-28T23:59:59')
  })
})
