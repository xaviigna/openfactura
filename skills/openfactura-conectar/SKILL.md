---
name: openfactura-conectar
description: Conecta un agente (Claude Code, Claude Desktop, Cursor u otro cliente MCP) a Open Factura, la plataforma abierta de facturación electrónica de El Salvador (DTE del Ministerio de Hacienda). Úsala cuando el usuario quiera configurar el servidor MCP o la CLI de Open Factura, crear o elegir una clave de API, pasar de pruebas a producción, o cuando las herramientas de Open Factura no aparezcan o respondan `no_autenticado`/`sin_permiso`.
---

# Conectar un agente a Open Factura

Open Factura expone las mismas operaciones por tres vías: servidor MCP remoto (`/mcp`), servidor MCP
local por stdio (`openfactura mcp`) y CLI/REST. Todas usan una **clave de API** y exigen los mismos
permisos. En una instalación propia, cambia `app.openfactura.co` y `openfactura.co` por tu dominio. Documentación completa:
https://docs.openfactura.co

## 1. Datos que necesitas del usuario

- **URL del servidor**: `https://app.openfactura.co` si usa **Open Factura Cloud** (el MCP remoto
  está en `https://openfactura.co/mcp`); si la empresa se autoaloja, la URL de su instalación. En desarrollo local: `http://localhost:8788`.
- **Clave de API**, creada en el panel web: Desarrolladores → Nueva clave. La clave completa se muestra una
  sola vez.

No inventes la URL ni la clave. Pídelas. Nunca imprimas la clave completa en la respuesta ni la guardes
en archivos versionados.

## 2. Elegir la clave correcta

| Prefijo     | Ambiente del MH | Efecto                                   |
| ----------- | --------------- | ---------------------------------------- |
| `of_test_…` | `00` pruebas    | Sin valor fiscal. Empieza siempre aquí.  |
| `of_live_…` | `01` producción | Documentos con valor legal ante Hacienda |

Recomienda permisos mínimos según el uso:

- Sólo consultar: `dte:read`, `clientes:read`, `productos:read`, `emisor:read`.
- Facturar: lo anterior más `dte:emit`, `clientes:write`, `productos:write`.
- Invalidar: añadir `dte:invalidate` sólo si de verdad se necesita.
- Recibir notificaciones en su sistema: `webhooks:manage` (crea webhooks y ve sus entregas).

Una clave nunca puede llevar `emisor:write`, `claves:manage` ni `auditoria:read`: eso se hace en el
panel.

## 3. Conectar

**MCP remoto (recomendado si el cliente admite encabezados HTTP):**

```bash
claude mcp add --transport http openfactura https://openfactura.co/mcp \
  --header "Authorization: Bearer of_test_…"
```

**MCP local por stdio** (clientes que no envían encabezados, como Claude Desktop):

```json
{
  "mcpServers": {
    "openfactura": {
      "command": "npx",
      "args": ["-y", "@openfactura/cli", "mcp"],
      "env": { "OPENFACTURA_API_KEY": "of_test_…", "OPENFACTURA_URL": "https://app.openfactura.co" }
    }
  }
}
```

**CLI** (scripts, integración continua):

```bash
npm i -g @openfactura/cli
openfactura login --url https://app.openfactura.co # pide la clave sin mostrarla
# o en CI: OPENFACTURA_URL=… OPENFACTURA_API_KEY=… openfactura whoami
```

## 4. Verificar

1. Llama a `emisor_obtener` (o `openfactura whoami` y `openfactura emisor`).
2. Confirma con el usuario: nombre y NIT del emisor, **ambiente activo** (00 o 01), que haya al menos
   un punto de venta y que las credenciales del MH estén cargadas para ese ambiente.
3. Si el emisor no está configurado (`emisor_no_configurado`) o faltan credenciales
   (`credenciales_incompletas`), el usuario debe completarlo en el panel web: Emisor y
   Credenciales del MH. El agente no puede hacerlo con una clave de API.

## Problemas frecuentes

| Síntoma                             | Causa y solución                                                    |
| ----------------------------------- | ------------------------------------------------------------------- |
| `401 no_autenticado`                | Clave mal copiada, revocada o expirada. Crea otra en el panel.      |
| `403 sin_permiso`                   | `details.permiso` indica qué falta. Crea una clave con ese permiso. |
| `429 limite_excedido`               | 120 peticiones/minuto por clave. Espera `Retry-After` segundos.     |
| No aparecen herramientas en el MCP  | La ruta `/mcp` sólo acepta clave de API, no la sesión del panel.    |
| Documentos "desaparecen" al cambiar | Cada clave ve sólo su ambiente: las de pruebas no ven producción.   |

Para emitir documentos, usa la habilidad `openfactura-facturar`.
