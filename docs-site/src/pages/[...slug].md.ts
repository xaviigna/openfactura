import type { APIRoute, GetStaticPaths } from 'astro'
import { type PaginaMd, paginasMarkdown } from '../lib/markdown'

// Gemelo en Markdown de cada página: /inicio-rapido.md, /guias/webhooks.md, /api/operations/dte_emitir.md…
export const getStaticPaths = (async () =>
  (await paginasMarkdown()).flatMap((g) =>
    g.paginas.map((pagina) => ({ params: { slug: pagina.id }, props: { pagina } })),
  )) satisfies GetStaticPaths

export const GET: APIRoute<{ pagina: PaginaMd }> = ({ props }) =>
  new Response(props.pagina.markdown, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
