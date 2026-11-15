import {
  type ArchivoDte,
  construirOperacionesEspeciales,
  construirRetorno,
  type Dte,
  DteRechazadoError,
  fechaHoraSV,
  sumar,
  transmitirEvento,
  validarDte,
} from '@openfactura/dte'
import { generarPdfDte } from '@openfactura/dte/pdf'
import { and, desc, eq, or } from 'drizzle-orm'
import type { OperacionesEspecialesEntrada, RetornoEntrada } from 'shared'
import { type Ctx, exigir } from '../contexto'
import { evento } from '../db'
import { opcionesPdf } from '../extensiones'
import { AppError, conflicto, invalido, mensajeDe, noEncontrado } from '../lib/errors'
import { registrar } from './auditoria'
import { archivoJson, contextoDelDocumento, errorMh, fila, guardarEvento, vistaEvento } from './dte'
import { ambienteActivo, type ContextoEmision, contextoEmision } from './emisor'
import type { Respuesta } from './idempotencia'
import { publicar } from './webhooks'

export type { VistaEvento } from './dte'

type FilaEvento = typeof evento.$inferSelect

const monto = (dte: Dte) => Number(dte.resumen?.montoTotalOperacion ?? dte.resumen?.subTotal ?? 0)

/** Valida, firma y transmite un evento 17/18 y lo guarda. El MH rechaza → `evento_rechazado`. */
async function transmitirYGuardar(
  ctx: Ctx,
  ce: ContextoEmision,
  tipo: 'retorno' | 'operaciones_especiales',
  dte: Dte,
  documentoId: string | null,
): Promise<Respuesta> {
  const problemas = validarDte(dte)
  if (problemas.length) {
    throw new AppError(400, 'dte_invalido', 'El evento no cumple la estructura que exige el MH', {
      problemas,
    })
  }
  try {
    const r = await transmitirEvento(ce.cliente, dte, ce.firmante)
    const id = await guardarEvento(ctx, {
      tipo,
      dte,
      documentoId,
      estado: 'procesado',
      firma: r.firma,
      respuesta: r.respuesta,
    })
    await registrar(ctx, `evento.${tipo}`, 'evento', id, {
      codigoGeneracion: dte.identificacion.codigoGeneracion,
    })
    const [f] = await ctx.db.select().from(evento).where(eq(evento.id, id))
    const cuerpo = vistaEvento(f!)
    await publicar(ctx, `${tipo}.procesado`, cuerpo)
    return { status: 201, cuerpo }
  } catch (error) {
    if (error instanceof DteRechazadoError) {
      const detalle = errorMh(error.respuesta)
      await guardarEvento(ctx, {
        tipo,
        dte,
        documentoId,
        estado: 'rechazado',
        respuesta: error.respuesta,
      })
      throw new AppError(422, 'evento_rechazado', detalle.mensaje, { mh: detalle })
    }
    if (error instanceof AppError) throw error
    throw new AppError(502, 'mh_no_disponible', mensajeDe(error, 'El MH no está disponible'))
  }
}

/**
 * Evento de Retorno (18) sobre una Factura, Factura de Exportación o Sujeto Excluido procesado:
 * devolución de bienes, reembolsos o envases. La suma de los retornos no puede superar el DTE.
 */
export async function retornar(
  ctx: Ctx,
  codigo: string,
  entrada: RetornoEntrada,
): Promise<Respuesta> {
  exigir(ctx, 'dte:emit')
  const f = await fila(ctx, codigo)
  if (!['01', '11', '14'].includes(f.tipoDte)) {
    throw invalido(
      'El retorno sólo se aplica a Factura (01), Factura de Exportación (11) o Sujeto Excluido (14). Para un Crédito Fiscal emite una Nota de Crédito.',
    )
  }
  if (f.estado !== 'procesado') {
    throw conflicto(
      'estado_invalido',
      `Sólo un documento procesado admite retorno; este está ${f.estado}`,
    )
  }
  const ce = await contextoDelDocumento(ctx, f)
  const original = await archivoJson(ctx, codigo)

  let dte: Dte
  try {
    dte = construirRetorno({
      ambiente: ce.ambiente,
      emisor: ce.emisor,
      documentos: [original],
      items: entrada.items,
    })
  } catch (error) {
    throw invalido(mensajeDe(error, 'Los datos del retorno no tienen la forma esperada'))
  }

  const previos = await ctx.db
    .select({ dte: evento.dte })
    .from(evento)
    .where(
      and(
        eq(evento.organizationId, ctx.actor.organizationId),
        eq(evento.documentoId, f.id),
        eq(evento.tipo, 'retorno'),
        eq(evento.estado, 'procesado'),
      ),
    )
  const yaRetornado = sumar(previos.map((p) => monto(JSON.parse(p.dte) as Dte)))
  const disponible = Math.round((monto(original) - yaRetornado) * 100) / 100
  if (monto(dte) > disponible + 0.005) {
    throw conflicto(
      'retorno_excedido',
      `El retorno (${monto(dte)}) supera lo que queda por retornar de este documento (${disponible})`,
      { disponible },
    )
  }
  return transmitirYGuardar(ctx, ce, 'retorno', dte, f.id)
}

/** Evento de Operaciones Especiales (17): informa facturas simplificadas o comprobantes de control interno. */
export async function informarOperacionesEspeciales(
  ctx: Ctx,
  entrada: OperacionesEspecialesEntrada,
): Promise<Respuesta> {
  exigir(ctx, 'dte:emit')
  // Un día pasado va a mediodía de El Salvador (la fecha indicada, sin importar la zona horaria);
  // el de hoy, a la hora actual: el MH rechaza una hora de emisión que aún no ha llegado
  // (`007 [identificacion.fecEmi/horEmi] VALOR NO ES PERMITIDO`).
  const fecha =
    entrada.fecha && entrada.fecha !== fechaHoraSV().fecha
      ? new Date(`${entrada.fecha}T12:00:00-06:00`)
      : new Date()
  // «No futura» se decide por el día en El Salvador: el de hoy vale a cualquier hora.
  if (Number.isNaN(fecha.getTime()) || (entrada.fecha ?? '') > fechaHoraSV().fecha) {
    throw invalido('La fecha del evento debe ser una fecha válida y no futura')
  }
  const ce = await contextoEmision(ctx)
  let dte: Dte
  try {
    dte = construirOperacionesEspeciales({
      ambiente: ce.ambiente,
      emisor: ce.emisor,
      tipoDocumento: entrada.tipoDocumento,
      items: entrada.items,
      fecha,
    })
  } catch (error) {
    throw invalido(mensajeDe(error, 'Los datos del evento no tienen la forma esperada'))
  }
  return transmitirYGuardar(ctx, ce, 'operaciones_especiales', dte, null)
}

/** Eventos de retorno y operaciones especiales del ambiente activo, del más reciente al más antiguo. */
export async function listarEventos(ctx: Ctx, tipo?: 'retorno' | 'operaciones_especiales') {
  exigir(ctx, 'dte:read')
  const ambiente = await ambienteActivo(ctx)
  const filas = await ctx.db
    .select()
    .from(evento)
    .where(
      and(
        eq(evento.organizationId, ctx.actor.organizationId),
        eq(evento.ambiente, ambiente),
        // Las invalidaciones y contingencias se ven en el detalle de cada documento.
        tipo
          ? eq(evento.tipo, tipo)
          : or(eq(evento.tipo, 'retorno'), eq(evento.tipo, 'operaciones_especiales')),
      ),
    )
    .orderBy(desc(evento.creado))
    .limit(50)
  return filas.map(vistaEvento)
}

async function filaEvento(ctx: Ctx, codigo: string): Promise<FilaEvento> {
  const [e] = await ctx.db
    .select()
    .from(evento)
    .where(
      and(
        eq(evento.organizationId, ctx.actor.organizationId),
        eq(evento.codigoGeneracion, codigo.toUpperCase()),
      ),
    )
  if (!e) throw noEncontrado('El evento')
  if (ctx.actor.modo && e.ambiente !== (await ambienteActivo(ctx))) throw noEncontrado('El evento')
  return e
}

export async function obtenerEvento(ctx: Ctx, codigo: string) {
  exigir(ctx, 'dte:read')
  const e = await filaEvento(ctx, codigo)
  return {
    ...vistaEvento(e),
    dte: JSON.parse(e.dte) as Dte,
    respuestaMh: e.respuestaMh ? JSON.parse(e.respuestaMh) : null,
  }
}

/** Archivo del evento (estructura + firma + sello) que se entrega al receptor. */
export async function archivoEvento(ctx: Ctx, codigo: string): Promise<ArchivoDte> {
  exigir(ctx, 'dte:read')
  const e = await filaEvento(ctx, codigo)
  return {
    ...(JSON.parse(e.dte) as Dte),
    firmaElectronica: e.firma ?? '',
    selloRecibido: e.selloRecibido,
  }
}

export async function pdfEvento(ctx: Ctx, codigo: string) {
  const archivo = await archivoEvento(ctx, codigo)
  return {
    nombre: `${archivo.identificacion.codigoGeneracion}.pdf`,
    bytes: await generarPdfDte(archivo, await opcionesPdf(ctx)),
  }
}
