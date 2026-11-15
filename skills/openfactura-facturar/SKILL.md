---
name: openfactura-facturar
description: Emite y consulta facturas electrónicas de El Salvador (DTE) con Open Factura por MCP, CLI o API — Factura de consumidor final (01), Crédito Fiscal (03), notas de crédito y débito (05/06), Sujeto Excluido (14), Exportación (11), Liquidación (08/09), Donación (15) y otros. Úsala cuando el usuario pida facturar, emitir un comprobante o CCF, cobrarle a un cliente, buscar o descargar un DTE (PDF/JSON), o registrar clientes y productos en Open Factura.
---

# Facturar con Open Factura

Emitir un DTE **tiene efecto fiscal**: se firma, se transmite al Ministerio de Hacienda (MH) y consume
un número de control. Sólo se deshace con una invalidación, que tiene plazos. Trabaja con cuidado.

## Reglas que no se rompen

1. **Valida antes de emitir.** Siempre `dte_validar` primero; corrige los `problemas` y repite.
2. **Confirma con el usuario antes de `dte_emitir`.** Muéstrale: tipo de documento, receptor, cada línea
   (cantidad × precio), total y ambiente (pruebas o **producción**). Emite sólo tras un "sí" explícito
   a ese resumen. Nunca emitas por iniciativa propia ni "para probar" en producción.
3. **No calcules impuestos ni totales.** Open Factura calcula IVA, retenciones, redondeos y total.
   Muestra siempre el `total` que devuelve `dte_validar`, no uno calculado por ti.
4. **Usa una `idempotencyKey` por intento** (por ejemplo `pedido-1042` o un UUID) y **reutilízala** si
   reintentas el mismo documento. Así un reintento nunca emite dos veces.
5. **No adivines datos fiscales** (NIT, NRC, actividad económica, dirección). Búscalos en clientes
   guardados o pídelos al usuario.

## Flujo

1. `emisor_obtener` — ambiente activo, punto de venta, credenciales. Si el ambiente es `01`, dile al
   usuario que vas a emitir **en producción**.
2. **Receptor:** `clientes_buscar` por nombre o documento. Si no existe y el documento lo requiere,
   pide los datos y guárdalo con `cliente_crear` (después de confirmar).
3. **Ítems:** `productos_buscar` para reutilizar código y precio. Atención al IVA (ver abajo).
4. `dte_validar` con `{ tipoDte, datos, clienteId? }`.
5. Resumen y confirmación del usuario.
6. `dte_emitir` con la misma entrada más `idempotencyKey`.
7. Informa `estado`, `numeroControl`, `codigoGeneracion`, `total` y, si existe, `urlConsulta`. El PDF y
   el JSON oficial se obtienen con `dte_obtener` o `openfactura dte pdf|json <codigo>`.

## ¿Qué documento corresponde?

| Situación                                                        | `tipoDte` | Receptor                                                                                |
| ---------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| Venta a consumidor final o a quien no pide crédito fiscal        | `01`      | Opcional (obligatorio desde $25,000)                                                    |
| Venta a un contribuyente inscrito en IVA que pide crédito fiscal | `03`      | Obligatorio: NIT, NRC, nombre, actividad (`codActividad` + `descActividad`) y dirección |
| Corregir a la baja un CCF ya emitido (devolución, descuento)     | `05`      | El mismo del documento original                                                         |
| Aumentar el valor de un CCF ya emitido                           | `06`      | El mismo del documento original                                                         |
| Compra a una persona no inscrita en IVA (sujeto excluido)        | `14`      | `sujetoExcluido` con documento y dirección                                              |
| Venta al exterior                                                | `11`      | Receptor extranjero con `codPais`                                                       |
| Traslado de mercadería sin venta                                 | `04`      | Según el caso                                                                           |
| Como comisionista, liquidar ventas hechas por cuenta de un tercero | `08`    | El mandante (NIT); `documentos` con montos en positivo                                  |
| Como agente perceptor (tarjetas), liquidar a un afiliado         | `09`      | El afiliado: NIT, actividad y correo                                                    |
| Acreditar una donación recibida (entidad autorizada)             | `15`      | El donante; `documentosAsociados` con la resolución                                     |
| Devolución, reembolso o envases sobre una Factura (01), Exportación (11) o Sujeto Excluido (14) | Evento de retorno (`dte_retorno`) | El del documento original (se copia solo) |

Si no está claro, pregunta: "¿El cliente necesita Crédito Fiscal (tiene NRC)?" Sí → `03`; no → `01`.

## IVA en los precios

- **Factura (01):** `precioUni` **incluye** IVA (13 %). Es el precio que paga el consumidor.
- **CCF (03), notas (05/06) y remisión (04):** `precioUni` va **sin** IVA.
- Los productos guardados tienen el precio **sin** IVA. Para una Factura (01), manda en `precioUni` el
  precio que paga el consumidor (con IVA), no el guardado tal cual. Si el usuario dice "cobrale $50",
  pregunta si es con o sin IVA cuando no sea obvio.

## Ejemplos de `datos`

Factura de consumidor final, sin receptor:

```json
{
  "tipoDte": "01",
  "datos": {
    "items": [
      { "descripcion": "Servicio de consultoría", "cantidad": 3, "precioUni": 56.5, "tipoItem": 2 }
    ]
  }
}
```

Crédito Fiscal para un cliente guardado (el receptor sale del cliente):

```json
{
  "tipoDte": "03",
  "clienteId": "c6de4c6c-…",
  "datos": {
    "items": [{ "descripcion": "Licencia anual", "cantidad": 1, "precioUni": 100, "tipoItem": 2 }]
  }
}
```

Nota de crédito sobre un CCF electrónico:

```json
{
  "tipoDte": "05",
  "clienteId": "c6de4c6c-…",
  "datos": {
    "documentosRelacionados": [
      {
        "tipoDocumento": "03",
        "tipoGeneracion": 2,
        "numeroDocumento": "<codigoGeneracion del CCF>",
        "fechaEmision": "2026-11-12"
      }
    ],
    "items": [{ "descripcion": "Devolución parcial", "cantidad": 1, "precioUni": 20 }]
  }
}
```

Comprobante de Retención (07): cada ítem es un documento al que se le retuvo IVA (código CAT-006:
`22` retención 1 %, `C4` 13 %, `C9` otros casos con `ivaRetenido` explícito):

```json
{
  "tipoDte": "07",
  "clienteId": "c6de4c6c-…",
  "datos": {
    "items": [
      {
        "tipoDte": "03", "tipoGeneracion": 2, "numeroDocumento": "<codigoGeneracion del CCF>",
        "fechaEmision": "2026-11-01", "montoSujetoGrav": 1000, "codigoRetencionMH": "22",
        "descripcion": "Retención 1 %"
      }
    ]
  }
}
```

Factura de Exportación (11), precios sin IVA (tributo C3 al 0 %). Para bienes (`tipoItemExpor: 1`)
van `recintoFiscal` (CAT-027), `tipoRegimen` (CAT-033) y `regimen` (CAT-028):

```json
{
  "tipoDte": "11",
  "datos": {
    "receptor": {
      "nombre": "ACME Inc.", "tipoDocumento": "37", "numDocumento": "US-123456", "codPais": "US",
      "complemento": "1 Main St, Austin TX", "tipoPersona": 2, "descActividad": "Software"
    },
    "tipoItemExpor": 1, "recintoFiscal": "01", "tipoRegimen": "EX-1", "regimen": "1000.000",
    "items": [{ "descripcion": "Café oro", "cantidad": 100, "precioUni": 3.5, "uniMedida": 36 }],
    "flete": 50, "seguro": 10
  }
}
```

Factura de Sujeto Excluido (14): una **compra** a quien no está inscrito en IVA; `retencionRenta: true`
retiene el 10 %:

```json
{
  "tipoDte": "14",
  "datos": {
    "sujetoExcluido": {
      "tipoDocumento": "13", "numDocumento": "01234567-8", "nombre": "María López",
      "direccion": { "departamento": "06", "municipio": "23", "distrito": "14", "complemento": "Col. Escalón" }
    },
    "items": [{ "descripcion": "Servicio de jardinería", "cantidad": 1, "precioUni": 200, "tipoItem": 2 }],
    "retencionRenta": true
  }
}
```

Campos útiles de cada ítem: `descripcion`, `cantidad`, `precioUni`, `tipoItem` (1 bien, 2 servicio,
3 ambos, 4 otros tributos), `codigo`, `uniMedida` (CAT-014; 59 = unidad), `descuento` (total de la
línea), `tipoVenta` (`gravada` por defecto, `exenta`, `noSujeta`).

Pago: por defecto contado en efectivo. A crédito: `"condicionOperacion": 2` y
`"credito": { "plazo": "01", "periodo": 30 }` (30 días). Otras formas de pago: `pagos` con códigos de
CAT-017 (consulta `catalogo_buscar` con `id: "CAT-017"`).

Direcciones: `{ departamento, municipio, distrito, complemento }` con códigos de CAT-012, CAT-013 y
CAT-008. NIT, DUI y NRC pueden ir con o sin guiones.

## Retorno (devoluciones sobre 01, 11 y 14)

Para una devolución sobre una Factura, Exportación o Sujeto Excluido **no** se invalida ni se emite una
nota: se transmite un **Evento de Retorno** con `dte_retorno` (`openfactura dte retorno <codigo> -`).

- `codigoGeneracion` del documento original, `idempotencyKey` e `items` con lo que se devuelve.
- `precioUni` como en el documento original: en Factura (01) **con** IVA; en 11 y 14 sin IVA.
- Plazo: 3 meses desde la fecha del documento. La suma de retornos no puede superar el documento.
- Si el cliente cambia el producto, además se emite un documento nuevo por la nueva venta.
- Confirma con el usuario igual que al emitir: tiene efecto fiscal.

Las facturas simplificadas en papel y los comprobantes de control interno se informan cada periodo con
`operaciones_especiales_informar` (evento 17): `tipoDocumento` 02 por rangos `docDel`–`docAl`, o 97 uno
a uno o por rangos; precios sin IVA.

## Consultar

- `dte_listar` con filtros `tipo`, `estado`, `q` (receptor, número de control o código), `desde`/`hasta`
  (AAAA-MM-DD).
- `dte_obtener` con el `codigoGeneracion`: estado, sello, JSON oficial, respuesta del MH y eventos.

Si algo falla al validar o emitir, o el usuario quiere anular un documento, usa la habilidad
`openfactura-errores`.

Guías completas y referencia de la API: https://docs.openfactura.co
