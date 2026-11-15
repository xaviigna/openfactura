/** Reglas del equipo que usan los ganchos de la organización (ver `auth.ts`). */
/** De menor a mayor acceso. */
const ORDEN = ['member', 'admin', 'owner']

/** El rol guardado puede ser una lista separada por comas; vale el de mayor rango. */
const rango = (rol: string | string[] | null | undefined): number =>
  Math.max(
    -1,
    ...(Array.isArray(rol) ? rol : (rol ?? '').split(',')).map((r) => ORDEN.indexOf(r.trim())),
  )

/** Sólo propietarios y administradores invitan (los permisos por defecto de la organización). */
export const puedeInvitar = (rol: string | null | undefined) => rango(rol) >= ORDEN.indexOf('admin')

/**
 * ¿Pasar de `actual` a `nuevo` da más acceso? Un rol desconocido cuenta como más acceso: ante la
 * duda se exige lo mismo que para invitar. Quitar acceso (bajar de rol) nunca lo amplía.
 */
export const amplia = (
  actual: string | string[] | null | undefined,
  nuevo: string | string[] | null | undefined,
) => rango(nuevo) < 0 || rango(nuevo) > rango(actual)
