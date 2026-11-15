import { crearMockMH, type MockMH } from '@openfactura/dte/mock'

/**
 * Simulador del MH (MH_SIMULADO=1). Sólo lo usan las credenciales que genera el servidor
 * (`credencial_mh.simulada`); las que sube el usuario van siempre a Hacienda.
 * Vive en la memoria de cada instancia del Worker, así que acepta invalidar documentos que recibió
 * otra instancia. No reproduce todas las validaciones fiscales de Hacienda.
 */
const simuladores = new Map<string, MockMH>()

/** Simuladores vivos por instancia (uno por credencial simulada): al pasarlo se descarta el menos usado. */
export const MAX_SIMULADORES = 200
/** Entradas que retiene cada simulador por colección (documentos, números de control…): se descartan las más antiguas. */
export const MAX_ENTRADAS_SIMULADOR = 500

export function simuladorPara(nit: string, apiPassword: string): MockMH {
  const clave = `${nit}:${apiPassword}`
  let mock = simuladores.get(clave)
  if (mock) {
    // Reinsertar lo deja como el más reciente.
    simuladores.delete(clave)
  } else {
    mock = crearMockMH({
      usuarios: { [nit]: apiPassword },
      aceptarDesconocidos: true,
      maxEntradas: MAX_ENTRADAS_SIMULADOR,
    })
  }
  simuladores.set(clave, mock)
  for (const k of simuladores.keys()) {
    if (simuladores.size <= MAX_SIMULADORES) break
    simuladores.delete(k)
  }
  return mock
}
