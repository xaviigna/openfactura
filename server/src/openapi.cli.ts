/**
 * Escribe el documento OpenAPI en `docs-site/public/openapi.json` para el sitio de documentación.
 * Uso: `bun run openapi` (en `server/`). Se ejecuta con Bun, fuera del Worker.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { construirOpenApi } from './openapi'

const destino = fileURLToPath(new URL('../../docs-site/public/openapi.json', import.meta.url))
writeFileSync(destino, `${JSON.stringify(construirOpenApi(), null, 2)}\n`)
console.log(`OpenAPI escrito en ${destino}`)
