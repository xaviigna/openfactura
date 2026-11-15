import type { Contexto, Emisor } from '../src'

export const emisor: Emisor = {
  nit: '0614-290786-102-3',
  nrc: '123456-7',
  nombre: 'EMPRESA DE PRUEBA, S.A. DE C.V.',
  codActividad: '62010',
  descActividad: 'Programación informática',
  nombreComercial: 'Open Factura',
  tipoEstablecimiento: '02',
  direccion: { departamento: '06', municipio: '23', distrito: '14', complemento: 'Calle El Rosal #567, Col. Escalón' },
  telefono: '22223333',
  correo: 'facturacion@ejemplo.com.sv',
  codEstableMH: 'M001',
  codPuntoVentaMH: 'P001'
}

export const contribuyente = {
  nit: '06142907861031',
  nrc: '2345678',
  nombre: 'CLIENTE CONTRIBUYENTE, S.A. DE C.V.',
  codActividad: '46900',
  descActividad: 'Venta al por mayor de otros productos',
  direccion: { departamento: '06', municipio: '23', distrito: '14', complemento: 'Av. Olímpica #100' },
  telefono: '22445566',
  correo: 'compras@cliente.com.sv'
}

export const ctx = (correlativo = 1, extra: Partial<Contexto> = {}): Contexto => ({ ambiente: '00', emisor, correlativo, fecha: new Date('2026-11-12T16:30:00Z'), ...extra })
