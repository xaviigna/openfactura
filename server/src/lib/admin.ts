/**
 * Administración de una instalación propia, sin panel. El operador del servidor define ADMIN_TOKEN y
 * con él:
 * - crea organizaciones (`POST /api/admin/organizaciones`), y
 * - actúa con todos los permisos sobre una de ellas en `/api/v1` enviando
 *   `Authorization: Bearer <ADMIN_TOKEN>` y `X-Organizacion: <id>` (emisor, credenciales del MH,
 *   claves de API…). Así no hace falta un panel para dar de alta una empresa.
 * Sin ADMIN_TOKEN (o con menos de 32 caracteres) nada de esto existe.
 */
import { eq } from 'drizzle-orm'
import { PERMISOS } from 'shared'
import type { Actor } from '../contexto'
import { type Db, organization } from '../db'
import type { Bindings } from '../env'
import { sha256Hex } from './crypto'
import { AppError, noEncontrado } from './errors'

export const LARGO_MINIMO_ADMIN = 32

/** Compara en tiempo constante (sobre los hashes, del mismo largo) el token recibido con ADMIN_TOKEN. */
export async function esTokenAdmin(env: Pick<Bindings, 'ADMIN_TOKEN'>, token: string | undefined) {
  const esperado = env.ADMIN_TOKEN
  if (!esperado || esperado.length < LARGO_MINIMO_ADMIN || !token) return false
  const [a, b] = await Promise.all([sha256Hex(esperado), sha256Hex(token)])
  let diferencia = 0
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diferencia === 0
}

/** Actor del operador sobre la organización de `X-Organizacion`, con todos los permisos. */
export async function actorAdmin(db: Db, organizationId: string | undefined, ip?: string) {
  if (!organizationId) {
    throw new AppError(
      400,
      'organizacion_requerida',
      'Con ADMIN_TOKEN indica la organización en el encabezado X-Organizacion',
    )
  }
  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
  if (!org) throw noEncontrado('La organización')
  return {
    tipo: 'sistema',
    id: 'admin',
    organizationId: org.id,
    permisos: new Set(PERMISOS),
    origen: 'api',
    ip,
  } satisfies Actor
}
