import type { APIRoute } from 'astro'
import { paginasMarkdown } from '../lib/markdown'
import { SITIO } from '../lib/mcp'

// Todas las páginas de la documentación en un solo archivo Markdown.
export const GET: APIRoute = async () => {
  const paginas = (await paginasMarkdown()).flatMap((g) => g.paginas)
  const texto = paginas
    .map((p) => `<!-- ${SITIO}/${p.id}.md -->\n\n${p.markdown.trim()}`)
    .join('\n\n---\n\n')
  return new Response(`${texto}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
