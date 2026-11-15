import { fechaHoraSV } from '@openfactura/dte'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import type { ConsultaUso } from 'shared'
import { type Ctx, exigir } from '../contexto'
import { documento } from '../db'
import { invalido } from '../lib/errors'
import { ambienteActivo } from './emisor'

const DIA = 86_400_000
const MAX_DIAS = 366
const aMs = (fecha: string) => Date.parse(`${fecha}T00:00:00Z`)

/**
 * Uso por día en el ambiente activo: documentos emitidos (cada uno consumió un número de control),
 * procesados, rechazados y monto de los procesados. Una sola consulta agregada sobre el índice
 * (organización, ambiente, fecha); sólo devuelve los días con movimiento.
 */
export async function obtenerUso(ctx: Ctx, consulta: ConsultaUso = {}) {
  exigir(ctx, 'dte:read')
  const hasta = consulta.hasta ?? fechaHoraSV().fecha
  const desde = consulta.desde ?? new Date(aMs(hasta) - 29 * DIA).toISOString().slice(0, 10)
  const dias = (aMs(hasta) - aMs(desde)) / DIA + 1
  if (!Number.isFinite(dias) || dias < 1) {
    throw invalido('`desde` debe ser una fecha válida anterior o igual a `hasta`')
  }
  if (dias > MAX_DIAS) throw invalido(`El rango máximo es de ${MAX_DIAS} días`)

  const ambiente = await ambienteActivo(ctx)
  const contar = (estado: string) =>
    sql<number>`coalesce(sum(case when ${documento.estado} = ${estado} then 1 else 0 end), 0)`
  const filas = await ctx.db
    .select({
      fecha: documento.fechaEmision,
      emitidos: sql<number>`count(*)`,
      procesados: contar('procesado'),
      rechazados: contar('rechazado'),
      centavos: sql<number>`coalesce(sum(case when ${documento.estado} = 'procesado' then ${documento.totalCentavos} else 0 end), 0)`,
    })
    .from(documento)
    .where(
      and(
        eq(documento.organizationId, ctx.actor.organizationId),
        eq(documento.ambiente, ambiente),
        gte(documento.fechaEmision, desde),
        lte(documento.fechaEmision, hasta),
      ),
    )
    .groupBy(documento.fechaEmision)
    .orderBy(documento.fechaEmision)

  const totales = { emitidos: 0, procesados: 0, rechazados: 0, centavos: 0 }
  for (const f of filas) {
    totales.emitidos += f.emitidos
    totales.procesados += f.procesados
    totales.rechazados += f.rechazados
    totales.centavos += f.centavos
  }
  return {
    ambiente,
    desde,
    hasta,
    totales: {
      emitidos: totales.emitidos,
      procesados: totales.procesados,
      rechazados: totales.rechazados,
      monto: totales.centavos / 100,
    },
    dias: filas.map((f) => ({
      fecha: f.fecha,
      emitidos: f.emitidos,
      procesados: f.procesados,
      rechazados: f.rechazados,
      monto: f.centavos / 100,
    })),
  }
}
