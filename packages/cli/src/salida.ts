const ANCHO_MAXIMO = 44

const celda = (valor: unknown): string => {
  if (valor === null || valor === undefined || valor === '') return '—'
  const texto = String(valor).replace(/\s+/g, ' ')
  return texto.length > ANCHO_MAXIMO ? `${texto.slice(0, ANCHO_MAXIMO - 1)}…` : texto
}

/** Tabla de columnas alineadas. `derecha` lista los índices de columnas numéricas. */
export function tabla(encabezados: string[], filas: unknown[][], derecha: number[] = []): string {
  const celdas = filas.map((fila) => fila.map(celda))
  const anchos = encabezados.map((titulo, i) =>
    Math.max(titulo.length, ...celdas.map((fila) => fila[i]?.length ?? 0)),
  )
  const linea = (fila: string[]) =>
    fila
      .map((texto, i) =>
        derecha.includes(i) ? texto.padStart(anchos[i] ?? 0) : texto.padEnd(anchos[i] ?? 0),
      )
      .join('  ')
      .trimEnd()
  return [linea(encabezados.map((t) => t.toUpperCase())), ...celdas.map(linea)].join('\n')
}

/** Lista «clave: valor» con las claves alineadas. Omite los valores vacíos. */
export function fichas(pares: Array<[string, unknown]>): string {
  const visibles = pares.filter(
    ([, valor]) => valor !== null && valor !== undefined && valor !== '',
  )
  const ancho = Math.max(0, ...visibles.map(([clave]) => clave.length))
  return visibles
    .map(([clave, valor]) => `${`${clave}:`.padEnd(ancho + 2)}${String(valor)}`)
    .join('\n')
}

export const dinero = (valor: unknown): string =>
  typeof valor === 'number' ? `$${valor.toFixed(2)}` : '—'

export const siNo = (valor: unknown): string => (valor ? 'sí' : 'no')
