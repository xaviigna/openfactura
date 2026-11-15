// Gemelos en Markdown de cada página (`/ruta.md`), para /llms.txt y el menú «Copiar página».
import { getCollection } from 'astro:content'
import { slug } from 'github-slugger'
import especificacion from '../../public/openapi.json'
import { gruposAntesDeLaApi, gruposDespuesDeLaApi } from '../navegacion.mjs'
import { enlacesInstalacion, type Idioma, SITIO } from './mcp'

export interface PaginaMd {
  /** Ruta del gemelo sin la extensión, p. ej. `guias/webhooks` o `index`. */
  id: string
  titulo: string
  descripcion?: string
  markdown: string
}

/** `/guias/webhooks/` → `/guias/webhooks.md`; `/` → `/index.md`. */
export const rutaMd = (ruta: string) => `${ruta.replace(/\/+$/, '') || '/index'}.md`

const ETIQUETAS_ASIDE: Record<Idioma, Record<string, string>> = {
  es: { note: 'Nota', tip: 'Consejo', caution: 'Precaución', danger: 'Peligro' },
  en: { note: 'Note', tip: 'Tip', caution: 'Caution', danger: 'Danger' },
}

/** Las páginas en inglés viven en `en/…` (y su portada es `en`). */
const idiomaDeId = (id: string): Idioma => (id === 'en' || id.startsWith('en/') ? 'en' : 'es')

const atributos = (texto: string) =>
  Object.fromEntries([...texto.matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, v]))

const absoluto = (href: string) => (href.startsWith('/') ? SITIO + href : href)

/** Convierte el cuerpo MDX a Markdown simple: quita imports y componentes, conserva el código. */
export function mdxAMarkdown(cuerpo: string, idioma: Idioma = 'es'): string {
  const etiquetas = ETIQUETAS_ASIDE[idioma]
  const salida: string[] = []
  let cerca: string | null = null
  let cita: string | null = null
  const lineas = cuerpo
    .replace(/<LinkCard([\s\S]*?)\/>/g, (_, a: string) => {
      const { title, description, href } = atributos(a)
      return `- [${title}](${absoluto(href)})${description ? `: ${description}` : ''}`
    })
    .split('\n')

  for (const linea of lineas) {
    const sangria = linea.match(/^\s*/)?.[0] ?? ''
    const texto = linea.trim()
    const valla = texto.match(/^(`{3,}|~{3,})/)?.[1]
    if (cerca) {
      if (valla?.startsWith(cerca)) cerca = null
      salida.push(cita !== null ? `${cita}> ${linea}` : linea)
      continue
    }
    if (valla) cerca = valla

    if (/^(import|export) .+ from /.test(texto)) continue
    if (/^<\/?(Steps|Tabs|CardGrid)\b[^>]*>$/.test(texto) || /^<\/(TabItem|Card)>$/.test(texto)) {
      continue
    }
    const pestana = texto.match(/^<TabItem\b([^>]*)>$/)
    if (pestana) {
      salida.push(`${sangria}#### ${atributos(pestana[1]).label}`)
      continue
    }
    const tarjeta = texto.match(/^<Card\b([^>]*)>$/)
    if (tarjeta) {
      salida.push(`${sangria}**${atributos(tarjeta[1]).title}**`)
      continue
    }
    const instalar = texto.match(/^<InstalarMcp agente="(\w+)" \/>$/)
    if (instalar) {
      const { nombre, href } = enlacesInstalacion[instalar[1] as keyof typeof enlacesInstalacion]
      salida.push(
        `${sangria}[${idioma === 'en' ? 'Install in' : 'Instalar en'} ${nombre}](${href})`,
      )
      continue
    }
    const aside = texto.match(/^<Aside\b([^>]*)>$/) ?? texto.match(/^:::(\w+)(?:\[(.*)\])?$/)
    if (aside && cita === null) {
      const a = aside[0].startsWith(':::')
        ? { type: aside[1], title: aside[2] }
        : atributos(aside[1])
      const etiqueta = a.title || etiquetas[a.type ?? 'note'] || etiquetas.note
      salida.push(`${sangria}> **${etiqueta}**`, `${sangria}>`)
      cita = sangria
      continue
    }
    if (cita !== null && (texto === '</Aside>' || texto === ':::')) {
      cita = null
      continue
    }
    const enlazada = linea.replace(/\]\((\/[^)\s]*)\)/g, (_, href: string) => `](${SITIO}${href})`)
    salida.push(
      cita !== null ? (texto ? `${cita}> ${enlazada.slice(cita.length)}` : `${cita}>`) : enlazada,
    )
  }
  return salida
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const encabezado = (titulo: string, descripcion?: string) =>
  `# ${titulo}\n\n${descripcion ? `> ${descripcion}\n\n` : ''}`

async function paginasDocs(): Promise<PaginaMd[]> {
  const entradas = await getCollection('docs')
  return entradas
    .filter((e) => e.id !== '404')
    .map((e) => ({
      id: e.id,
      titulo: e.data.title,
      descripcion: e.data.description,
      markdown: `${encabezado(e.data.title, e.data.description)}${mdxAMarkdown(e.body ?? '', idiomaDeId(e.id))}\n`,
    }))
}

// --- Referencia de la API (generada por starlight-openapi a partir de public/openapi.json) ---

type Json = any
const doc: Json = especificacion
const METODOS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
const BASE_API = doc.servers?.[0]?.url ?? ''

const resolver = (v: Json): Json =>
  v?.$ref
    ? resolver(
        v.$ref
          .slice(2)
          .split('/')
          .reduce((o: Json, k: string) => o?.[k], doc),
      )
    : v

const nombreEsquema = (s: Json) => (s?.$ref ? `\`${s.$ref.split('/').pop()}\`` : null)

/** Nombres de los esquemas de componentes que usa un valor, incluidos los anidados. */
function esquemasUsados(valor: Json, vistos = new Set<string>()): Set<string> {
  JSON.stringify(valor, (k, v) => {
    if (k === '$ref' && typeof v === 'string' && v.startsWith('#/components/schemas/')) {
      const nombre = v.split('/').pop()!
      if (!vistos.has(nombre)) {
        vistos.add(nombre)
        esquemasUsados(doc.components.schemas[nombre], vistos)
      }
    }
    return v
  })
  return vistos
}

interface Operacion {
  metodo: string
  ruta: string
  op: Json
  id: string
  titulo: string
}

const operaciones: Operacion[] = Object.entries(doc.paths ?? {}).flatMap(
  ([ruta, item]: [string, Json]) =>
    METODOS.filter((m) => item[m]).map((m) => ({
      metodo: m,
      ruta,
      op: item[m],
      id: `api/operations/${slug(item[m].operationId ?? ruta)}`,
      titulo: item[m].summary ?? item[m].operationId,
    })),
)

const lineaOperacion = (o: Operacion) =>
  `- [${o.titulo}](${SITIO}/${o.id}.md): \`${o.metodo.toUpperCase()} ${o.ruta}\``

function markdownOperacion(o: Operacion): string {
  const partes = [`\`${o.metodo.toUpperCase()} ${BASE_API}${o.ruta}\``]
  if (o.op.description) partes.push(o.op.description)
  const parametros = [...(o.op.parameters ?? [])].map(resolver)
  if (parametros.length) {
    partes.push(
      '## Parámetros',
      '| Nombre | En | Requerido | Tipo | Descripción |\n| --- | --- | --- | --- | --- |\n' +
        parametros
          .map(
            (p: Json) =>
              `| \`${p.name}\` | ${p.in} | ${p.required ? 'sí' : 'no'} | ${p.schema?.type ?? ''} | ${(p.description ?? '').replace(/\n/g, ' ')} |`,
          )
          .join('\n'),
    )
  }
  const cuerpo = resolver(o.op.requestBody)
  if (cuerpo?.content) {
    for (const [tipo, media] of Object.entries(cuerpo.content) as [string, Json][]) {
      partes.push(
        `## Cuerpo (${tipo}${cuerpo.required ? ', requerido' : ''})`,
        nombreEsquema(media.schema) ??
          `\`\`\`json\n${JSON.stringify(media.schema, null, 2)}\n\`\`\``,
      )
    }
  }
  partes.push(
    '## Respuestas',
    Object.entries(o.op.responses ?? {})
      .map(([codigo, r]: [string, Json]) => {
        const res = resolver(r)
        const esquema = Object.values(res.content ?? {}).map((m: Json) =>
          nombreEsquema(m.schema),
        )[0]
        return `- **${codigo}**: ${(res.description ?? '').replace(/\n/g, ' ')}${esquema ? ` Esquema: ${esquema}.` : ''}`
      })
      .join('\n'),
  )
  const nombres = [...esquemasUsados([o.op.parameters, o.op.requestBody, o.op.responses])]
  if (nombres.length) {
    partes.push(
      '## Esquemas',
      ...nombres.map(
        (n) =>
          `### ${n}\n\n\`\`\`json\n${JSON.stringify(doc.components.schemas[n], null, 2)}\n\`\`\``,
      ),
    )
  }
  return partes.join('\n\n')
}

function paginasApi(): PaginaMd[] {
  const etiquetas: { name: string; description?: string }[] = doc.tags ?? []
  const deEtiqueta = (nombre: string) => operaciones.filter((o) => o.op.tags?.includes(nombre))
  return [
    {
      id: 'api',
      titulo: doc.info.title,
      descripcion: doc.info.summary,
      markdown: `${encabezado(doc.info.title, doc.info.summary)}${doc.info.description}\n\nURL base: \`${BASE_API}\`\n\n${etiquetas
        .map(
          (t) =>
            `## ${t.name}\n\n${t.description ? `${t.description}\n\n` : ''}${deEtiqueta(t.name).map(lineaOperacion).join('\n')}`,
        )
        .join('\n\n')}\n`,
    },
    ...etiquetas.map((t) => ({
      id: `api/operations/tags/${slug(t.name)}`,
      titulo: t.name,
      descripcion: t.description,
      markdown: `${encabezado(t.name, t.description)}${deEtiqueta(t.name).map(lineaOperacion).join('\n')}\n`,
    })),
    ...operaciones.map((o) => ({
      id: o.id,
      titulo: o.titulo,
      descripcion: `${o.metodo.toUpperCase()} ${o.ruta}`,
      markdown: `# ${o.titulo}\n\n${markdownOperacion(o)}\n`,
    })),
  ]
}

/** Todas las páginas con gemelo en Markdown, en el orden del menú lateral. */
export async function paginasMarkdown(): Promise<{ grupo: string; paginas: PaginaMd[] }[]> {
  const docs = new Map((await paginasDocs()).map((p) => [p.id, p]))
  const api = paginasApi()
  type Grupo = {
    label: string
    translations?: { en?: string }
    items: (string | { link: string })[]
  }
  const grupo = (idioma: Idioma) => (g: Grupo) => ({
    grupo: idioma === 'en' ? `English: ${g.translations?.en ?? g.label}` : g.label,
    paginas: g.items.map((i) => {
      const es = typeof i === 'string' ? i : i.link.replace(/^\/|\/$/g, '') || 'index'
      const id = idioma === 'es' ? es : es === 'index' ? 'en' : `en/${es}`
      const pagina = docs.get(id)
      if (!pagina) throw new Error(`Página del menú sin contenido: ${id}`)
      docs.delete(id)
      return pagina
    }),
  })
  const grupos = [
    ...gruposAntesDeLaApi.map(grupo('es')),
    { grupo: 'Referencia de la API', paginas: api },
    ...gruposDespuesDeLaApi.map(grupo('es')),
    // La versión en inglés (/en/), en el mismo orden. La referencia de la API sólo existe en español.
    ...[...gruposAntesDeLaApi, ...gruposDespuesDeLaApi].map(grupo('en')),
  ]
  if (docs.size) grupos.push({ grupo: 'Otras páginas', paginas: [...docs.values()] })
  return grupos
}
