# Sitio de documentación

Documentación pública de Open Factura en <https://docs.openfactura.co>, hecha con
[Astro Starlight](https://starlight.astro.build) (MIT). La referencia de la API se genera con
[starlight-openapi](https://github.com/HiDeoo/starlight-openapi) (MIT) a partir de
`public/openapi.json`. Es un sitio estático: no necesita runtime de servidor.

```bash
bun run dev       # http://localhost:4321
bun run build     # genera dist/
bun run preview
```

Los scripts usan `bun --bun` para no depender de la versión de Node instalada (Astro 7 pide
Node 22.23.4 o superior).

## Contenido

- Páginas: `src/content/docs/**/*.mdx`. El orden del menú está en `astro.config.mjs`.
- Referencia de la API: `public/openapi.json`. Se regenera desde el servidor y se versiona:

  ```bash
  cd server && bun run openapi
  ```

  La prueba `server/test/openapi.test.ts` falla si la copia no coincide con el documento que sirve
  la API (`GET /api/v1/openapi.json`).

- Orden del menú: `src/navegacion.mjs` (lo usan también `llms.txt` y `llms-full.txt`).
- Aspecto: sólo tema oscuro, con la paleta de openfactura.co (`src/styles/marca.css`,
  `src/tema-codigo.mjs` para los bloques de código y `src/components/Theme*.astro` sin selector).

## Markdown para asistentes de IA

Cada página tiene un gemelo en Markdown en la misma ruta con `.md` (`/inicio-rapido.md`,
`/api/operations/dte_emitir.md`), generado en `src/pages/[...slug].md.ts` desde el contenido MDX
(o desde `openapi.json` para la referencia de la API). También se generan `/llms.txt` y
`/llms-full.txt`. El menú «Copiar página» (`src/components/PageTitle.astro`) copia ese Markdown, abre
la página en ChatGPT o Claude y enlaza la instalación del servidor MCP en Cursor y VS Code
(`src/lib/mcp.ts`). Si añade un componente MDX nuevo, enséñele a `mdxAMarkdown()` en
`src/lib/markdown.ts` cómo convertirlo.

## Despliegue en Cloudflare Pages

| Ajuste                 | Valor                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| Framework preset       | Astro (o ninguno)                                                |
| Directorio raíz        | `/` (la raíz del repositorio, por los workspaces de Bun)         |
| Comando de compilación | `bun install --frozen-lockfile && bun run --cwd docs-site build` |
| Directorio de salida   | `docs-site/dist`                                                 |
| Variables de entorno   | `BUN_VERSION=1.4.4`                                              |
| Dominio personalizado  | `docs.openfactura.co` (Pages → Custom domains)                   |

No hace falta ninguna función ni binding: todo se sirve como archivos estáticos.
