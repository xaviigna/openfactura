import { crearMockMH, type MockMH } from '@openfactura/dte/mock'

/**
 * Simulador del MH (MH_SIMULADO=1). Sólo lo usan las credenciales que genera el servidor
 * (`credencial_mh.simulada`); las que sube el usuario van siempre a Hacienda.
 * Vive en la memoria de cada instancia del Worker, así que acepta invalidar documentos que recibió
 * otra instancia. No reproduce todas las validaciones fiscales de Hacienda.
 */
const simuladores = new Map<string, MockMH>()

export function simuladorPara(nit: string, apiPassword: string): MockMH {
  const clave = `${nit}:${apiPassword}`
  let mock = simuladores.get(clave)
  if (!mock) {
    mock = crearMockMH({ usuarios: { [nit]: apiPassword }, aceptarDesconocidos: true })
    simuladores.set(clave, mock)
  }
  return mock
}
