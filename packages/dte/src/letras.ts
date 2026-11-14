const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE']
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

function centenas(n: number): string {
  if (n === 100) return 'CIEN'
  const partes: string[] = []
  const c = Math.floor(n / 100)
  const resto = n % 100
  if (c) partes.push(CENTENAS[c]!)
  if (resto < 30) {
    if (resto) partes.push(UNIDADES[resto]!)
  } else {
    const u = resto % 10
    partes.push(DECENAS[Math.floor(resto / 10)]! + (u ? ` Y ${UNIDADES[u]}` : ''))
  }
  return partes.join(' ')
}

/** "UNO" se apocopa antes de MIL / MILLONES: VEINTIÚN MIL, UN MILLÓN. */
const apocopar = (texto: string) => texto.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/UNO$/, 'UN')

function entero(n: number): string {
  if (n === 0) return 'CERO'
  const millones = Math.floor(n / 1_000_000)
  const miles = Math.floor((n % 1_000_000) / 1000)
  const resto = n % 1000
  const partes: string[] = []
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${apocopar(entero(millones))} MILLONES`)
  if (miles) partes.push(miles === 1 ? 'MIL' : `${apocopar(centenas(miles))} MIL`)
  if (resto) partes.push(centenas(resto))
  return partes.join(' ')
}

/** 2260 -> "DOS MIL DOSCIENTOS SESENTA 00/100 DÓLARES" (campo totalLetras). */
export function numeroALetras(valor: number): string {
  const centavosTotales = Math.round(Math.abs(valor) * 100 * (1 + Number.EPSILON))
  const dolares = Math.floor(centavosTotales / 100)
  const centavos = centavosTotales % 100
  return `${entero(dolares)} ${String(centavos).padStart(2, '0')}/100 ${dolares === 1 ? 'DÓLAR' : 'DÓLARES'}`
}
