/**
 * Redondeo según Normativa 2.0 (regla 7.2) y Manual Funcional (XXI):
 * 8 decimales en el cuerpo del documento, 2 en el resumen, medio hacia arriba.
 */
export function redondear(valor: number, decimales = 2): number {
  if (!Number.isFinite(valor)) throw new RangeError(`Valor no numérico: ${valor}`)
  const factor = 10 ** decimales
  // (1 + EPSILON) corrige representaciones binarias como 5.665 -> 5.664999…
  const escalado = Math.round(Math.abs(valor) * factor * (1 + Number.EPSILON))
  return (Math.sign(valor) * escalado) / factor || 0
}

export const r2 = (valor: number) => redondear(valor, 2)
export const r8 = (valor: number) => redondear(valor, 8)

export const sumar = (valores: number[]) => valores.reduce((total, v) => total + v, 0)

/** Cantidad de decimales significativos de un número (para validar 11.8 y 11.2). */
export function decimales(valor: number): number {
  if (Number.isInteger(valor)) return 0
  const texto = Math.abs(valor).toString()
  if (texto.includes('e-')) {
    const [mantisa = '', exponente = '0'] = texto.split('e-')
    return (mantisa.split('.')[1]?.length ?? 0) + Number(exponente)
  }
  return texto.split('.')[1]?.length ?? 0
}

export const IVA = 0.13
