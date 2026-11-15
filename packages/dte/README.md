# @openfactura/dte

SDK en TypeScript para los Documentos Tributarios Electrónicos (DTE) de El Salvador, según la **Normativa de Cumplimiento 2.0** y el **Manual Técnico de Integración v2** del Ministerio de Hacienda.

Construye, valida, firma y transmite. Sin Java ni Docker: la firma usa WebCrypto, así que corre en Node 20+, Cloudflare Workers, Deno y Bun.

```ts
import { ClienteMH, construirFactura, emitirDte } from '@openfactura/dte'
import { generarPdfDte } from '@openfactura/dte/pdf'

const cliente = new ClienteMH({ ambiente: '00', usuario: NIT, password: PASSWORD_API })

const dte = construirFactura(
  { ambiente: '00', emisor, correlativo: 1 },
  { items: [{ descripcion: 'Café 340 g', cantidad: 2, precioUni: 9.5 }] } // precios con IVA
)

const { archivo } = await emitirDte(cliente, dte, { certificado: crtXml, password: CLAVE_PRIVADA })
archivo.selloRecibido        // sello de recepción del MH
JSON.stringify(archivo)      // archivo DTE a entregar: estructura + firmaElectronica + selloRecibido
await generarPdfDte(archivo) // representación gráfica con QR
```

Pruébalo sin credenciales: `bun run demo` (emite contra un MH simulado y deja JSON + PDF en `examples/salida/`).

## Qué incluye

| Área | Detalle |
|---|---|
| Constructores | Los 11 DTE: Factura (01), Crédito Fiscal (03), Nota de Remisión (04), Nota de Crédito (05), Nota de Débito (06), Retención (07), Liquidación (08), Doc. Contable de Liquidación (09), Exportación (11), Sujeto Excluido (14) y Donación (15); eventos de invalidación, contingencia, Retorno (18) y Operaciones Especiales (17). Calculan resumen, tributos, redondeos y valor en letras. |
| Validación | Los 15 JSON Schemas oficiales + catálogos CAT-001…CAT-033. Validador propio sin `eval` (apto para Workers), contrastado con Ajv en los tests. |
| Firma | JWS RS512 compatible con el firmador oficial; lee el `.crt` del MH y verifica la contraseña de la llave privada. |
| Transmisión | Autenticación, recepción uno a uno y por lotes, consultas, invalidación, contingencia. Política de reintentos del Manual Técnico (8 s → consulta → reenvío ×2 → contingencia). |
| Extras | Número de control, código de generación, URL/QR de consulta pública, plazos de invalidación y de retorno, PDF, y un MH simulado (`@openfactura/dte/mock`) para desarrollo y CI. |

## Reglas de cálculo aplicadas

- Cuerpo a 8 decimales y resumen a 2, redondeo medio hacia arriba (Normativa 2.0, regla 7.2).
- Factura: precios **con** IVA; `ivaItem = ventaGravada / 1.13 × 0.13`. CCF, notas y remisión: precios **sin** IVA y tributo `20` en el resumen.
- Descuentos por ítem y globales, cargos/abonos que no afectan la base, saldo a favor, retención y percepción de IVA 1 %, retención de renta 10 % en sujeto excluido.
- NIT, DUI y NRC se envían sin guiones; toda dirección lleva `distrito` (CAT-008).

Los ejemplos numéricos del Manual Funcional v2 están reproducidos en `test/builders.test.ts`.

## Limitaciones conocidas

- **No se ha probado contra el ambiente de pruebas real de Hacienda**: hacen falta credenciales de un contribuyente. El MH simulado valida firma y estructura, no todas las reglas fiscales. Usa `examples/emitir-pruebas.ts` con tus credenciales.
- El Manual Técnico v2 no documenta un endpoint propio para los eventos de Retorno (18) y Operaciones Especiales (17); el SDK los envía por `recepciondte`. Confírmalo en pruebas.
- Operación a crédito: la Normativa (Anexo IV, campos 160–161) pide código de forma de pago `null` y monto 0; el Manual Funcional muestra un ejemplo con monto. El SDK sigue la Normativa por defecto; envía `pagos` explícito para usar la otra forma.
- `limiteInvalidacion` cuenta días hábiles sin asuetos salvo que se los pases.
- Los catálogos no relacionan distrito con municipio (el catálogo oficial no lo publica); se valida distrito y municipio contra el departamento.

## Desarrollo

```bash
npm test                 # 44 pruebas
bun run demo             # flujo completo contra el MH simulado
bun run mock             # MH simulado en http://localhost:8787
python3 scripts/build-catalogs.py "<Catálogos.xlsx>"   # regenerar catálogos (desde la raíz del repo)
```

Licencia MIT. Este proyecto no está afiliado al Ministerio de Hacienda; los documentos oficiales prevalecen.
