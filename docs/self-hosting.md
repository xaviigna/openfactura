# Desplegar en tu propia cuenta de Cloudflare

Open Factura corre como un solo Worker con una base D1: la API REST, el servidor MCP, los webhooks y
el cron de conciliación. No trae panel web (el panel es parte de [Open Factura Cloud](https://openfactura.co)):
se administra con la API, la CLI o tu agente. Necesitas una cuenta de Cloudflare y
[Wrangler](https://developers.cloudflare.com/workers/wrangler/) con sesión iniciada (`wrangler login`).

> El plan gratuito de Workers limita la CPU a 10 ms por petición. Firmar (RSA) y generar el PDF superan
> ese límite: usa el plan de pago de Workers.

## 1. Base de datos

```bash
cd server
bunx wrangler d1 create openfactura
```

Copia el `database_id` que imprime a `server/wrangler.jsonc` (`d1_databases[0].database_id`) y aplica
las migraciones:

```bash
bun run db:migrate:remote
```

## 2. Configuración

En `server/wrangler.jsonc`, cambia `vars.APP_URL` por la URL pública (por ejemplo
`https://facturas.suempresa.com`).

Secretos:

```bash
openssl rand -base64 32 | bunx wrangler secret put BETTER_AUTH_SECRET
openssl rand -base64 32 | bunx wrangler secret put CRED_KEK_V1
openssl rand -base64 48 | tee admin-token.txt | bunx wrangler secret put ADMIN_TOKEN
```

`ADMIN_TOKEN` es tu credencial de operador: crea organizaciones y administra cualquiera de ellas
(emisor, credenciales del MH, claves de API). Guárdalo como una contraseña y bórralo de
`admin-token.txt` cuando lo tengas a salvo. Sin `ADMIN_TOKEN` (o con menos de 32 caracteres) la
administración queda desactivada.

`CRED_KEK_V1` cifra las credenciales del MH de todos los emisores. **Guarda una copia fuera de
Cloudflare**: si se pierde, las credenciales guardadas no se pueden recuperar y cada emisor tendrá que
cargarlas otra vez.

No definas `WEBHOOKS_LOCAL` en producción.

## 3. Desplegar

```bash
cd ..
bun run deploy        # compila y despliega el Worker
```

## 4. Primer uso

Con la [CLI](https://www.npmjs.com/package/@openfactura/cli) crea la organización y una clave de API de
pruebas (queda guardada como si hubieras hecho `openfactura login`):

```bash
export OPENFACTURA_URL=https://facturas.suempresa.com
export OPENFACTURA_ADMIN_TOKEN=$(cat admin-token.txt)
npx @openfactura/cli alta "Mi Empresa, S.A. de C.V."   # imprime el id de la organización
export ORG=<id de la organización>
```

Lo que sigue usa `ADMIN_TOKEN` y el encabezado `X-Organizacion` sobre la API normal:

```bash
admin() { curl -sS "$OPENFACTURA_URL/api/v1$1" -H "Authorization: Bearer $OPENFACTURA_ADMIN_TOKEN" \
  -H "X-Organizacion: $ORG" -H 'Content-Type: application/json' "${@:2}"; }

# 1. Datos del emisor (ver el esquema Emisor en /api/v1/openapi.json)
admin /emisor -X PUT -d @emisor.json

# 2. Credenciales del ambiente de pruebas de Hacienda: contraseña de API y certificado .crt
jq -n --arg p "$MH_API_PASSWORD" --rawfile c certificado.crt --arg cp "$MH_CERT_PASSWORD" \
  '{apiPassword: $p, certificado: $c, certificadoPassword: $cp}' |
  admin /emisor/credenciales/00 -X PUT -d @-

# 3. Probar la conexión con el MH
admin /emisor/probar -X POST
```

4. Emite los documentos de prueba que exige el MH (ver `docs/ser-emisor.md`) con la CLI, la API o el
   MCP.
5. Cuando Hacienda lo autorice, carga las credenciales de producción (`/emisor/credenciales/01`),
   vuelve a enviar `emisor.json` con `"ambiente": "01"` y crea una clave `of_live_…`
   (`admin /claves -X POST -d '{"nombre":"Producción","modo":"live","scopes":["dte:read","dte:emit"]}'`).

Las claves de API nunca pueden modificar el emisor ni sus credenciales: eso sólo lo hace el operador
con `ADMIN_TOKEN`. El token no vale en el MCP.

## Rotar la llave maestra

1. `bunx wrangler secret put CRED_KEK_V2` con una llave nueva. Desde ese momento todo lo que se guarde se
   cifra con V2; lo anterior se sigue descifrando con V1.
2. Vuelve a guardar las credenciales de cada emisor (o ejecuta un proceso que las recifre).
3. Cuando ningún valor empiece por `v1.`, elimina `CRED_KEK_V1`.

## Variables

| Nombre                    | Tipo    | Descripción                                                                      |
| ------------------------- | ------- | -------------------------------------------------------------------------------- |
| `APP_URL`                 | var     | URL pública del servicio                                                         |
| `BETTER_AUTH_SECRET`      | secreto | Firma de sesiones                                                                |
| `ADMIN_TOKEN`             | secreto | Credencial del operador (32+ caracteres); sin ella no hay administración         |
| `CRED_KEK_V1` (`V2`, …)   | secreto | Llave maestra AES-256, 32 bytes en base64                                        |
| `LIMITE_CLAVE_POR_MINUTO` | var     | Peticiones por minuto por clave de API (120)                                     |
| `TRUSTED_ORIGINS`         | var     | Orígenes adicionales de confianza, separados por coma                            |
| `URL_MCP`                 | var     | URL pública del MCP si no es `<APP_URL>/mcp` (la devuelve `GET /api/v1/yo`)      |
| `MH_BASE_URL`             | var     | Sustituye la URL del MH (sólo para pruebas)                                      |
| `MH_SIMULADO`             | var     | `1` permite `POST /emisor/credenciales-prueba` (simulador del MH, ambiente `00`) |
| `WEBHOOKS_LOCAL`          | var     | `1` permite webhooks a `http://localhost` (sólo desarrollo)                      |
