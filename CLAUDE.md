# Open Factura — guía para agentes

Facturación electrónica de El Salvador, de código abierto. Monorepo Bun + Turbo (estructura inicial de
bhvr). Lea `docs/arquitectura.md` y `docs/api.md` antes de cambiar el servidor.

## Comandos

```bash
bun install
bun run build         # shared → SDK, CLI y tipos del servidor
bun run dev           # API y MCP en :8788 (wrangler dev); no hay panel
bun run test          # SDK, API (workerd + D1 local) y CLI
bun run type-check
bun run lint          # biome check .   (bun run format para corregir)
```

Después de cambiar código: `bun run lint`, `bun run type-check` y las pruebas del paquete tocado.
Después de cambiar `server/src/db/schema.ts`: `cd server && bun run db:generate` y
`bun run db:migrate:local`. Tras cambiar rutas del servidor: `bun run build` en `server/` para que el
cliente vea los tipos nuevos.

## Reglas del proyecto

1. **Origen limpio.** Este repositorio reemplaza una versión basada en una plantilla propietaria. No
   copie código, esquemas ni nombres de esa plantilla ni de ninguna otra fuente con licencia
   incompatible. Dependencias nuevas: sólo licencias permisivas (MIT, Apache-2.0, BSD, ISC).
2. **Licencias.** `server` y `shared` son AGPL-3.0. `packages/dte` y `packages/cli` son MIT y
   no pueden importar nada de los paquetes AGPL; la CLI sólo habla HTTP con la API.
3. **Idioma.** Términos de dominio, mensajes al usuario y comentarios en español. Los códigos de error
   (`dte_rechazado`) y los permisos (`dte:emit`) son contrato público: no los renombre.
4. **Servicios.** Toda lógica de negocio va en `server/src/services` con la firma `(ctx, entrada)`.
   Cada función pública empieza con `exigir(ctx, permiso)` y toda consulta filtra por
   `ctx.actor.organizationId`. Las rutas REST y las herramientas MCP sólo validan la entrada y llaman al
   servicio. Una operación nueva se expone en REST, MCP y CLI.
5. **Permisos.** Fuente única: `shared/src/permisos.ts`. No compare nombres de rol en el código.
6. **Secretos.** Nada que venga de `credencial_mh` se devuelve, se registra en auditoría ni se escribe
   en logs. Los secretos nuevos se cifran con `cifrar()` y un AAD propio.
7. **Dinero.** Los cálculos fiscales viven en el SDK (`packages/dte/src/money.ts` y constructores). No
   recalcule totales en el servidor ni en el cliente; muestre los del DTE construido.
8. **Número de control.** Sólo `reservar()` en `services/dte.ts` toca la tabla `correlativo`.
9. **Pruebas.** Un cambio en servicios lleva su prueba en `server/test` (corren en workerd con D1 real y
   el simulador del MH). Un servicio nuevo que lee datos lleva su caso en la prueba de aislamiento entre
   organizaciones.
10. **Cliente.** Las claves de React Query empiezan por el id del usuario y la caché se vacía al cerrar
    sesión o cambiar de usuario. Los guardas de ruta van en `beforeLoad`. Nada sensible en
    `localStorage`.
11. **Cloudflare.** El trabajo de CPU por petición debe ser poco: no cargue el JSON de los DTE en
    listados (vive en `documento_archivo`), y enumere columnas en consultas de rutas muy usadas.

## Estilo

Biome: comillas simples, sin punto y coma, 2 espacios, 100 columnas. Código conciso; sin abstracciones
que no se usen dos veces.
