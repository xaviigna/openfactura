import { type Ambiente, type ModoClave, type Permiso, permisosDeRol } from 'shared'
import type { Db } from './db'
import type { Bindings } from './env'
import type { Extension } from './extensiones'
import { sinPermiso } from './lib/errors'

/** Quién hace la petición, ya resuelto a una organización y a un conjunto de permisos. */
export interface Actor {
  tipo: 'usuario' | 'clave' | 'sistema'
  id: string
  organizationId: string
  permisos: ReadonlySet<Permiso>
  /** Sólo en claves de API: fija el ambiente del MH. */
  modo?: ModoClave
  /**
   * Superficie por la que llegó la operación; queda en `documento.origen`. Las extensiones usan sus
   * propios valores (p. ej. 'whatsapp').
   */
  origen: 'panel' | 'api' | 'mcp' | 'cli' | (string & {})
  ip?: string
}

/** Todo lo que un servicio necesita. No depende de Hono: lo usan REST, MCP y las pruebas. */
export interface Ctx {
  env: Bindings
  db: Db
  actor: Actor
  /** Sustituto de `fetch` para hablar con el MH (pruebas con el simulador del SDK). */
  mhFetch?: typeof fetch
  /** Trabajo que sigue después de responder (primer intento de los webhooks). */
  waitUntil?: (promesa: Promise<unknown>) => void
  /** Extensiones del Worker (ganchos `cuenta` y `antesDeEmitir`). Vacío en una instalación propia. */
  extensiones?: readonly Extension[]
}

/**
 * Actor de un miembro de una organización: los permisos salen de su rol. Lo usan la sesión del panel
 * y las extensiones que actúan a nombre de un usuario.
 */
export const actorDeMiembro = (
  m: { userId: string; organizationId: string; role: string },
  origen: Actor['origen'],
  ip?: string,
): Actor => ({
  tipo: 'usuario',
  id: m.userId,
  organizationId: m.organizationId,
  permisos: new Set<Permiso>(permisosDeRol(m.role)),
  origen,
  ip,
})

export function exigir(ctx: Ctx, permiso: Permiso): void {
  if (!ctx.actor.permisos.has(permiso)) throw sinPermiso(permiso)
}

export const ambienteDeModo = (modo: ModoClave): Ambiente => (modo === 'live' ? '01' : '00')
