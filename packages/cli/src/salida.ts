const ANCHO_MAXIMO = 44

/**
 * Quita los caracteres de control C0/C1 (ESC, BEL, CSI 0x9B…) de un texto que viene de la API
 * antes de imprimirlo en la terminal: un dato guardado por otro usuario no debe poder mover el
 * cursor, cambiar el título ni borrar la pantalla. El salto de línea y el tabulador se
 * convierten en espacio (los saltos de línea los pone la CLI, nunca el dato). Sólo para la
 * salida legible; `--json` no pasa por aquí.
 */
export const limpiar = (valor: unknown): string =>
  String(valor)
    .replace(/[\t\n\r\u2028\u2029]+/g, ' ')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: justamente quita controles
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')

const celda = (valor: unknown): string => {
  if (valor === null || valor === undefined || valor === '') return '—'
  const texto = limpiar(valor).replace(/\s+/g, ' ')
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
    .map(([clave, valor]) => `${`${limpiar(clave)}:`.padEnd(ancho + 2)}${limpiar(valor)}`)
    .join('\n')
}

export const dinero = (valor: unknown): string =>
  typeof valor === 'number' ? `$${valor.toFixed(2)}` : '—'

export const siNo = (valor: unknown): string => (valor ? 'sí' : 'no')
