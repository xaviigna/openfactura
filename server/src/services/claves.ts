import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ClaveApiEntrada, Permiso } from 'shared'
import { PERMISOS_CLAVE } from 'shared'
import { type Actor, type Ctx, exigir } from '../contexto'
import { claveApi, type Db } from '../db'
import { aleatorioBase62, nuevoId, sha256Hex } from '../lib/crypto'
import { noEncontrado } from '../lib/errors'
import { registrar } from './auditoria'

/** of_test_… / of_live_…: el modo se reconoce a simple vista y por escáneres de secretos. */
const PREFIJO = { test: 'of_test_', live: 'of_live_' } as const
const LARGO_SECRETO = 40 // ≈238 bits de entropía
const LARGO_VISIBLE = 14

export const pareceClaveApi = (token: string) => /^of_(test|live)_[0-9A-Za-z]{40}$/.test(token)

const publica = (f: typeof claveApi.$inferSelect) => ({
  id: f.id,
  nombre: f.nombre,
  prefijo: f.prefijo,
  modo: f.modo,
  scopes: JSON.parse(f.scopes) as Permiso[],
  expira: f.expira?.getTime() ?? null,
  ultimoUso: f.ultimoUso?.getTime() ?? null,
  revocada: f.revocada?.getTime() ?? null,
  creado: f.creado.getTime(),
  estado: f.revocada
    ? ('revocada' as const)
    : f.expira && f.expira.getTime() <= Date.now()
      ? ('expirada' as const)
      : ('activa' as const),
})

export async function listarClaves(ctx: Ctx) {
  exigir(ctx, 'claves:manage')
  const filas = await ctx.db
    .select()
    .from(claveApi)
    .where(eq(claveApi.organizationId, ctx.actor.organizationId))
    .orderBy(desc(claveApi.creado))
  return filas.map(publica)
}

/** Crea una clave. La clave completa sólo existe en esta respuesta: se guarda su SHA-256. */
export async function crearClave(ctx: Ctx, datos: ClaveApiEntrada) {
  exigir(ctx, 'claves:manage')
  const clave = `${PREFIJO[datos.modo]}${aleatorioBase62(LARGO_SECRETO)}`
  const id = nuevoId()
  await ctx.db.insert(claveApi).values({
    id,
    organizationId: ctx.actor.organizationId,
    nombre: datos.nombre,
    prefijo: clave.slice(0, LARGO_VISIBLE),
    hash: await sha256Hex(clave),
    modo: datos.modo,
    scopes: JSON.stringify([...new Set(datos.scopes)]),
    expira: datos.expiraEnDias ? new Date(Date.now() + datos.expiraEnDias * 86_400_000) : null,
    creadoPor: ctx.actor.tipo === 'usuario' ? ctx.actor.id : null,
  })
  await registrar(ctx, 'clave.crear', 'clave_api', id, { modo: datos.modo, scopes: datos.scopes })
  const [fila] = await ctx.db.select().from(claveApi).where(eq(claveApi.id, id))
  return { ...publica(fila!), clave }
}

export async function revocarClave(ctx: Ctx, id: string) {
  exigir(ctx, 'claves:manage')
  const filtro = and(eq(claveApi.id, id), eq(claveApi.organizationId, ctx.actor.organizationId))
  const [fila] = await ctx.db.select().from(claveApi).where(filtro)
  if (!fila) throw noEncontrado('La clave')
  if (!fila.revocada) {
    await ctx.db.update(claveApi).set({ revocada: new Date() }).where(filtro)
    await registrar(ctx, 'clave.revocar', 'clave_api', id)
  }
  return { revocada: true }
}

/**
 * Resuelve una clave de API a su actor, o `null` si no existe, fue revocada o expiró.
 * Busca por hash: la clave tiene entropía suficiente para no necesitar sal ni KDF lento.
 */
export async function verificarClave(
  db: Db,
  token: string,
  origen: Actor['origen'],
  ip?: string,
): Promise<Actor | null> {
  if (!pareceClaveApi(token)) return null
  const [fila] = await db
    .select()
    .from(claveApi)
    .where(and(eq(claveApi.hash, await sha256Hex(token)), isNull(claveApi.revocada)))
  if (!fila) return null
  if (fila.expira && fila.expira.getTime() <= Date.now()) return null
  // El último uso se actualiza como mucho una vez por minuto para no escribir en cada petición.
  if (!fila.ultimoUso || Date.now() - fila.ultimoUso.getTime() > 60_000) {
    await db.update(claveApi).set({ ultimoUso: new Date() }).where(eq(claveApi.id, fila.id))
  }
  const permitidos = new Set<string>(PERMISOS_CLAVE)
  return {
    tipo: 'clave',
    id: fila.id,
    organizationId: fila.organizationId,
    permisos: new Set((JSON.parse(fila.scopes) as Permiso[]).filter((p) => permitidos.has(p))),
    modo: fila.modo,
    origen,
    ip,
  }
}
