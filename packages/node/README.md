# @openfactura/node

SDK de la API de [Open Factura](https://openfactura.co): facturación electrónica de El Salvador
(DTE). Tipado desde la especificación OpenAPI, **sin dependencias**: corre en Node 20+, Bun, Deno,
Cloudflare Workers y el navegador.

```bash
npm install @openfactura/node
```

```ts
import { OpenFactura } from '@openfactura/node'

const of = new OpenFactura({ apiKey: process.env.OPENFACTURA_API_KEY! })

const doc = await of.dte.emitir({
  tipoDte: '01',
  datos: { items: [{ descripcion: 'Café', cantidad: 2, precioUni: 2.5 }] },
})
console.log(doc.estado, doc.selloRecibido)
const pdf = await of.dte.pdf(doc.codigoGeneracion) // ArrayBuffer
```

- **Idempotencia y reintentos.** Cada emisión lleva una clave de idempotencia (generada si no pasas
  `{ idempotencyKey }`). Ante 429, 5xx o una falla de red se reintenta con **la misma** clave: nunca
  se emite dos veces. Lo que no es seguro repetir no se reintenta.
- **Errores tipados.** `OpenFacturaError` con `status`, `code` (`dte_rechazado`, `plan_requerido`…),
  `details` y `retryAfter`.

## Webhooks

```ts
import { verificarWebhook } from '@openfactura/node'

const evento = await verificarWebhook(
  await request.text(), // el cuerpo crudo, antes de parsearlo
  request.headers.get('OpenFactura-Signature'),
  process.env.OPENFACTURA_WEBHOOK_SECRET!,
)
if (evento.evento === 'dte.procesado') {
  /* … */
}
```

Rechaza firmas que no coinciden y envíos de hace más de 5 minutos.

## Plataforma (Open Factura Cloud)

Integra la facturación en el sistema de cada cliente, cada uno en su espacio aislado:

```ts
const cliente = await of.plataforma.clientes.crear({
  nombre: 'Casa Barista',
  externalId: 'cliente-482',
  datos: { nit: '0614-290786-102-3' },
})
const { url } = await of.plataforma.clientes.enlace(cliente.id) // para que active su cuenta

// Una vez: una clave en SU espacio. Guárdala en tu base de datos.
const { clave } = await of.plataforma.clientes.claves.crear(cliente.id, {
  nombre: 'POS Casa Barista',
  modo: 'live',
  scopes: ['dte:emit', 'dte:read'],
})

// Desde ahí, emite a su nombre:
await of.comoCliente(clave).dte.emitir({ tipoDte: '01', datos })
```

Tus webhooks de cuenta reciben los eventos de todos tus clientes con `evento.datos.cliente`.

## Todo lo demás

`dte` · `eventos` · `contingencia` · `emisor` (y establecimientos) · `clientes` · `productos` ·
`catalogos` · `claves` · `webhooks` · `registros` · `auditoria` · `uso` · `yo` · y en Cloud:
`plataforma` · `marca` · `correo` · `certificacion`. Referencia completa:
[docs.openfactura.co](https://docs.openfactura.co).

Licencia MIT.
