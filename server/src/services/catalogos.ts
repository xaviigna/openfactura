import { catalogo, type IdCatalogo, listarCatalogos as listarSdk } from '@openfactura/dte'
import { noEncontrado } from '../lib/errors'

/** Catálogos oficiales del MH (CAT-001 … CAT-033). Son datos públicos: no requieren permiso. */
export const listarCatalogos = () => listarSdk()

export function consultarCatalogo(
  id: string,
  opciones: { q?: string; departamento?: string; limite?: number } = {},
) {
  const existe = listarSdk().some((c) => c.id === id)
  if (!existe) throw noEncontrado(`El catálogo ${id}`)
  const { nombre, valores } = catalogo(id as IdCatalogo)
  const q = opciones.q?.trim().toLowerCase()
  const filtrados = valores.filter(
    (v) =>
      (!opciones.departamento || v.departamento === opciones.departamento) &&
      (!q || v.valor.toLowerCase().includes(q) || String(v.codigo).toLowerCase().includes(q)),
  )
  // CAT-019 (actividades económicas) tiene miles de filas: siempre se recorta.
  const limite = Math.min(opciones.limite ?? (id === 'CAT-019' ? 50 : 2000), 2000)
  return { id, nombre, total: filtrados.length, valores: filtrados.slice(0, limite) }
}
