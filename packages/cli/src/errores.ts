/** Códigos de salida del proceso. */
export const SALIDA = { ok: 0, error: 1, uso: 2, noAutenticado: 3, limite: 4 } as const

/** Cuerpo de error de la API: `{ error: { code, message, details } }`. */
export interface CuerpoError {
  error: { code: string; message: string; details?: unknown }
}

/** Argumentos u opciones mal usados (salida 2). */
export class ErrorUso extends Error {}

/** Error propio de la CLI: sin clave, sin conexión, archivo ilegible… */
export class ErrorCli extends Error {
  constructor(
    message: string,
    readonly code = 'error',
    readonly salida: number = SALIDA.error,
  ) {
    super(message)
  }

  get cuerpo(): CuerpoError {
    return { error: { code: this.code, message: this.message } }
  }
}

/** Respuesta de error de la API. */
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly cuerpo: CuerpoError,
    /** Segundos de espera indicados por `Retry-After` (sólo en 429). */
    readonly retryAfter: number | null = null,
  ) {
    super(cuerpo.error.message)
  }

  get code(): string {
    return this.cuerpo.error.code
  }

  get details(): unknown {
    return this.cuerpo.error.details
  }

  get salida(): number {
    if (this.status === 401) return SALIDA.noAutenticado
    if (this.status === 429) return SALIDA.limite
    return SALIDA.error
  }
}
