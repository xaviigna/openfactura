import {
  type ArchivoDte,
  type Contexto,
  ContingenciaRequeridaError,
  construirContingencia,
  construirCreditoFiscal,
  construirDocumentoContableLiquidacion,
  construirDonacion,
  construirExportacion,
  construirFactura,
  construirInvalidacion,
  construirLiquidacion,
  construirNotaCredito,
  construirNotaDebito,
  construirNotaRemision,
  construirRetencion,
  construirSujetoExcluido,
  type Dte,
  DteRechazadoError,
  documentoParaInvalidar,
  ErrorConexionMH,
  ErrorMH,
  fechaHoraSV,
  firmar,
  generarCodigoGeneracion,
  parsearNumeroControl,
  type RespuestaMH,
  transmitirDte,
  transmitirEvento,
  urlConsultaPublica,
  validarDte,
} from '@openfactura/dte'
import { generarPdfDte } from '@openfactura/dte/pdf'
import { and, desc, eq, gte, like, lte, min, or, sql } from 'drizzle-orm'
import type {
  Ambiente,
  EmisionEntrada,
  InvalidacionEntrada,
  ListaDtesEntrada,
  TipoDteSoportado,
} from 'shared'
import { PERMISOS } from 'shared'
import { type Ctx, exigir } from '../contexto'
import { type Db, documento, documentoArchivo, evento, cliente as tablaCliente } from '../db'
import type { Bindings } from '../env'
import { antesDeEmitir, type Extension, opcionesPdf } from '../extensiones'
import { nuevoId } from '../lib/crypto'
import { AppError, conflicto, invalido, mensajeDe, noEncontrado } from '../lib/errors'
import { registrar } from './auditoria'
import { ambienteActivo, type ContextoEmision, contextoEmision, emisorParaDte } from './emisor'
import type { Respuesta } from './idempotencia'
import { publicar } from './webhooks'

const CONSTRUCTORES: Record<TipoDteSoportado, (ctx: Contexto, datos: any) => Dte> = {
  '01': construirFactura,
  '03': construirCreditoFiscal,
  '04': construirNotaRemision,
  '05': construirNotaCredito,
  '06': construirNotaDebito,
  '07': construirRetencion,
  '08': construirLiquidacion,
  '09': construirDocumentoContableLiquidacion,
  '11': construirExportacion,
  '14': construirSujetoExcluido,
  '15': construirDonacion,
}

/** CLE, DCLE y CDE no admiten modelo diferido ni contingencia (Normativa 2.0). */
const SIN_CONTINGENCIA: ReadonlySet<string> = new Set(['08', '09', '15'])

function construir(tipo: TipoDteSoportado, contexto: Contexto, datos: unknown): Dte {
  try {
    return CONSTRUCTORES[tipo](contexto, datos)
  } catch (error) {
    throw invalido(mensajeDe(error, 'Los datos del documento no tienen la forma esperada'))
  }
}

/** Datos del listado que se extraen del DTE ya construido. */
function resumen(dte: Dte) {
  const r = dte.receptor ?? dte.sujetoExcluido ?? null
  const res = dte.resumen ?? {}
  // CLE: total (incluye percepción); CDE: valor donado; DCLE: líquido a pagar al afiliado.
  const total =
    res.totalPagar ??
    res.total ??
    res.montoTotalOperacion ??
    res.totalCompra ??
    res.totalIvaRetenido ??
    res.valorTotal ??
    dte.cuerpoDocumento?.liquidoApagar ??
    0
  return {
    receptorNombre: (r?.nombre as string | undefined) ?? null,
    receptorDocumento: ((r?.numDocumento ?? r?.nit) as string | undefined) ?? null,
    totalCentavos: Math.round(Number(total) * 100),
  }
}

/** Completa `datos.receptor` con el cliente guardado cuando la petición sólo trae `clienteId`. */
async function prepararDatos(ctx: Ctx, entrada: EmisionEntrada): Promise<Record<string, unknown>> {
  if (!entrada.clienteId) return entrada.datos
  const [c] = await ctx.db
    .select()
    .from(tablaCliente)
    .where(
      and(
        eq(tablaCliente.id, entrada.clienteId),
        eq(tablaCliente.organizationId, ctx.actor.organizationId),
      ),
    )
  if (!c) throw noEncontrado('El cliente')
  if (entrada.datos.receptor || entrada.datos.sujetoExcluido) return entrada.datos
  const direccion =
    c.departamento && c.municipio && c.distrito && c.complemento
      ? {
          departamento: c.departamento,
          municipio: c.municipio,
          distrito: c.distrito,
          complemento: c.complemento,
        }
      : null
  const receptor = {
    tipoDocumento: c.tipoDocumento,
    numDocumento: c.numDocumento,
    ...(c.tipoDocumento === '36' ? { nit: c.numDocumento } : {}),
    nrc: c.nrc,
    nombre: c.nombre,
    nombreComercial: c.nombreComercial,
    codActividad: c.codActividad,
    descActividad: c.descActividad,
    direccion,
    telefono: c.telefono,
    correo: c.correo,
  }
  return entrada.tipoDte === '14'
    ? { ...entrada.datos, sujetoExcluido: receptor }
    : { ...entrada.datos, receptor }
}

export type FilaDocumento = typeof documento.$inferSelect

const vista = (f: FilaDocumento) => ({
  id: f.id,
  codigoGeneracion: f.codigoGeneracion,
  numeroControl: f.numeroControl,
  tipoDte: f.tipoDte,
  ambiente: f.ambiente,
  estado: f.estado,
  fechaEmision: f.fechaEmision,
  horaEmision: f.horaEmision,
  receptorNombre: f.receptorNombre,
  receptorDocumento: f.receptorDocumento,
  total: f.totalCentavos / 100,
  selloRecibido: f.selloRecibido,
  origen: f.origen,
  error: f.error
    ? (JSON.parse(f.error) as { codigo: string; mensaje: string; observaciones?: string[] })
    : null,
  creado: f.creado.getTime(),
  urlConsulta: f.selloRecibido
    ? urlConsultaPublica(f.ambiente, f.codigoGeneracion, f.fechaEmision)
    : null,
})
export type VistaDocumento = ReturnType<typeof vista>

const TIPO_EVENTO = { retorno: '18', operaciones_especiales: '17' } as const
type FilaEvento = typeof evento.$inferSelect

export const vistaEvento = (e: FilaEvento) => ({
  id: e.id,
  tipo: e.tipo,
  tipoEvento: TIPO_EVENTO[e.tipo as keyof typeof TIPO_EVENTO] ?? null,
  codigoGeneracion: e.codigoGeneracion,
  ambiente: e.ambiente,
  estado: e.estado,
  selloRecibido: e.selloRecibido,
  documentoId: e.documentoId,
  creado: e.creado.getTime(),
})
export type VistaEvento = ReturnType<typeof vistaEvento>

/** Publica a los webhooks la vista actual de un documento. Nunca lanza. */
async function avisar(ctx: Ctx, id: string, evento: 'dte.procesado' | 'dte.rechazado') {
  try {
    const [f] = await ctx.db.select().from(documento).where(eq(documento.id, id))
    if (f) await publicar(ctx, evento, vista(f))
  } catch (error) {
    console.error('No se pudo publicar el evento de webhook', evento, error)
  }
}

export const errorMh = (r: RespuestaMH) => ({
  codigo: r.codigoMsg ?? 'rechazado',
  mensaje: r.descripcionMsg ?? 'El MH rechazó el documento',
  observaciones: r.observaciones ?? [],
})

// ---------------------------------------------------------------------------
// Previsualización

/** Construye y valida sin consumir número de control, firmar ni transmitir. */
export async function previsualizar(ctx: Ctx, entrada: EmisionEntrada) {
  exigir(ctx, 'dte:emit')
  const base = await emisorParaDte(ctx, { puntoVentaId: entrada.puntoVentaId })
  const datos = await prepararDatos(ctx, entrada)
  const dte = construir(
    entrada.tipoDte,
    { ambiente: base.ambiente, emisor: base.emisor, correlativo: 1 },
    datos,
  )
  return { dte, problemas: validarDte(dte), ...resumenVista(dte) }
}

const resumenVista = (dte: Dte) => {
  const r = resumen(dte)
  return { total: r.totalCentavos / 100, receptorNombre: r.receptorNombre }
}

// ---------------------------------------------------------------------------
// Emisión

/**
 * Reserva el siguiente correlativo de la serie y crea la fila del documento en estado
 * `pendiente`, todo en una transacción: ningún número queda sin su documento.
 */
async function reservar(
  ctx: Ctx,
  d: {
    tipoDte: string
    ambiente: Ambiente
    codEstable: string
    codPuntoVenta: string
    codigoGeneracion: string
    fecha: string
    hora: string
    clienteId: string | null
  },
) {
  const id = nuevoId()
  const org = ctx.actor.organizationId
  const anio = Number(d.fecha.slice(0, 4))
  const serie = [org, d.ambiente, d.tipoDte, d.codEstable, d.codPuntoVenta, anio]
  const d1 = ctx.env.DB
  const [incremento] = await d1.batch<{ ultimo: number }>([
    d1
      .prepare(
        `INSERT INTO correlativo (organization_id, ambiente, tipo_dte, cod_estable, cod_punto_venta, anio, ultimo)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
         ON CONFLICT (organization_id, ambiente, tipo_dte, cod_estable, cod_punto_venta, anio)
         DO UPDATE SET ultimo = ultimo + 1
         RETURNING ultimo`,
      )
      .bind(...serie),
    d1
      .prepare(
        `INSERT INTO documento (id, organization_id, codigo_generacion, numero_control, tipo_dte, ambiente,
           estado, fecha_emision, hora_emision, cliente_id, origen, actor_tipo, actor_id)
         SELECT ?7, ?1, ?8, 'DTE-' || ?3 || '-' || ?4 || ?5 || '-' || printf('%015d', ultimo), ?3, ?2,
           'pendiente', ?9, ?10, ?11, ?12, ?13, ?14
         FROM correlativo
         WHERE organization_id = ?1 AND ambiente = ?2 AND tipo_dte = ?3 AND cod_estable = ?4
           AND cod_punto_venta = ?5 AND anio = ?6`,
      )
      .bind(
        ...serie,
        id,
        d.codigoGeneracion,
        d.fecha,
        d.hora,
        d.clienteId,
        ctx.actor.origen,
        ctx.actor.tipo,
        ctx.actor.id,
      ),
  ])
  const correlativo = incremento?.results[0]?.ultimo
  if (!correlativo) throw new Error('No se pudo reservar el correlativo')
  return { id, correlativo }
}

async function guardar(
  ctx: Ctx,
  id: string,
  cambios: Partial<typeof documento.$inferInsert>,
  archivo?: { dte: Dte; firma: string | null; respuestaMh?: unknown },
) {
  const actualizar = ctx.db.update(documento).set(cambios).where(eq(documento.id, id))
  if (!archivo) {
    await actualizar
    return
  }
  const valores = {
    dte: JSON.stringify(archivo.dte),
    firma: archivo.firma,
    respuestaMh: archivo.respuestaMh ? JSON.stringify(archivo.respuestaMh) : null,
  }
  await ctx.db.batch([
    actualizar,
    ctx.db
      .insert(documentoArchivo)
      .values({ documentoId: id, ...valores })
      .onConflictDoUpdate({ target: documentoArchivo.documentoId, set: valores }),
  ])
}

const mhNoDisponible = (error: unknown) =>
  error instanceof ContingenciaRequeridaError ||
  error instanceof ErrorConexionMH ||
  (error instanceof ErrorMH && error.status >= 500)

/**
 * Emite un DTE: valida → reserva número de control → firma → transmite al MH.
 * - 201: procesado y sellado.
 * - 202: el MH no respondió; queda firmado en contingencia para transmitirlo después.
 * - 422 (AppError): el MH lo rechazó; el número de control queda consumido y registrado.
 */
export async function emitir(
  ctx: Ctx,
  entrada: EmisionEntrada,
  opciones: {
    /**
     * Emite en modelo diferido sin intentar la transmisión, como si el MH no respondiera. Sólo en
     * el ambiente de pruebas: sirve para ejercitar el evento de contingencia.
     */
    forzarContingencia?: boolean
  } = {},
): Promise<Respuesta> {
  exigir(ctx, 'dte:emit')
  const ce = await contextoEmision(ctx, { puntoVentaId: entrada.puntoVentaId })
  if (opciones.forzarContingencia && ce.ambiente !== '00') {
    throw invalido('La contingencia sólo se puede forzar en el ambiente de pruebas')
  }
  const datos = await prepararDatos(ctx, entrada)
  const fecha = new Date()
  const codigoGeneracion = generarCodigoGeneracion()
  const base = { ambiente: ce.ambiente, emisor: ce.emisor, fecha, codigoGeneracion }

  // 1. Validar antes de consumir un número de control.
  const borrador = construir(entrada.tipoDte, { ...base, correlativo: 1 }, datos)
  const problemas = validarDte(borrador)
  if (problemas.length) {
    throw new AppError(
      400,
      'dte_invalido',
      'El documento no cumple la estructura que exige el MH',
      {
        problemas,
      },
    )
  }

  // 2. Autenticar antes de reservar: unas credenciales rechazadas no deben gastar correlativos.
  let mhCaido = !!opciones.forzarContingencia
  if (!mhCaido && !ce.tokenVigente) {
    try {
      await ce.cliente.autenticar()
    } catch (error) {
      if (mhNoDisponible(error)) mhCaido = true
      else {
        throw new AppError(
          502,
          'mh_credenciales_rechazadas',
          mensajeDe(error, 'El MH rechazó las credenciales'),
          { ambiente: ce.ambiente },
        )
      }
    }
  }

  if (mhCaido && SIN_CONTINGENCIA.has(entrada.tipoDte)) {
    throw new AppError(
      502,
      'mh_no_disponible',
      'El MH no está disponible y este tipo de documento no puede emitirse en contingencia',
    )
  }

  // 3. Ganchos de las extensiones (plan, límites): pueden impedir la emisión sin gastar un número.
  await antesDeEmitir(ctx, { ambiente: ce.ambiente, tipoDte: entrada.tipoDte })

  // 4. Reservar correlativo y registrar el documento como pendiente.
  const { fecha: fecEmi, hora: horEmi } = fechaHoraSV(fecha)
  const { id, correlativo } = await reservar(ctx, {
    tipoDte: entrada.tipoDte,
    ambiente: ce.ambiente,
    codEstable: ce.emisor.codEstableMH,
    codPuntoVenta: ce.emisor.codPuntoVentaMH,
    codigoGeneracion,
    fecha: fecEmi,
    hora: horEmi,
    clienteId: entrada.clienteId ?? null,
  })

  const referencia = { id, codigoGeneracion }
  /**
   * Tras reservar, un fallo cuyo resultado en el MH se desconoce deja el documento `pendiente`:
   * el cron lo consulta en el MH y lo sella o lo descarta. Nunca se marca rechazado a ciegas.
   */
  const incierta = (error: unknown) => {
    console.error('Emisión incierta', codigoGeneracion, error)
    return new AppError(
      502,
      'emision_incierta',
      'No se pudo confirmar el resultado de la emisión. Consulta el documento antes de reintentar.',
      referencia,
    )
  }
  const responder = async (status: 201 | 202): Promise<Respuesta> => {
    const [fila] = await ctx.db.select().from(documento).where(eq(documento.id, id))
    const cuerpo = vista(fila!)
    await publicar(ctx, status === 201 ? 'dte.procesado' : 'dte.contingencia', cuerpo)
    return { status, cuerpo }
  }
  const auditar = (accion: string, detalle: Record<string, unknown>) =>
    registrar(ctx, accion, 'documento', id, detalle).catch((error) =>
      console.error('No se pudo auditar', accion, error),
    )

  if (!mhCaido) {
    // 5. Firmar y guardar. Si esto falla, nada salió hacia el MH.
    let dte: Dte
    let firma: string
    try {
      dte = construir(entrada.tipoDte, { ...base, correlativo }, datos)
      firma = await firmar(dte, ce.firmante)
      await guardar(ctx, id, resumen(dte), { dte, firma })
    } catch (error) {
      console.error('Emisión fallida antes de transmitir', codigoGeneracion, error)
      await guardar(ctx, id, {
        estado: 'rechazado',
        error: JSON.stringify({
          codigo: 'error_interno',
          mensaje: 'El documento no llegó a transmitirse al MH',
        }),
      }).catch(() => {})
      throw new AppError(
        502,
        'emision_fallida',
        'No se pudo firmar el documento; no se transmitió al MH',
        referencia,
      )
    }

    // 6. Transmitir.
    let respuesta: RespuestaMH | undefined
    try {
      respuesta = await transmitirDte(ce.cliente, dte, firma)
    } catch (error) {
      if (error instanceof DteRechazadoError) {
        const detalle = errorMh(error.respuesta)
        try {
          await guardar(
            ctx,
            id,
            { estado: 'rechazado', error: JSON.stringify(detalle) },
            { dte, firma, respuestaMh: error.respuesta },
          )
        } catch (fallo) {
          throw incierta(fallo)
        }
        await auditar('dte.rechazado', { codigo: detalle.codigo })
        await avisar(ctx, id, 'dte.rechazado')
        throw new AppError(422, 'dte_rechazado', detalle.mensaje, {
          ...referencia,
          numeroControl: dte.identificacion.numeroControl,
          mh: detalle,
        })
      }
      if (!mhNoDisponible(error)) throw incierta(error)
    }

    if (respuesta) {
      // El MH ya selló: a partir de aquí ningún fallo local puede degradar el documento.
      try {
        await guardar(
          ctx,
          id,
          { estado: 'procesado', selloRecibido: respuesta.selloRecibido },
          { dte, firma, respuestaMh: respuesta },
        )
        await auditar('dte.emitir', { tipoDte: entrada.tipoDte, codigoGeneracion })
        return await responder(201)
      } catch (error) {
        throw incierta(error)
      }
    }
  }

  // 7. El MH no responde: se emite en contingencia (modelo diferido) y se transmite después.
  // Los tipos sin contingencia quedan pendientes: el cron consulta el MH y los sella o descarta.
  if (SIN_CONTINGENCIA.has(entrada.tipoDte)) throw incierta(new Error('MH no disponible'))
  try {
    const dte = construir(
      entrada.tipoDte,
      { ...base, correlativo, contingencia: { tipo: 1 } },
      datos,
    )
    const firma = await firmar(dte, ce.firmante)
    await guardar(ctx, id, { ...resumen(dte), estado: 'contingencia' }, { dte, firma })
    await auditar('dte.contingencia', { codigoGeneracion })
    return await responder(202)
  } catch (error) {
    throw incierta(error)
  }
}

// ---------------------------------------------------------------------------
// Consulta

export async function listar(ctx: Ctx, filtros: ListaDtesEntrada) {
  exigir(ctx, 'dte:read')
  const ambiente = await ambienteActivo(ctx)
  const patron = filtros.q ? `%${filtros.q.replace(/[%_]/g, '')}%` : null
  const donde = and(
    eq(documento.organizationId, ctx.actor.organizationId),
    eq(documento.ambiente, ambiente),
    filtros.tipo ? eq(documento.tipoDte, filtros.tipo) : undefined,
    filtros.estado ? eq(documento.estado, filtros.estado) : undefined,
    filtros.desde ? gte(documento.fechaEmision, filtros.desde) : undefined,
    filtros.hasta ? lte(documento.fechaEmision, filtros.hasta) : undefined,
    patron
      ? or(
          like(documento.receptorNombre, patron),
          like(documento.receptorDocumento, patron),
          like(documento.numeroControl, patron),
          like(documento.codigoGeneracion, patron),
        )
      : undefined,
  )
  const [filas, [conteo]] = await Promise.all([
    ctx.db
      .select()
      .from(documento)
      .where(donde)
      .orderBy(desc(documento.creado))
      .limit(filtros.porPagina)
      .offset((filtros.pagina - 1) * filtros.porPagina),
    ctx.db.select({ total: sql<number>`count(*)` }).from(documento).where(donde),
  ])
  return {
    items: filas.map(vista),
    total: conteo?.total ?? 0,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    ambiente,
  }
}

/** Busca por código de generación o por id interno, siempre dentro de la organización. */
export async function fila(ctx: Ctx, codigo: string): Promise<FilaDocumento> {
  const [f] = await ctx.db
    .select()
    .from(documento)
    .where(
      and(
        eq(documento.organizationId, ctx.actor.organizationId),
        or(eq(documento.codigoGeneracion, codigo.toUpperCase()), eq(documento.id, codigo)),
      ),
    )
  if (!f) throw noEncontrado('El documento')
  // Una clave de pruebas no ve documentos de producción, ni al revés.
  if (ctx.actor.modo && f.ambiente !== (await ambienteActivo(ctx)))
    throw noEncontrado('El documento')
  return f
}

async function archivoDe(ctx: Ctx, f: FilaDocumento) {
  const [a] = await ctx.db
    .select()
    .from(documentoArchivo)
    .where(eq(documentoArchivo.documentoId, f.id))
  if (!a) throw conflicto('sin_archivo', 'El documento todavía no tiene archivo: sigue pendiente')
  return a
}

export async function obtener(ctx: Ctx, codigo: string) {
  exigir(ctx, 'dte:read')
  const f = await fila(ctx, codigo)
  const [archivos, eventos] = await Promise.all([
    ctx.db.select().from(documentoArchivo).where(eq(documentoArchivo.documentoId, f.id)),
    ctx.db
      .select()
      .from(evento)
      .where(and(eq(evento.organizationId, f.organizationId), eq(evento.documentoId, f.id)))
      .orderBy(desc(evento.creado)),
  ])
  const a = archivos[0]
  return {
    ...vista(f),
    dte: a ? (JSON.parse(a.dte) as Dte) : null,
    respuestaMh: a?.respuestaMh ? JSON.parse(a.respuestaMh) : null,
    eventos: eventos.map((e) => ({
      id: e.id,
      tipo: e.tipo,
      codigoGeneracion: e.codigoGeneracion,
      estado: e.estado,
      selloRecibido: e.selloRecibido,
      creado: e.creado.getTime(),
    })),
  }
}

/** "Archivo DTE" que la Normativa obliga a entregar al receptor: estructura + firma + sello. */
export async function archivoJson(ctx: Ctx, codigo: string): Promise<ArchivoDte> {
  exigir(ctx, 'dte:read')
  const f = await fila(ctx, codigo)
  const a = await archivoDe(ctx, f)
  return {
    ...(JSON.parse(a.dte) as Dte),
    firmaElectronica: a.firma ?? '',
    selloRecibido: f.selloRecibido,
  }
}

export async function pdf(
  ctx: Ctx,
  codigo: string,
): Promise<{ nombre: string; bytes: Uint8Array }> {
  const archivo = await archivoJson(ctx, codigo)
  return {
    nombre: `${archivo.identificacion.codigoGeneracion}.pdf`,
    bytes: await generarPdfDte(archivo, await opcionesPdf(ctx)),
  }
}

// ---------------------------------------------------------------------------
// Invalidación

export async function contextoDelDocumento(ctx: Ctx, f: FilaDocumento): Promise<ContextoEmision> {
  const serie = parsearNumeroControl(f.numeroControl)
  const ce = await contextoEmision(
    ctx,
    serie
      ? { codigos: { establecimiento: serie.establecimiento, puntoVenta: serie.puntoVenta } }
      : {},
  )
  if (ce.ambiente !== f.ambiente) {
    throw conflicto(
      'ambiente_distinto',
      'El documento pertenece a otro ambiente: cambia el ambiente activo para operar sobre él',
    )
  }
  return ce
}

export async function guardarEvento(
  ctx: Ctx,
  d: {
    tipo: (typeof evento.$inferInsert)['tipo']
    dte: Dte
    documentoId: string | null
    estado: 'procesado' | 'rechazado'
    firma?: string | null
    respuesta?: RespuestaMH
  },
) {
  const id = nuevoId()
  await ctx.db.insert(evento).values({
    id,
    organizationId: ctx.actor.organizationId,
    tipo: d.tipo,
    codigoGeneracion: d.dte.identificacion.codigoGeneracion,
    ambiente: d.dte.identificacion.ambiente,
    documentoId: d.documentoId,
    estado: d.estado,
    selloRecibido: d.respuesta?.selloRecibido ?? null,
    dte: JSON.stringify(d.dte),
    firma: d.firma ?? null,
    respuestaMh: d.respuesta ? JSON.stringify(d.respuesta) : null,
  })
  return id
}

/**
 * Construye, valida y transmite el evento de invalidación de un DTE o evento sellado, y lo guarda.
 * Lanza `invalidacion_rechazada` si el MH lo rechaza. Devuelve el código y el sello del evento, que
 * se entrega al receptor (Normativa 2.0, regla 6).
 */
async function transmitirInvalidacion(
  ctx: Ctx,
  ce: ContextoEmision,
  archivo: ArchivoDte,
  documentoId: string | null,
  entrada: InvalidacionEntrada,
) {
  const responsable = entrada.responsable ?? ce.responsable
  if (!responsable) {
    throw invalido('Indica el responsable de la invalidación o configúralo en los datos del emisor')
  }
  const documentoSdk = documentoParaInvalidar(archivo)
  const solicitante =
    entrada.solicitante ??
    (documentoSdk.nombre && documentoSdk.tipoDocumento && documentoSdk.numDocumento
      ? {
          nombre: documentoSdk.nombre,
          tipoDocumento: documentoSdk.tipoDocumento,
          numDocumento: documentoSdk.numDocumento,
        }
      : responsable)

  let dteEvento: Dte
  try {
    dteEvento = construirInvalidacion({
      ambiente: ce.ambiente,
      emisor: ce.emisor,
      documento: documentoSdk,
      tipoAnulacion: entrada.tipoAnulacion,
      motivoAnulacion: entrada.motivoAnulacion,
      codigoGeneracionReemplazo: entrada.codigoGeneracionReemplazo,
      responsable,
      solicitante,
    })
  } catch (error) {
    throw invalido(mensajeDe(error, 'Los datos del evento no tienen la forma esperada'))
  }
  const problemas = validarDte(dteEvento)
  if (problemas.length) {
    throw new AppError(
      400,
      'dte_invalido',
      'El evento de invalidación no cumple la estructura del MH',
      { problemas },
    )
  }

  try {
    const r = await transmitirEvento(ce.cliente, dteEvento, ce.firmante)
    await guardarEvento(ctx, {
      tipo: 'invalidacion',
      dte: dteEvento,
      documentoId,
      estado: 'procesado',
      firma: r.firma,
      respuesta: r.respuesta,
    })
    return {
      codigoGeneracion: dteEvento.identificacion.codigoGeneracion,
      selloRecibido: r.respuesta.selloRecibido,
    }
  } catch (error) {
    if (error instanceof DteRechazadoError) {
      const detalle = errorMh(error.respuesta)
      await guardarEvento(ctx, {
        tipo: 'invalidacion',
        dte: dteEvento,
        documentoId,
        estado: 'rechazado',
        respuesta: error.respuesta,
      })
      throw new AppError(422, 'invalidacion_rechazada', detalle.mensaje, { mh: detalle })
    }
    if (error instanceof AppError) throw error
    throw new AppError(502, 'mh_no_disponible', mensajeDe(error, 'El MH no está disponible'))
  }
}

/**
 * Invalida un DTE procesado o, si el código es de un evento de retorno u operaciones especiales,
 * ese evento. Un DTE con un retorno vigente no se invalida: primero se invalida el retorno
 * (Manual Funcional, VII).
 */
export async function invalidar(ctx: Ctx, codigo: string, entrada: InvalidacionEntrada) {
  exigir(ctx, 'dte:invalidate')
  const ev = await eventoInvalidable(ctx, codigo)
  if (ev) {
    const ce = await contextoEmision(ctx)
    if (ce.ambiente !== ev.ambiente) {
      throw conflicto(
        'ambiente_distinto',
        'El evento pertenece a otro ambiente: cambia el ambiente activo para operar sobre él',
      )
    }
    const archivo = {
      ...(JSON.parse(ev.dte) as Dte),
      firmaElectronica: ev.firma ?? '',
      selloRecibido: ev.selloRecibido,
    }
    const invalidacion = await transmitirInvalidacion(ctx, ce, archivo, ev.documentoId, entrada)
    await ctx.db.update(evento).set({ estado: 'invalidado' }).where(eq(evento.id, ev.id))
    await publicar(ctx, `${ev.tipo as 'retorno' | 'operaciones_especiales'}.invalidado`, {
      ...vistaEvento({ ...ev, estado: 'invalidado' }),
      invalidacion,
    })
    await registrar(ctx, 'evento.invalidar', 'evento', ev.id, {
      tipoAnulacion: entrada.tipoAnulacion,
    })
    return { invalidado: true, tipo: ev.tipo, codigoGeneracion: ev.codigoGeneracion }
  }

  const f = await fila(ctx, codigo)
  if (f.estado !== 'procesado') {
    throw conflicto(
      'estado_invalido',
      `Sólo se invalida un documento procesado; este está ${f.estado}`,
    )
  }
  const [retorno] = await ctx.db
    .select({ codigo: evento.codigoGeneracion })
    .from(evento)
    .where(
      and(
        eq(evento.organizationId, ctx.actor.organizationId),
        eq(evento.documentoId, f.id),
        eq(evento.tipo, 'retorno'),
        eq(evento.estado, 'procesado'),
      ),
    )
    .limit(1)
  if (retorno) {
    throw conflicto(
      'retorno_vigente',
      `El documento tiene un evento de retorno vigente (${retorno.codigo}): invalídalo primero`,
      { codigoGeneracion: retorno.codigo },
    )
  }
  const ce = await contextoDelDocumento(ctx, f)
  const archivo = await archivoJson(ctx, codigo)
  const invalidacion = await transmitirInvalidacion(ctx, ce, archivo, f.id, entrada)
  await guardar(ctx, f.id, { estado: 'invalidado' })
  await publicar(ctx, 'dte.invalidado', { ...vista({ ...f, estado: 'invalidado' }), invalidacion })
  await registrar(ctx, 'dte.invalidar', 'documento', f.id, {
    tipoAnulacion: entrada.tipoAnulacion,
  })
  return obtener(ctx, f.id)
}

/** Evento de retorno u operaciones especiales procesado con ese código, de esta organización. */
async function eventoInvalidable(ctx: Ctx, codigo: string) {
  const [ev] = await ctx.db
    .select()
    .from(evento)
    .where(
      and(
        eq(evento.organizationId, ctx.actor.organizationId),
        eq(evento.codigoGeneracion, codigo.toUpperCase()),
        or(eq(evento.tipo, 'retorno'), eq(evento.tipo, 'operaciones_especiales')),
      ),
    )
  if (!ev) return null
  if (ctx.actor.modo && ev.ambiente !== (await ambienteActivo(ctx))) return null
  if (ev.estado !== 'procesado') {
    throw conflicto(
      'estado_invalido',
      `Sólo se invalida un evento procesado; este está ${ev.estado}`,
    )
  }
  return ev
}

// ---------------------------------------------------------------------------
// Contingencia

/** El MH limita las subpeticiones de un Worker: se transmite por tandas. */
const MAX_POR_TANDA = 40

/**
 * Transmite el evento de contingencia con los documentos pendientes y luego cada documento.
 * Si quedan más de una tanda, devuelve `restantes` para volver a llamar.
 */
export async function transmitirContingencia(ctx: Ctx) {
  exigir(ctx, 'dte:invalidate')
  const ce = await contextoEmision(ctx)
  const donde = and(
    eq(documento.organizationId, ctx.actor.organizationId),
    eq(documento.ambiente, ce.ambiente),
    eq(documento.estado, 'contingencia'),
  )
  const pendientes = await ctx.db.select().from(documento).where(donde).orderBy(documento.creado)
  if (!pendientes.length) return { evento: null, procesados: [], rechazados: [], restantes: 0 }
  if (!ce.responsable) {
    throw invalido(
      'Configura el responsable en los datos del emisor para transmitir la contingencia',
    )
  }
  const tanda = pendientes.slice(0, MAX_POR_TANDA)

  let dteEvento: Dte
  try {
    dteEvento = construirContingencia({
      ambiente: ce.ambiente,
      emisor: ce.emisor,
      responsable: ce.responsable,
      documentos: tanda.map((d) => ({ tipoDte: d.tipoDte, codigoGeneracion: d.codigoGeneracion })),
      inicio: tanda[0]!.creado,
      fin: new Date(),
      tipoContingencia: 1,
    })
  } catch (error) {
    throw invalido(mensajeDe(error, 'Los datos del evento no tienen la forma esperada'))
  }

  let idEvento: string
  try {
    const r = await transmitirEvento(ce.cliente, dteEvento, ce.firmante)
    idEvento = await guardarEvento(ctx, {
      tipo: 'contingencia',
      dte: dteEvento,
      documentoId: null,
      estado: 'procesado',
      firma: r.firma,
      respuesta: r.respuesta,
    })
  } catch (error) {
    if (error instanceof DteRechazadoError) {
      const detalle = errorMh(error.respuesta)
      await guardarEvento(ctx, {
        tipo: 'contingencia',
        dte: dteEvento,
        documentoId: null,
        estado: 'rechazado',
        respuesta: error.respuesta,
      })
      throw new AppError(422, 'contingencia_rechazada', detalle.mensaje, { mh: detalle })
    }
    throw new AppError(502, 'mh_no_disponible', mensajeDe(error, 'El MH no está disponible'))
  }

  const procesados: VistaDocumento[] = []
  const rechazados: VistaDocumento[] = []
  for (const d of tanda) {
    const a = await archivoDe(ctx, d)
    const dte = JSON.parse(a.dte) as Dte
    try {
      const respuesta = await transmitirDte(ce.cliente, dte, a.firma ?? '')
      await guardar(
        ctx,
        d.id,
        { estado: 'procesado', selloRecibido: respuesta.selloRecibido },
        { dte, firma: a.firma, respuestaMh: respuesta },
      )
      procesados.push(vista({ ...d, estado: 'procesado', selloRecibido: respuesta.selloRecibido }))
    } catch (error) {
      if (error instanceof DteRechazadoError) {
        const detalle = errorMh(error.respuesta)
        await guardar(
          ctx,
          d.id,
          { estado: 'rechazado', error: JSON.stringify(detalle) },
          { dte, firma: a.firma, respuestaMh: error.respuesta },
        )
        rechazados.push(vista({ ...d, estado: 'rechazado', error: JSON.stringify(detalle) }))
      } else {
        // El MH volvió a caer: lo que falta sigue en contingencia para el próximo intento.
        break
      }
    }
  }
  await publicar(ctx, 'dte.procesado', procesados)
  await publicar(ctx, 'dte.rechazado', rechazados)
  await registrar(ctx, 'contingencia.transmitir', 'evento', idEvento, {
    procesados: procesados.length,
    rechazados: rechazados.length,
  })
  const [conteo] = await ctx.db
    .select({ total: sql<number>`count(*)` })
    .from(documento)
    .where(donde)
  return {
    evento: { id: idEvento, codigoGeneracion: dteEvento.identificacion.codigoGeneracion },
    procesados,
    rechazados,
    restantes: conteo?.total ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Tablero

/**
 * Contingencia de más de 3 días consecutivos: antes de transmitir el evento se presenta a Hacienda un
 * Informe Técnico de Contingencia (Normativa 2.0, regla 13.2.1.1).
 */
export const LIMITE_INFORME_CONTINGENCIA_MS = 72 * 60 * 60 * 1000

/** Contingencia abierta en un ambiente: cuántos documentos esperan y desde cuándo. */
async function contingenciaAbierta(ctx: Ctx, ambiente: Ambiente) {
  const [c] = await ctx.db
    .select({ documentos: sql<number>`count(*)`, desde: min(documento.creado) })
    .from(documento)
    .where(
      and(
        eq(documento.organizationId, ctx.actor.organizationId),
        eq(documento.ambiente, ambiente),
        eq(documento.estado, 'contingencia'),
      ),
    )
  if (!c?.documentos || !c.desde) return null
  const desde = c.desde.getTime()
  return {
    documentos: c.documentos,
    desde,
    requiereInforme: Date.now() - desde > LIMITE_INFORME_CONTINGENCIA_MS,
  }
}

export async function resumenTablero(ctx: Ctx) {
  exigir(ctx, 'dte:read')
  const ambiente = await ambienteActivo(ctx)
  const mes = fechaHoraSV().fecha.slice(0, 7)
  const base = and(
    eq(documento.organizationId, ctx.actor.organizationId),
    eq(documento.ambiente, ambiente),
  )
  const [porEstado, delMes, recientes, contingencia] = await Promise.all([
    ctx.db
      .select({ estado: documento.estado, total: sql<number>`count(*)` })
      .from(documento)
      .where(base)
      .groupBy(documento.estado),
    ctx.db
      .select({
        documentos: sql<number>`count(*)`,
        centavos: sql<number>`coalesce(sum(${documento.totalCentavos}), 0)`,
      })
      .from(documento)
      .where(and(base, eq(documento.estado, 'procesado'), like(documento.fechaEmision, `${mes}%`))),
    ctx.db.select().from(documento).where(base).orderBy(desc(documento.creado)).limit(5),
    contingenciaAbierta(ctx, ambiente),
  ])
  return {
    ambiente,
    mes,
    porEstado: Object.fromEntries(porEstado.map((e) => [e.estado, e.total])) as Record<
      string,
      number
    >,
    procesadosMes: delMes[0]?.documentos ?? 0,
    totalMes: (delMes[0]?.centavos ?? 0) / 100,
    recientes: recientes.map(vista),
    /** Documentos en contingencia y sus plazos; null si no hay. */
    contingencia,
  }
}

// ---------------------------------------------------------------------------
// Conciliación (cron)

/**
 * Un documento que quedó `pendiente` (el Worker se interrumpió a media emisión) se consulta
 * en el MH: si fue recibido se sella; si no, queda rechazado con el motivo.
 */
export async function conciliarPendiente(ctx: Ctx, f: FilaDocumento) {
  const ce = await contextoDelDocumento(ctx, f)
  // Sólo una respuesta efectiva del MH decide el estado; cualquier error deja el documento pendiente.
  const estado = await ce.cliente.consultarDte({
    nitEmisor: ce.emisor.nit,
    tipoDte: f.tipoDte,
    codigoGeneracion: f.codigoGeneracion,
  })
  if (estado.estado === 'PROCESADO' && estado.selloRecibido) {
    await guardar(ctx, f.id, { estado: 'procesado', selloRecibido: estado.selloRecibido })
    await avisar(ctx, f.id, 'dte.procesado')
    return 'procesado' as const
  }
  await guardar(ctx, f.id, {
    estado: 'rechazado',
    error: JSON.stringify({
      codigo: 'sin_respuesta',
      mensaje: 'La emisión se interrumpió y el MH no registra el documento',
    }),
  })
  await avisar(ctx, f.id, 'dte.rechazado')
  return 'rechazado' as const
}

/**
 * Cron: transmite sola la contingencia abierta de cada organización (Normativa 2.0, regla 13.2): se
 * reintenta la conexión con el MH al menos cada 15 minutos y, cuando responde, se transmite el
 * evento de contingencia (24 h desde el cese) y luego los documentos (72 h desde su sello).
 *
 * - Sólo producción por defecto: en pruebas la certificación fuerza contingencias y las transmite ella.
 * - Una contingencia de más de 3 días no se transmite sola: antes va el Informe Técnico de
 *   Contingencia, que presenta el contribuyente; luego la transmite él desde el panel o la API.
 * - Si el MH sigue sin responder o falta el responsable, se registra y se intenta en la próxima vuelta.
 */
export async function transmitirContingenciasAbiertas(
  env: Bindings,
  db: Db,
  extensiones: readonly Extension[] = [],
  opciones: { ambiente?: Ambiente; ahora?: number; maxOrganizaciones?: number } = {},
) {
  const ambiente = opciones.ambiente ?? '01'
  const ahora = opciones.ahora ?? Date.now()
  const abiertas = await db
    .select({ organizationId: documento.organizationId, desde: min(documento.creado) })
    .from(documento)
    .where(and(eq(documento.estado, 'contingencia'), eq(documento.ambiente, ambiente)))
    .groupBy(documento.organizationId)
    // Orden aleatorio: una organización con el MH caído no bloquea a las demás.
    .orderBy(sql`random()`)
    .limit(opciones.maxOrganizaciones ?? 5)
  const resultado: { organizationId: string; transmitidos: number; omitida?: 'informe' }[] = []
  for (const { organizationId, desde } of abiertas) {
    if (desde && ahora - desde.getTime() > LIMITE_INFORME_CONTINGENCIA_MS) {
      resultado.push({ organizationId, transmitidos: 0, omitida: 'informe' })
      continue
    }
    const ctx: Ctx = {
      env,
      db,
      actor: {
        tipo: 'sistema',
        id: 'cron',
        organizationId,
        permisos: new Set(PERMISOS),
        modo: ambiente === '01' ? 'live' : 'test',
        origen: 'api',
      },
      extensiones,
    }
    try {
      const r = await transmitirContingencia(ctx)
      resultado.push({ organizationId, transmitidos: r.procesados.length + r.rechazados.length })
    } catch (error) {
      console.error('No se pudo transmitir la contingencia', organizationId, mensajeDe(error, ''))
      resultado.push({ organizationId, transmitidos: 0 })
    }
  }
  return resultado
}
