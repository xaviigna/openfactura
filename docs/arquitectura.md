# Arquitectura

## Piezas

```
server/          Hono en Cloudflare Workers                      (API REST + MCP + cron)
  src/services/  lógica de negocio; no depende de Hono
  src/routes/    REST /api/v1
  src/mcp.ts     herramientas MCP sobre los mismos servicios
shared/          esquemas zod, permisos y tipos del servidor (y de un panel, si lo hay)
packages/dte/    SDK: construir, validar, firmar, transmitir, PDF, catálogos, simulador
packages/cli/    CLI y servidor MCP por stdio (sólo habla HTTP con la API)
```

Un solo Worker sirve la API, el MCP y el cron. El núcleo no trae panel: una distribución (como Open
Factura Cloud) puede servir el suyo desde el mismo Worker (`assets`), con mismo origen, cookies propias
y sin CORS. Sin panel, el operador administra con `ADMIN_TOKEN` (ver `docs/self-hosting.md`).

## Una capa de servicios, tres superficies

Cada operación vive una vez en `server/src/services` con la firma `(ctx, entrada)`. `ctx` lleva la base
de datos, el entorno y el **actor** ya autenticado (usuario o clave de API, organización y permisos).
REST, MCP y las pruebas llaman a los mismos servicios, así que el comportamiento y los permisos son
idénticos en todas partes. Cada servicio empieza con `exigir(ctx, 'permiso')` y filtra por
`organizationId`.

## Decisiones

### Datos: Cloudflare D1 (SQLite)

- **Por qué:** un solo proveedor, coste casi nulo, despliegue con `wrangler deploy`.
- **Consecuencia:** tope de 10 GB por base y un único escritor. El JSON de cada DTE vive en
  `documento_archivo`, separado del resumen que se lista. Si el volumen crece, el siguiente paso es
  mover esos JSON a R2 y dejar en D1 sólo el resumen.
- Los montos se calculan en el SDK; en la base se guarda el total en centavos enteros.

### Número de control sin huecos ni duplicados

`reservar()` en `services/dte.ts` ejecuta en una sola transacción (`batch` de D1):

1. `INSERT … ON CONFLICT DO UPDATE SET ultimo = ultimo + 1 RETURNING ultimo` sobre la serie
   (organización, ambiente, tipo, establecimiento, punto de venta, año).
2. `INSERT INTO documento … SELECT … ultimo` con estado `pendiente`.

Cada número consumido tiene su fila. Antes de reservar se valida el documento y se autentica contra el
MH, para que un error de datos o de credenciales no gaste números. Un rechazo del MH deja la fila en
`rechazado`: el número no se reutiliza.

### Emisión

validar → autenticar → reservar → firmar y guardar → transmitir.

- `201 procesado`: sellado por el MH.
- `202 contingencia`: el MH no respondió tras los reintentos del SDK. El documento se reconstruye con
  modelo diferido, se firma y queda en `contingencia`. `POST /contingencia/transmitir` envía el evento
  de contingencia y luego cada documento.
- `422 dte_rechazado`: queda registrado con las observaciones del MH.
- `502 emision_incierta`: algo falló después de reservar y no se sabe qué registró el MH. El documento
  queda `pendiente`; nunca se marca rechazado sin una respuesta del MH que lo diga.
- Un cron cada 5 minutos consulta en el MH los documentos que quedaron `pendiente` por una interrupción.
- Webhooks salientes (`services/webhooks.ts`): los servicios llaman a `publicar()` al cambiar el estado
  de un documento o evento; se crea una fila en `webhook_entrega` y el primer intento sale con
  `waitUntil`. El mismo cron reintenta las entregas vencidas con espera exponencial.

### Autenticación

- **Panel:** Better Auth (correo y contraseña) con el plugin de organizaciones. Roles `owner`, `admin`,
  `member`; los permisos por rol están en `shared/src/permisos.ts`.
- **Contraseñas:** PBKDF2-SHA256 con WebCrypto (600 000 iteraciones en 6 rondas, porque workerd limita
  cada llamada a 100 000). El scrypt en JS puro que Better Auth
  usa fuera de Node agota la CPU de un Worker.
- **Claves de API:** implementación propia (`services/claves.ts`). Formato `of_test_` / `of_live_` + 40
  caracteres base62 (≈238 bits). Se guarda el SHA-256; la clave se muestra una vez. Cada clave lleva sus
  permisos y su modo: `test` sólo opera en el ambiente `00` del MH y `live` sólo en `01`.
- **CSRF:** cookies `SameSite=Lax` más comprobación de `Origin` en toda petición con cookie que modifica
  datos.

### Secretos del MH

Contraseña de API, certificado `.crt`, contraseña de la llave y token del MH se cifran con AES-256-GCM
(`lib/crypto.ts`). La llave maestra es un secreto del Worker (`CRED_KEK_V1`); el texto cifrado guarda la
versión de la llave para poder rotarla (`CRED_KEK_V2`, …). Como dato autenticado adicional (AAD) se usa
`organización|ambiente|campo`, de modo que un valor copiado a otra fila no descifra. Ninguna ruta
devuelve secretos: sólo banderas de "cargado".

### Registros de la API y uso

- `registro_api` guarda una fila por petición hecha con clave de API (REST y MCP): método, patrón de
  ruta, estado HTTP, duración, origen y clave. Nunca cuerpos, encabezados, parámetros ni la URL real.
  El middleware la escribe con `waitUntil`, después de responder, así que no agrega latencia ni puede
  hacer fallar la petición. El volumen lo acota el límite por clave: como mucho una fila por petición
  permitida y un solo `429` por ventana. El cron borra lo que pasa de 30 días.
- `ultimo_uso` de la clave se actualiza como mucho una vez por minuto.
- `GET /uso` es una sola consulta agregada (`GROUP BY fecha_emision`) sobre el índice
  (organización, ambiente, fecha); no lee `documento_archivo`.

### Límite de peticiones e idempotencia

- Límite por clave con una ventana fija en D1: un `INSERT … ON CONFLICT … RETURNING` incrementa y lee
  de forma atómica, lo que da valores exactos para `RateLimit-*` y `Retry-After`.
- `Idempotency-Key` guarda la respuesta de `POST /dte` por organización durante 24 horas.

### MCP

`/mcp` usa `@modelcontextprotocol/server` 2.x con `createMcpHandler`: Streamable HTTP sin estado
(revisión 2026-07-28) y compatibilidad con clientes de 2025. Se crea un servidor por petición con las
herramientas ligadas al actor autenticado. Autenticación con clave de API; OAuth queda pendiente.

### Simulador del MH

Con `MH_SIMULADO=1` el emisor puede generar credenciales de prueba (`credencial_mh.simulada`); sólo
esas se atienden con el simulador del SDK, en la memoria del Worker. Las credenciales que sube el
usuario van siempre a Hacienda, y el ambiente `01` nunca usa el simulador. Como cada instancia del
Worker tiene su propia memoria, el simulador acepta invalidar documentos que recibió otra instancia.
Sirve para empezar sin trámites; no sustituye las pruebas en el ambiente oficial de Hacienda.

## Extensiones

El Worker se arma con `crearWorker(extensiones)` (`server/src/index.ts`). La exportación por defecto es
`crearWorker([])`: una instalación propia no cambia nada. Una distribución (por ejemplo, una nube
privada con funciones de pago) tiene su propio Worker que importa el núcleo y lo compone:

```ts
import { crearWorker } from 'server/extensiones'
import { miExtension } from './mi-extension'

export default crearWorker([miExtension])
```

`server/extensiones` (`server/src/sdk-extensiones.ts`) es la única entrada pública para autores de
extensiones: servicios (`emitir`, `previsualizar`, `listar`, `obtener`, `archivoJson`, `pdf`,
`listarClientes`, `ambienteActivo`, `ejecutarUnaVez`, `registrar`), `cifrar`/`descifrar`, el esquema de
Drizzle, los tipos `Ctx`/`Bindings` y los errores. Una `Extension` (`server/src/extensiones.ts`) puede
aportar:

| Campo                       | Qué hace                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | Identificador (`[a-z][a-z0-9-]*`); define el prefijo `/api/v1/ext/<id>`.                                                                                                                                                                                                |
| `rutas(app)`                | Rutas **públicas** en la raíz (webhooks de terceros, páginas propias). Cada una verifica lo suyo: firma, o sesión con `autenticar`.                                                                                                                                     |
| `api(router)`               | Rutas **autenticadas** en `/api/v1/ext/<id>/…`. Pasan por el mismo middleware que `/api/v1` (sesión o clave, CSRF, límites) y reciben `c.var.ctx`.                                                                                                                      |
| `cron(env, ejecucion)`      | Se llama en cada ejecución del cron, aislada: un error se registra y no afecta las tareas del núcleo.                                                                                                                                                                   |
| `panel`                     | Enlaces `{ titulo, ruta, icono?, permiso?, grupo? }` que `GET /api/v1/yo` devuelve en `extensiones` (filtrados por permiso) y el panel muestra en la barra lateral con navegación completa. `grupo` es `'desarrolladores'`, `'administracion'` o `'mas'` (por defecto). |
| `cuenta(ctx)`               | Datos de la cuenta que el panel muestra: plan, uso y aviso de mejora. Se agrega a `GET /api/v1/yo` como `cuenta`.                                                                                                                                                       |
| `antesDeEmitir(ctx, datos)` | Se llama antes de reservar el número de control en cada emisión. Lanza `AppError` para impedirla.                                                                                                                                                                       |

### Ganchos de cuenta y de emisión

```ts
/** Datos de la cuenta que el panel muestra (plan, uso, aviso de mejora). Se agrega a GET /api/v1/yo como `cuenta`. */
cuenta?: (ctx: Ctx) => Promise<CuentaExtension | null>
/** Se llama antes de reservar el número de control en cada emisión (DTE y eventos que consumen correlativo). Lanza AppError para impedirla (p. ej. 402 plan_requerido, 429 limite_plan). */
antesDeEmitir?: (ctx: Ctx, datos: { ambiente: '00' | '01'; tipoDte: string }) => Promise<void>

export interface CuentaExtension {
  plan: { id: string; nombre: string } // p. ej. { id: 'free', nombre: 'Free' }
  uso?: { etiqueta: string; usado: number; limite: number | null }[] // p. ej. DTE del mes
  mejorar?: { titulo: string; detalle: string; ruta: string } // ruta interna /app/… o URL absoluta https
}
```

- **`cuenta`**: `GET /api/v1/yo` devuelve `cuenta: CuentaExtension | null`. Gana la primera extensión
  que devuelva un valor. Si una extensión falla, el error se registra, se sigue con la siguiente y,
  si ninguna responde, `cuenta` es `null`: `/yo` nunca se rompe por una extensión. Con `cuenta`, el
  panel muestra el nombre del plan junto a la marca, barras de uso en Inicio y la tarjeta `mejorar`
  al pie de la barra lateral, encima del menú del usuario. Con `null` (instalación propia) no
  muestra nada.
- **`antesDeEmitir`**: corre en `emitir()` para cada extensión que lo defina, en orden, después de
  validar el documento y de autenticar contra el MH y justo antes de `reservar()`. Si lanza, la
  emisión no ocurre y **no se consume número de control**; con `Idempotency-Key` la clave queda
  libre para reintentar. Vale igual para REST, MCP y el panel. Los eventos de invalidación,
  contingencia, retorno y operaciones especiales no pasan por el gancho porque no consumen
  correlativo (sólo `emitir()` llama a `reservar()`); retransmitir una contingencia tampoco, porque
  esos documentos ya tienen su número. Códigos reservados para las distribuciones:
  `plan_requerido` (402) y `limite_plan` (429).
- Los ganchos viajan en `ctx.extensiones`, que fija el middleware de autenticación. Un `Ctx` armado
  con `ctxDeMiembro` sólo los lleva si se le pasa `extensiones` (las mismas que recibió
  `crearWorker`); sin eso, lo que emita esa extensión no pasa por `antesDeEmitir`.

Para actuar a nombre de un usuario fuera de una petición (un mensaje entrante, por ejemplo),
`ctxDeMiembro(env, { userId, organizationId, origen })` arma un `Ctx` con los permisos del rol actual
del miembro, o `null` si ya no pertenece a la organización. `origen` admite valores propios de la
extensión (`'whatsapp'`) y queda en `documento.origen`. Las reglas del núcleo siguen valiendo: la
lógica pasa por los servicios (`exigir` y filtro por organización), los secretos se cifran con
`cifrar()` y nada sensible va a los logs.

Las rutas `/api/v1/ext/*` no forman parte del documento OpenAPI del núcleo (la prueba
`openapi.test.ts` las excluye a propósito); cada distribución documenta las suyas.

**Migraciones.** Las tablas de una extensión son suyas y no van en `server/migrations`. D1 aplica un
único directorio de migraciones, así que la distribución arma el suyo copiando `server/migrations` del
núcleo y sus propias migraciones numeradas para quedar siempre después (p. ej. `1000_…`). **Assets.**
Las rutas públicas de una extensión deben ir en `assets.run_worker_first` del `wrangler.jsonc` de la
distribución; si no, el panel (SPA) las atiende antes que el Worker.

## Pendiente

- Validación contra el ambiente de pruebas oficial del MH.
- OAuth 2.1 para MCP (clientes que no admiten un encabezado fijo pueden usar `openfactura mcp`).
- Correo para invitaciones y recuperación de contraseña.
- Transmisión por lotes y webhooks de estado.
- Formularios guiados para los tipos 04, 07, 11 y 14 (hoy se emiten con JSON).
