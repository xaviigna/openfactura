export interface Bindings {
  DB: D1Database
  ASSETS?: Fetcher
  APP_URL: string
  BETTER_AUTH_SECRET: string
  /** Llaves maestras versionadas (CRED_KEK_V1, CRED_KEK_V2…). La de mayor versión cifra; todas descifran. */
  CRED_KEK_V1: string
  CRED_KEK_V2?: string
  /** Sustituye la URL del MH (simulador local o de pruebas). */
  MH_BASE_URL?: string
  LIMITE_CLAVE_POR_MINUTO?: string
  /**
   * '1' permite generar credenciales de prueba atendidas por el simulador del MH. Sólo esas
   * credenciales usan el simulador; las que sube el usuario van a Hacienda.
   */
  MH_SIMULADO?: string
  /** '1' permite webhooks a http://localhost (sólo desarrollo; nunca en producción). */
  WEBHOOKS_LOCAL?: string
  /** URL pública del servidor MCP, si no es `<APP_URL>/mcp` (en la nube, `https://openfactura.co/mcp`). */
  URL_MCP?: string
  /** Orígenes adicionales de confianza, separados por coma (p. ej. el servidor de Vite en desarrollo). */
  TRUSTED_ORIGINS?: string
  /**
   * Token del operador de una instalación propia (sin panel): crea organizaciones y administra
   * cualquiera de ellas por la API (ver lib/admin.ts). Secreto de 32 caracteres o más; sin él no hay
   * acceso de administración. Nunca se define en Open Factura Cloud.
   */
  ADMIN_TOKEN?: string
}
