---
name: openfactura-webhooks
description: Configura y recibe webhooks de Open Factura (facturación electrónica DTE de El Salvador) — avisos firmados cuando un documento queda procesado, rechazado, en contingencia o invalidado, o cuando se sella un retorno. Úsala cuando el usuario quiera que su sistema (ERP, tienda en línea, backend) se entere de los cambios de estado sin consultar la API, implemente el endpoint que recibe los avisos, verifique la firma `OpenFactura-Signature` o investigue entregas fallidas.
---

# Webhooks de Open Factura

Open Factura envía un `POST` JSON firmado a la URL del cliente cuando cambia el estado de un documento.
Configúralos con el MCP (`webhooks_listar`, `webhook_crear`, `webhook_eliminar`, `webhook_probar`), la
CLI (`openfactura webhooks …`), la API (`/api/v1/webhooks`) o el panel (Administración → Webhooks).
Requieren el permiso `webhooks:manage`.

## Eventos

| Evento                             | Cuándo                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `dte.procesado`                    | Hacienda selló un documento (al emitir, al transmitir una contingencia o al conciliar un pendiente) |
| `dte.rechazado`                    | Hacienda rechazó un documento                                                |
| `dte.contingencia`                 | Hacienda no respondió y el documento quedó firmado en contingencia           |
| `dte.invalidado`                   | Se invalidó un documento                                                     |
| `retorno.procesado`                | Hacienda selló un evento de retorno (18)                                     |
| `operaciones_especiales.procesado` | Hacienda selló un evento de operaciones especiales (17)                      |

`webhook.prueba` sólo llega al usar `webhook_probar`. Suscribe sólo los eventos que el sistema usa.

## Crear el webhook

1. Pregunta la URL pública del endpoint. Debe ser `https://` con un dominio público: se rechazan
   `localhost`, IPs privadas, `*.local`, `*.internal` y URLs con usuario o contraseña.
2. `webhook_crear` con `{ url, eventos: [...], descripcion? }`. La respuesta trae `secreto`
   (`whsec_…`) **una sola vez**: indica al usuario que lo guarde como variable de entorno (por ejemplo
   `OPENFACTURA_WEBHOOK_SECRET`). No lo escribas en archivos versionados ni lo repitas después.
3. Implementa el endpoint (abajo) y despliégalo.
4. `webhook_probar`: debe responder `entregado: true`. Si no, revisa `status` y `error`.

Máximo 10 webhooks por organización (`409 limite_webhooks`). Si el secreto se filtra, rótalo
(`openfactura webhooks rotate <id>` o `POST /webhooks/:id/rotar-secreto`): el anterior deja de valer.

## Lo que llega

```json
{
  "id": "1f0c…",
  "evento": "dte.procesado",
  "creado": "2026-11-12T16:04:05.123Z",
  "ambiente": "00",
  "organizacion": "…",
  "datos": { "codigoGeneracion": "…", "numeroControl": "DTE-01-…", "tipoDte": "01", "estado": "procesado", "total": 22.6 }
}
```

Cabeceras: `OpenFactura-Event`, `OpenFactura-Delivery` (igual a `id`) y
`OpenFactura-Signature: t=<unix>,v1=<hex>`, donde `v1` es HMAC-SHA256 del texto `"<t>.<cuerpo crudo>"`
con el secreto completo (incluido `whsec_`) como llave.

`datos` es la vista pública del documento, nunca el JSON del DTE: si lo necesitas, pídelo con
`GET /api/v1/dte/{codigoGeneracion}` o `dte_obtener`.

## Implementar el endpoint (reglas)

1. **Lee el cuerpo crudo** antes de parsear; la firma se calcula sobre esos bytes exactos.
2. **Verifica la firma** y rechaza (400) si no coincide o si `t` tiene más de 5 minutos.
3. **Descarta duplicados** por `id`: una entrega puede llegar más de una vez.
4. **Responde 2xx en menos de 10 s** y haz el trabajo pesado después (cola, tarea en segundo plano).
   Las redirecciones no se siguen y cuentan como fallo.
5. **Filtra por `ambiente`** si sólo te interesan los documentos de producción (`01`).

```ts
const codificar = (texto: string) => new TextEncoder().encode(texto)

export async function verificarFirma(cuerpoCrudo: string, cabecera: string, secreto: string) {
  const partes = Object.fromEntries(cabecera.split(',').map((p) => p.split('=') as [string, string]))
  const t = Number(partes.t)
  const v1 = partes.v1 ?? ''
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false
  if (!/^[0-9a-f]{64}$/.test(v1)) return false
  const llave = await crypto.subtle.importKey('raw', codificar(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const firma = Uint8Array.from(v1.match(/../g) ?? [], (h) => Number.parseInt(h, 16))
  return crypto.subtle.verify('HMAC', llave, firma, codificar(`${t}.${cuerpoCrudo}`)) // tiempo constante
}

export async function POST(peticion: Request) {
  const cuerpo = await peticion.text()
  const firma = peticion.headers.get('OpenFactura-Signature') ?? ''
  if (!(await verificarFirma(cuerpo, firma, process.env.OPENFACTURA_WEBHOOK_SECRET!))) {
    return new Response('firma inválida', { status: 400 })
  }
  const aviso = JSON.parse(cuerpo)
  // Ignora aviso.id si ya lo procesaste; encola el trabajo y responde rápido.
  return new Response(null, { status: 204 })
}
```

Funciona en Node 18+, Cloudflare Workers, Deno y Bun (WebCrypto). En Express, usa `express.raw()` en
esa ruta para tener el cuerpo crudo.

## Entregas fallidas

- Si el endpoint no responde 2xx, Open Factura reintenta con espera creciente (1 min, 5 min, 30 min,
  2 h, 6 h, 12 h y 24 h). Tras 8 intentos la entrega queda `fallido`.
- Revisa el historial: `openfactura webhooks deliveries <id>` o `GET /api/v1/webhooks/:id/entregas`
  (`estado`, `intentos`, `ultimoStatus`, `ultimoError`).
- Corrige el endpoint y reenvía: `POST /api/v1/webhooks/entregas/:id/reenviar`.
- Desactivar un webhook detiene sus reintentos.

Detalle completo: https://docs.openfactura.co/guias/webhooks
