---
name: openfactura-errores
description: Resuelve errores y situaciones especiales de Open Factura (facturación electrónica DTE de El Salvador) — DTE rechazado por Hacienda, MH no disponible, contingencia, emisión incierta, conflictos de idempotencia — y guía la invalidación (anulación) de un documento con sus plazos. Úsala cuando una llamada a Open Factura devuelva un error, un documento quede en estado pendiente, contingencia o rechazado, o el usuario quiera anular, corregir o invalidar un DTE.
---

# Errores, contingencia e invalidación en Open Factura

Todo error tiene la forma `{ "error": { "code", "message", "details" } }`. Decide por `code`, nunca
por el texto del mensaje.

## Antes de reintentar una emisión

La regla de oro: **reintenta sólo con la misma `idempotencyKey`** (o `--idempotency-key` en la CLI).
Con la misma clave, el servidor devuelve el resultado original y no emite dos veces. Una clave nueva
puede crear un segundo documento con valor fiscal.

## Qué hacer según el código

| `code`                                                                 | Qué pasó                                                       | Qué hacer                                                                                                                                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `datos_invalidos`                                                      | La entrada no tiene la forma esperada                          | Lee `details[].ruta` y `mensaje`, corrige y repite.                                                                                                              |
| `dte_invalido`                                                         | No cumple el esquema del MH. No se emitió nada                 | Corrige cada `details.problemas[]` (`ruta`, `mensaje`) y vuelve a `dte_validar`.                                                                                 |
| `dte_rechazado` (422)                                                  | Hacienda lo rechazó. El número de control queda como rechazado | Muestra `details.mh.observaciones` al usuario, corrige los datos y emite **un documento nuevo** con otra `idempotencyKey` (el rechazado no cuenta como emitido). |
| `mh_no_disponible` (502)                                               | No se pudo hablar con Hacienda. No se consumió número          | Espera y reintenta con la misma `idempotencyKey`.                                                                                                                |
| `mh_credenciales_rechazadas`                                           | Hacienda no aceptó la contraseña de API o el certificado       | El usuario debe revisar Emisor → Credenciales del MH en el panel.                                                                                               |
| `emision_fallida`                                                      | No se pudo firmar; quedó `rechazado` sin transmitirse          | Revisar el certificado en el panel; luego emitir de nuevo.                                                                                                       |
| `emision_incierta`                                                     | No se sabe si Hacienda lo recibió. Queda `pendiente`           | **No emitas otro.** Consulta `dte_obtener` con `details.codigoGeneracion`; el servidor lo concilia solo con el MH en minutos.                                    |
| `idempotencia_en_curso`                                                | Ese mismo intento todavía se está procesando                   | Espera unos segundos y repite con la misma clave.                                                                                                                |
| `idempotencia_distinta`                                                | Esa clave ya se usó con otro contenido                         | Si es otro documento, usa una clave nueva. Si es el mismo, envía exactamente el mismo cuerpo.                                                                    |
| `emisor_no_configurado`, `credenciales_incompletas`, `sin_punto_venta` | Falta configuración                                            | El usuario debe completarla en el panel web; el agente no puede.                                                                                                 |
| `retorno_excedido` (409)       | El retorno supera lo que queda del documento                   | `details.disponible` dice cuánto queda por retornar. Ajusta las cantidades.                         |
| `retorno_vigente` (409)         | El documento tiene un evento de retorno procesado              | Para invalidar el documento, primero invalida el retorno: `dte_invalidar` con `details.codigoGeneracion`. |
| `evento_rechazado` (422)        | Hacienda rechazó el retorno o las operaciones especiales       | Muestra `details.mh.observaciones`, corrige y vuelve a enviar con otra `idempotencyKey`.             |
| `sin_permiso` (403)                                                    | La clave no tiene el permiso `details.permiso`                 | Pide una clave con ese permiso.                                                                                                                                  |
| `limite_excedido` (429)                                                | Demasiadas peticiones                                          | Espera `Retry-After` segundos.                                                                                                                                   |

## Contingencia

Si `dte_emitir` devuelve estado `contingencia` (HTTP 202), Hacienda no respondió: el documento **ya es
válido**, quedó firmado y se transmitirá después. Díselo así al usuario y entrégale el documento
normalmente. No lo vuelvas a emitir.

Cuando Hacienda vuelva a responder, hay que transmitirlos: pantalla **Contingencia** del panel,
`openfactura contingencia transmitir` o `POST /contingencia/transmitir` (requiere `dte:invalidate`).
Plazos: 24 horas desde que termina la contingencia para el evento, y 72 horas desde su sello para los documentos.

## Invalidar (anular) un documento

La invalidación es **irreversible** y tiene efecto fiscal. Antes de llamar `dte_invalidar`:

1. `dte_obtener` y confirma que el documento está `procesado` (sólo esos se invalidan). Si tiene un
   evento de retorno procesado, hay que invalidar antes ese retorno (`dte_invalidar` con el código del
   retorno); un retorno se invalida dentro de los 4 días siguientes a su sello.
2. Revisa el plazo:
   - Factura (01), Exportación (11) y Sujeto Excluido (14): **3 meses** desde el sello.
   - Los demás (CCF 03, notas 05/06, etc.): hasta el **10.º día hábil del mes siguiente** a la emisión.
   - Fuera de plazo, Hacienda la rechaza (`invalidacion_rechazada`). Para un CCF vencido, lo normal es una
     Nota de Crédito (05) en lugar de invalidar.
3. Elige `tipoAnulacion` con el usuario:
   - `1` Error en la información: primero emite el documento correcto y pasa su código en
     `codigoGeneracionReemplazo`.
   - `2` Rescindir la operación (la venta no ocurrió): no requiere reemplazo.
   - `3` Otro: requiere `motivoAnulacion` y `codigoGeneracionReemplazo`.
4. Resume (documento, receptor, total, tipo de anulación, reemplazo) y pide un "sí" explícito.
5. Llama a `dte_invalidar`. Si responde `invalidacion_rechazada`, muestra `details.mh.observaciones`.

## Estados de un documento

`pendiente` (esperando confirmación del MH) · `procesado` (válido, con sello) · `contingencia` (válido,
se transmite después) · `rechazado` (sin valor; emite otro) · `invalidado` (anulado).

Lista completa de códigos de error: https://docs.openfactura.co/errores
