import { existeEnCatalogo, distritosDe, municipiosDe, type IdCatalogo } from './catalogs'
import { decimales } from './money'
import { ESQUEMAS, tipoDeDocumento } from './schemas'
import type { Dte, TipoDocumento } from './types'

export interface Problema {
  /** Ruta del campo, p. ej. `cuerpoDocumento[0].precioUni`. */
  ruta: string
  mensaje: string
  /** Palabra clave del esquema o regla de negocio que falló. */
  regla: string
}

type Esquema = Record<string, any>

const tipoDe = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v

const cumpleTipo = (v: unknown, tipo: string) => {
  const real = tipoDe(v)
  return real === tipo || (tipo === 'number' && real === 'integer')
}

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/
function esFecha(texto: string) {
  const m = RE_FECHA.exec(texto)
  if (!m) return false
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
}

const patrones = new Map<string, RegExp>()
function patron(fuente: string) {
  let re = patrones.get(fuente)
  if (!re) patrones.set(fuente, (re = new RegExp(fuente, 'u')))
  return re
}

const unir = (ruta: string, clave: string | number) => (typeof clave === 'number' ? `${ruta}[${clave}]` : ruta ? `${ruta}.${clave}` : clave)

/**
 * Validador de JSON Schema draft-07 limitado a las palabras clave que usan los
 * esquemas del MH. Sin `eval` ni `new Function`, por lo que corre en Cloudflare
 * Workers. `multipleOf` se valida contando decimales para evitar falsos
 * negativos por coma flotante (p. ej. 0.1 no es "múltiplo" binario de 1e-8).
 */
export function validarConEsquema(valor: unknown, esquema: Esquema, ruta = '', problemas: Problema[] = []): Problema[] {
  const falla = (regla: string, mensaje: string) => problemas.push({ ruta: ruta || '(raíz)', mensaje, regla })

  if (esquema.type !== undefined) {
    const tipos: string[] = Array.isArray(esquema.type) ? esquema.type : [esquema.type]
    if (!tipos.some(t => cumpleTipo(valor, t))) {
      falla('type', `debe ser ${tipos.join(' o ')} (se recibió ${tipoDe(valor)})`)
      return problemas
    }
  }
  if ('const' in esquema && valor !== esquema.const) falla('const', `debe ser ${JSON.stringify(esquema.const)}`)
  if (esquema.enum && !esquema.enum.includes(valor)) falla('enum', `debe ser uno de ${JSON.stringify(esquema.enum)}`)

  if (typeof valor === 'string') {
    const largo = [...valor].length
    if (esquema.minLength !== undefined && largo < esquema.minLength) falla('minLength', `debe tener al menos ${esquema.minLength} caracteres`)
    if (esquema.maxLength !== undefined && largo > esquema.maxLength) falla('maxLength', `no debe exceder ${esquema.maxLength} caracteres`)
    if (esquema.pattern && !patron(esquema.pattern).test(valor)) falla('pattern', `no cumple el formato ${esquema.pattern}`)
    if (esquema.format === 'date' && !esFecha(valor)) falla('format', 'debe ser una fecha AAAA-MM-DD válida')
  } else if (typeof valor === 'number') {
    if (esquema.minimum !== undefined && valor < esquema.minimum) falla('minimum', `debe ser >= ${esquema.minimum}`)
    if (esquema.maximum !== undefined && valor > esquema.maximum) falla('maximum', `debe ser <= ${esquema.maximum}`)
    if (esquema.exclusiveMinimum !== undefined && valor <= esquema.exclusiveMinimum) falla('exclusiveMinimum', `debe ser > ${esquema.exclusiveMinimum}`)
    if (esquema.exclusiveMaximum !== undefined && valor >= esquema.exclusiveMaximum) falla('exclusiveMaximum', `debe ser < ${esquema.exclusiveMaximum}`)
    if (esquema.multipleOf !== undefined && decimales(valor) > decimales(esquema.multipleOf)) falla('multipleOf', `admite como máximo ${decimales(esquema.multipleOf)} decimales`)
  } else if (Array.isArray(valor)) {
    if (esquema.minItems !== undefined && valor.length < esquema.minItems) falla('minItems', `debe tener al menos ${esquema.minItems} elementos`)
    if (esquema.maxItems !== undefined && valor.length > esquema.maxItems) falla('maxItems', `no debe exceder ${esquema.maxItems} elementos`)
    if (esquema.uniqueItems && new Set(valor.map(v => JSON.stringify(v))).size !== valor.length) falla('uniqueItems', 'no debe tener elementos repetidos')
    if (esquema.items) valor.forEach((item, i) => validarConEsquema(item, esquema.items, unir(ruta, i), problemas))
  } else if (valor !== null && typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>
    for (const clave of esquema.required ?? []) {
      if (!(clave in objeto)) problemas.push({ ruta: unir(ruta, clave), mensaje: 'es requerido', regla: 'required' })
    }
    const propiedades: Record<string, Esquema> = esquema.properties ?? {}
    for (const [clave, hijo] of Object.entries(objeto)) {
      if (propiedades[clave]) validarConEsquema(hijo, propiedades[clave]!, unir(ruta, clave), problemas)
      else if (esquema.additionalProperties === false) problemas.push({ ruta: unir(ruta, clave), mensaje: 'no es un campo permitido', regla: 'additionalProperties' })
    }
  }

  for (const sub of esquema.allOf ?? []) validarConEsquema(valor, sub, ruta, problemas)
  if (esquema.oneOf) {
    const validos = (esquema.oneOf as Esquema[]).filter(sub => validarConEsquema(valor, sub, ruta).length === 0).length
    if (validos !== 1) falla('oneOf', `debe cumplir exactamente una de las ${esquema.oneOf.length} variantes (cumple ${validos})`)
  }
  if (esquema.if) {
    const rama = validarConEsquema(valor, esquema.if, ruta).length === 0 ? esquema.then : esquema.else
    if (rama) validarConEsquema(valor, rama, ruta, problemas)
  }
  return problemas
}

/** Valida un DTE o evento contra el JSON Schema oficial de su tipo. */
export function validarEstructura(doc: Dte, tipo: TipoDocumento = tipoDeDocumento(doc)): Problema[] {
  return validarConEsquema(doc, ESQUEMAS[tipo])
}

// ---------------------------------------------------------------------------
// Catálogos: el esquema 2.0 ya no enumera códigos; Hacienda los valida al recibir.

const CAMPOS_CATALOGO: Array<[RegExp, IdCatalogo]> = [
  [/(^|\.)direccion\.departamento$/, 'CAT-012'],
  [/\.codActividad$/, 'CAT-019'],
  [/^(emisor|receptor)\.tipoDocumento$/, 'CAT-022'],
  [/^receptor\.codDomiciliado$/, 'CAT-032'],
  [/^receptor\.tipoEstablecimiento$/, 'CAT-009'],
  [/^otrosDocumentos\[\d+\]\.codDocAsociado$/, 'CAT-021'],
  [/^cuerpoDocumento\[\d+\]\.tipoDonacion$/, 'CAT-026'],
  [/^cuerpoDocumento\[\d+\]\.tipoGeneracion$/, 'CAT-007'],
  [/^identificacion\.tipoContingencia$/, 'CAT-005'],
  [/^cuerpoDocumento\[\d+\]\.uniMedida$/, 'CAT-014'],
  [/^cuerpoDocumento\[\d+\]\.tipoItem$/, 'CAT-011'],
  [/^cuerpoDocumento\[\d+\]\.tributos\[\d+\]$/, 'CAT-015'],
  [/^cuerpoDocumento\[\d+\]\.codTributo$/, 'CAT-015'],
  [/^resumen\.tributos\[\d+\]\.codigo$/, 'CAT-015'],
  [/^resumen\.condicionOperacion$/, 'CAT-016'],
  [/^resumen\.pagos\[\d+\]\.codigo$/, 'CAT-017'],
  [/^resumen\.pagos\[\d+\]\.plazo$/, 'CAT-018'],
  [/^receptor\.codPais$/, 'CAT-020'],
  [/^resumen\.codIncoterms$/, 'CAT-031'],
  [/^emisor\.recintoFiscal$/, 'CAT-027'],
  [/^emisor\.regimen$/, 'CAT-028'],
  [/^emisor\.tipoRegimen$/, 'CAT-033'],
  [/^receptor\.bienTitulo$/, 'CAT-025'],
  [/^motivo\.tipoAnulacion$/, 'CAT-024']
]

function recorrer(valor: unknown, ruta: string, visitar: (ruta: string, valor: unknown) => void) {
  visitar(ruta, valor)
  if (Array.isArray(valor)) valor.forEach((v, i) => recorrer(v, unir(ruta, i), visitar))
  else if (valor && typeof valor === 'object') for (const [k, v] of Object.entries(valor)) recorrer(v, unir(ruta, k), visitar)
}

/** Verifica que los códigos usados existan en los catálogos oficiales (CAT-0xx). */
export function validarCatalogos(doc: Dte): Problema[] {
  const problemas: Problema[] = []
  recorrer(doc, '', (ruta, valor) => {
    if (valor === null || valor === undefined || typeof valor === 'object') return
    const cat = CAMPOS_CATALOGO.find(([re]) => re.test(ruta))?.[1]
    if (cat && !existeEnCatalogo(cat, valor as string | number)) problemas.push({ ruta, mensaje: `"${valor}" no existe en el catálogo ${cat}`, regla: 'catalogo' })
  })
  recorrer(doc, '', (ruta, valor) => {
    if (!ruta.endsWith('direccion') || !valor || typeof valor !== 'object') return
    const { departamento, municipio, distrito } = valor as Record<string, string>
    if (!departamento || !existeEnCatalogo('CAT-012', departamento)) return
    if (municipio && !municipiosDe(departamento).some(m => m.codigo === municipio)) problemas.push({ ruta: `${ruta}.municipio`, mensaje: `el municipio "${municipio}" no pertenece al departamento ${departamento} (CAT-013)`, regla: 'catalogo' })
    if (distrito && !distritosDe(departamento).some(d => d.codigo === distrito)) problemas.push({ ruta: `${ruta}.distrito`, mensaje: `el distrito "${distrito}" no pertenece al departamento ${departamento} (CAT-008)`, regla: 'catalogo' })
  })
  return problemas
}

/** Estructura + catálogos. Devuelve [] cuando el documento está listo para firmar. */
export function validarDte(doc: Dte, tipo: TipoDocumento = tipoDeDocumento(doc)): Problema[] {
  return [...validarEstructura(doc, tipo), ...validarCatalogos(doc)]
}

export class DteInvalidoError extends Error {
  constructor(public readonly problemas: Problema[]) {
    super(`DTE inválido:\n${problemas.map(p => `  - ${p.ruta}: ${p.mensaje}`).join('\n')}`)
    this.name = 'DteInvalidoError'
  }
}

export function asegurarDteValido(doc: Dte, tipo?: TipoDocumento): void {
  const problemas = validarDte(doc, tipo)
  if (problemas.length) throw new DteInvalidoError(problemas)
}
