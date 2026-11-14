/**
 * Simulador del Sistema de Transmisión del MH para desarrollo y pruebas.
 * Implementa los endpoints del Manual Técnico v2 y valida firma + estructura,
 * pero NO reproduce todas las validaciones fiscales de Hacienda: un DTE que
 * pasa aquí aún debe probarse en el ambiente de pruebas oficial.
 */
import { fechaHoraSV, generarCodigoGeneracion } from '../ids'
import { tipoDeDocumento } from '../schemas'
import { leerJws, verificarFirma } from '../sign'
import type { Dte } from '../types'
import { validarEstructura } from '../validate'
import type { RespuestaMH } from './client'

export interface OpcionesMockMH {
  /** Usuarios de API aceptados: { [nit]: contraseña }. */
  usuarios: Record<string, string>
  /** Llaves públicas (SPKI) por NIT para verificar la firma. Si falta el NIT sólo se exige un JWS RS512 bien formado. */
  llavesPublicas?: Record<string, Uint8Array<ArrayBuffer>>
  /**
   * Acepta invalidar documentos que este simulador no recibió (p. ej. un servidor con varias
   * instancias, cada una con su memoria). Sin esta opción responde 014 como Hacienda.
   */
  aceptarDesconocidos?: boolean
}

export interface MockMH {
  /** Sustituto de `fetch` para pasar a `new ClienteMH({ fetch })`. */
  fetch: typeof fetch
  /** Atiende una Request estándar (para montar en un servidor HTTP). */
  atender(request: Request): Promise<Response>
  /** Las próximas `n` transmisiones no responden (simula caída del MH). */
  simularCaida(n: number, opciones?: { procesar?: boolean }): void
  /** Documentos sellados, por código de generación. */
  readonly recibidos: Map<string, { dte: Dte; sello: string; invalidado: boolean }>
  readonly contingencias: Map<string, Dte>
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } })

function fechaProceso() {
  const { fecha, hora } = fechaHoraSV()
  const [a, m, d] = fecha.split('-')
  return `${d}/${m}/${a} ${hora}`
}

function nuevoSello() {
  const hex = [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `${new Date().getFullYear()}${hex}`.slice(0, 40)
}

export function crearMockMH(opciones: OpcionesMockMH): MockMH {
  const tokens = new Map<string, string>()
  const recibidos: MockMH['recibidos'] = new Map()
  const numerosControl = new Set<string>()
  const contingencias: MockMH['contingencias'] = new Map()
  const lotes = new Map<string, { procesados: RespuestaMH[]; rechazados: RespuestaMH[] }>()
  let caidas = 0
  let procesarEnCaida = false

  const rechazo = (codigoGeneracion: string | null, codigoMsg: string, descripcionMsg: string, observaciones: string[] = []): RespuestaMH => ({
    version: 2, ambiente: '00', versionApp: 2, estado: 'RECHAZADO', codigoGeneracion, selloRecibido: null, fhProcesamiento: fechaProceso(), clasificaMsg: '20', codigoMsg, descripcionMsg, observaciones
  })

  async function leerFirmado(jws: unknown, nit: string): Promise<Dte | string> {
    if (typeof jws !== 'string') return 'documento: DEBE PROPORCIONAR UN VALOR'
    let dte: Dte
    try {
      const { encabezado, contenido } = leerJws<Dte>(jws)
      if (encabezado.alg !== 'RS512') return 'firma: el algoritmo debe ser RS512'
      dte = contenido
    } catch {
      return 'DATOS NO CUMPLEN ESTANDAR JSON'
    }
    const llave = opciones.llavesPublicas?.[nit]
    if (llave && !(await verificarFirma(jws, llave))) return 'firma: la firma electrónica no es válida'
    if ((dte.emisor?.nit ?? dte.emisor?.numDocumento) !== nit) return 'emisor.nit: NO CORRESPONDE A CONTRIBUYENTE'
    return dte
  }

  async function recibir(jws: unknown, nit: string): Promise<RespuestaMH> {
    const dte = await leerFirmado(jws, nit)
    if (typeof dte === 'string') return rechazo(null, '098', dte)
    const id = dte.identificacion
    const problemas = validarEstructura(dte)
    if (problemas.length) return rechazo(id.codigoGeneracion, '096', 'DOCUMENTO NO CUMPLE CON NORMATIVA DE CUMPLIMIENTO', problemas.map(p => `${p.ruta} ${p.mensaje}`))
    if (recibidos.has(id.codigoGeneracion)) return rechazo(id.codigoGeneracion, '004', '[identificacion.codigoGeneracion] YA EXISTE UN REGISTRO CON ESE VALOR')
    if (id.numeroControl && numerosControl.has(id.numeroControl)) return rechazo(id.codigoGeneracion, '004', '[identificacion.numeroControl] YA EXISTE UN REGISTRO CON ESE VALOR')
    if (id.tipoOperacion === 2 && ![...contingencias.values()].some(c => c.detalleDTE.some((d: any) => d.codigoGeneracion === id.codigoGeneracion))) {
      return rechazo(id.codigoGeneracion, '012', '[identificacion.tipoOperacion] NO EXISTE EVENTO DE CONTINGENCIA')
    }
    const sello = nuevoSello()
    recibidos.set(id.codigoGeneracion, { dte, sello, invalidado: false })
    if (id.numeroControl) numerosControl.add(id.numeroControl)
    return { version: 2, ambiente: id.ambiente, versionApp: 2, estado: 'PROCESADO', codigoGeneracion: id.codigoGeneracion, selloRecibido: sello, fhProcesamiento: fechaProceso(), clasificaMsg: '10', codigoMsg: '001', descripcionMsg: 'RECIBIDO', observaciones: [] }
  }

  async function atender(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const ruta = url.pathname
    if (ruta.endsWith('/')) return json({ status: 'ERROR', message: 'La URL no debe terminar en barra diagonal' }, 404)

    if (ruta === '/seguridad/auth' && request.method === 'POST') {
      const form = new URLSearchParams(await request.text())
      const usuario = form.get('user') ?? ''
      if (!opciones.usuarios[usuario] || opciones.usuarios[usuario] !== form.get('pwd')) return json({ status: 'ERROR', error: 'Unauthorized', message: 'Usuario no valido' }, 401)
      const token = `Bearer mock.${generarCodigoGeneracion()}`
      tokens.set(token, usuario)
      return json({ status: 'OK', body: { user: usuario, token, rol: { nombre: 'Usuario', codigo: 'ROLE_USER' }, roles: ['ROLE_USER'], tokenType: 'Bearer' } })
    }

    const nit = tokens.get(request.headers.get('Authorization') ?? '')
    if (!nit) return json({ status: 'ERROR', error: 'Unauthorized', message: 'ERROR TOKEN INVÁLIDO' }, 401)
    const cuerpo: any = request.method === 'POST' ? await request.json().catch(() => null) : null

    if (ruta === '/fesv/recepciondte') {
      if (caidas > 0) {
        caidas--
        if (procesarEnCaida) await recibir(cuerpo?.documento, nit)
        throw new TypeError('fetch failed (caída simulada del MH)')
      }
      const respuesta = await recibir(cuerpo?.documento, nit)
      return json(respuesta, respuesta.estado === 'PROCESADO' ? 200 : 400)
    }

    if (ruta === '/fesv/recepcion/consultadte') {
      const registro = recibidos.get(cuerpo?.codigoGeneracion)
      if (!registro) return json(rechazo(cuerpo?.codigoGeneracion ?? null, '014', '[codigoGeneracion] NO EXISTE UN REGISTRO CON ESTE DATO'), 400)
      return json({ version: 2, ambiente: registro.dte.identificacion.ambiente, versionApp: 2, estado: registro.invalidado ? 'INVALIDADO' : 'PROCESADO', codigoGeneracion: cuerpo.codigoGeneracion, selloRecibido: registro.sello, fhProcesamiento: fechaProceso(), clasificaMsg: '10', codigoMsg: '001', descripcionMsg: 'RECIBIDO', observaciones: [] })
    }

    if (ruta === '/fesv/recepcionlote') {
      const documentos: unknown[] = Array.isArray(cuerpo?.documentos) ? cuerpo.documentos : []
      if (!documentos.length || documentos.length > 100) return json({ estado: 'RECHAZADO', descripcionMsg: 'PARAMETROS NO SON VALIDOS' }, 400)
      const resultado = { procesados: [] as RespuestaMH[], rechazados: [] as RespuestaMH[] }
      for (const [index, documento] of documentos.entries()) {
        const r = await recibir(documento, nit)
        ;(r.estado === 'PROCESADO' ? resultado.procesados : resultado.rechazados).push({ ...r, index })
      }
      const codigoLote = generarCodigoGeneracion()
      lotes.set(codigoLote, resultado)
      return json({ version: 1, ambiente: cuerpo.ambiente, versionApp: 1, estado: 'RECIBIDO', idEnvio: cuerpo.idEnvio, codigoLote, fhProcesamiento: fechaProceso(), clasificaMsg: '10', codigoMsg: '001', descripcionMsg: 'LOTE RECIBIDO' })
    }

    const lote = /^\/fesv\/recepcion\/consultadtelote\/([^/]+)$/.exec(ruta)
    if (lote && request.method === 'GET') {
      const resultado = lotes.get(lote[1]!)
      return resultado ? json(resultado) : json({ estado: 'RECHAZADO', descripcionMsg: 'NO EXISTE UN REGISTRO CON ESTE DATO' }, 400)
    }

    if (ruta === '/fesv/contingencia') {
      const evento = await leerFirmado(cuerpo?.documento, nit)
      const problemas = typeof evento === 'string' ? [evento] : validarEstructura(evento, 'contingencia').map(p => `${p.ruta} ${p.mensaje}`)
      if (problemas.length || typeof evento === 'string') return json({ estado: 'RECHAZADO', fechaHora: fechaProceso(), mensaje: 'Validaciones no superadas', selloRecibido: null, observaciones: problemas }, 400)
      contingencias.set(evento.identificacion.codigoGeneracion, evento)
      return json({ estado: 'RECIBIDO', fechaHora: fechaProceso(), mensaje: 'Documento recibido', selloRecibido: nuevoSello(), observaciones: [] })
    }

    if (ruta === '/fesv/anulardte') {
      const evento = await leerFirmado(cuerpo?.documento, nit)
      if (typeof evento === 'string') return json(rechazo(null, '098', evento), 400)
      const codigo = evento.identificacion.codigoGeneracion
      const problemas = validarEstructura(evento, 'invalidacion')
      if (problemas.length) return json(rechazo(codigo, '096', 'DOCUMENTO NO CUMPLE CON NORMATIVA DE CUMPLIMIENTO', problemas.map(p => `${p.ruta} ${p.mensaje}`)), 400)
      if (opciones.aceptarDesconocidos && !recibidos.has(evento.documento.codigoGeneracion)) {
        recibidos.set(evento.documento.codigoGeneracion, { dte: evento as unknown as Dte, sello: evento.documento.selloRecibido, invalidado: false })
      }
      const registro = recibidos.get(evento.documento.codigoGeneracion)
      if (!registro) return json(rechazo(codigo, '014', '[documento.codigoGeneracion] NO EXISTE UN REGISTRO CON ESTE DATO'), 400)
      if (registro.sello !== evento.documento.selloRecibido) return json(rechazo(codigo, '027', '[documento.selloRecibido] DATO NO COINCIDE CON DTE'), 400)
      if (registro.invalidado) return json(rechazo(codigo, '015', '[documento.codigoGeneracion] DOCUMENTO SE ENCUENTRA INVALIDADO'), 400)
      const reemplazo = evento.documento.codigoGeneracionR
      if (reemplazo && !recibidos.has(reemplazo) && !opciones.aceptarDesconocidos) return json(rechazo(codigo, '112', 'CODIGO DE GENERACION REEMPLAZO, NO EXISTE'), 400)
      registro.invalidado = true
      return json({ version: 2, ambiente: evento.identificacion.ambiente, versionApp: 1, estado: 'PROCESADO', codigoGeneracion: codigo, selloRecibido: nuevoSello(), fhProcesamiento: fechaProceso(), codigoMsg: '001', descripcionMsg: 'Invalidación Recibida y Procesada', observaciones: null })
    }

    return json({ status: 'ERROR', message: `Ruta desconocida: ${ruta}` }, 404)
  }

  return {
    atender,
    fetch: ((entrada: RequestInfo | URL, init?: RequestInit) => atender(new Request(entrada, init))) as typeof fetch,
    simularCaida(n, o) { caidas = n; procesarEnCaida = !!o?.procesar },
    recibidos,
    contingencias
  }
}

export { tipoDeDocumento }
