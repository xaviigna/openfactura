import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Error de negocio con código estable. Se serializa como `{ error: { code, message, details } }`. */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } }
  }
}

export const noAutenticado = (mensaje = 'Inicia sesión o envía una clave de API válida') =>
  new AppError(401, 'no_autenticado', mensaje)
export const sinPermiso = (permiso: string) =>
  new AppError(403, 'sin_permiso', `Falta el permiso ${permiso}`, { permiso })
export const noEncontrado = (que: string) => new AppError(404, 'no_encontrado', `${que} no existe`)
export const conflicto = (code: string, mensaje: string, details?: unknown) =>
  new AppError(409, code, mensaje, details)
export const invalido = (mensaje: string, details?: unknown) =>
  new AppError(400, 'datos_invalidos', mensaje, details)

const ERRORES_CON_MENSAJE_PUBLICO = new Set([
  'Error',
  'ErrorMH',
  'ErrorConexionMH',
  'DteRechazadoError',
  'DteInvalidoError',
  'ContingenciaRequeridaError',
])

/**
 * Mensaje apto para el cliente: los errores de validación del SDK se muestran tal cual; los
 * internos (TypeError, base de datos, llaves) se registran y se sustituyen por un texto genérico.
 */
export function mensajeDe(error: unknown, generico: string): string {
  if (
    error instanceof Error &&
    ERRORES_CON_MENSAJE_PUBLICO.has(error.name) &&
    !/D1_|SQLITE|llave maestra/i.test(error.message)
  ) {
    return error.message
  }
  console.error(error)
  return generico
}
