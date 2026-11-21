import { and, eq } from 'drizzle-orm'
import type { DocumentoMiembroEntrada } from 'shared'
import type { Ctx } from '../contexto'
import { miembroDocumento, user } from '../db'
import { conflicto, sinPermiso } from '../lib/errors'
import { registrar } from './auditoria'

/** Persona que firma o solicita una invalidación: lo que pide el MH (Anexo V, motivo). */
export interface Responsable {
  nombre: string
  tipoDocumento: string
  numDocumento: string
}

/**
 * Responsable de la invalidación: el de la solicitud o, si no hay, el «Responsable de anulaciones»
 * configurado en el emisor. Sin ninguno, 409 `responsable_no_configurado` (el cliente lo pide una
 * sola vez, lo guarda con `PUT /emisor` y reintenta). Nunca incluye datos personales.
 */
export function exigirResponsable(
  explicito: Responsable | null | undefined,
  deEmisor: Responsable | null,
): { responsable: Responsable; fuente: 'solicitud' | 'emisor' } {
  if (explicito) return { responsable: explicito, fuente: 'solicitud' }
  if (deEmisor) return { responsable: deEmisor, fuente: 'emisor' }
  throw conflicto(
    'responsable_no_configurado',
    'No hay un responsable de anulaciones. Configúralo en los datos del emisor (responsableNombre, responsableTipoDoc y responsableNumDoc) o envía `responsable` en la solicitud.',
  )
}

/** Nombre y documento de la persona con sesión, si ya registró su documento. */
export async function personaDelActor(ctx: Ctx): Promise<Responsable | null> {
  if (ctx.actor.tipo !== 'usuario') return null
  const [f] = await ctx.db
    .select({
      nombre: user.name,
      tipoDocumento: miembroDocumento.tipoDocumento,
      numDocumento: miembroDocumento.numDocumento,
    })
    .from(user)
    .leftJoin(
      miembroDocumento,
      and(
        eq(miembroDocumento.userId, user.id),
        eq(miembroDocumento.organizationId, ctx.actor.organizationId),
      ),
    )
    .where(eq(user.id, ctx.actor.id))
  return f?.tipoDocumento && f.numDocumento
    ? { nombre: f.nombre, tipoDocumento: f.tipoDocumento, numDocumento: f.numDocumento }
    : null
}

/** El documento de la persona con sesión, sin devolver el número. */
export async function obtenerMiDocumento(ctx: Ctx) {
  const p = await personaDelActor(ctx)
  return { documentoRegistrado: !!p, tipoDocumento: p?.tipoDocumento ?? null }
}

/** Cada persona registra su propio documento (sólo sesiones; las claves de API no tienen perfil). */
export async function guardarMiDocumento(ctx: Ctx, datos: DocumentoMiembroEntrada) {
  if (ctx.actor.tipo !== 'usuario') throw sinPermiso('sesión de persona')
  const valores = {
    tipoDocumento: datos.tipoDocumento,
    numDocumento: datos.numDocumento,
    actualizado: new Date(),
  }
  await ctx.db
    .insert(miembroDocumento)
    .values({ organizationId: ctx.actor.organizationId, userId: ctx.actor.id, ...valores })
    .onConflictDoUpdate({
      target: [miembroDocumento.organizationId, miembroDocumento.userId],
      set: valores,
    })
  // Sólo el tipo: el número no va a la bitácora.
  await registrar(ctx, 'perfil.documento', 'miembro', ctx.actor.id, {
    tipoDocumento: datos.tipoDocumento,
  })
  return { documentoRegistrado: true, tipoDocumento: datos.tipoDocumento }
}
