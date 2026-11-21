/**
 * Consulta al MH del estado de un DTE de un tercero (validar una compra recibida).
 *
 * Usa las credenciales y el ambiente de quien consulta (nunca las del emisor ajeno) y NO guarda
 * nada del documento: la caché efímera (Cache API, por colo) sólo conserva el veredicto mínimo y un
 * hash del sello, con vida corta. Es un servicio de verificación, no un buscador: por eso tiene
 * topes por clave y por organización, y responde `selloCoincide` en lugar de devolver el sello.
 * Nada que identifique el documento (NIT, código de generación) se escribe en logs.
 */
import { type ClienteMH, ErrorConexionMH, ErrorMH } from '@openfactura/dte'
import type { ConsultaDteTerceroEntrada } from 'shared'
import { type Ctx, exigir } from '../contexto'
import { AppError } from '../lib/errors'
import { contextoEmision } from './emisor'
import { consumir } from './limites'

export interface VeredictoDteTercero {
  /** `encontrado`: el MH lo registra; `no_encontrado`: el MH no lo registra; `discrepancia`: lo registra pero el sello enviado no coincide. */
  veredicto: 'encontrado' | 'no_encontrado' | 'discrepancia'
  /** Estado en el MH: `procesado`, `invalidado` u otro que el MH informe; null si no se encontró. */
  estado: string | null
  /** true/false si se envió `selloRecibido`; null si no se envió o no se encontró. */
  selloCoincide: boolean | null
  /** Fecha y hora de procesamiento que informa el MH (`dd/MM/yyyy HH:mm:ss`), si la trae. */
  fechaProcesamiento: string | null
  ambiente: '00' | '01'
  /** true si la respuesta salió de la caché y no se consultó al MH. */
  cache: boolean
}

interface Base {
  estado: string | null
  hashSello: string | null
  fechaProcesamiento: string | null
}

const MINUTO_POR_CLAVE = 20
const DIA_POR_ORGANIZACION = 1000
/** Vida de la caché: un documento hallado puede invalidarse, por eso corta; un «no existe» aún menos. */
const TTL_ENCONTRADO = 300
const TTL_NO_ENCONTRADO = 60
const INTENTOS = 2

const hex = async (texto: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

const limite = (valor: string | undefined, porDefecto: number) => Number(valor) || porDefecto

async function aplicarLimites(ctx: Ctx) {
  const porClave = await consumir(
    ctx.env.DB,
    `consulta-tercero:${ctx.actor.id}`,
    limite(ctx.env.CONSULTA_TERCERO_POR_MINUTO, MINUTO_POR_CLAVE),
  )
  if (!porClave.permitido) {
    throw new AppError(
      429,
      'limite_excedido',
      `Límite de ${porClave.limite} consultas de terceros por minuto excedido`,
      { reintentarEn: porClave.reinicioEn },
    )
  }
  const porOrg = await consumir(
    ctx.env.DB,
    `consulta-tercero-dia:${ctx.actor.organizationId}`,
    limite(ctx.env.CONSULTA_TERCERO_POR_DIA, DIA_POR_ORGANIZACION),
    86_400,
  )
  if (!porOrg.permitido) {
    throw new AppError(
      429,
      'limite_excedido',
      `Límite diario de ${porOrg.limite} consultas de terceros de la organización excedido`,
      { reintentarEn: porOrg.reinicioEn },
    )
  }
}

async function leerCache(llave: Request): Promise<Base | null> {
  try {
    const r = await caches.default.match(llave)
    return r ? ((await r.json()) as Base) : null
  } catch {
    return null
  }
}

async function guardarCache(llave: Request, base: Base, ttl: number) {
  try {
    await caches.default.put(
      llave,
      new Response(JSON.stringify(base), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` },
      }),
    )
  } catch {
    // La caché es una optimización: sin ella se consulta al MH.
  }
}

/** Dos intentos como máximo, sólo ante fallos de red o 5xx; cualquier otra respuesta es del MH. */
async function consultarConReintento(cliente: ClienteMH, c: ConsultaDteTerceroEntrada) {
  let ultimo: unknown
  for (let i = 0; i < INTENTOS; i++) {
    try {
      return await cliente.consultarDte({
        nitEmisor: c.nitEmisor,
        tipoDte: c.tipoDte,
        codigoGeneracion: c.codigoGeneracion,
      })
    } catch (error) {
      if (!(error instanceof ErrorConexionMH)) throw error
      ultimo = error
    }
  }
  throw ultimo
}

export async function consultarDteTercero(
  ctx: Ctx,
  entrada: ConsultaDteTerceroEntrada,
): Promise<VeredictoDteTercero> {
  exigir(ctx, 'dte:read')
  await aplicarLimites(ctx)

  const { ambiente, cliente } = await contextoEmision(ctx)
  const llave = new Request(
    `https://consulta-tercero.invalid/${ctx.actor.organizationId}/${ambiente}/${entrada.tipoDte}/${await hex(`${entrada.nitEmisor}|${entrada.codigoGeneracion}`)}`,
  )

  let base = await leerCache(llave)
  const cache = base !== null
  if (!base) {
    let r: Awaited<ReturnType<ClienteMH['consultarDte']>>
    try {
      r = await consultarConReintento(cliente, entrada)
    } catch (error) {
      if (error instanceof ErrorConexionMH) {
        throw new AppError(
          502,
          'mh_no_disponible',
          'El MH no respondió. Reintenta en unos segundos.',
          { reintentarEn: 30 },
        )
      }
      if (
        error instanceof ErrorMH &&
        (error.status === 401 ||
          error.status === 403 ||
          error.message.startsWith('Autenticación rechazada'))
      ) {
        throw new AppError(
          502,
          'mh_credenciales_rechazadas',
          'El MH rechazó las credenciales de la organización',
        )
      }
      if (error instanceof AppError) throw error
      throw new AppError(502, 'mh_respuesta_inesperada', 'El MH respondió algo inesperado')
    }
    if (r.codigoMsg === '014') {
      base = { estado: null, hashSello: null, fechaProcesamiento: null }
      await guardarCache(llave, base, TTL_NO_ENCONTRADO)
    } else if (r.estado === 'PROCESADO' || r.estado === 'INVALIDADO') {
      base = {
        estado: r.estado.toLowerCase(),
        hashSello: r.selloRecibido ? await hex(String(r.selloRecibido).toUpperCase()) : null,
        fechaProcesamiento: r.fhProcesamiento ?? null,
      }
      await guardarCache(llave, base, TTL_ENCONTRADO)
    } else {
      // Rechazos de parámetros, topes del MH u otros: no son un veredicto sobre el documento.
      throw new AppError(502, 'mh_respuesta_inesperada', 'El MH no pudo atender la consulta', {
        codigoMsg: typeof r.codigoMsg === 'string' ? r.codigoMsg : null,
      })
    }
  }

  if (base.estado === null) {
    return {
      veredicto: 'no_encontrado',
      estado: null,
      selloCoincide: null,
      fechaProcesamiento: null,
      ambiente,
      cache,
    }
  }
  const selloCoincide = entrada.selloRecibido
    ? base.hashSello !== null && base.hashSello === (await hex(entrada.selloRecibido))
    : null
  return {
    veredicto: selloCoincide === false ? 'discrepancia' : 'encontrado',
    estado: base.estado,
    selloCoincide,
    fechaProcesamiento: base.fechaProcesamiento,
    ambiente,
    cache,
  }
}
