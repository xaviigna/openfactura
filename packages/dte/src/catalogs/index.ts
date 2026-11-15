import catalogos from './data/catalogs.json'
import actividadesJson from './data/actividades.json'

export interface ValorCatalogo {
  codigo: string
  valor: string
  /** CAT-008 y CAT-013: departamento al que pertenece. */
  departamento?: string
  /** CAT-015: sección del catálogo de tributos (1 resumen, 2 cuerpo, 3 informativo). */
  seccion?: number
}
export interface Catalogo { id: string; nombre: string; valores: ValorCatalogo[] }
export type IdCatalogo = keyof typeof catalogos | 'CAT-019'

const todos: Record<string, Catalogo> = { ...(catalogos as Record<string, Catalogo>), 'CAT-019': actividadesJson as Catalogo }

export function catalogo(id: IdCatalogo): Catalogo {
  const c = todos[id]
  if (!c) throw new Error(`Catálogo desconocido: ${id}`)
  return c
}

export const listarCatalogos = () => Object.values(todos).map(({ id, nombre, valores }) => ({ id, nombre, total: valores.length }))

/** Descripción de un código, o undefined si no existe en el catálogo. */
export function valorCatalogo(id: IdCatalogo, codigo: string | number): string | undefined {
  return catalogo(id).valores.find(v => v.codigo === String(codigo))?.valor
}

export const existeEnCatalogo = (id: IdCatalogo, codigo: string | number) => valorCatalogo(id, codigo) !== undefined

export const municipiosDe = (departamento: string) => catalogo('CAT-013').valores.filter(v => v.departamento === departamento)
export const distritosDe = (departamento: string) => catalogo('CAT-008').valores.filter(v => v.departamento === departamento)

export const nombreTributo = (codigo: string) => catalogo('CAT-015').valores.find(v => v.codigo === codigo)?.valor
/** Tributos de la sección 3 del CAT-015: informativos, no suman a los totales. */
export const esTributoInformativo = (codigo: string) => {
  const secciones = catalogo('CAT-015').valores.filter(v => v.codigo === codigo).map(v => v.seccion)
  return secciones.length > 0 && secciones.every(s => s === 3)
}
