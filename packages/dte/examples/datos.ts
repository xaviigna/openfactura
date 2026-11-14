import type { Emisor } from '../src'

/** Emisor ficticio para la demo. Sustitúyelo por tus datos reales para el ambiente de pruebas. */
export const emisorDemo: Emisor = {
  nit: '06142907861023',
  nrc: '1234567',
  nombre: 'EMPRESA DEMO, S.A. DE C.V.',
  codActividad: '62010',
  descActividad: 'Programación informática',
  nombreComercial: 'Open Factura Demo',
  tipoEstablecimiento: '02',
  direccion: { departamento: '06', municipio: '23', distrito: '14', complemento: 'Calle El Rosal #567, Col. Escalón' },
  telefono: '22223333',
  correo: 'facturacion@ejemplo.com.sv',
  codEstableMH: 'M001',
  codPuntoVentaMH: 'P001'
}
