import { and, eq } from 'drizzle-orm'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Ctx } from '../contexto'
import { idempotencia } from '../db'
import { sha256Hex } from '../lib/crypto'
import { AppError, conflicto } from '../lib/errors'

/** Errores posteriores a la reserva del número de control: quedan como respuesta de la clave. */
const DEFINITIVOS = new Set(['dte_rechazado', 'emision_incierta'])

export interface Respuesta {
  status: ContentfulStatusCode
  cuerpo: unknown
}

/**
 * Ejecuta `accion` una sola vez por clave dentro de la organización y del ámbito.
 * Quien llama debe haber comprobado ya el permiso: una respuesta guardada se devuelve sin
 * volver a pasar por el servicio.
 * Un reintento con el mismo cuerpo recibe la respuesta guardada; con otro cuerpo, 409.
 * Sin clave, simplemente ejecuta.
 */
export async function ejecutarUnaVez(
  ctx: Ctx,
  ambito: string,
  claveCliente: string | undefined,
  cuerpo: unknown,
  accion: () => Promise<Respuesta>,
): Promise<Respuesta & { repetida: boolean }> {
  if (!claveCliente) return { ...(await accion()), repetida: false }
  // `ambito` (operación y ambiente) separa pruebas de producción: una clave usada en un ambiente
  // nunca devuelve la respuesta del otro.
  const clave = `${ambito}:${claveCliente}`
  if (claveCliente.length > 200)
    throw new AppError(400, 'datos_invalidos', 'Idempotency-Key admite hasta 200 caracteres')

  const org = ctx.actor.organizationId
  const hashPeticion = await sha256Hex(JSON.stringify(cuerpo))
  const filtro = and(eq(idempotencia.organizationId, org), eq(idempotencia.clave, clave))

  const reservada = await ctx.db
    .insert(idempotencia)
    .values({ organizationId: org, clave, hashPeticion })
    .onConflictDoNothing()
    .returning({ clave: idempotencia.clave })

  if (!reservada.length) {
    const [previa] = await ctx.db.select().from(idempotencia).where(filtro)
    if (!previa || previa.hashPeticion !== hashPeticion) {
      throw conflicto(
        'idempotencia_distinta',
        'Esa Idempotency-Key ya se usó con un cuerpo diferente',
      )
    }
    if (previa.status === null || previa.respuesta === null) {
      throw conflicto(
        'idempotencia_en_curso',
        'La petición original con esa Idempotency-Key sigue en curso',
      )
    }
    return {
      status: previa.status as ContentfulStatusCode,
      cuerpo: JSON.parse(previa.respuesta),
      repetida: true,
    }
  }

  try {
    const respuesta = await accion()
    await ctx.db
      .update(idempotencia)
      .set({ status: respuesta.status, respuesta: JSON.stringify(respuesta.cuerpo) })
      .where(filtro)
    return { ...respuesta, repetida: false }
  } catch (error) {
    if (error instanceof AppError && DEFINITIVOS.has(error.code)) {
      // Ya se consumió número de control o el resultado es incierto: reintentar no debe emitir otra vez.
      await ctx.db
        .update(idempotencia)
        .set({ status: error.status, respuesta: JSON.stringify(error.toJSON()) })
        .where(filtro)
    } else {
      // Nada se emitió (validación, configuración o fallo inesperado): se libera la clave para reintentar.
      await ctx.db.delete(idempotencia).where(filtro)
    }
    throw error
  }
}
