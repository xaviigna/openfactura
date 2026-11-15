/**
 * Emite una Factura en el AMBIENTE DE PRUEBAS real de Hacienda.
 * Requiere tus credenciales (ver docs/ser-emisor.md):
 *   MH_NIT=06140000000000 MH_API_PASSWORD='…' MH_CERT=./06140000000000.crt MH_CERT_PASSWORD='…' \
 *   CORRELATIVO=1 npx tsx examples/emitir-pruebas.ts
 * Edita `emisor` en examples/datos.ts con los datos reales de tu NIT antes de ejecutar.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { ClienteMH, DteRechazadoError, construirFactura, emitirDte } from '../src'
import { generarPdfDte } from '../src/pdf'
import { emisorDemo } from './datos'

const { MH_NIT, MH_API_PASSWORD, MH_CERT, MH_CERT_PASSWORD, CORRELATIVO } = process.env
if (!MH_NIT || !MH_API_PASSWORD || !MH_CERT || !MH_CERT_PASSWORD) throw new Error('Faltan MH_NIT, MH_API_PASSWORD, MH_CERT o MH_CERT_PASSWORD')

const emisor = { ...emisorDemo, nit: MH_NIT }
const cliente = new ClienteMH({ ambiente: '00', usuario: MH_NIT, password: MH_API_PASSWORD })
const dte = construirFactura({ ambiente: '00', emisor, correlativo: Number(CORRELATIVO ?? 1) }, { items: [{ descripcion: 'Producto de prueba', cantidad: 1, precioUni: 11.3 }] })

try {
  const { archivo, respuesta } = await emitirDte(cliente, dte, { certificado: readFileSync(MH_CERT, 'utf8'), password: MH_CERT_PASSWORD })
  const codigo = archivo.identificacion.codigoGeneracion
  writeFileSync(`${codigo}.json`, JSON.stringify(archivo, null, 2))
  writeFileSync(`${codigo}.pdf`, await generarPdfDte(archivo))
  console.log('PROCESADO', respuesta.selloRecibido, respuesta.observaciones)
} catch (error) {
  if (error instanceof DteRechazadoError) console.error('RECHAZADO', JSON.stringify(error.respuesta, null, 2))
  else throw error
}
