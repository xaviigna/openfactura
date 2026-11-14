/** Permisos de la plataforma. Los usan por igual las sesiones (según rol) y las claves de API. */
export const PERMISOS = [
  'dte:read',
  'dte:emit',
  'dte:invalidate',
  'clientes:read',
  'clientes:write',
  'productos:read',
  'productos:write',
  'emisor:read',
  'emisor:write',
  'claves:manage',
  'webhooks:manage',
  'auditoria:read',
  'registros:read',
] as const
export type Permiso = (typeof PERMISOS)[number]

export const DESCRIPCION_PERMISO: Record<Permiso, string> = {
  'dte:read': 'Consultar documentos, su JSON y su PDF',
  'dte:emit': 'Emitir y validar documentos',
  'dte:invalidate': 'Invalidar documentos y transmitir contingencias',
  'clientes:read': 'Consultar clientes',
  'clientes:write': 'Crear, editar y eliminar clientes',
  'productos:read': 'Consultar productos',
  'productos:write': 'Crear, editar y eliminar productos',
  'emisor:read': 'Ver los datos del emisor y sus establecimientos',
  'emisor:write': 'Editar el emisor, sus establecimientos y las credenciales del MH',
  'claves:manage': 'Crear y revocar claves de API',
  'webhooks:manage': 'Configurar webhooks y ver sus entregas',
  'auditoria:read': 'Ver la bitácora de auditoría',
  'registros:read': 'Ver los registros de peticiones hechas con claves de API',
}

/**
 * Permisos que puede llevar una clave de API (nunca administra claves ni credenciales).
 * `webhooks:manage` sí: los integradores configuran sus webhooks desde su propio sistema.
 */
export const PERMISOS_CLAVE = [
  'dte:read',
  'dte:emit',
  'dte:invalidate',
  'clientes:read',
  'clientes:write',
  'productos:read',
  'productos:write',
  'emisor:read',
  'webhooks:manage',
  'registros:read',
] as const satisfies readonly Permiso[]
export type PermisoClave = (typeof PERMISOS_CLAVE)[number]

export const ROLES = ['owner', 'admin', 'member'] as const
export type Rol = (typeof ROLES)[number]

export const NOMBRE_ROL: Record<Rol, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  member: 'Facturador',
}

const TODOS: readonly Permiso[] = PERMISOS
export const PERMISOS_ROL: Record<Rol, readonly Permiso[]> = {
  owner: TODOS,
  admin: TODOS,
  member: [
    'dte:read',
    'dte:emit',
    'clientes:read',
    'clientes:write',
    'productos:read',
    'productos:write',
    'emisor:read',
  ],
}

export const permisosDeRol = (rol: string): readonly Permiso[] => PERMISOS_ROL[rol as Rol] ?? []
