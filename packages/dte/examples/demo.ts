/**
 * Demo de punta a punta, sin credenciales: construye una Factura y un CCF,
 * los valida, firma, transmite a un MH simulado e invalida uno.
 * Uso: npm run demo   →   deja JSON y PDF en packages/dte/examples/salida/
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { ClienteMH, construirCreditoFiscal, construirFactura, construirInvalidacion, documentoParaInvalidar, emitirDte, generarCertificadoPrueba, transmitirEvento } from '../src'
import { crearMockMH } from '../src/mh/mock'
import { generarPdfDte } from '../src/pdf'
import { emisorDemo as emisor } from './datos'

const salida = new URL('./salida/', import.meta.url)
mkdirSync(salida, { recursive: true })

const { xml, certificado } = await generarCertificadoPrueba(emisor.nit, 'clave-demo')
const firmante = { certificado: xml, password: 'clave-demo' }
const mock = crearMockMH({ usuarios: { [emisor.nit]: 'Password-API-123!' }, llavesPublicas: { [emisor.nit]: certificado.llavePublica! } })
const cliente = new ClienteMH({ ambiente: '00', usuario: emisor.nit, password: 'Password-API-123!', fetch: mock.fetch })

const guardar = async (archivo: Awaited<ReturnType<typeof emitirDte>>['archivo']) => {
  const codigo = archivo.identificacion.codigoGeneracion
  writeFileSync(new URL(`${codigo}.json`, salida), JSON.stringify(archivo, null, 2))
  writeFileSync(new URL(`${codigo}.pdf`, salida), await generarPdfDte(archivo))
  return codigo
}

const factura = await emitirDte(cliente, construirFactura({ ambiente: '00', emisor, correlativo: 1 }, {
  receptor: { tipoDocumento: '13', numDocumento: '012345678', nombre: 'Juan Pérez', correo: 'juan@ejemplo.com' },
  items: [
    { descripcion: 'Café de especialidad 340 g', codigo: 'CAFE-340', cantidad: 2, precioUni: 9.5 },
    { descripcion: 'Taza de cerámica', cantidad: 1, precioUni: 12, descuento: 2 }
  ]
}), firmante)
console.log(`Factura   ${factura.archivo.identificacion.numeroControl}  sello ${factura.archivo.selloRecibido}  total $${factura.archivo.resumen.totalPagar}`)
await guardar(factura.archivo)

const ccf = await emitirDte(cliente, construirCreditoFiscal({ ambiente: '00', emisor, correlativo: 1 }, {
  receptor: {
    nit: '06142907861031', nrc: '2345678', nombre: 'CLIENTE CONTRIBUYENTE, S.A. DE C.V.', codActividad: '46900', descActividad: 'Venta al por mayor de otros productos',
    direccion: { departamento: '06', municipio: '23', distrito: '14', complemento: 'Av. Olímpica #100' }, correo: 'compras@cliente.com.sv'
  },
  items: [{ descripcion: 'Desarrollo de software (horas)', tipoItem: 2, cantidad: 40, precioUni: 35 }],
  condicionOperacion: 2, credito: { plazo: '01', periodo: 30 }
}), firmante)
console.log(`CCF       ${ccf.archivo.identificacion.numeroControl}  sello ${ccf.archivo.selloRecibido}  total $${ccf.archivo.resumen.totalPagar}`)
await guardar(ccf.archivo)

const persona = { nombre: 'Ana Gómez', tipoDocumento: '13', numDocumento: '012345678' }
const invalidacion = await transmitirEvento(cliente, construirInvalidacion({ ambiente: '00', emisor, documento: documentoParaInvalidar(factura.archivo), tipoAnulacion: 2, motivoAnulacion: 'El cliente rescindió la compra', responsable: persona, solicitante: persona }), firmante)
console.log(`Invalidación de la factura: ${invalidacion.respuesta.descripcionMsg} (sello ${invalidacion.archivo.selloRecibido})`)
console.log(`\nArchivos en ${salida.pathname}`)
console.log('Nota: el MH es simulado. Para el ambiente de pruebas real vea examples/emitir-pruebas.ts')
