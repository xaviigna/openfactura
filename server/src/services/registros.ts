import { and, desc, eq, gte, lt } from 'drizzle-orm'
import type { ConsultaRegistros } from 'shared'
import { type Ctx, exigir } from '../contexto'
import { claveApi, type Db, registroApi } from '../db'
import { nuevoId } from '../lib/crypto'

/** Días que se conservan los registros de peticiones. */
export const DIAS_REGISTROS = 30

/**
 * Anota una petición hecha con clave de API. Lo llama el middleware de autenticación dentro de
 * `waitUntil`, después de responder. Sólo metadatos: el patrón de la ruta, nunca la URL, el cuerpo
 * ni los encabezados.
 */
export async function anotarPeticion(
  db: Db,
  datos: {
    organizationId: string
    claveId: string
    metodo: string
    ruta: string
    estado: number
    duracionMs: number
    origen: 'api' | 'mcp'
  },
): Promise<void> {
  await db.insert(registroApi).values({
    id: nuevoId(),
    ...datos,
    metodo: datos.metodo.slice(0, 10),
    ruta: datos.ruta.slice(0, 200),
    duracionMs: Math.max(0, Math.round(datos.duracionMs)),
  })
}

/** Peticiones hechas con las claves de API de la organización, de la más reciente a la más antigua. */
export async function listarRegistros(ctx: Ctx, filtros: ConsultaRegistros = {}) {
  exigir(ctx, 'registros:read')
  const filas = await ctx.db
    .select({
      id: registroApi.id,
      creado: registroApi.creado,
      metodo: registroApi.metodo,
      ruta: registroApi.ruta,
      estado: registroApi.estado,
      duracionMs: registroApi.duracionMs,
      origen: registroApi.origen,
      claveId: registroApi.claveId,
      clavePrefijo: claveApi.prefijo,
      claveNombre: claveApi.nombre,
    })
    .from(registroApi)
    .leftJoin(claveApi, eq(claveApi.id, registroApi.claveId))
    .where(
      and(
        eq(registroApi.organizationId, ctx.actor.organizationId),
        filtros.antesDe ? lt(registroApi.creado, new Date(filtros.antesDe)) : undefined,
        filtros.estado === 'error' ? gte(registroApi.estado, 400) : undefined,
        filtros.estado === 'ok' ? lt(registroApi.estado, 400) : undefined,
        filtros.origen ? eq(registroApi.origen, filtros.origen) : undefined,
        filtros.claveId ? eq(registroApi.claveId, filtros.claveId) : undefined,
      ),
    )
    .orderBy(desc(registroApi.creado))
    .limit(Math.min(filtros.limite ?? 50, 200))
  return filas.map((f) => ({
    id: f.id,
    creado: f.creado.getTime(),
    metodo: f.metodo,
    ruta: f.ruta,
    estado: f.estado,
    duracionMs: f.duracionMs,
    origen: f.origen,
    clave: { id: f.claveId, prefijo: f.clavePrefijo, nombre: f.claveNombre },
  }))
}

/** Borra los registros que pasaron la retención. Lo llama el cron. */
export async function limpiarRegistros(d1: D1Database): Promise<void> {
  await d1
    .prepare('DELETE FROM registro_api WHERE creado < ?1')
    .bind(Date.now() - DIAS_REGISTROS * 86_400_000)
    .run()
}
