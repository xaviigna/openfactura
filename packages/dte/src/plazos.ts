/** Plazos de la Normativa 2.0 / Manual Funcional v2, como utilidades de fecha (hora de El Salvador, UTC-6). */

const MS_HORA = 3_600_000
const OFFSET_SV = -6 * MS_HORA

/** Fin del día (23:59:59) en El Salvador para una fecha local AAAA-MM-DD. */
const finDelDiaSV = (anio: number, mes: number, dia: number) => new Date(Date.UTC(anio, mes, dia, 23, 59, 59) - OFFSET_SV)
const partesSV = (fecha: Date) => {
  const local = new Date(fecha.getTime() + OFFSET_SV)
  return { anio: local.getUTCFullYear(), mes: local.getUTCMonth(), dia: local.getUTCDate() }
}

/** FE, FEXE y FSEE: 3 meses desde el sello. El resto: 10.º día hábil del mes siguiente. */
const TRES_MESES = new Set(['01', '11', '14'])

/**
 * Fecha límite para transmitir el evento de invalidación (Manual Funcional, VII).
 * Los días hábiles excluyen sábados, domingos y los `feriados` indicados
 * (AAAA-MM-DD); pasa los asuetos oficiales del año para un resultado exacto.
 */
export function limiteInvalidacion(tipoDte: string, fechaSello: Date, feriados: string[] = []): Date {
  const { anio, mes, dia } = partesSV(fechaSello)
  if (TRES_MESES.has(tipoDte)) {
    const ultimoDia = new Date(Date.UTC(anio, mes + 4, 0)).getUTCDate()
    return finDelDiaSV(anio, mes + 3, Math.min(dia, ultimoDia))
  }
  const asuetos = new Set(feriados)
  let habiles = 0
  for (let d = 1; d <= 31; d++) {
    const fecha = new Date(Date.UTC(anio, mes + 1, d))
    const diaSemana = fecha.getUTCDay()
    if (diaSemana === 0 || diaSemana === 6 || asuetos.has(fecha.toISOString().slice(0, 10))) continue
    if (++habiles === 10) return finDelDiaSV(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate())
  }
  throw new Error('No se pudo calcular el décimo día hábil')
}

/** 24 h desde el fin de la contingencia para transmitir el evento (Manual Funcional, VIII). */
export const limiteEventoContingencia = (finContingencia: Date) => new Date(finContingencia.getTime() + 24 * MS_HORA)
/** 72 h desde el sello del evento de contingencia para transmitir los DTE informados. */
export const limiteLoteContingencia = (selloEvento: Date) => new Date(selloEvento.getTime() + 72 * MS_HORA)

/** Actividades cuyas FE y FEXE admiten retorno hasta 2 años después (Manual Funcional, X). */
const RETORNO_DOS_ANIOS = new Set(['21001', '21008', '46482', '46484', '46491', '47721'])

/**
 * Última fecha del evento para aplicar un Evento de Retorno a una FE, FEXE o FSEE:
 * 3 meses desde su fecha de generación (AAAA-MM-DD), o 2 años para las FE y FEXE de las
 * actividades económicas que señala el Manual Funcional (X).
 */
export function limiteRetorno(tipoDte: string, fecEmi: string, codActividad?: string | null): Date {
  const [anio, mes, dia] = fecEmi.split('-').map(Number) as [number, number, number]
  const largo = tipoDte !== '14' && !!codActividad && RETORNO_DOS_ANIOS.has(codActividad)
  const destino = mes - 1 + (largo ? 24 : 3)
  const ultimoDia = new Date(Date.UTC(anio, destino + 1, 0)).getUTCDate()
  return finDelDiaSV(anio, destino, Math.min(dia, ultimoDia))
}
