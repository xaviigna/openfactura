import { and, asc, eq, like, or } from 'drizzle-orm'
import type { esquemaProducto } from 'shared'
import type { z } from 'zod'
import { type Ctx, exigir } from '../contexto'
import { producto } from '../db'
import { nuevoId } from '../lib/crypto'
import { conflicto, noEncontrado } from '../lib/errors'
import { registrar } from './auditoria'

type Datos = z.infer<typeof esquemaProducto>

const propio = (ctx: Ctx, id: string) =>
  and(eq(producto.id, id), eq(producto.organizationId, ctx.actor.organizationId))

export async function listarProductos(ctx: Ctx, opciones: { q?: string; limite?: number } = {}) {
  exigir(ctx, 'productos:read')
  const q = opciones.q?.trim()
  const patron = q ? `%${q.replace(/[%_]/g, '')}%` : null
  return ctx.db
    .select()
    .from(producto)
    .where(
      and(
        eq(producto.organizationId, ctx.actor.organizationId),
        patron ? or(like(producto.descripcion, patron), like(producto.codigo, patron)) : undefined,
      ),
    )
    .orderBy(asc(producto.descripcion))
    .limit(Math.min(opciones.limite ?? 100, 500))
}

export async function obtenerProducto(ctx: Ctx, id: string) {
  exigir(ctx, 'productos:read')
  const [fila] = await ctx.db.select().from(producto).where(propio(ctx, id))
  if (!fila) throw noEncontrado('El producto')
  return fila
}

export async function crearProducto(ctx: Ctx, datos: Datos) {
  exigir(ctx, 'productos:write')
  const id = nuevoId()
  try {
    await ctx.db.insert(producto).values({ id, organizationId: ctx.actor.organizationId, ...datos })
  } catch {
    throw conflicto('producto_repetido', `Ya existe un producto con el código ${datos.codigo}`)
  }
  await registrar(ctx, 'producto.crear', 'producto', id)
  return obtenerProducto(ctx, id)
}

export async function actualizarProducto(ctx: Ctx, id: string, datos: Datos) {
  exigir(ctx, 'productos:write')
  await obtenerProducto(ctx, id)
  try {
    await ctx.db.update(producto).set(datos).where(propio(ctx, id))
  } catch {
    throw conflicto('producto_repetido', `Ya existe otro producto con el código ${datos.codigo}`)
  }
  await registrar(ctx, 'producto.actualizar', 'producto', id)
  return obtenerProducto(ctx, id)
}

export async function eliminarProducto(ctx: Ctx, id: string) {
  exigir(ctx, 'productos:write')
  await obtenerProducto(ctx, id)
  await ctx.db.delete(producto).where(propio(ctx, id))
  await registrar(ctx, 'producto.eliminar', 'producto', id)
  return { eliminado: true }
}
