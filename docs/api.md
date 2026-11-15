# API de Open Factura

Base: `/api/v1`. Todo es JSON. La misma API sirve al panel web (cookie de sesión) y a integraciones
(clave de API). El servidor MCP en `/mcp` y la CLI usan los mismos servicios.

`GET /api/v1/openapi.json` (público, sin autenticación) sirve el documento OpenAPI 3.1, construido en
`server/src/openapi.ts` desde los esquemas zod de `shared`. Al agregar una ruta a `routes/v1.ts`,
agrega su entrada en `RUTAS` y ejecuta `cd server && bun run openapi`; la prueba
`server/test/openapi.test.ts` falla si falta alguna.

## Autenticación

| Quién       | Cómo                                                           | Ambiente del MH                     |
| ----------- | -------------------------------------------------------------- | ----------------------------------- |
| Panel web   | Cookie de sesión de Better Auth (`/api/auth/*`)                | El `ambiente` guardado en el emisor |
| Operador    | `Authorization: Bearer <ADMIN_TOKEN>` + `X-Organizacion: <id>` | El `ambiente` guardado en el emisor |
| Integración | `Authorization: Bearer of_test_…`                              | `00` pruebas                        |
| Integración | `Authorization: Bearer of_live_…`                              | `01` producción                     |

El panel web es de quien distribuye el núcleo (p. ej. Open Factura Cloud); una instalación propia no lo
trae. El operador de una instalación propia usa `ADMIN_TOKEN` (secreto del servidor, 32+ caracteres)
con todos los permisos sobre la organización de `X-Organizacion`, sólo en `/api/v1` (no en el MCP), y
crea organizaciones con `POST /api/admin/organizaciones` `{ nombre }` (`GET` las lista). Sin
`ADMIN_TOKEN` esas rutas responden 404.

Una clave de pruebas nunca toca producción, ni al revés. La clave completa se muestra una sola vez al
crearla; el servidor guarda únicamente su SHA-256.

### Rutas de sesión (Better Auth)

- `POST /api/auth/sign-up/email` `{ name, email, password }` (contraseña de 10+ caracteres)
- `POST /api/auth/sign-in/email` `{ email, password }`
- `POST /api/auth/sign-out`
- `GET  /api/auth/get-session`
- `POST /api/auth/organization/create` `{ name, slug }` — el creador queda como `owner`
- `POST /api/auth/organization/set-active` `{ organizationId }`
- `GET  /api/auth/organization/list`
- Invitaciones y miembros: `organization/invite-member`, `organization/list-members`,
  `organization/remove-member`, `organization/update-member-role`, `organization/accept-invitation`
  (ver la documentación del plugin `organization` de Better Auth).

Un usuario sin organización recibe `409 sin_organizacion` en `/api/v1/*`. Si pertenece a varias y la
sesión no tiene una activa, recibe `409 sin_organizacion_activa` con `details.organizaciones`: llama a
`organization/set-active`.

## Permisos

`dte:read` · `dte:emit` · `dte:invalidate` · `clientes:read` · `clientes:write` · `productos:read` ·
`productos:write` · `emisor:read` · `emisor:write` · `claves:manage` · `webhooks:manage` ·
`auditoria:read` · `registros:read`

- Roles del panel: `owner` y `admin` tienen todos; `member` (facturador) tiene `dte:read`, `dte:emit`,
  `clientes:*`, `productos:*` y `emisor:read` (no `webhooks:manage`).
- Una clave de API sí puede llevar `webhooks:manage`, para que el integrador configure sus webhooks
  desde su propio sistema, y `registros:read`, para depurar su integración desde la CLI o el MCP.
- Una clave de API lleva la lista de permisos que se eligió al crearla. Nunca puede llevar
  `emisor:write`, `claves:manage` ni `auditoria:read`.

## Errores

```json
{ "error": { "code": "dte_invalido", "message": "…", "details": {} } }
```

| HTTP | `code`                                                                                                                                                                                                                                                                                                                                                 | Significado                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `datos_invalidos`                                                                                                                                                                                                                                                                                                                                      | Cuerpo o parámetros inválidos; `details` = `[{ ruta, mensaje }]`                                                                                           |
| 400  | `dte_invalido`                                                                                                                                                                                                                                                                                                                                         | El DTE no cumple el esquema del MH; `details.problemas` = `[{ ruta, mensaje, regla }]`                                                                     |
| 401  | `no_autenticado`                                                                                                                                                                                                                                                                                                                                       | Falta sesión o la clave no es válida, fue revocada o expiró                                                                                                |
| 402  | `plan_requerido`                                                                                                                                                                                                                                                                                                                                       | Sólo en distribuciones con planes: el plan de la cuenta no incluye la operación. Una instalación propia nunca lo devuelve                                  |
| 403  | `sin_permiso`                                                                                                                                                                                                                                                                                                                                          | `details.permiso` indica el permiso que falta                                                                                                              |
| 404  | `no_encontrado`                                                                                                                                                                                                                                                                                                                                        |                                                                                                                                                            |
| 409  | `sin_organizacion`, `sin_organizacion_activa`, `nit_bloqueado`, `emisor_no_configurado`, `credenciales_incompletas`, `sin_punto_venta`, `estado_invalido`, `ambiente_distinto`, `retorno_excedido`, `retorno_vigente`, `limite_webhooks`, `idempotencia_distinta`, `idempotencia_en_curso`, `cliente_repetido`, `producto_repetido`, `codigo_repetido` | Falta configurar algo o hay un conflicto                                                                                                                   |
| 422  | `dte_rechazado`, `invalidacion_rechazada`, `contingencia_rechazada`, `evento_rechazado`                                                                                                                                                                                                                                                                | El MH rechazó; `details.mh` = `{ codigo, mensaje, observaciones[] }`                                                                                       |
| 429  | `limite_excedido`                                                                                                                                                                                                                                                                                                                                      | `Retry-After` indica cuántos segundos esperar                                                                                                              |
| 429  | `limite_plan`                                                                                                                                                                                                                                                                                                                                          | Sólo en distribuciones con planes: se alcanzó el límite del plan (p. ej. DTE del mes). No se consumió número de control                                    |
| 502  | `mh_credenciales_rechazadas`, `mh_no_disponible`                                                                                                                                                                                                                                                                                                       | Problema hablando con el MH; no se consumió número de control                                                                                              |
| 502  | `emision_fallida`                                                                                                                                                                                                                                                                                                                                      | No se pudo firmar; el documento quedó `rechazado` sin transmitirse                                                                                         |
| 502  | `emision_incierta`                                                                                                                                                                                                                                                                                                                                     | No se pudo confirmar el resultado. El documento queda `pendiente` y se concilia solo contra el MH; consulta `details.codigoGeneracion` antes de reintentar |

## Límite de peticiones

Cada clave de API admite 120 peticiones por minuto (configurable con `LIMITE_CLAVE_POR_MINUTO`).
Toda respuesta autenticada con clave trae `RateLimit-Limit`, `RateLimit-Remaining` y `RateLimit-Reset`
(segundos). Al exceder el límite: `429` con `Retry-After`. Además: las rutas de `/api/auth/*` tienen
límite por IP, los intentos con claves inválidas se limitan a 30 por minuto por IP, cada sesión del
panel admite 600 peticiones por minuto y ningún cuerpo puede superar 512 KB.

## Idempotencia

`POST /api/v1/dte` acepta el encabezado `Idempotency-Key` (hasta 200 caracteres). Repetir la petición con
la misma clave y el mismo cuerpo devuelve la respuesta original con `Idempotent-Replayed: true`, sin
emitir dos veces. Con otro cuerpo: `409 idempotencia_distinta`. Las claves se conservan 24 horas y son
independientes por ambiente: una clave usada en pruebas no devuelve nada en producción. Se guardan como
respuesta definitiva los éxitos, `dte_rechazado` y `emision_incierta`; los demás errores liberan la
clave para reintentar.

## Rutas

### Sesión y tablero

- `GET /yo` → `{ usuario: { id, nombre, correo } | null, rol, actor, organizationId, permisos[], ambiente, simulador, url, extensiones[], cuenta }` (`url`: URL pública del servidor; `extensiones`: enlaces `{ titulo, ruta, icono, grupo }` de las extensiones instaladas, vacío en una instalación estándar; `cuenta`: `{ plan: { id, nombre }, uso?: [{ etiqueta, usado, limite }], mejorar?: { titulo, detalle, ruta } }` cuando una extensión lo aporta, `null` en una instalación propia)
- `GET /resumen` → `{ ambiente, mes, porEstado: { procesado: n, … }, procesadosMes, totalMes, recientes: Documento[] }`
- `GET /uso?desde=&hasta=` (`dte:read`) → `{ ambiente, desde, hasta, totales: { emitidos, procesados, rechazados, monto }, dias: [{ fecha, emitidos, procesados, rechazados, monto }] }`.
  Uso por día en el ambiente activo. Fechas `AAAA-MM-DD` en hora de El Salvador; sin fechas, los
  últimos 30 días; rango máximo de 366 días. `dias` sólo trae los días con movimiento y `monto` suma
  los documentos procesados.

### Emisor (`emisor:read` / `emisor:write`)

- `GET /emisor` → `{ emisor | null, establecimientos: [{ …, puntosVenta: [] }], credenciales: { "00": { apiPassword, certificado, certificadoNit, actualizado }, "01": {…} }, ambienteActivo }`
- `PUT /emisor` — cuerpo: `nit, nrc, nombre, nombreComercial?, codActividad, descActividad, departamento,
  municipio, distrito, complemento, telefono, correo, ambiente? ('00'|'01'; si se omite se conserva),
  responsableNombre?,
  responsableTipoDoc?, responsableNumDoc?`. La primera vez crea el establecimiento `M001` y el punto de
  venta `P001`.
- `PUT /emisor/credenciales/:ambiente` — `{ apiPassword?, certificado?, certificadoPassword? }`.
  `certificado` es el contenido XML del `.crt` de Hacienda y va siempre junto a su contraseña. Se valida
  que la contraseña abra la llave y que el NIT del certificado sea el del emisor. Los secretos se cifran
  (AES-256-GCM) y **nunca** se devuelven: la respuesta sólo trae banderas.
- `POST /emisor/probar` → `{ ok, ambiente, mensaje }` — autentica contra el MH.
- `POST /emisor/credenciales-prueba` — sólo con `MH_SIMULADO=1`: genera un certificado de prueba para el
  ambiente `00`, atendido por el simulador (`simuladas: true`). Las credenciales que sube el usuario van
  siempre a Hacienda.
- `GET /establecimientos` · `POST /establecimientos` · `PUT /establecimientos/:id` — `{ nombre, tipo
  ('01' sucursal | '02' casa matriz | '04' bodega | '07' patio), codMh (M001…), codInterno?, departamento?,
  municipio?, distrito?, complemento?, telefono? }`
- `POST /puntos-venta` — `{ establecimientoId, nombre, codMh (P001…), codInterno? }`

### Clientes y productos

- `GET /clientes?q=&limite=` · `POST /clientes` · `GET|PUT|DELETE /clientes/:id`
  Cuerpo: `tipoDocumento ('36' NIT | '13' DUI | '03' pasaporte | '02' carné de residente | '37' otro),
  numDocumento, nrc?, nombre, nombreComercial?, codActividad?, descActividad?, departamento?, municipio?,
  distrito?, complemento?, telefono?, correo?`
- `GET /productos?q=&limite=` · `POST /productos` · `GET|PUT|DELETE /productos/:id`
  Cuerpo: `codigo, descripcion, precioUnitario (SIN IVA), tipoItem (1 bien | 2 servicio | 3 ambos | 4 otros
  tributos), uniMedida (CAT-014; 59 = unidad), tipoVenta ('gravada' | 'exenta' | 'noSujeta')`

### DTE

Cuerpo de emisión:

```json
{
  "tipoDte": "01",
  "datos": { "items": [{ "descripcion": "Servicio", "cantidad": 2, "precioUni": 11.3 }] },
  "clienteId": "opcional",
  "puntoVentaId": "opcional"
}
```

`tipoDte`: `01` Factura, `03` Crédito Fiscal, `04` Nota de Remisión, `05` Nota de Crédito, `06` Nota de
Débito, `07` Comprobante de Retención, `08` Comprobante de Liquidación, `09` Documento Contable de
Liquidación, `11` Factura de Exportación, `14` Sujeto Excluido, `15` Comprobante de Donación. `08`, `09` y
`15` no admiten contingencia: con el MH caído responden `502 mh_no_disponible`.

`datos` es la entrada del constructor del SDK `@openfactura/dte` para ese tipo (`FacturaInput`,
`CreditoFiscalInput`, `NotaInput`, …; ver `packages/dte/README.md`). En Factura `precioUni` incluye IVA; en
CCF, notas y remisión va sin IVA. Si se envía `clienteId` y falta `datos.receptor`, el receptor se toma
del cliente guardado.

- `POST /dte/validar` (`dte:emit`) → `{ dte, problemas[], total, receptorNombre }`. No consume número de
  control, no firma, no transmite.
- `POST /dte` (`dte:emit`) → `Documento`
  - `201` estado `procesado`, con `selloRecibido`.
  - `202` estado `contingencia`: el MH no respondió; el DTE quedó firmado y se transmite después.
  - `422 dte_rechazado`: el MH lo rechazó (el número de control queda registrado como rechazado).
- `GET /dte?tipo=&estado=&q=&desde=&hasta=&pagina=&porPagina=` (`dte:read`) → `{ items: Documento[], total, pagina, porPagina, ambiente }`
- `GET /dte/:codigo` → `Documento & { dte, respuestaMh, eventos[] }` (`:codigo` = código de generación o id)
- `GET /dte/:codigo/json` → archivo DTE oficial (estructura + `firmaElectronica` + `selloRecibido`)
- `GET /dte/:codigo/pdf` → `application/pdf`
- `POST /dte/:codigo/invalidar` (`dte:invalidate`) — `{ tipoAnulacion: 1|2|3, motivoAnulacion?,
  codigoGeneracionReemplazo?, solicitante?: { nombre, tipoDocumento, numDocumento }, responsable? }`.
  `:codigo` también puede ser el de un evento de retorno u operaciones especiales: entonces se invalida
  ese evento y la respuesta es `{ invalidado: true, tipo, codigoGeneracion }`. Un DTE con un retorno
  vigente responde `409 retorno_vigente` (`details.codigoGeneracion`): primero se invalida el retorno.
- `POST /dte/:codigo/retorno` (`dte:emit`, admite `Idempotency-Key`) — Evento de Retorno (18) sobre una
  Factura (01), Factura de Exportación (11) o Sujeto Excluido (14) procesados: devolución de bienes,
  reembolsos o envases, sin invalidar el documento. Cuerpo: `{ items: [{ descripcion, cantidad,
  precioUni, tipoItem?, codigo?, uniMedida?, descuento?, tipoVenta?, seguro?, flete? }] }`. `precioUni`
  como en el documento original (en Factura, con IVA). Receptor, terceros y datos de exportación se
  copian del DTE; las retenciones se aplican si el DTE las tuvo. Plazo: 3 meses desde la fecha del DTE
  (2 años para FE y FEXE de las actividades 21001, 21008, 46482, 46484, 46491 y 47721). La suma de los
  retornos no puede superar el DTE: `409 retorno_excedido` con `details.disponible`. → `201 Evento`
- `POST /contingencia/transmitir` (`dte:invalidate`) → `{ evento, procesados[], rechazados[], restantes }`

### Eventos de retorno (18) y operaciones especiales (17)

- `POST /eventos/operaciones-especiales` (`dte:emit`, admite `Idempotency-Key`) — informa facturas
  simplificadas (`tipoDocumento: "02"`, siempre por rangos `docDel`–`docAl`) o comprobantes de control
  interno (`"97"`, uno a uno con `numDocumento` + `fechaEmision`, o por rangos; no se mezclan).
  Cuerpo: `{ tipoDocumento, fecha?: AAAA-MM-DD (define el periodo; por defecto hoy, nunca futura),
  items: [{ descripcion, precioUni (SIN IVA), cantidad?, numDocumento?, docDel?, docAl?, fechaEmision?,
  tipoVenta?, codigoGeneracionRef? }] }`. Los documentos anulados van en un evento aparte, todos con
  `codigoGeneracionRef` (el evento donde se informaron activos). → `201 Evento`
- `GET /eventos?tipo=retorno|operaciones_especiales` (`dte:read`) → `Evento[]` (50 más recientes del
  ambiente activo)
- `GET /eventos/:codigo` → `Evento & { dte, respuestaMh }`
- `GET /eventos/:codigo/json` · `GET /eventos/:codigo/pdf` — archivo y representación gráfica que se
  entregan al receptor

`Evento`: `{ id, tipo: "retorno" | "operaciones_especiales", tipoEvento: "18" | "17", codigoGeneracion,
ambiente, estado: "procesado" | "rechazado" | "invalidado", selloRecibido, documentoId, creado }`. Si el
MH rechaza el evento: `422 evento_rechazado` con `details.mh`.

`Documento`:

```json
{
  "id": "…",
  "codigoGeneracion": "UUID",
  "numeroControl": "DTE-01-M001P001-000000000000001",
  "tipoDte": "01",
  "ambiente": "00",
  "estado": "pendiente | procesado | rechazado | contingencia | invalidado",
  "fechaEmision": "2026-11-12",
  "horaEmision": "01:38:12",
  "receptorNombre": null,
  "receptorDocumento": null,
  "total": 22.6,
  "selloRecibido": "…",
  "origen": "panel | api | mcp",
  "error": null,
  "creado": 1794469092559,
  "urlConsulta": "https://admin.factura.gob.sv/…"
}
```

### Catálogos

- `GET /catalogos` → `[{ id, nombre, total }]`
- `GET /catalogos/:id?q=&departamento=&limite=` → `{ id, nombre, total, valores: [{ codigo, valor, departamento? }] }`
  (`CAT-012` departamentos, `CAT-013` municipios, `CAT-008` distritos, `CAT-019` actividades económicas —
  devuelve 50 por defecto, usa `q` —, `CAT-014` unidades, `CAT-017` formas de pago, `CAT-022` documentos)

### Claves de API (`claves:manage`) y auditoría (`auditoria:read`)

- `GET /claves` → `[{ id, nombre, prefijo, modo, scopes[], expira, ultimoUso, revocada, creado, estado: 'activa'|'revocada'|'expirada' }]`
- `POST /claves` — `{ nombre, modo: 'test'|'live', scopes: [...], expiraEnDias? }` → lo anterior más
  `clave` (la clave completa, sólo esta vez)
- `DELETE /claves/:id` → revoca de inmediato
- `GET /auditoria?antesDe=&limite=` → `[{ id, actorTipo, actorId, accion, recurso, recursoId, ip, detalle, creado }]`

### Registros de la API (`registros:read`)

- `GET /registros?estado=ok|error&origen=api|mcp&claveId=&antesDe=&limite=` →
  `[{ id, creado, metodo, ruta, estado, duracionMs, origen: 'api'|'mcp', clave: { id, prefijo, nombre } }]`

Una fila por petición hecha con clave de API (REST o MCP); las del panel no se anotan. `ruta` es el
patrón (`/api/v1/dte/:codigo`), nunca la URL: no se guardan identificadores, parámetros de consulta,
encabezados ni cuerpos. Una ruta inexistente queda como `/api/*`. Al exceder el límite de peticiones
se anota un solo `429` por ventana. Se conservan 30 días. Paginación hacia atrás con `antesDe`
(milisegundos); `limite` máximo 200.

## Webhooks

Open Factura avisa a tu sistema cuando un documento cambia de estado, sin que tengas que consultar.
Configúralos en el panel (**Administración → Webhooks**), con la API, con `openfactura webhooks` o con
las herramientas MCP. Requieren el permiso `webhooks:manage`.

### Rutas (`webhooks:manage`)

- `GET /webhooks` → `[{ id, url, descripcion, eventos[], activo, creado, actualizado }]` (nunca el secreto)
- `POST /webhooks` — `{ url, eventos: [...], descripcion?, activo? }` → lo anterior más `secreto`
  (`whsec_…`, sólo esta vez). Hasta 10 por organización (`409 limite_webhooks`).
- `PATCH /webhooks/:id` — cualquiera de `{ url, descripcion, eventos, activo }`
- `DELETE /webhooks/:id` → `{ eliminado: true }`; borra también su historial de entregas
- `POST /webhooks/:id/rotar-secreto` → el webhook con un `secreto` nuevo; el anterior deja de firmar
  de inmediato
- `POST /webhooks/:id/probar` → envía ya un evento `webhook.prueba` y responde
  `{ entregado, status, error, entrega }`. No se reintenta.
- `GET /webhooks/:id/entregas` → las 50 más recientes:
  `[{ id, webhookId, evento, estado: 'pendiente'|'entregado'|'fallido', intentos, ultimoStatus, ultimoError, proximoIntento, creado, entregado }]`
- `POST /webhooks/entregas/:id/reenviar` → reenvía ahora el mismo cuerpo con una firma nueva y
  reinicia sus reintentos

Crear, cambiar, eliminar y rotar quedan en la auditoría (sólo el host de la URL, nunca el secreto).

### Eventos

| Evento                             | Cuándo                                                                                                | `datos`                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `dte.procesado`                    | El MH selló un documento: al emitir, al transmitir una contingencia o al conciliar un pendiente       | Documento (como `GET /dte/:codigo` sin `dte`, `respuestaMh` ni `eventos`) |
| `dte.rechazado`                    | El MH rechazó un documento (al emitir o al transmitir la contingencia), o la conciliación lo descartó | Documento                                                                 |
| `dte.contingencia`                 | El MH no respondió y el documento quedó firmado en contingencia                                       | Documento                                                                 |
| `dte.invalidado`                   | Se invalidó un documento                                                                              | Documento                                                                 |
| `retorno.procesado`                | El MH selló un evento de retorno (18)                                                                 | Evento (como `GET /eventos/:codigo` sin `dte`)                            |
| `operaciones_especiales.procesado` | El MH selló un evento de operaciones especiales (17)                                                  | Evento                                                                    |

`webhook.prueba` sólo se envía con `POST /webhooks/:id/probar`. Los nombres de los eventos son
contrato público y no cambian.

### Cuerpo

```json
{
  "id": "1f0c…",
  "evento": "dte.procesado",
  "creado": "2026-11-12T16:04:05.123Z",
  "ambiente": "00",
  "organizacion": "org_…",
  "datos": {
    "codigoGeneracion": "C25227C9-…",
    "numeroControl": "DTE-01-M001P001-000000000000001",
    "tipoDte": "01",
    "estado": "procesado",
    "selloRecibido": "2026…",
    "total": 22.6,
    "…": "…"
  }
}
```

`id` es el id de la entrega (igual a la cabecera `OpenFactura-Delivery`): úsalo para descartar
duplicados, porque una entrega puede llegar más de una vez. `ambiente` permite ignorar los de pruebas
(`00`). El cuerpo nunca lleva el JSON del DTE ni datos de las credenciales del MH: si necesitas el
documento completo, pídelo con `GET /dte/:codigo`.

### Cabeceras

```
POST <tu URL>
Content-Type: application/json
User-Agent: OpenFactura-Webhooks/1
OpenFactura-Event: dte.procesado
OpenFactura-Delivery: 1f0c…
OpenFactura-Signature: t=1794500645,v1=5d41402abc4b2a76b9719d911017c592…
```

`v1` es el HMAC-SHA256, en hexadecimal, del texto `"<t>.<cuerpo crudo>"` con el secreto completo
(incluido `whsec_`) como llave. `t` es la hora del envío en segundos Unix.

### Verificar la firma (Node 18+, Workers, Deno o Bun, con WebCrypto)

```ts
const codificar = (texto: string) => new TextEncoder().encode(texto)

/** Devuelve true si la petición viene de Open Factura y tiene menos de 5 minutos. */
export async function verificarFirma(cuerpoCrudo: string, cabecera: string, secreto: string) {
  const partes = Object.fromEntries(
    cabecera.split(',').map((p) => p.split('=') as [string, string]),
  )
  const t = Number(partes.t)
  const v1 = partes.v1 ?? ''
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false
  if (!/^[0-9a-f]{64}$/.test(v1)) return false
  const llave = await crypto.subtle.importKey(
    'raw',
    codificar(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const firma = Uint8Array.from(v1.match(/../g) ?? [], (h) => Number.parseInt(h, 16))
  // `verify` compara en tiempo constante.
  return crypto.subtle.verify('HMAC', llave, firma, codificar(`${t}.${cuerpoCrudo}`))
}

// Ejemplo con un handler estándar (Hono, Workers, Next.js route handlers…):
export async function POST(peticion: Request) {
  const cuerpo = await peticion.text() // el cuerpo CRUDO, antes de JSON.parse
  const firma = peticion.headers.get('OpenFactura-Signature') ?? ''
  if (!(await verificarFirma(cuerpo, firma, process.env.OPENFACTURA_WEBHOOK_SECRET!))) {
    return new Response('firma inválida', { status: 400 })
  }
  const aviso = JSON.parse(cuerpo)
  // … encola el trabajo y responde rápido; ignora `aviso.id` si ya lo procesaste.
  return new Response(null, { status: 204 })
}
```

### Entrega y reintentos

- Cualquier respuesta 2xx en menos de 10 s cuenta como entregada. Las redirecciones no se siguen y
  cuentan como fallo.
- El primer intento sale justo después de la operación, sin retrasar la respuesta de la API. Una
  operación que cambia muchos documentos a la vez (p. ej. una contingencia grande) intenta los primeros
  10 de inmediato y deja el resto al cron.
- Si falla, se reintenta desde el cron (cada 5 minutos) con espera creciente: 1 min, 5 min, 30 min,
  2 h, 6 h, 12 h y 24 h. Tras 8 intentos (casi dos días) la entrega queda `fallido`; puedes reenviarla
  a mano con `POST /webhooks/entregas/:id/reenviar`.
- Desactivar un webhook detiene sus reintentos (las entregas pendientes quedan `fallido`).
- Cada ejecución del cron envía como mucho 20 entregas.

### Seguridad

- Sólo URLs `https://` con nombre de dominio público. Se rechazan `localhost`, `*.localhost`, `*.local`,
  `*.internal`, IPs privadas, de loopback, de enlace local y reservadas (IPv4 e IPv6, en cualquier
  notación), nombres sin dominio y URLs con usuario o contraseña. En desarrollo, `WEBHOOKS_LOCAL=1` permite además
  `http://localhost`.
- El secreto se guarda cifrado (AES-256-GCM con la llave maestra) y sólo se muestra al crearlo o
  rotarlo. Si se filtra, rótalo.
- El cuerpo de la respuesta de tu servidor no se lee ni se guarda; el historial sólo conserva el
  estado HTTP y un motivo breve.

## MCP

`POST /mcp` — Streamable HTTP sin estado (revisión 2026-07-28; también atiende clientes de 2025).
Autenticación sólo con clave de API (las cookies de sesión no se aceptan en esta ruta):

```bash
claude mcp add --transport http openfactura https://TU-DOMINIO/mcp --header "Authorization: Bearer of_test_…"
```

Herramientas: `emisor_obtener`, `catalogo_buscar`, `clientes_buscar`, `cliente_crear`,
`productos_buscar`, `producto_crear`, `dte_validar`, `dte_emitir` (requiere `idempotencyKey`),
`dte_listar`, `dte_obtener`, `dte_invalidar`,
`dte_retorno` y `operaciones_especiales_informar`
(requieren `idempotencyKey`), `eventos_listar`, `evento_obtener`, `webhooks_listar`, `webhook_crear`,
`webhook_eliminar`, `webhook_probar`, `uso_obtener`, `registros_listar`. Cada una exige el mismo permiso que su ruta REST. La CLI
(`openfactura mcp`) expone las mismas herramientas por stdio.
