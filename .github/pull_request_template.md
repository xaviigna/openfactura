<!--
Gracias por contribuir a Open Factura. Complete las tres secciones; un PR sin ellas no se revisa.
Escriba en español, en frases cortas. Borre estos comentarios al terminar.
-->

## Problema

<!--
¿Qué está mal o qué falta, y a quién afecta? Sea concreto: el síntoma, cómo reproducirlo y, si es
un error, el resultado esperado frente al obtenido. Enlace el issue si existe (Cierra #123).
Si es una regla fiscal, cite la fuente: Normativa 2.0, Manual Técnico o Manual Funcional del MH,
con sección.
-->

## Solución

<!--
Qué cambió y por qué así. Mencione los archivos o servicios principales, las decisiones que tomó y
las alternativas que descartó. Indique si cambia algún contrato público: rutas de la API, códigos de
error, permisos, eventos de webhooks, herramientas MCP, comandos de la CLI o el esquema de la base de
datos (con su migración).
-->

## Verificación

<!--
Cómo comprobó que funciona. Pegue los comandos que ejecutó y su resultado resumido, las pruebas
nuevas o modificadas y, si toca el panel o el PDF, capturas de pantalla. Diga también qué NO pudo
verificar (por ejemplo, contra el ambiente de pruebas real de Hacienda).
-->

- [ ] `bun run lint`
- [ ] `bun run type-check`
- [ ] `bun run test`
- [ ] Pruebas nuevas en `server/test` si cambia un servicio (y un caso en la prueba de aislamiento
      entre organizaciones si el servicio lee datos)

## Licencia

- [ ] Leí y acepto el [CLA de Open Factura](https://github.com/xaviigna/openfactura/blob/main/CLA.md) (versión 1.0) para esta y mis futuras
      contribuciones, y mis commits van firmados con `git commit -s`.
