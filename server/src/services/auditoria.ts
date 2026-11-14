import { and, desc, eq, lt } from 'drizzle-orm'
import { type Ctx, exigir } from '../contexto'
import { auditoria } from '../db'
import { nuevoId } from '../lib/crypto'

/** Deja constancia de una acción. Nunca recibe secretos: sólo identificadores y banderas. */
export async function registrar(
  ctx: Ctx,
  accion: string,
  recurso: string,
  recursoId?: string | null,
  detalle?: Record<string, unknown>,
): Promise<void> {
  await ctx.db.insert(auditoria).values({
    id: nuevoId(),
    organizationId: ctx.actor.organizationId,
    actorTipo: ctx.actor.tipo,
    actorId: ctx.actor.id,
    accion,
    recurso,
    recursoId: recursoId ?? null,
    ip: ctx.actor.ip ?? null,
    detalle: detalle ? JSON.stringify(detalle) : null,
  })
}

export async function listarAuditoria(
  ctx: Ctx,
  opciones: { antesDe?: number; limite?: number } = {},
) {
  exigir(ctx, 'auditoria:read')
  const filas = await ctx.db
    .select()
    .from(auditoria)
    .where(
      and(
        eq(auditoria.organizationId, ctx.actor.organizationId),
        opciones.antesDe ? lt(auditoria.creado, new Date(opciones.antesDe)) : undefined,
      ),
    )
    .orderBy(desc(auditoria.creado))
    .limit(Math.min(opciones.limite ?? 50, 200))
  return filas.map((f) => ({ ...f, detalle: f.detalle ? JSON.parse(f.detalle) : null }))
}
