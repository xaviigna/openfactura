# @openfactura/cli

Cliente de línea de comandos de [Open Factura](../../README.md), la plataforma abierta de facturación
electrónica de El Salvador (DTE, Ministerio de Hacienda). Emite, consulta e invalida documentos desde la
terminal o desde un script, e incluye un servidor MCP por stdio para Claude y otros asistentes.

La CLI habla con un servidor de Open Factura únicamente por su API REST: no firma ni transmite por su
cuenta, y no necesita el certificado de Hacienda en tu equipo.

## Instalación

Requiere Node.js 20 o superior (también funciona con Bun).

```bash
npm i -g @openfactura/cli
openfactura --version

# o sin instalar
npx @openfactura/cli --help
```

## Inicio de sesión

Crea una clave de API en el panel web (Desarrolladores → Nueva clave). Las claves `of_test_…` trabajan contra
el ambiente de pruebas del MH y las `of_live_…` contra producción.

```bash
openfactura login --url https://factura.tu-empresa.sv
# Clave de API (of_test_… u of_live_…): ← se teclea sin mostrarse
```

`login` verifica la clave contra el servidor y la guarda en `~/.config/openfactura/config.json`
(o en `$XDG_CONFIG_HOME/openfactura/config.json`) con permisos `0600`. La clave completa nunca se
imprime: la CLI muestra sólo sus primeros 14 caracteres.

```bash
openfactura login --url https://factura.tu-empresa.sv --key of_test_…   # sin preguntar
echo "$CLAVE" | openfactura login                                        # desde una tubería
openfactura login --profile produccion                                   # otro perfil
openfactura logout                                                       # borra la clave guardada
```

Evita `--key` en equipos compartidos: el valor queda en el historial de la terminal.

En tu propio servidor (sin panel), el operador crea la organización y una clave de pruebas con el
`ADMIN_TOKEN` del servidor; la clave queda guardada como con `login` y el token no se guarda:

```bash
OPENFACTURA_ADMIN_TOKEN=… openfactura alta "Mi Empresa" --url https://factura.tu-empresa.sv
```

En un servidor de integración continua no hace falta `login`; basta con las variables de entorno:

```bash
export OPENFACTURA_URL=https://factura.tu-empresa.sv
export OPENFACTURA_API_KEY=of_test_…
openfactura whoami
```

### De dónde sale cada valor

| Valor            | Orden de prioridad                                                           |
| ---------------- | ---------------------------------------------------------------------------- |
| URL del servidor | `--url` → `OPENFACTURA_URL` → perfil guardado → `https://app.openfactura.co` |
| Clave de API     | `OPENFACTURA_API_KEY` → perfil guardado                                      |
| Perfil           | `--profile` → `OPENFACTURA_PROFILE` → `default`                              |

## Comandos

Todos aceptan `--json` (imprime el JSON de la API en stdout, para scripts), `--url`, `--profile` y
`--help`.

### Sesión y emisor

```bash
openfactura whoami      # actor, permisos, ambiente, servidor y prefijo de la clave
openfactura emisor      # datos fiscales, establecimientos, puntos de venta y credenciales cargadas
```

```text
$ openfactura whoami
Actor:        clave
Organización: aaFgOwpa4md9Tl6Ct9e42AJ2jNnAltjh
Ambiente:     00 Pruebas (simulador del MH)
Servidor:     https://app.openfactura.co (defecto)
Clave:        of_test_0d2aEw… (entorno)
Perfil:       default
Permisos:     dte:read, dte:emit, dte:invalidate, clientes:read, …
```

### Clientes

```bash
openfactura clientes list
openfactura clientes list --q "contribuyente"

openfactura clientes add --file cliente.json
openfactura clientes add \
  --tipo-documento 36 --num-documento 0614-290786-103-1 --nrc 234567-8 \
  --nombre "CLIENTE CONTRIBUYENTE, S.A. DE C.V." \
  --cod-actividad 46900 --desc-actividad "Venta al por mayor de otros productos" \
  --departamento 06 --municipio 23 --distrito 14 --complemento "Av. Olímpica #100" \
  --telefono 22445566 --correo compras@cliente.com.sv
```

`--tipo-documento`: `36` NIT, `13` DUI, `03` pasaporte, `02` carné de residente, `37` otro. También
existe `--nombre-comercial`. El archivo de `--file` lleva los mismos campos que la API
(`tipoDocumento`, `numDocumento`, `nombre`, …); `--file -` lee la entrada estándar.

### Productos

```bash
openfactura productos list --q licencia

openfactura productos add --file producto.json
openfactura productos add --codigo LIC-001 --descripcion "Licencia anual" --precio 100 --tipo-item 2
```

`--precio` va **sin IVA**. `--tipo-item`: `1` bien (por defecto), `2` servicio, `3` ambos, `4` otros
tributos. `--uni-medida`: código de CAT-014 (por defecto `59`, unidad). `--tipo-venta`: `gravada`
(por defecto), `exenta` o `noSujeta`.

### Catálogos del MH

```bash
openfactura catalogos                               # lista de catálogos
openfactura catalogos CAT-012                       # departamentos
openfactura catalogos CAT-013 --departamento 06     # municipios de San Salvador
openfactura catalogos CAT-019 --q "programación"    # actividades económicas
```

### DTE

El archivo de emisión es el mismo cuerpo de `POST /api/v1/dte`:

```json
{
  "tipoDte": "01",
  "datos": {
    "items": [
      { "descripcion": "Servicio de consultoría", "cantidad": 2, "precioUni": 11.3, "tipoItem": 2 }
    ]
  }
}
```

- `tipoDte`: `01` Factura, `03` Crédito Fiscal, `04` Nota de Remisión, `05` Nota de Crédito, `06` Nota de
  Débito, `07` Comprobante de Retención, `08` Comprobante de Liquidación, `09` Documento Contable de
  Liquidación, `11` Factura de Exportación, `14` Sujeto Excluido, `15` Comprobante de Donación.
- `datos`: `items`, `receptor`, `condicionOperacion`, `pagos`, `documentosRelacionados`… En Factura,
  `precioUni` **incluye** IVA; en Crédito Fiscal, notas y remisión va **sin** IVA.
- `clienteId` (opcional): usa un cliente guardado como receptor. `puntoVentaId` (opcional): punto de
  venta que emite; por defecto el primero.

Un Crédito Fiscal para un cliente guardado:

```json
{
  "tipoDte": "03",
  "clienteId": "c6de4c6c-d772-4f19-811a-5419655dcd06",
  "datos": { "items": [{ "descripcion": "Licencia anual", "cantidad": 1, "precioUni": 100 }] }
}
```

#### Validar

```bash
openfactura dte validar factura.json
cat factura.json | openfactura dte validar -
```

Construye el documento y lo valida contra el esquema del MH sin consumir número de control, sin firmar y
sin transmitir. Imprime los totales y los problemas; termina con salida `1` si hay problemas.

#### Emitir

```bash
openfactura dte emitir factura.json
generar-factura | openfactura dte emitir - --json > emitido.json
```

```text
$ openfactura dte emitir factura.json
Idempotency-Key: 853c48f2-f488-45d5-af00-0369495f0c05
Estado:               procesado
Tipo:                 01 Factura
Número de control:    DTE-01-M001P001-000000000000002
Código de generación: 0862382B-0BB8-42A0-BB6B-B42DCCDF1EA4
Total:                $22.60
Sello recibido:       20265EE94C1B2C4CBB56F56121E37F5AC8CA7D27
```

Cada emisión lleva una `Idempotency-Key`. Si no la indicas, la CLI genera un UUID y lo muestra (por
stderr) **antes** de enviar. Si la red falla y no sabes si el documento se emitió, repite el comando con
esa misma clave: el servidor devuelve el resultado original y no emite dos veces.

```bash
openfactura dte emitir factura.json --idempotency-key 853c48f2-f488-45d5-af00-0369495f0c05
openfactura dte emitir factura.json --idempotency-key pedido-1042     # tu propio identificador
```

Si el MH no responde, el documento queda firmado en estado `contingencia` y se transmite después con
`openfactura contingencia transmitir`.

#### Consultar

```bash
openfactura dte list
openfactura dte list --tipo 01 --estado procesado --desde 2026-11-01 --hasta 2026-11-30
openfactura dte list --q "cliente contribuyente" --pagina 2

openfactura dte get 0862382B-0BB8-42A0-BB6B-B42DCCDF1EA4     # estado, sello, respuesta del MH, eventos

openfactura dte json 0862382B-0BB8-42A0-BB6B-B42DCCDF1EA4               # JSON oficial a stdout
openfactura dte json 0862382B-0BB8-42A0-BB6B-B42DCCDF1EA4 -o dte.json

openfactura dte pdf 0862382B-0BB8-42A0-BB6B-B42DCCDF1EA4                # guarda <codigo>.pdf aquí
openfactura dte pdf 0862382B-0BB8-42A0-BB6B-B42DCCDF1EA4 -o factura.pdf
```

`--estado`: `pendiente`, `procesado`, `rechazado`, `contingencia` o `invalidado`.

#### Invalidar

```bash
openfactura dte invalidar 0862382B-0BB8-42A0-BB6B-B42DCCDF1EA4 --tipo 2 --motivo "Operación rescindida"
openfactura dte invalidar <codigo> --tipo 1 --reemplazo <codigo-del-dte-que-lo-corrige>
```

`--tipo`: `1` error en la información (requiere `--reemplazo`), `2` rescindir la operación, `3` otro
(requiere `--motivo` y `--reemplazo`). La invalidación es irreversible. El mismo comando invalida un
evento de retorno u operaciones especiales si recibe su código. Un DTE con un retorno vigente no se
invalida hasta invalidar antes el retorno.

#### Retorno (evento 18)

Devolución de bienes, reembolso o envases sobre una Factura (01), Factura de Exportación (11) o Sujeto
Excluido (14) procesados, sin invalidar el documento. Plazo: 3 meses desde la fecha del documento.

```bash
echo '{ "items": [{ "descripcion": "Silla", "cantidad": 1, "precioUni": 22.6 }] }' \
  | openfactura dte retorno 0862382B-0BB8-42A0-BB6B-B42DCCDF1EA4 -
```

`precioUni` va como en el documento original: en Factura con IVA, en 11 y 14 sin IVA. Como `dte emitir`,
lleva `Idempotency-Key` y pide confirmación con una clave `of_live_…`.

### Eventos

```bash
openfactura eventos operaciones-especiales simplificadas.json   # evento 17
openfactura eventos list --tipo retorno
openfactura eventos get <codigo>
openfactura eventos json <codigo> -o retorno.json
openfactura eventos pdf <codigo> -o retorno.pdf
```

El archivo de operaciones especiales informa facturas simplificadas (`"tipoDocumento": "02"`, por rangos)
o comprobantes de control interno (`"97"`):

```json
{
  "tipoDocumento": "02",
  "fecha": "2026-10-31",
  "items": [
    { "descripcion": "Facturas simplificadas", "docDel": "1", "docAl": "25", "precioUni": 10 }
  ]
}
```

### Contingencia

```bash
openfactura contingencia transmitir
```

### Webhooks

Tu sistema recibe un `POST` firmado cuando un documento cambia de estado. La clave necesita el permiso
`webhooks:manage`.

```bash
openfactura webhooks add https://erp.tu-empresa.sv/hooks/openfactura \
  --eventos dte.procesado,dte.rechazado --descripcion "ERP"   # sin --eventos: todos
openfactura webhooks list
openfactura webhooks test <id>          # envía webhook.prueba; salida 1 si no se entrega
openfactura webhooks deliveries <id>    # últimas 50 entregas, con intentos y errores
openfactura webhooks rotate <id>        # secreto nuevo; el anterior deja de firmar
openfactura webhooks remove <id>
```

`add` y `rotate` muestran el secreto de firma (`whsec_…`) una sola vez. Eventos: `dte.procesado`,
`dte.rechazado`, `dte.contingencia`, `dte.invalidado`, `retorno.procesado`,
`operaciones_especiales.procesado`. Cómo verificar la cabecera `OpenFactura-Signature`: sección
«Webhooks» de `docs/api.md` en el repositorio del servidor.

### Uso y registros

```bash
openfactura uso                                  # emitidos, procesados y rechazados por día (30 días)
openfactura uso --desde 2026-11-01 --hasta 2026-11-30
openfactura registros list                       # últimas peticiones hechas con claves de API
openfactura registros list --estado error --origen mcp --limite 20
```

`registros list` requiere que la clave tenga el permiso `registros:read`. Sólo muestra metadatos
(método, patrón de ruta, estado HTTP, duración y clave); el servidor nunca guarda el contenido.

### Confirmación en producción

Con una clave `of_live_…`, `dte emitir`, `dte retorno`, `eventos operaciones-especiales`,
`dte invalidar` y `contingencia transmitir` piden confirmación
porque tienen efecto fiscal. Usa `--yes` para omitirla. Si no hay una terminal interactiva (un script,
una tubería, `dte emitir -`), la CLI no pregunta: exige `--yes` y termina con salida `2` si falta.

## Uso en scripts

`--json` imprime en stdout exactamente el JSON de la API; los avisos y errores van a stderr.

```bash
codigo=$(openfactura dte emitir factura.json --json | jq -r .codigoGeneracion)
openfactura dte pdf "$codigo" -o "facturas/$codigo.pdf"
```

Los errores se imprimen en stderr como `Error [codigo]: mensaje`, seguidos del detalle: cada problema de
`dte_invalido` como `ruta: mensaje`, o las observaciones del MH en `dte_rechazado`. Con `--json`, stderr
recibe el JSON de error de la API (`{ "error": { "code", "message", "details" } }`); en un `429` se le
agrega el campo `retryAfter` con los segundos de espera.

### Códigos de salida

| Código | Significado                                                                            |
| ------ | -------------------------------------------------------------------------------------- |
| `0`    | Todo bien                                                                              |
| `1`    | Error de la API o de validación (incluye `dte validar` con problemas y errores de red) |
| `2`    | Uso incorrecto: opción o argumento inválido, archivo ilegible, falta `--yes`           |
| `3`    | Sin autenticar: falta la clave, o es inválida, fue revocada o expiró                   |
| `4`    | Límite de peticiones excedido; se imprime `Retry-After`                                |

### Variables de entorno

| Variable              | Uso                                                        |
| --------------------- | ---------------------------------------------------------- |
| `OPENFACTURA_API_KEY` | Clave de API. Tiene prioridad sobre la clave guardada      |
| `OPENFACTURA_URL`     | URL del servidor                                           |
| `OPENFACTURA_PROFILE` | Perfil de configuración (por defecto `default`)            |
| `XDG_CONFIG_HOME`     | Carpeta base de la configuración (por defecto `~/.config`) |

## Conectar tu agente

`openfactura mcp install` agrega Open Factura a la configuración MCP de tu agente de IA en un solo
comando. Ejecuta antes `openfactura login`: así el agente usa el perfil guardado y la clave **no** se
copia en archivos de terceros.

```bash
openfactura login --url https://factura.tu-empresa.sv
openfactura mcp install cursor claude-desktop    # uno o varios agentes
openfactura mcp install --todos                  # todos los detectados en este equipo
openfactura mcp install zed --imprimir           # sólo muestra qué agregar y dónde
openfactura mcp agentes                          # agentes compatibles, detectados y su archivo
```

```text
$ openfactura mcp install cursor codex --yes
✓ Cursor: ~/.cursor/mcp.json (reinicia Cursor)
✓ Codex CLI: ~/.codex/config.toml (abre una sesión nueva de Codex)
La clave no se copió: el servidor usa el perfil «default» de `openfactura login`.
```

| Agente           | Dónde escribe                                                                                                                        | Formato                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `claude-code`    | `claude mcp add --scope user …` (si `claude` está en el PATH; si no, lo imprime)                                                     | comando                          |
| `claude-desktop` | macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`, Linux `~/.config/Claude/` → `claude_desktop_config.json` | JSON `mcpServers` (sólo local)   |
| `cursor`         | `~/.cursor/mcp.json`                                                                                                                 | JSON `mcpServers`                |
| `vscode`         | `code --add-mcp '<json>'` (si `code` está en el PATH; si no, lo imprime)                                                             | comando                          |
| `windsurf`       | `~/.codeium/windsurf/mcp_config.json`                                                                                                | JSON `mcpServers`                |
| `codex`          | `~/.codex/config.toml` (o `$CODEX_HOME`)                                                                                             | TOML `[mcp_servers.openfactura]` |
| `gemini`         | `~/.gemini/settings.json`                                                                                                            | JSON `mcpServers`                |
| `zed`            | `~/.config/zed/settings.json` (Linux `$XDG_CONFIG_HOME/zed`, Windows `%APPDATA%\Zed`)                                                | JSON `context_servers`           |
| `cline`          | `~/.cline/data/settings/cline_mcp_settings.json` (o `CLINE_MCP_SETTINGS_PATH`)                                                       | JSON `mcpServers`                |
| `goose`          | `~/.config/goose/config.yaml` (Windows `%APPDATA%\Block\goose\config\`)                                                              | YAML `extensions.openfactura`    |

Cómo modifica los archivos:

- Pide confirmación antes de escribir (`--yes` la omite; sin terminal y sin `--yes` sale con código 2).
- Lee el archivo, agrega o reemplaza **sólo** la entrada `openfactura` y conserva todo lo demás. Antes
  de escribir deja un respaldo `<archivo>.bak-AAAAMMDDhhmmss` y escribe de forma atómica.
- Si el archivo no se puede editar con seguridad (por ejemplo, el `settings.json` de Zed con
  comentarios, o un YAML que no sigue el estilo de Goose) no lo toca: imprime el fragmento y la ruta
  para que lo pegues tú.
- Por defecto el agente lanza el servidor local (`npx -y @openfactura/cli mcp`) con
  `OPENFACTURA_URL` (y `OPENFACTURA_PROFILE` si no usas el perfil `default`).
- Sin sesión guardada, usa `OPENFACTURA_API_KEY` o te la pide sin mostrarla, la verifica contra el
  servidor y la escribe en la configuración del agente con permisos `0600`. La CLI nunca imprime la
  clave: los fragmentos muestran `<CLAVE_DE_API>`.
- `--remoto` configura el servidor MCP remoto (`<url>/mcp`; en la nube, `https://openfactura.co/mcp`)
  con el encabezado `Authorization: Bearer <clave>`, en los agentes que admiten encabezados (todos
  menos Claude Desktop). La clave queda en el archivo del agente.
- `--json` imprime el resultado de cada agente (`instalado`, `sin_cambios`, `manual`, `impreso`,
  `error`).

## Servidor MCP (stdio)

`openfactura mcp` es un servidor [MCP](https://modelcontextprotocol.io) por stdio. Sirve para los
clientes que no pueden enviar un encabezado HTTP fijo al servidor MCP remoto (`/mcp`). Expone las mismas
herramientas que el remoto y las ejecuta llamando a la API REST con tu clave:

`emisor_obtener`, `catalogo_buscar`, `clientes_buscar`, `cliente_crear`, `productos_buscar`,
`producto_crear`, `dte_validar`, `dte_emitir`, `dte_listar`, `dte_obtener`, `dte_invalidar`,
`dte_retorno`, `operaciones_especiales_informar`, `eventos_listar`, `evento_obtener`,
`webhooks_listar`, `webhook_crear`, `webhook_eliminar`, `webhook_probar`, `uso_obtener`,
`registros_listar`.

Cada herramienta exige el mismo permiso que su ruta REST, así que la clave decide qué puede hacer el
asistente. Empieza con una clave `of_test_…`; `dte_emitir`, `dte_retorno`, `operaciones_especiales_informar` y
`dte_invalidar` tienen efecto fiscal con una
clave `of_live_…`, y aquí no hay confirmación de la CLI: la das tú en tu cliente MCP al aprobar la
llamada.

### Claude Code

```bash
claude mcp add openfactura \
  --env OPENFACTURA_API_KEY=of_test_… \
  --env OPENFACTURA_URL=https://factura.tu-empresa.sv \
  -- npx -y @openfactura/cli mcp
```

### Claude Desktop

En `claude_desktop_config.json` (o en un `.mcp.json` de proyecto para Claude Code):

```json
{
  "mcpServers": {
    "openfactura": {
      "command": "npx",
      "args": ["-y", "@openfactura/cli", "mcp"],
      "env": {
        "OPENFACTURA_API_KEY": "of_test_…",
        "OPENFACTURA_URL": "https://factura.tu-empresa.sv"
      }
    }
  }
}
```

Si ya ejecutaste `openfactura login` en ese equipo puedes omitir `env`: el servidor usa el perfil guardado.

Si tu cliente sí admite encabezados HTTP, puedes conectarte al servidor remoto sin instalar nada:

```bash
claude mcp add --transport http openfactura https://factura.tu-empresa.sv/mcp \
  --header "Authorization: Bearer of_test_…"
```

## Desarrollo

```bash
bun install
bun run dev -- whoami     # ejecuta desde el código fuente
bun run build             # dist/index.js
bun run test
bun run type-check
```

## Licencia

MIT. La CLI es un cliente independiente del servidor de Open Factura (AGPL-3.0): se comunica con él
únicamente por HTTP y no incluye su código.
