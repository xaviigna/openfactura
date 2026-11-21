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
  /** Consultas de DTE de terceros por clave y minuto (20) y por organización y día (1000). */
  CONSULTA_TERCERO_POR_MINUTO?: string
  CONSULTA_TERCERO_POR_DIA?: string
  /**
   * '1' permite generar credenciales de prueba atendidas por el simulador del MH. Sólo esas
   * credenciales usan el simulador; las que sube el usuario van a Hacienda.
   */
  MH_SIMULADO?: string
  /** '1' permite webhooks a http://localhost (sólo desarrollo; nunca en producción). */
  WEBHOOKS_LOCAL?: string
  /**
   * Hosts EXACTOS, separados por coma, bajo el dominio propio que sí pueden recibir webhooks (p. ej. una app
   * hermana en `facturas.openfactura.co`, otro Worker). Sólo los exime del bloqueo del dominio propio: las
   * reglas de IP privadas, `localhost`, DNS comodín y https siguen aplicando.
   */
  WEBHOOKS_HOSTS_PERMITIDOS?: string
  /** URL pública del servidor MCP, si no es `<APP_URL>/mcp` (en la nube, `https://openfactura.co/mcp`). */
  URL_MCP?: string
  /** Orígenes adicionales de confianza, separados por coma (p. ej. el servidor de Vite en desarrollo). */
  TRUSTED_ORIGINS?: string
  /**
   * «Ingresar con GitHub»: Client ID y client secret de una GitHub App (ver lib/github.ts). Con los
   * dos definidos se ofrece el botón; sin ellos, sólo correo y contraseña.
   */
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  /**
   * Token del operador de una instalación propia (sin panel): crea organizaciones y administra
   * cualquiera de ellas por la API (ver lib/admin.ts). Secreto de 32 caracteres o más; sin él no hay
   * acceso de administración. Nunca se define en Open Factura Cloud.
   */
  ADMIN_TOKEN?: string
  /**
   * Cloudflare Turnstile (opcional). Con el secreto definido, el registro, el inicio de sesión y la
   * petición del enlace de recuperación exigen el token del widget (`x-turnstile-token`). La clave
   * del sitio es pública: el panel la recibe en `GET /api/v1/acceso` para mostrar el widget.
   * `TURNSTILE_HOSTNAMES`: dominios (separados por coma) donde se muestra el widget; el token de
   * otro dominio se rechaza. Con el secreto y sin dominios, se rechaza todo.
   */
  TURNSTILE_SECRET?: string
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_HOSTNAMES?: string
}
