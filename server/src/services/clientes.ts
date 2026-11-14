import { and, asc, eq, like, or } from 'drizzle-orm'
import type { esquemaCliente } from 'shared'
import type { z } from 'zod'
import { type Ctx, exigir } from '../contexto'
import { cliente } from '../db'
import { nuevoId } from '../lib/crypto'
import { conflicto, noEncontrado } from '../lib/errors'
import { registrar } from './auditoria'

type Datos = z.infer<typeof esquemaCliente>

/** NIT y DUI se guardan sin guiones, igual que viajan en el DTE. */
const normalizar = (d: Datos): Datos => ({
  ...d,
  numDocumento:
    d.tipoDocumento === '36' || d.tipoDocumento === '13'
      ? d.numDocumento.replace(/[^0-9A-Za-z]/g, '')
      : d.numDocumento,
  nrc: d.nrc ? d.nrc.replace(/[^0-9]/g, '') : null,
})

const propio = (ctx: Ctx, id: string) =>
  and(eq(cliente.id, id), eq(cliente.organizationId, ctx.actor.organizationId))

export async function listarClientes(ctx: Ctx, opciones: { q?: string; limite?: number } = {}) {
  exigir(ctx, 'clientes:read')
  const q = opciones.q?.trim()
  const patron = q ? `%${q.replace(/[%_]/g, '')}%` : null
  return ctx.db
    .select()
    .from(cliente)
    .where(
      and(
        eq(cliente.organizationId, ctx.actor.organizationId),
        patron
          ? or(
              like(cliente.nombre, patron),
              like(cliente.numDocumento, patron),
              like(cliente.nombreComercial, patron),
            )
          : undefined,
      ),
    )
    .orderBy(asc(cliente.nombre))
    .limit(Math.min(opciones.limite ?? 100, 500))
}

export async function obtenerCliente(ctx: Ctx, id: string) {
  exigir(ctx, 'clientes:read')
  const [fila] = await ctx.db.select().from(cliente).where(propio(ctx, id))
  if (!fila) throw noEncontrado('El cliente')
  return fila
}

export async function crearCliente(ctx: Ctx, datos: Datos) {
  exigir(ctx, 'clientes:write')
  const id = nuevoId()
  const valores = normalizar(datos)
  try {
    await ctx.db
      .insert(cliente)
      .values({ id, organizationId: ctx.actor.organizationId, ...valores })
  } catch {
    throw conflicto(
      'cliente_repetido',
      `Ya existe un cliente con el documento ${valores.numDocumento}`,
    )
  }
  await registrar(ctx, 'cliente.crear', 'cliente', id)
  return obtenerCliente(ctx, id)
}

export async function actualizarCliente(ctx: Ctx, id: string, datos: Datos) {
  exigir(ctx, 'clientes:write')
  await obtenerCliente(ctx, id)
  try {
    await ctx.db.update(cliente).set(normalizar(datos)).where(propio(ctx, id))
  } catch {
    throw conflicto('cliente_repetido', 'Ya existe otro cliente con ese documento')
  }
  await registrar(ctx, 'cliente.actualizar', 'cliente', id)
  return obtenerCliente(ctx, id)
}

export async function eliminarCliente(ctx: Ctx, id: string) {
  exigir(ctx, 'clientes:write')
  await obtenerCliente(ctx, id)
  await ctx.db.delete(cliente).where(propio(ctx, id))
  await registrar(ctx, 'cliente.eliminar', 'cliente', id)
  return { eliminado: true }
}
