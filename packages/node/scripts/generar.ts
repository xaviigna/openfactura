/**
 * Genera src/generado.ts desde las dos especificaciones OpenAPI de la documentación (el núcleo y
 * Open Factura Cloud): los esquemas como tipos y, por cada operación, su método, su ruta, sus
 * parámetros, su cuerpo y su respuesta. Sin dependencias. `bun run generar` tras cambiar la API.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

type Esquema = Record<string, any>
const docs = (archivo: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../docs-site/public/${archivo}`, import.meta.url)),
      'utf8',
    ),
  ) as Esquema

const ident = (n: string) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n))

/** Un esquema JSON a un tipo de TypeScript. `ns` resuelve los $ref de ese documento. */
export function aTipo(s: Esquema | undefined, ns: string, sangria = ''): string {
  if (!s || Object.keys(s).length === 0) return 'unknown'
  if (s.$ref) return `${ns}[${JSON.stringify(String(s.$ref).split('/').pop())}]`
  if ('const' in s) return JSON.stringify(s.const)
  if (s.enum) return s.enum.map((v: unknown) => JSON.stringify(v)).join(' | ')
  if (s.oneOf || s.anyOf)
    return (s.oneOf ?? s.anyOf).map((x: Esquema) => aTipo(x, ns, sangria)).join(' | ')
  if (s.allOf) return s.allOf.map((x: Esquema) => `(${aTipo(x, ns, sangria)})`).join(' & ')
  if (Array.isArray(s.type)) {
    return s.type.map((t: string) => aTipo({ ...s, type: t }, ns, sangria)).join(' | ')
  }
  switch (s.type) {
    case 'string':
      return 'string'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return `Array<${aTipo(s.items, ns, sangria)}>`
    case 'object':
    case undefined: {
      const props = s.properties as Record<string, Esquema> | undefined
      if (!props || Object.keys(props).length === 0) {
        return s.additionalProperties && s.additionalProperties !== true
          ? `Record<string, ${aTipo(s.additionalProperties, ns, sangria)}>`
          : 'Record<string, unknown>'
      }
      const req = new Set<string>(s.required ?? [])
      const dentro = `${sangria}  `
      const lineas = Object.entries(props).map(([k, v]) => {
        const doc = v.description
          ? `${dentro}/** ${String(v.description).replace(/\*\//g, '*\\/').replace(/\n+/g, ' ')} */\n`
          : ''
        return `${doc}${dentro}${ident(k)}${req.has(k) ? '' : '?'}: ${aTipo(v, ns, dentro)}`
      })
      return `{\n${lineas.join('\n')}\n${sangria}}`
    }
    default:
      return 'unknown'
  }
}

interface Operacion {
  id: string
  metodo: string
  ruta: string
  params: string[]
  query: string
  cuerpo: string | null
  respuesta: string
  binaria: boolean
  resumen: string
}

function operaciones(doc: Esquema, ns: string, prefijo: string): Operacion[] {
  const out: Operacion[] = []
  for (const [ruta, metodos] of Object.entries<Esquema>(doc.paths)) {
    for (const [metodo, o] of Object.entries<Esquema>(metodos)) {
      if (!o.operationId || o.operationId === 'openapi_obtener') continue
      const parametros = (o.parameters ?? []) as Esquema[]
      const enRuta = parametros.filter((p) => p.in === 'path').map((p) => p.name as string)
      // Las rutas del núcleo usan `:id`; las de la nube, `{id}`.
      for (const m of ruta.matchAll(/[:{](\w+)}?/g))
        if (!enRuta.includes(m[1] as string)) enRuta.push(m[1] as string)
      const query = parametros.filter((p) => p.in === 'query')
      const ok = Object.keys(o.responses ?? {}).find((c) => c.startsWith('2'))
      const contenido = ok ? (o.responses[ok].content ?? {}) : {}
      const cuerpo = o.requestBody?.content?.['application/json']?.schema
      out.push({
        id: o.operationId,
        metodo: metodo.toUpperCase(),
        ruta: `${prefijo}${ruta.replace(/\{(\w+)\}/g, ':$1')}`,
        params: enRuta,
        query: query.length
          ? `{ ${query.map((p) => `${ident(p.name)}${p.required ? '' : '?'}: ${aTipo(p.schema, ns)}`).join('; ')} }`
          : 'never',
        cuerpo: cuerpo ? aTipo(cuerpo, ns, '    ') : null,
        respuesta: contenido['application/json']
          ? aTipo(contenido['application/json'].schema, ns, '    ')
          : 'ArrayBuffer',
        binaria: !contenido['application/json'] && Object.keys(contenido).length > 0,
        resumen: o.summary ?? '',
      })
    }
  }
  return out
}

function esquemas(doc: Esquema, nombre: string): string {
  const cuerpo = Object.entries<Esquema>(doc.components?.schemas ?? {})
    .map(([n, s]) => `  ${ident(n)}: ${aTipo(s, nombre, '  ')}`)
    .join('\n')
  return `export interface ${nombre} {\n${cuerpo}\n}`
}

export function generar(): string {
  const nucleo = docs('openapi.json')
  const cloud = docs('openapi-cloud.json')
  const ops = [...operaciones(nucleo, 'Nucleo', '/api/v1'), ...operaciones(cloud, 'Cloud', '')]
  const tipos = ops
    .map(
      (o) =>
        `  /** ${o.resumen.replace(/\*\//g, '')} */\n  ${o.id}: {\n    params: ${o.params.length ? `{ ${o.params.map((p) => `${p}: string`).join('; ')} }` : 'never'}\n    query: ${o.query}\n    cuerpo: ${o.cuerpo ?? 'never'}\n    respuesta: ${o.respuesta}\n  }`,
    )
    .join('\n')
  const rutas = ops
    .map(
      (o) =>
        `  ${o.id}: { metodo: '${o.metodo}', ruta: '${o.ruta}'${o.binaria ? ', binaria: true' : ''} },`,
    )
    .join('\n')
  return `// Generado por scripts/generar.ts desde docs-site/public/openapi*.json. No lo edites a mano:
// cambia la API y ejecuta \`bun run generar\`.
/* eslint-disable */

${esquemas(nucleo, 'Nucleo')}

${esquemas(cloud, 'Cloud')}

/** Cada operación de la API: parámetros de ruta, consulta, cuerpo y respuesta. */
export interface Operaciones {
${tipos}
}

export type IdOperacion = keyof Operaciones

export const RUTAS: Record<IdOperacion, { metodo: string; ruta: string; binaria?: true }> = {
${rutas}
}
`
}

if (import.meta.main) {
  const destino = fileURLToPath(new URL('../src/generado.ts', import.meta.url))
  writeFileSync(destino, generar())
  console.log(`Escrito ${destino}`)
}
