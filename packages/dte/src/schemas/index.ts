import type { Dte, TipoDocumento } from '../types'
import fe from './fe-f-v2.json'
import ccf from './fe-ccf-v4.json'
import nr from './fe-nr-v4.json'
import nc from './fe-nc-v4.json'
import nd from './fe-nd-v4.json'
import cr from './fe-cr-v2.json'
import cl from './fe-cl-v2.json'
import dcl from './fe-dcl-v2.json'
import fex from './fe-fex-v3.json'
import fse from './fe-fse-v2.json'
import cd from './fe-cd-v2.json'
import eop from './fe-eop-v1.json'
import eret from './fe-eret-v1.json'
import invalidacion from './invalidacion-schema-v3.json'
import contingencia from './contingencia-schema-v4.json'

/** JSON Schemas oficiales (svfe-json-schemas, Normativa 2.0) por tipo de documento. */
export const ESQUEMAS: Record<TipoDocumento, object> = {
  '01': fe, '03': ccf, '04': nr, '05': nc, '06': nd, '07': cr, '08': cl, '09': dcl, '11': fex, '14': fse, '15': cd,
  '17': eop, '18': eret, invalidacion, contingencia
}

/** Deduce el tipo de documento a partir de su estructura. */
export function tipoDeDocumento(doc: Dte): TipoDocumento {
  const id = doc.identificacion ?? {}
  if (id.tipoDte) return id.tipoDte
  if (id.tipoEvento) return id.tipoEvento
  if ('detalleDTE' in doc) return 'contingencia'
  if ('documento' in doc && 'motivo' in doc) return 'invalidacion'
  throw new Error('No se pudo determinar el tipo de documento: falta identificacion.tipoDte / tipoEvento')
}
