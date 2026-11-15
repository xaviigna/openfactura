import type { APIRoute } from 'astro'
import { paginasMarkdown } from '../lib/markdown'
import { SITIO } from '../lib/mcp'

// Índice para modelos de lenguaje según la convención de https://llmstxt.org.
export const GET: APIRoute = async () => {
  const grupos = await paginasMarkdown()
  const texto = [
    '# Open Factura',
    '> Facturación electrónica de El Salvador (DTE, Normativa de Cumplimiento 2.0) con API REST, servidor MCP, CLI y SDK de código abierto. Cada página tiene una versión en Markdown en la misma ruta con la extensión `.md`.',
    `Servidor MCP remoto: \`https://openfactura.co/mcp\` (encabezado \`Authorization: Bearer of_test_…\`). Todo el contenido en un archivo: ${SITIO}/llms-full.txt`,
    ...grupos.map(
      ({ grupo, paginas }) =>
        `## ${grupo}\n\n${paginas
          .map(
            (p) =>
              `- [${p.titulo}](${SITIO}/${p.id}.md)${p.descripcion ? `: ${p.descripcion}` : ''}`,
          )
          .join('\n')}`,
    ),
  ].join('\n\n')
  return new Response(`${texto}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
