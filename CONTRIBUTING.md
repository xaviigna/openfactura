# Contribuir

Gracias por tu interés. Antes de enviar cambios:

1. Abre un issue para cambios grandes, así se acuerda el enfoque primero.
2. `bun install`, y sigue "Empezar en local" del `README.md`.
3. Cumple las reglas de `CLAUDE.md` (aplican también a personas): servicios con permiso y filtro por
   organización, pruebas para cada cambio de comportamiento, nada de secretos en respuestas o logs.
4. `bun run lint && bun run type-check && bun run test` deben pasar.
5. Un cambio por pull request. La descripción sigue la plantilla del repositorio, con tres secciones
   obligatorias:
   - **Problema**: qué está mal o qué falta, a quién afecta y cómo reproducirlo.
   - **Solución**: qué cambió, por qué así y si toca algún contrato público (API, errores, permisos,
     webhooks, MCP, CLI, base de datos).
   - **Verificación**: comandos y pruebas que ejecutaste con su resultado, capturas si cambia el panel o
     el PDF, y lo que no pudiste verificar.

## Licencia de las contribuciones

Para contribuir debes aceptar el [Acuerdo de licencia para contribuyentes (CLA)](CLA.md): conservas
tus derechos de autor, tu aporte se publica bajo la licencia del paquete que modificas (AGPL-3.0 para
`server` y `shared`; MIT para `packages/dte`, `packages/cli` y `skills`), y además autorizas al
titular del proyecto a usarlo en otras licencias, como la de la versión administrada Open Factura Cloud.
Acéptalo marcando la casilla de la plantilla del pull request o con un comentario (el texto está en
`CLA.md`). Firma también tus
commits con `git commit -s` ([Developer Certificate of Origin](https://developercertificate.org/)).

No copies código de proyectos con licencias incompatibles ni de plantillas comerciales.

## Normativa

Los cambios de reglas fiscales deben citar la fuente (Normativa 2.0, Manual Técnico o Manual Funcional
del MH, con sección) en el comentario o en la descripción del pull request.
