import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { mcpAgentes, mcpInstall } from './agentes'
import {
  type Env,
  enmascarar,
  esClaveDeProduccion,
  esClaveValida,
  guardarConfig,
  leerConfig,
  type Resuelto,
  rutaConfig,
} from './config'
import { ErrorCli, ErrorUso, SALIDA } from './errores'
import { ESTADOS_DTE, EVENTOS_WEBHOOK, NOMBRE_AMBIENTE, TIPOS_DTE } from './esquemas'
import { ClienteApi } from './http'
import { servirMcp } from './mcp'
import { dinero, fichas, siNo, tabla } from './salida'

/** Todo lo que la CLI toca del mundo exterior; las pruebas lo sustituyen. */
export interface Entorno {
  env: Env
  fetch: typeof fetch
  /** Escribe una línea en stdout / stderr. */
  stdout: (linea: string) => void
  stderr: (linea: string) => void
  /** Lee toda la entrada estándar. */
  leerEntrada: () => Promise<string>
  /** Hay una terminal interactiva en la entrada estándar. */
  esTTY: boolean
  preguntar: (pregunta: string, oculto?: boolean) => Promise<string>
  cwd: string
  /** Sistema operativo (`process.platform`). */
  plataforma: NodeJS.Platform
  /** Ejecuta un programa sin shell y devuelve su código y su salida (stdout + stderr). */
  ejecutarProceso: (programa: string, args: string[]) => Promise<{ codigo: number; salida: string }>
}

export interface Contexto {
  ent: Entorno
  version: string
  args: string[]
  json: boolean
  si: boolean
  cfg: Resuelto
  /** Valor de una opción de texto. */
  op: (nombre: string) => string | undefined
  /** Una opción booleana está presente. */
  bandera: (nombre: string) => boolean
  /** Cliente de la API; falla con salida 3 si no hay clave. */
  api: () => ClienteApi
  /** API de Plataforma (`/cloud/plataforma`) con TU clave, aunque estés usando un cliente. */
  apiPlataforma: () => ClienteApi
}

export interface Comando {
  nombre: string
  uso: string
  resumen: string
  opciones: string[]
  /** Mínimo y máximo de argumentos posicionales. */
  args: [number, number]
  accion: (ctx: Contexto) => Promise<number | undefined>
}

type Registro = Record<string, unknown>

interface Documento extends Registro {
  codigoGeneracion: string
  numeroControl: string
  tipoDte: string
  ambiente: string
  estado: string
  total: number | null
}

const nombreTipo = (codigo: unknown) =>
  `${codigo} ${(TIPOS_DTE as Record<string, string>)[String(codigo)] ?? ''}`.trim()
const nombreAmbiente = (codigo: unknown) =>
  `${codigo} ${NOMBRE_AMBIENTE[String(codigo)] ?? ''}`.trim()
const fecha = (ms: unknown) =>
  typeof ms === 'number' ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : ms
const segmento = (texto: string) => encodeURIComponent(texto)

function mostrar(ctx: Contexto, datos: unknown, legible: () => string): void {
  ctx.ent.stdout(ctx.json ? JSON.stringify(datos, null, 2) : legible())
}

async function leerJson(ctx: Contexto, origen: string): Promise<unknown> {
  let texto: string
  if (origen === '-') {
    texto = await ctx.ent.leerEntrada()
  } else {
    try {
      texto = await readFile(resolve(ctx.ent.cwd, origen), 'utf8')
    } catch (error) {
      throw new ErrorUso(`No se pudo leer ${origen}: ${(error as Error).message}`)
    }
  }
  try {
    return JSON.parse(texto)
  } catch (error) {
    throw new ErrorUso(
      `${origen === '-' ? 'La entrada estándar' : origen} no es un JSON válido: ${(error as Error).message}`,
    )
  }
}

async function leerEmision(ctx: Contexto, origen: string): Promise<Registro> {
  const cuerpo = await leerJson(ctx, origen)
  const valido =
    cuerpo &&
    typeof cuerpo === 'object' &&
    !Array.isArray(cuerpo) &&
    'tipoDte' in cuerpo &&
    'datos' in cuerpo
  if (!valido) {
    throw new ErrorUso(
      'El archivo debe ser un objeto { "tipoDte": "01", "datos": { … }, "clienteId"?, "puntoVentaId"? }',
    )
  }
  return cuerpo as Registro
}

/** Con una clave de producción, las operaciones con efecto fiscal piden confirmación. */
async function confirmar(ctx: Contexto, accion: string, entradaOcupada = false): Promise<void> {
  if (ctx.si || !ctx.cfg.apiKey || !esClaveDeProduccion(ctx.cfg.apiKey)) return
  if (!ctx.ent.esTTY || entradaOcupada) {
    throw new ErrorUso(
      `Vas a ${accion} en PRODUCCIÓN y no hay una terminal para confirmar: agrega --yes.`,
    )
  }
  const respuesta = await ctx.ent.preguntar(
    `Vas a ${accion} en PRODUCCIÓN (clave of_live_). ¿Continuar? [s/N] `,
  )
  if (!/^(s|si|sí|y|yes)$/i.test(respuesta.trim()))
    throw new ErrorCli('Operación cancelada.', 'cancelado')
}

function entero(ctx: Contexto, opcion: string, minimo = 1): number | undefined {
  const texto = ctx.op(opcion)
  if (texto === undefined) return undefined
  const numero = Number(texto)
  if (!Number.isInteger(numero) || numero < minimo)
    throw new ErrorUso(`--${opcion} debe ser un número entero (recibido: ${texto})`)
  return numero
}

function fichaDocumento(doc: Documento): string {
  return fichas([
    ['Estado', doc.estado],
    ['Tipo', nombreTipo(doc.tipoDte)],
    ['Número de control', doc.numeroControl],
    ['Código de generación', doc.codigoGeneracion],
    ['Ambiente', nombreAmbiente(doc.ambiente)],
    ['Emisión', `${doc.fechaEmision ?? ''} ${doc.horaEmision ?? ''}`.trim()],
    ['Receptor', [doc.receptorNombre, doc.receptorDocumento].filter(Boolean).join(' · ')],
    ['Total', dinero(doc.total)],
    ['Sello recibido', doc.selloRecibido],
    ['Origen', doc.origen],
    ['Error', doc.error],
    ['Consulta pública', doc.urlConsulta],
  ])
}

/** Arma el cuerpo de `add` desde `--file` o desde opciones sueltas (nunca ambas). */
async function cuerpoDeAlta(
  ctx: Contexto,
  campos: Record<string, string>,
  numericos: string[] = [],
): Promise<unknown> {
  const dados = Object.keys(campos).filter((opcion) => ctx.op(opcion) !== undefined)
  const archivo = ctx.op('file')
  if (archivo !== undefined) {
    if (dados.length) throw new ErrorUso('Usa --file o las opciones sueltas, no ambas.')
    return leerJson(ctx, archivo)
  }
  if (!dados.length) {
    throw new ErrorUso(
      `Indica --file <archivo.json> o los datos con opciones: ${Object.keys(campos)
        .map((o) => `--${o}`)
        .join(', ')}`,
    )
  }
  const cuerpo: Registro = {}
  for (const opcion of dados) {
    const texto = ctx.op(opcion) as string
    const campo = campos[opcion] as string
    if (numericos.includes(opcion)) {
      const numero = Number(texto)
      if (texto.trim() === '' || !Number.isFinite(numero))
        throw new ErrorUso(`--${opcion} debe ser un número (recibido: ${texto})`)
      cuerpo[campo] = numero
    } else {
      cuerpo[campo] = texto
    }
  }
  return cuerpo
}

const CAMPOS_CLIENTE = {
  'tipo-documento': 'tipoDocumento',
  'num-documento': 'numDocumento',
  nrc: 'nrc',
  nombre: 'nombre',
  'nombre-comercial': 'nombreComercial',
  'cod-actividad': 'codActividad',
  'desc-actividad': 'descActividad',
  departamento: 'departamento',
  municipio: 'municipio',
  distrito: 'distrito',
  complemento: 'complemento',
  telefono: 'telefono',
  correo: 'correo',
}

const CAMPOS_PRODUCTO = {
  codigo: 'codigo',
  descripcion: 'descripcion',
  precio: 'precioUnitario',
  'tipo-item': 'tipoItem',
  'uni-medida': 'uniMedida',
  'tipo-venta': 'tipoVenta',
}

// ───────────────────────────── sesión ─────────────────────────────

async function login(ctx: Contexto): Promise<undefined> {
  let clave = ctx.op('key')
  if (clave === undefined) {
    clave = ctx.ent.esTTY
      ? await ctx.ent.preguntar('Clave de API (of_test_… u of_live_…): ', true)
      : (await ctx.ent.leerEntrada()).split('\n')[0]
  }
  clave = (clave ?? '').trim()
  if (!esClaveValida(clave))
    throw new ErrorUso('La clave de API debe empezar con of_test_ o of_live_.')

  const api = new ClienteApi({
    url: ctx.cfg.url,
    apiKey: clave,
    version: ctx.version,
    fetch: ctx.ent.fetch,
  })
  const { datos } = await api.pedir<Registro>('GET', '/yo')

  const config = leerConfig(ctx.ent.env)
  config.perfiles[ctx.cfg.perfil] = { url: ctx.cfg.url, apiKey: clave }
  const ruta = guardarConfig(ctx.ent.env, config)

  mostrar(ctx, datos, () =>
    [
      `Sesión iniciada en ${ctx.cfg.url}`,
      fichas([
        ['Clave', enmascarar(clave)],
        ['Ambiente', nombreAmbiente(datos.ambiente)],
        ['Perfil', ctx.cfg.perfil],
        ['Guardado en', ruta],
      ]),
    ].join('\n'),
  )
  if (ctx.ent.env.OPENFACTURA_API_KEY) {
    ctx.ent.stderr(
      'Aviso: OPENFACTURA_API_KEY está definida y tiene prioridad sobre la clave guardada.',
    )
  }
  return undefined
}

/** Permisos que admite una clave de API (PERMISOS_CLAVE del servidor). */
const PERMISOS_DE_CLAVE = [
  'dte:read',
  'dte:emit',
  'dte:invalidate',
  'clientes:read',
  'clientes:write',
  'productos:read',
  'productos:write',
  'emisor:read',
  'webhooks:manage',
  'registros:read',
]

/**
 * Instalación propia sin panel: con el ADMIN_TOKEN del servidor crea la organización y una clave de
 * API de pruebas con todos los permisos, y la guarda como `login`. El token no se guarda.
 */
async function alta(ctx: Contexto): Promise<undefined> {
  const nombre = (ctx.args[0] ?? '').trim()
  if (!nombre) throw new ErrorUso('Indica el nombre de la empresa: openfactura alta "Mi empresa"')
  let token = ctx.op('token') ?? ctx.ent.env.OPENFACTURA_ADMIN_TOKEN
  if (token === undefined && ctx.ent.esTTY) {
    token = await ctx.ent.preguntar('ADMIN_TOKEN del servidor: ', true)
  }
  token = (token ?? '').trim()
  if (!token) throw new ErrorUso('Falta el ADMIN_TOKEN (--token u OPENFACTURA_ADMIN_TOKEN).')

  const comun = { url: ctx.cfg.url, apiKey: token, version: ctx.version, fetch: ctx.ent.fetch }
  const { datos: org } = await new ClienteApi({ ...comun, base: '/api/admin' }).pedir<Registro>(
    'POST',
    '/organizaciones',
    { cuerpo: { nombre } },
  )
  const organizacion = String(org.id)
  const { datos: creada } = await new ClienteApi(comun).pedir<Registro>('POST', '/claves', {
    cuerpo: { nombre: 'CLI', modo: 'test', scopes: PERMISOS_DE_CLAVE },
    headers: { 'X-Organizacion': organizacion },
  })
  const clave = String(creada.clave)

  const config = leerConfig(ctx.ent.env)
  config.perfiles[ctx.cfg.perfil] = { url: ctx.cfg.url, apiKey: clave }
  const ruta = guardarConfig(ctx.ent.env, config)

  mostrar(ctx, { organizacion: org, clave: { ...creada, clave: enmascarar(clave) } }, () =>
    [
      `Organización creada en ${ctx.cfg.url}`,
      fichas([
        ['Organización', `${org.nombre} (${organizacion})`],
        ['Clave de pruebas', enmascarar(clave)],
        ['Perfil', ctx.cfg.perfil],
        ['Guardado en', ruta],
      ]),
      '',
      'Siguiente: registra el emisor y sus credenciales del MH con ADMIN_TOKEN y',
      `X-Organizacion: ${organizacion} (ver docs.openfactura.co/autoalojamiento).`,
    ].join('\n'),
  )
  return undefined
}

async function logout(ctx: Contexto): Promise<undefined> {
  const config = leerConfig(ctx.ent.env)
  const habia = ctx.cfg.perfil in config.perfiles
  if (habia) {
    delete config.perfiles[ctx.cfg.perfil]
    guardarConfig(ctx.ent.env, config)
  }
  mostrar(ctx, { perfil: ctx.cfg.perfil, eliminado: habia }, () =>
    habia
      ? `Sesión cerrada: se borró la clave del perfil «${ctx.cfg.perfil}» (${rutaConfig(ctx.ent.env)}).`
      : `No había una sesión guardada en el perfil «${ctx.cfg.perfil}».`,
  )
  if (ctx.ent.env.OPENFACTURA_API_KEY) {
    ctx.ent.stderr('Aviso: OPENFACTURA_API_KEY sigue definida en el entorno.')
  }
  return undefined
}

async function whoami(ctx: Contexto): Promise<undefined> {
  const { datos } = await ctx.api().pedir<Registro>('GET', '/yo')
  const usuario = datos.usuario as { nombre?: string; correo?: string } | null
  mostrar(ctx, datos, () =>
    fichas([
      ['Actor', datos.actor],
      ['Usuario', usuario ? `${usuario.nombre} <${usuario.correo}>` : null],
      ['Rol', datos.rol],
      ['Organización', datos.organizationId],
      [
        'Ambiente',
        `${nombreAmbiente(datos.ambiente)}${datos.simulador ? ' (simulador del MH)' : ''}`,
      ],
      ['Servidor', `${ctx.cfg.url} (${ctx.cfg.origenUrl})`],
      [
        'Actuando como',
        ctx.cfg.cliente ? `${ctx.cfg.cliente.nombre} (openfactura usar --yo para volver)` : null,
      ],
      ['Clave', `${enmascarar(ctx.cfg.apiKey as string)} (${ctx.cfg.origenClave})`],
      ['Perfil', ctx.cfg.perfil],
      ['Permisos', Array.isArray(datos.permisos) ? datos.permisos.join(', ') : null],
    ]),
  )
  return undefined
}

// ───────────────────────────── emisor y catálogos ─────────────────────────────

async function emisor(ctx: Contexto): Promise<undefined> {
  const { datos } = await ctx.api().pedir<Registro>('GET', '/emisor')
  mostrar(ctx, datos, () => {
    const e = datos.emisor as Registro | null
    if (!e) return 'El emisor aún no está configurado. Completa sus datos en el panel web.'
    const establecimientos = (datos.establecimientos ?? []) as Array<
      Registro & { puntosVenta?: Registro[] }
    >
    const credenciales = (datos.credenciales ?? {}) as Record<string, Registro>
    return [
      fichas([
        ['Nombre', e.nombre],
        ['Nombre comercial', e.nombreComercial],
        ['NIT', e.nit],
        ['NRC', e.nrc],
        ['Actividad', `${e.codActividad} ${e.descActividad}`],
        [
          'Dirección',
          `${e.complemento} (depto. ${e.departamento}, mun. ${e.municipio}, dist. ${e.distrito})`,
        ],
        ['Teléfono', e.telefono],
        ['Correo', e.correo],
        ['Ambiente activo', nombreAmbiente(datos.ambienteActivo)],
      ]),
      '',
      'Establecimientos',
      tabla(
        ['código', 'nombre', 'tipo', 'puntos de venta'],
        establecimientos.map((est) => [
          est.codMh,
          est.nombre,
          est.tipo,
          (est.puntosVenta ?? []).map((pv) => `${pv.codMh} ${pv.nombre}`).join(', '),
        ]),
      ),
      '',
      'Credenciales del MH',
      tabla(
        ['ambiente', 'contraseña api', 'certificado', 'nit del certificado'],
        Object.entries(credenciales).map(([ambiente, c]) => [
          nombreAmbiente(ambiente),
          siNo(c.apiPassword),
          siNo(c.certificado),
          c.certificadoNit,
        ]),
      ),
    ].join('\n')
  })
  return undefined
}

async function catalogos(ctx: Contexto): Promise<undefined> {
  const id = ctx.args[0]
  if (!id) {
    if (ctx.op('q') !== undefined || ctx.op('departamento') !== undefined) {
      throw new ErrorUso(
        '--q y --departamento requieren el id del catálogo, por ejemplo: openfactura catalogos CAT-013 --departamento 06',
      )
    }
    const { datos } = await ctx.api().pedir<Registro[]>('GET', '/catalogos')
    mostrar(ctx, datos, () =>
      tabla(
        ['id', 'nombre', 'valores'],
        datos.map((c) => [c.id, c.nombre, c.total]),
        [2],
      ),
    )
    return undefined
  }
  const { datos } = await ctx
    .api()
    .pedir<Registro & { valores: Registro[] }>('GET', `/catalogos/${segmento(id.toUpperCase())}`, {
      query: { q: ctx.op('q'), departamento: ctx.op('departamento') },
    })
  mostrar(ctx, datos, () => {
    const conDepartamento = datos.valores.some((v) => v.departamento)
    const filas = datos.valores.map((v) =>
      conDepartamento ? [v.codigo, v.valor, v.departamento] : [v.codigo, v.valor],
    )
    return [
      `${datos.id} ${datos.nombre} — ${datos.valores.length} de ${datos.total} valores`,
      tabla(conDepartamento ? ['código', 'valor', 'departamento'] : ['código', 'valor'], filas),
    ].join('\n')
  })
  return undefined
}

// ───────────────────────────── clientes y productos ─────────────────────────────

async function clientesList(ctx: Contexto): Promise<undefined> {
  const { datos } = await ctx
    .api()
    .pedir<Registro[]>('GET', '/clientes', { query: { q: ctx.op('q') } })
  mostrar(ctx, datos, () =>
    datos.length
      ? tabla(
          ['id', 'doc', 'número', 'nombre', 'nrc', 'correo'],
          datos.map((c) => [c.id, c.tipoDocumento, c.numDocumento, c.nombre, c.nrc, c.correo]),
        )
      : 'No hay clientes.',
  )
  return undefined
}

async function clientesAdd(ctx: Contexto): Promise<undefined> {
  const cuerpo = await cuerpoDeAlta(ctx, CAMPOS_CLIENTE)
  const { datos } = await ctx.api().pedir<Registro>('POST', '/clientes', { cuerpo })
  mostrar(ctx, datos, () =>
    [
      'Cliente creado.',
      fichas([
        ['Id', datos.id],
        ['Documento', `${datos.tipoDocumento} ${datos.numDocumento}`],
        ['Nombre', datos.nombre],
        ['NRC', datos.nrc],
        ['Correo', datos.correo],
      ]),
    ].join('\n'),
  )
  return undefined
}

async function productosList(ctx: Contexto): Promise<undefined> {
  const { datos } = await ctx
    .api()
    .pedir<Registro[]>('GET', '/productos', { query: { q: ctx.op('q') } })
  mostrar(ctx, datos, () =>
    datos.length
      ? tabla(
          ['id', 'código', 'descripción', 'precio sin iva', 'ítem', 'unidad', 'venta'],
          datos.map((p) => [
            p.id,
            p.codigo,
            p.descripcion,
            dinero(p.precioUnitario),
            p.tipoItem,
            p.uniMedida,
            p.tipoVenta,
          ]),
          [3],
        )
      : 'No hay productos.',
  )
  return undefined
}

async function productosAdd(ctx: Contexto): Promise<undefined> {
  const cuerpo = await cuerpoDeAlta(ctx, CAMPOS_PRODUCTO, ['precio', 'tipo-item', 'uni-medida'])
  const { datos } = await ctx.api().pedir<Registro>('POST', '/productos', { cuerpo })
  mostrar(ctx, datos, () =>
    [
      'Producto creado.',
      fichas([
        ['Id', datos.id],
        ['Código', datos.codigo],
        ['Descripción', datos.descripcion],
        ['Precio sin IVA', dinero(datos.precioUnitario)],
        ['Tipo de venta', datos.tipoVenta],
      ]),
    ].join('\n'),
  )
  return undefined
}

// ───────────────────────────── DTE ─────────────────────────────

async function dteValidar(ctx: Contexto): Promise<number> {
  const cuerpo = await leerEmision(ctx, ctx.args[0] as string)
  const { datos } = await ctx
    .api()
    .pedir<Registro & { problemas?: Registro[] }>('POST', '/dte/validar', { cuerpo })
  const problemas = datos.problemas ?? []
  mostrar(ctx, datos, () => {
    const resumen = ((datos.dte as Registro | null)?.resumen ?? {}) as Registro
    const numero = (campo: string) =>
      typeof resumen[campo] === 'number' ? dinero(resumen[campo]) : null
    return [
      fichas([
        ['Tipo', nombreTipo(cuerpo.tipoDte)],
        ['Receptor', datos.receptorNombre],
        ['Gravado', numero('totalGravada')],
        ['Exento', numero('totalExenta')],
        ['No sujeto', numero('totalNoSuj')],
        ['IVA', numero('totalIva')],
        ['Total', dinero(datos.total)],
        ['En letras', resumen.totalLetras],
      ]),
      '',
      problemas.length
        ? [
            `${problemas.length} problema(s):`,
            ...problemas.map((p) => `  ${p.ruta}: ${p.mensaje}`),
          ].join('\n')
        : 'Válido: cumple el esquema del MH. No se emitió nada.',
    ].join('\n')
  })
  return problemas.length ? SALIDA.error : SALIDA.ok
}

/**
 * Envía una operación con efecto fiscal una sola vez: genera (o usa) la Idempotency-Key, la
 * muestra antes de enviar y, si la red falla, indica cómo reintentar sin duplicar.
 */
async function enviarUnaVez<T>(
  ctx: Contexto,
  ruta: string,
  cuerpo: unknown,
  qué: string,
  reintento: string,
  stdin = false,
) {
  const api = ctx.api()
  const clave = ctx.op('idempotency-key') ?? randomUUID()
  if (clave.length < 1 || clave.length > 200)
    throw new ErrorUso('--idempotency-key debe tener entre 1 y 200 caracteres.')
  await confirmar(ctx, qué, stdin)

  // Se informa antes de enviar: si la red falla, el reintento debe reutilizarla.
  ctx.ent.stderr(`Idempotency-Key: ${clave}`)
  try {
    const respuesta = await api.pedir<T>('POST', ruta, {
      cuerpo,
      headers: { 'Idempotency-Key': clave },
    })
    if (respuesta.headers.get('Idempotent-Replayed') === 'true') {
      ctx.ent.stderr(
        'Respuesta repetida: esta Idempotency-Key ya se había usado; no se transmitió de nuevo.',
      )
    }
    return respuesta.datos
  } catch (error) {
    if (
      error instanceof ErrorCli &&
      (error.code === 'sin_conexion' || error.code === 'tiempo_agotado')
    ) {
      ctx.ent.stderr(
        `No se sabe si se transmitió. Reintenta con la misma clave para no duplicarlo:\n  openfactura ${reintento} --idempotency-key ${clave}`,
      )
    }
    throw error
  }
}

async function dteEmitir(ctx: Contexto): Promise<undefined> {
  const origen = ctx.args[0] as string
  const cuerpo = await leerEmision(ctx, origen)
  const doc = await enviarUnaVez<Documento>(
    ctx,
    '/dte',
    cuerpo,
    `emitir un DTE (${nombreTipo(cuerpo.tipoDte)})`,
    `dte emitir ${origen}`,
    origen === '-',
  )
  if (doc.estado === 'contingencia') {
    ctx.ent.stderr(
      'El MH no respondió: el DTE quedó firmado en contingencia. Transmítelo con `openfactura contingencia transmitir`.',
    )
  }
  mostrar(ctx, doc, () => fichaDocumento(doc))
  return undefined
}

async function dteList(ctx: Contexto): Promise<undefined> {
  const estado = ctx.op('estado')
  if (estado !== undefined && !(ESTADOS_DTE as readonly string[]).includes(estado)) {
    throw new ErrorUso(`--estado debe ser uno de: ${ESTADOS_DTE.join(', ')}`)
  }
  for (const opcion of ['desde', 'hasta']) {
    const valor = ctx.op(opcion)
    if (valor !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(valor))
      throw new ErrorUso(`--${opcion} debe tener el formato AAAA-MM-DD`)
  }
  const { datos } = await ctx.api().pedir<Registro & { items: Documento[] }>('GET', '/dte', {
    query: {
      tipo: ctx.op('tipo'),
      estado,
      q: ctx.op('q'),
      desde: ctx.op('desde'),
      hasta: ctx.op('hasta'),
      pagina: entero(ctx, 'pagina'),
    },
  })
  mostrar(ctx, datos, () =>
    [
      datos.items.length
        ? tabla(
            [
              'fecha',
              'tipo',
              'número de control',
              'estado',
              'receptor',
              'total',
              'código de generación',
            ],
            datos.items.map((d) => [
              d.fechaEmision,
              d.tipoDte,
              d.numeroControl,
              d.estado,
              d.receptorNombre,
              dinero(d.total),
              d.codigoGeneracion,
            ]),
            [5],
          )
        : 'No hay documentos.',
      `Página ${datos.pagina} · ${datos.items.length} de ${datos.total} documento(s) · ambiente ${nombreAmbiente(datos.ambiente)}`,
    ].join('\n'),
  )
  return undefined
}

async function dteGet(ctx: Contexto): Promise<undefined> {
  const { datos } = await ctx
    .api()
    .pedir<Documento>('GET', `/dte/${segmento(ctx.args[0] as string)}`)
  mostrar(ctx, datos, () => {
    const mh = datos.respuestaMh as Registro | null
    const eventos = (datos.eventos ?? []) as Registro[]
    const observaciones = Array.isArray(mh?.observaciones) ? mh.observaciones.join('; ') : null
    return [
      fichaDocumento(datos),
      ...(mh
        ? [
            '',
            'Respuesta del MH',
            fichas([
              ['Estado', mh.estado],
              ['Mensaje', `${mh.codigoMsg ?? ''} ${mh.descripcionMsg ?? ''}`.trim()],
              ['Procesado', mh.fhProcesamiento],
              ['Observaciones', observaciones],
            ]),
          ]
        : []),
      ...(eventos.length
        ? [
            '',
            'Eventos',
            tabla(
              ['tipo', 'estado', 'fecha (UTC)', 'código de generación', 'sello'],
              eventos.map((e) => [
                e.tipo,
                e.estado,
                fecha(e.creado),
                e.codigoGeneracion,
                e.selloRecibido,
              ]),
            ),
          ]
        : []),
    ].join('\n')
  })
  return undefined
}

async function dteJson(ctx: Contexto): Promise<undefined> {
  const { datos } = await ctx.api().pedir('GET', `/dte/${segmento(ctx.args[0] as string)}/json`)
  const texto = JSON.stringify(datos, null, 2)
  const salida = ctx.op('output')
  if (salida === undefined) {
    ctx.ent.stdout(texto)
    return undefined
  }
  const destino = resolve(ctx.ent.cwd, salida)
  await writeFile(destino, `${texto}\n`)
  mostrar(ctx, { archivo: destino }, () => `JSON guardado en ${destino}`)
  return undefined
}

async function dtePdf(ctx: Contexto): Promise<undefined> {
  const codigo = ctx.args[0] as string
  const bytes = await ctx.api().descargar(`/dte/${segmento(codigo)}/pdf`)
  // basename: el código nunca debe sacar el archivo del directorio actual.
  const destino = resolve(ctx.ent.cwd, ctx.op('output') ?? `${basename(codigo)}.pdf`)
  await writeFile(destino, bytes)
  mostrar(
    ctx,
    { archivo: destino, bytes: bytes.length },
    () => `PDF guardado en ${destino} (${bytes.length} bytes)`,
  )
  return undefined
}

async function dteInvalidar(ctx: Contexto): Promise<undefined> {
  const codigo = ctx.args[0] as string
  const tipo = ctx.op('tipo')
  if (tipo !== '1' && tipo !== '2' && tipo !== '3') {
    throw new ErrorUso(
      'Indica --tipo 1|2|3 (1 error en la información, 2 rescindir la operación, 3 otro).',
    )
  }
  const cuerpo: Registro = { tipoAnulacion: Number(tipo) }
  if (ctx.op('motivo') !== undefined) cuerpo.motivoAnulacion = ctx.op('motivo')
  if (ctx.op('reemplazo') !== undefined) cuerpo.codigoGeneracionReemplazo = ctx.op('reemplazo')
  const api = ctx.api()
  await confirmar(ctx, `invalidar el DTE ${codigo} (irreversible)`)
  const { datos } = await api.pedir<Documento>('POST', `/dte/${segmento(codigo)}/invalidar`, {
    cuerpo,
  })
  mostrar(ctx, datos, () => `DTE invalidado.\n${fichaDocumento(datos)}`)
  return undefined
}

// --- Eventos de retorno (18) y operaciones especiales (17) -------------------

const TIPOS_EVENTO = ['retorno', 'operaciones_especiales']

function fichaEvento(e: Registro): string {
  return fichas([
    [
      'Evento',
      e.tipoEvento === '18'
        ? '18 Retorno'
        : e.tipoEvento === '17'
          ? '17 Operaciones especiales'
          : e.tipo,
    ],
    ['Estado', e.estado],
    ['Código de generación', e.codigoGeneracion],
    ['Ambiente', nombreAmbiente(e.ambiente as string)],
    ['Sello recibido', e.selloRecibido],
  ])
}

async function leerObjeto(ctx: Contexto, origen: string, forma: string): Promise<Registro> {
  const cuerpo = await leerJson(ctx, origen)
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo) || !('items' in cuerpo)) {
    throw new ErrorUso(`El archivo debe ser un objeto ${forma}`)
  }
  return cuerpo as Registro
}

async function dteRetorno(ctx: Contexto): Promise<undefined> {
  const [codigo, origen] = ctx.args as [string, string]
  const cuerpo = await leerObjeto(
    ctx,
    origen,
    '{ "items": [{ "descripcion", "cantidad", "precioUni" }] }',
  )
  const evento = await enviarUnaVez<Registro>(
    ctx,
    `/dte/${segmento(codigo)}/retorno`,
    cuerpo,
    `registrar un retorno sobre el DTE ${codigo}`,
    `dte retorno ${codigo} ${origen}`,
    origen === '-',
  )
  mostrar(ctx, evento, () => `Retorno registrado.\n${fichaEvento(evento)}`)
  return undefined
}

async function eventosOperacionesEspeciales(ctx: Contexto): Promise<undefined> {
  const origen = ctx.args[0] as string
  const cuerpo = await leerObjeto(
    ctx,
    origen,
    '{ "tipoDocumento": "02" | "97", "fecha"?, "items": [{ "descripcion", "precioUni", "docDel", "docAl" }] }',
  )
  const evento = await enviarUnaVez<Registro>(
    ctx,
    '/eventos/operaciones-especiales',
    cuerpo,
    'informar operaciones especiales',
    `eventos operaciones-especiales ${origen}`,
    origen === '-',
  )
  mostrar(ctx, evento, () => `Operaciones especiales informadas.\n${fichaEvento(evento)}`)
  return undefined
}

async function eventosList(ctx: Contexto): Promise<undefined> {
  const tipo = ctx.op('tipo')
  if (tipo !== undefined && !TIPOS_EVENTO.includes(tipo)) {
    throw new ErrorUso(`--tipo debe ser uno de: ${TIPOS_EVENTO.join(', ')}`)
  }
  const { datos } = await ctx.api().pedir<Registro[]>('GET', '/eventos', { query: { tipo } })
  mostrar(ctx, datos, () =>
    datos.length
      ? tabla(
          ['creado', 'evento', 'estado', 'código de generación'],
          datos.map((e) => [
            new Date(e.creado as number).toISOString().slice(0, 10),
            e.tipoEvento,
            e.estado,
            e.codigoGeneracion,
          ]),
        )
      : 'No hay eventos.',
  )
  return undefined
}

async function eventosGet(ctx: Contexto): Promise<undefined> {
  const { datos } = await ctx
    .api()
    .pedir<Registro>('GET', `/eventos/${segmento(ctx.args[0] as string)}`)
  mostrar(ctx, datos, () => fichaEvento(datos))
  return undefined
}

async function eventosJson(ctx: Contexto): Promise<undefined> {
  const codigo = ctx.args[0] as string
  const { datos } = await ctx.api().pedir('GET', `/eventos/${segmento(codigo)}/json`)
  const texto = JSON.stringify(datos, null, 2)
  const salida = ctx.op('output')
  if (salida === undefined) {
    ctx.ent.stdout(texto)
    return undefined
  }
  const destino = resolve(ctx.ent.cwd, salida)
  await writeFile(destino, `${texto}\n`)
  mostrar(ctx, { archivo: destino }, () => `JSON guardado en ${destino}`)
  return undefined
}

async function eventosPdf(ctx: Contexto): Promise<undefined> {
  const codigo = ctx.args[0] as string
  const bytes = await ctx.api().descargar(`/eventos/${segmento(codigo)}/pdf`)
  const destino = resolve(ctx.ent.cwd, ctx.op('output') ?? `${basename(codigo)}.pdf`)
  await writeFile(destino, bytes)
  mostrar(
    ctx,
    { archivo: destino, bytes: bytes.length },
    () => `PDF guardado en ${destino} (${bytes.length} bytes)`,
  )
  return undefined
}

async function contingenciaTransmitir(ctx: Contexto): Promise<undefined> {
  const api = ctx.api()
  await confirmar(ctx, 'transmitir los DTE en contingencia')
  const { datos } = await api.pedir<Registro>('POST', '/contingencia/transmitir')
  mostrar(ctx, datos, () => {
    const procesados = (datos.procesados ?? []) as unknown[]
    const rechazados = (datos.rechazados ?? []) as unknown[]
    if (!datos.evento && !procesados.length && !rechazados.length)
      return 'No hay documentos en contingencia.'
    const linea = (d: unknown) => `  ${typeof d === 'string' ? d : JSON.stringify(d)}`
    return [
      fichas([
        ['Procesados', procesados.length],
        ['Rechazados', rechazados.length],
        ['Restantes', datos.restantes],
      ]),
      ...(rechazados.length ? ['', 'Rechazados:', ...rechazados.map(linea)] : []),
    ].join('\n')
  })
  return undefined
}

// ───────────────────────────── certificación ─────────────────────────────

interface Certificacion extends Registro {
  estado: string
  disponible: boolean
  requisitos: { simuladas: boolean }
  metas: Array<{ nombre: string; meta: number; hechas: number }>
  ultimoError: {
    operacion: string
    codigo: string
    mensaje: string
    observaciones?: string[]
  } | null
  operaciones?: unknown[]
  aviso?: string | null
}

const ESTADO_CERTIFICACION: Record<string, string> = {
  sin_iniciar: 'Sin iniciar',
  en_curso: 'En curso',
  detenida: 'Detenida por un rechazo del MH',
  completa: 'Completa',
}

function fichaCertificacion(c: Certificacion): string {
  const error = c.ultimoError
  return [
    fichas([
      ['Estado', ESTADO_CERTIFICACION[c.estado] ?? c.estado],
      ...c.metas.map((m): [string, unknown] => [m.nombre, `${m.hechas} de ${m.meta}`]),
    ]),
    ...(c.requisitos.simuladas
      ? ['', 'Simulacro: las credenciales son del simulador y nada llega a Hacienda.']
      : []),
    ...(error
      ? [
          '',
          `Último rechazo (${error.operacion}): ${error.codigo} ${error.mensaje}`,
          ...(error.observaciones ?? []).map((o) => `  ${o}`),
        ]
      : []),
  ].join('\n')
}

const lineaAvance = (c: Certificacion) =>
  c.metas.map((m) => `${m.nombre.split(' ').pop()} ${m.hechas}/${m.meta}`).join(' · ')

async function certificacionEstado(ctx: Contexto): Promise<undefined> {
  const { datos } = await ctx.api().pedir<Certificacion>('GET', '/ext/certificacion')
  mostrar(ctx, datos, () => fichaCertificacion(datos))
  return undefined
}

/** Llamadas seguidas en las que el MH no respondió antes de rendirse; se retoma al volver a ejecutar. */
const MAX_SIN_RESPUESTA = 3

async function certificacionEjecutar(ctx: Contexto): Promise<number | undefined> {
  const api = ctx.api()
  const cliente = ctx.op('cliente')
  let { datos } = await api.pedir<Certificacion>('POST', '/ext/certificacion/iniciar', {
    cuerpo: {
      ...(cliente ? { clienteCcfId: cliente } : {}),
      ...(ctx.bandera('completo') ? { alcance: 'completo' } : {}),
      desdeCero: ctx.bandera('desde-cero'),
    },
  })
  let sinRespuesta = 0
  while (datos.estado === 'en_curso' || datos.estado === 'detenida') {
    ;({ datos } = await api.pedir<Certificacion>('POST', '/ext/certificacion/avanzar'))
    ctx.ent.stderr(lineaAvance(datos))
    if (datos.estado === 'detenida') break
    if (datos.aviso) {
      ctx.ent.stderr(`Aviso: ${datos.aviso}`)
      if (++sinRespuesta >= MAX_SIN_RESPUESTA) break
    } else sinRespuesta = 0
  }
  mostrar(ctx, datos, () => fichaCertificacion(datos))
  return datos.estado === 'completa' ? undefined : 1
}

// ───────────────────────────── webhooks ─────────────────────────────

function fichaWebhook(w: Registro): string {
  return fichas([
    ['Id', w.id],
    ['URL', w.url],
    ['Descripción', w.descripcion],
    ['Eventos', Array.isArray(w.eventos) ? w.eventos.join(', ') : null],
    ['Activo', siNo(w.activo)],
  ])
}

/** El secreto se imprime una sola vez: el servidor no lo vuelve a mostrar. */
function mostrarSecreto(ctx: Contexto, w: Registro, titulo: string): void {
  mostrar(ctx, w, () =>
    [
      titulo,
      fichaWebhook(w),
      '',
      `Secreto de firma: ${w.secreto}`,
      'Guárdalo ahora: no se vuelve a mostrar. Verifica con él la cabecera OpenFactura-Signature.',
    ].join('\n'),
  )
}

async function webhooksList(ctx: Contexto): Promise<undefined> {
  const { datos } = await ctx.api().pedir<Registro[]>('GET', '/webhooks')
  mostrar(ctx, datos, () =>
    datos.length
      ? tabla(
          ['id', 'url', 'eventos', 'activo', 'descripción'],
          datos.map((w) => [
            w.id,
            w.url,
            (w.eventos as string[]).join(', '),
            siNo(w.activo),
            w.descripcion,
          ]),
        )
      : 'No hay webhooks.',
  )
  return undefined
}

async function webhooksAdd(ctx: Contexto): Promise<undefined> {
  const texto = ctx.op('eventos')
  const eventos = texto
    ? texto
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
    : [...EVENTOS_WEBHOOK]
  const desconocido = eventos.find((e) => !(EVENTOS_WEBHOOK as readonly string[]).includes(e))
  if (desconocido || !eventos.length) {
    throw new ErrorUso(`--eventos acepta, separados por coma: ${EVENTOS_WEBHOOK.join(', ')}`)
  }
  const cuerpo: Registro = { url: ctx.args[0], eventos }
  if (ctx.op('descripcion') !== undefined) cuerpo.descripcion = ctx.op('descripcion')
  const { datos } = await ctx.api().pedir<Registro>('POST', '/webhooks', { cuerpo })
  mostrarSecreto(ctx, datos, 'Webhook creado.')
  return undefined
}

async function webhooksRemove(ctx: Contexto): Promise<undefined> {
  const id = ctx.args[0] as string
  const { datos } = await ctx.api().pedir<Registro>('DELETE', `/webhooks/${segmento(id)}`)
  mostrar(ctx, datos, () => `Webhook ${id} eliminado.`)
  return undefined
}

async function webhooksTest(ctx: Contexto): Promise<number> {
  const id = ctx.args[0] as string
  const { datos } = await ctx.api().pedir<Registro>('POST', `/webhooks/${segmento(id)}/probar`)
  mostrar(ctx, datos, () =>
    datos.entregado
      ? `Entregado: el destino respondió HTTP ${datos.status}.`
      : `No se entregó: ${datos.error ?? 'error desconocido'}.`,
  )
  return datos.entregado ? SALIDA.ok : SALIDA.error
}

async function webhooksDeliveries(ctx: Contexto): Promise<undefined> {
  const id = ctx.args[0] as string
  const { datos } = await ctx.api().pedir<Registro[]>('GET', `/webhooks/${segmento(id)}/entregas`)
  mostrar(ctx, datos, () =>
    datos.length
      ? tabla(
          [
            'creado (UTC)',
            'evento',
            'estado',
            'intentos',
            'http',
            'error',
            'próximo intento',
            'id',
          ],
          datos.map((e) => [
            fecha(e.creado),
            e.evento,
            e.estado,
            e.intentos,
            e.ultimoStatus,
            e.ultimoError,
            fecha(e.proximoIntento),
            e.id,
          ]),
          [3],
        )
      : 'Este webhook todavía no tiene entregas.',
  )
  return undefined
}

async function webhooksRotate(ctx: Contexto): Promise<undefined> {
  const id = ctx.args[0] as string
  const { datos } = await ctx
    .api()
    .pedir<Registro>('POST', `/webhooks/${segmento(id)}/rotar-secreto`)
  mostrarSecreto(ctx, datos, 'Secreto rotado: el anterior ya no firma.')
  return undefined
}

async function mcp(ctx: Contexto): Promise<undefined> {
  const api = ctx.api()
  ctx.ent.stderr(
    `openfactura mcp: servidor MCP por stdio → ${ctx.cfg.url} (clave ${enmascarar(ctx.cfg.apiKey as string)})`,
  )
  await servirMcp(api, ctx.version)
  return undefined
}

function fechaOpcion(ctx: Contexto, opcion: string): string | undefined {
  const valor = ctx.op(opcion)
  if (valor !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(valor))
    throw new ErrorUso(`--${opcion} debe tener el formato AAAA-MM-DD`)
  return valor
}

async function uso(ctx: Contexto): Promise<undefined> {
  const { datos } = await ctx
    .api()
    .pedir<
      Registro & { totales: Record<string, number>; dias: Array<Record<string, number | string>> }
    >('GET', '/uso', {
      query: { desde: fechaOpcion(ctx, 'desde'), hasta: fechaOpcion(ctx, 'hasta') },
    })
  mostrar(ctx, datos, () =>
    [
      `Del ${datos.desde} al ${datos.hasta} · ambiente ${nombreAmbiente(datos.ambiente)}`,
      fichas([
        ['Emitidos', datos.totales.emitidos],
        ['Procesados', datos.totales.procesados],
        ['Rechazados', datos.totales.rechazados],
        ['Monto procesado', dinero(datos.totales.monto)],
      ]),
      datos.dias.length
        ? tabla(
            ['fecha', 'emitidos', 'procesados', 'rechazados', 'monto'],
            datos.dias.map((d) => [
              d.fecha,
              d.emitidos,
              d.procesados,
              d.rechazados,
              dinero(d.monto as number),
            ]),
            [1, 2, 3, 4],
          )
        : 'No hay documentos en ese rango.',
    ].join('\n\n'),
  )
  return undefined
}

async function registrosList(ctx: Contexto): Promise<undefined> {
  const estado = ctx.op('estado')
  if (estado !== undefined && estado !== 'ok' && estado !== 'error')
    throw new ErrorUso('--estado debe ser ok o error')
  const origen = ctx.op('origen')
  if (origen !== undefined && origen !== 'api' && origen !== 'mcp')
    throw new ErrorUso('--origen debe ser api o mcp')
  const limite = entero(ctx, 'limite')
  if (limite !== undefined && limite > 200) throw new ErrorUso('--limite admite hasta 200')
  const { datos } = await ctx
    .api()
    .pedir<Array<Registro & { clave: Registro }>>('GET', '/registros', {
      query: { estado, origen, limite },
    })
  mostrar(ctx, datos, () =>
    datos.length
      ? tabla(
          ['fecha (UTC)', 'método', 'ruta', 'estado', 'ms', 'origen', 'clave'],
          datos.map((r) => [
            fecha(r.creado),
            r.metodo,
            r.ruta,
            r.estado,
            r.duracionMs,
            r.origen,
            r.clave.prefijo ? `${r.clave.prefijo}…` : r.clave.id,
          ]),
          [3, 4],
        )
      : 'No hay peticiones registradas en los últimos 30 días.',
  )
  return undefined
}

// ───────────────────────────── plataforma ─────────────────────────────
//
// Open Factura Cloud: quien desarrolla administra las empresas de sus clientes, cada una en su
// espacio aislado. `plataforma …` usa siempre TU clave (habilitada para Plataforma); `usar` crea
// una vez la clave de un cliente en su espacio y, desde ahí, todos los comandos actúan como él.

interface ClientePlataforma extends Registro {
  id: string
  nombre: string
  externalId: string | null
  estado: string
  preparacion: string | null
  falta: string | null
  organizationId: string | null
}

const NOMBRE_PREPARACION: Record<string, string> = {
  conectado: 'conectado',
  pruebas: 'listo en pruebas',
  produccion: 'en producción',
}

/** Un cliente por su id, tu externalId o su nombre exacto (sin distinguir mayúsculas). */
async function buscarCliente(ctx: Contexto, ref: string): Promise<ClientePlataforma> {
  const { datos } = await ctx.apiPlataforma().pedir<ClientePlataforma[]>('GET', '/clientes')
  const porId = datos.find((c) => c.id === ref || c.externalId === ref)
  if (porId) return porId
  const porNombre = datos.filter((c) => c.nombre.toLowerCase() === ref.toLowerCase())
  if (porNombre.length === 1) return porNombre[0] as ClientePlataforma
  if (porNombre.length > 1) {
    throw new ErrorUso(
      `Hay ${porNombre.length} clientes llamados «${ref}». Usa su id: ${porNombre.map((c) => c.id).join(', ')}`,
    )
  }
  throw new ErrorCli(
    `No encontré el cliente «${ref}». Revisa con \`openfactura plataforma list\`.`,
    'no_encontrado',
  )
}

async function plataformaList(ctx: Contexto): Promise<undefined> {
  const estado = ctx.op('estado')
  const { datos } = await ctx
    .apiPlataforma()
    .pedir<ClientePlataforma[]>('GET', '/clientes', { query: { estado } })
  mostrar(ctx, datos, () =>
    datos.length
      ? tabla(
          ['', 'id', 'cliente', 'estado', 'le falta'],
          datos.map((c) => [
            ctx.cfg.cliente?.id === c.id ? '→' : '',
            c.externalId ?? c.id,
            c.nombre,
            c.estado === 'activo'
              ? (NOMBRE_PREPARACION[c.preparacion ?? ''] ?? 'activo')
              : c.estado,
            c.falta ?? '',
          ]),
        )
      : 'Todavía no tienes clientes. Agrega uno con `openfactura plataforma add "<nombre>"`.',
  )
  return undefined
}

async function plataformaAdd(ctx: Contexto): Promise<undefined> {
  const nombre = ctx.args[0] as string
  const datos = Object.fromEntries(
    (
      [
        ['nit', ctx.op('nit')],
        ['nrc', ctx.op('nrc')],
        ['razonSocial', ctx.op('razon-social')],
        ['correo', ctx.op('correo')],
        ['telefono', ctx.op('telefono')],
      ] as const
    ).filter(([, v]) => v),
  )
  const { datos: creado } = await ctx
    .apiPlataforma()
    .pedir<ClientePlataforma>('POST', '/clientes', {
      cuerpo: {
        nombre,
        ...(ctx.op('external-id') ? { externalId: ctx.op('external-id') } : {}),
        ...(Object.keys(datos).length ? { datos } : {}),
      },
    })
  mostrar(ctx, creado, () =>
    [
      `Cliente creado: ${creado.nombre} (${creado.id})`,
      '',
      'Siguientes pasos:',
      `  openfactura usar ${creado.externalId ?? creado.id}        # configúralo y emite por él (en pruebas)`,
      `  openfactura plataforma enlace ${creado.externalId ?? creado.id}  # su enlace para activar la cuenta`,
    ].join('\n'),
  )
  return undefined
}

async function plataformaEnlace(ctx: Contexto): Promise<undefined> {
  const cliente = await buscarCliente(ctx, ctx.args[0] as string)
  const horas = ctx.op('horas')
  const { datos } = await ctx
    .apiPlataforma()
    .pedir<{ url: string; expira: number }>('POST', `/clientes/${segmento(cliente.id)}/enlace`, {
      cuerpo: horas ? { expiraEnHoras: Number(horas) } : {},
    })
  mostrar(ctx, datos, () =>
    [
      `Enlace de alta de ${cliente.nombre} (un solo uso, vence ${fecha(datos.expira)}):`,
      datos.url,
    ].join('\n'),
  )
  return undefined
}

/** Crea una clave en el espacio del cliente. */
async function claveDeCliente(ctx: Contexto, cliente: ClientePlataforma, nombre: string) {
  const live = ctx.bandera('live')
  if (live && !ctx.si) {
    if (!ctx.ent.esTTY) {
      throw new ErrorUso(
        `Vas a crear una clave de PRODUCCIÓN para ${cliente.nombre} y no hay una terminal para confirmar: agrega --yes.`,
      )
    }
    const respuesta = await ctx.ent.preguntar(
      `Vas a crear una clave de PRODUCCIÓN (of_live_) para ${cliente.nombre}: emite DTE reales. ¿Continuar? [s/N] `,
    )
    if (!/^(s|si|sí|y|yes)$/i.test(respuesta.trim()))
      throw new ErrorCli('Operación cancelada.', 'cancelado')
  }
  const { datos } = await ctx
    .apiPlataforma()
    .pedir<Registro & { clave: string }>('POST', `/clientes/${segmento(cliente.id)}/claves`, {
      cuerpo: { nombre, modo: live ? 'live' : 'test', scopes: PERMISOS_DE_CLAVE },
    })
  return datos
}

async function plataformaClave(ctx: Contexto): Promise<undefined> {
  const cliente = await buscarCliente(ctx, ctx.args[0] as string)
  const datos = await claveDeCliente(
    ctx,
    cliente,
    ctx.op('nombre') ?? `Sistema de ${cliente.nombre}`,
  )
  mostrar(ctx, datos, () =>
    [
      `Clave para ${cliente.nombre} (sólo se muestra esta vez; guárdala en su sistema):`,
      datos.clave,
    ].join('\n'),
  )
  return undefined
}

async function usar(ctx: Contexto): Promise<undefined> {
  const config = leerConfig(ctx.ent.env)
  const perfil = config.perfiles[ctx.cfg.perfil] ?? {}
  if (ctx.bandera('yo')) {
    delete perfil.usando
    config.perfiles[ctx.cfg.perfil] = perfil
    guardarConfig(ctx.ent.env, config)
    mostrar(ctx, { usando: null }, () => 'De vuelta en tu cuenta.')
    return undefined
  }
  const ref = ctx.args[0]
  if (!ref) {
    mostrar(ctx, { usando: ctx.cfg.cliente }, () =>
      ctx.cfg.cliente
        ? `Actúas como ${ctx.cfg.cliente.nombre} (${ctx.cfg.cliente.id}). Vuelve con \`openfactura usar --yo\`.`
        : 'Actúas con tu propia cuenta. Elige un cliente con `openfactura usar <cliente>`.',
    )
    return undefined
  }
  if (ctx.ent.env.OPENFACTURA_API_KEY) {
    throw new ErrorUso(
      'OPENFACTURA_API_KEY está definida y manda sobre el cliente en uso: quítala para usar un cliente.',
    )
  }
  const cliente = await buscarCliente(ctx, ref)
  if (cliente.estado === 'desactivado') {
    throw new ErrorCli(
      `${cliente.nombre} está desactivado: ya no administras su cuenta.`,
      'cliente_no_activo',
    )
  }
  const clientes = perfil.clientes ?? {}
  const guardada = clientes[cliente.id]
  // Una clave por cliente, creada una sola vez (o de nuevo con --live si la guardada es de pruebas).
  const necesitaNueva = !guardada || (ctx.bandera('live') && !esClaveDeProduccion(guardada.apiKey))
  const apiKey = necesitaNueva
    ? (await claveDeCliente(ctx, cliente, 'CLI (openfactura usar)')).clave
    : guardada.apiKey
  clientes[cliente.id] = { nombre: cliente.nombre, apiKey }
  config.perfiles[ctx.cfg.perfil] = { ...perfil, clientes, usando: cliente.id }
  const ruta = guardarConfig(ctx.ent.env, config)
  mostrar(ctx, { usando: { id: cliente.id, nombre: cliente.nombre } }, () =>
    [
      `Ahora actúas como ${cliente.nombre}: emitir, documentos, webhooks… van a su espacio.`,
      fichas([
        [
          'Clave',
          `${enmascarar(apiKey)}${esClaveDeProduccion(apiKey) ? ' (PRODUCCIÓN)' : ' (pruebas)'}`,
        ],
        ['Guardada en', ruta],
        ['Volver', 'openfactura usar --yo'],
      ]),
    ].join('\n'),
  )
  return undefined
}

export const GRUPOS: Record<string, string> = {
  clientes: 'Clientes guardados',
  productos: 'Productos y servicios guardados',
  dte: 'Documentos tributarios electrónicos',
  eventos: 'Eventos de retorno (18) y de operaciones especiales (17)',
  contingencia: 'Documentos emitidos en contingencia',
  certificacion: 'Pruebas mínimas ante Hacienda para autorizarse como emisor (Open Factura Cloud)',
  plataforma: 'Las empresas de tus clientes, cada una en su espacio (Open Factura Cloud)',
  webhooks: 'Notificaciones firmadas a tu sistema cuando cambia un documento',
  registros: 'Peticiones hechas con claves de API (últimos 30 días)',
  mcp: 'Servidor MCP por stdio y conexión con agentes de IA',
}

export const COMANDOS: Comando[] = [
  {
    nombre: 'login',
    uso: 'login [--url <url>] [--key <clave>]',
    resumen: 'Verifica una clave de API y la guarda',
    opciones: ['key'],
    args: [0, 0],
    accion: login,
  },
  {
    nombre: 'alta',
    uso: 'alta <empresa> [--url <url>] [--token <ADMIN_TOKEN>]',
    resumen: 'Instalación propia: crea la organización y una clave de API con el ADMIN_TOKEN',
    opciones: ['token'],
    args: [1, 1],
    accion: alta,
  },
  {
    nombre: 'logout',
    uso: 'logout',
    resumen: 'Borra la clave guardada del perfil',
    opciones: [],
    args: [0, 0],
    accion: logout,
  },
  {
    nombre: 'whoami',
    uso: 'whoami',
    resumen: 'Muestra el actor, sus permisos, el ambiente y el servidor',
    opciones: [],
    args: [0, 0],
    accion: whoami,
  },
  {
    nombre: 'emisor',
    uso: 'emisor',
    resumen: 'Datos del emisor, establecimientos y credenciales cargadas',
    opciones: [],
    args: [0, 0],
    accion: emisor,
  },
  {
    nombre: 'clientes list',
    uso: 'clientes list [--q <texto>]',
    resumen: 'Lista o busca clientes',
    opciones: ['q'],
    args: [0, 0],
    accion: clientesList,
  },
  {
    nombre: 'clientes add',
    uso: 'clientes add --file <cliente.json> | --tipo-documento <36|13|03|02|37> --num-documento <n> --nombre <nombre> […]',
    resumen: 'Crea un cliente',
    opciones: ['file', ...Object.keys(CAMPOS_CLIENTE)],
    args: [0, 0],
    accion: clientesAdd,
  },
  {
    nombre: 'productos list',
    uso: 'productos list [--q <texto>]',
    resumen: 'Lista o busca productos',
    opciones: ['q'],
    args: [0, 0],
    accion: productosList,
  },
  {
    nombre: 'productos add',
    uso: 'productos add --file <producto.json> | --codigo <c> --descripcion <d> --precio <sin IVA> […]',
    resumen: 'Crea un producto o servicio',
    opciones: ['file', ...Object.keys(CAMPOS_PRODUCTO)],
    args: [0, 0],
    accion: productosAdd,
  },
  {
    nombre: 'catalogos',
    uso: 'catalogos [<id>] [--q <texto>] [--departamento <06>]',
    resumen: 'Catálogos oficiales del MH (CAT-012, CAT-019…)',
    opciones: ['q', 'departamento'],
    args: [0, 1],
    accion: catalogos,
  },
  {
    nombre: 'dte validar',
    uso: 'dte validar <archivo.json | ->',
    resumen: 'Valida un DTE sin emitirlo (salida 1 si hay problemas)',
    opciones: [],
    args: [1, 1],
    accion: dteValidar,
  },
  {
    nombre: 'dte emitir',
    uso: 'dte emitir <archivo.json | -> [--idempotency-key <k>] [--yes]',
    resumen: 'Emite un DTE: lo firma y lo transmite al MH',
    opciones: ['idempotency-key', 'yes'],
    args: [1, 1],
    accion: dteEmitir,
  },
  {
    nombre: 'dte list',
    uso: 'dte list [--tipo <01>] [--estado <estado>] [--q <texto>] [--desde <AAAA-MM-DD>] [--hasta <AAAA-MM-DD>] [--pagina <n>]',
    resumen: 'Lista documentos, del más reciente al más antiguo',
    opciones: ['tipo', 'estado', 'q', 'desde', 'hasta', 'pagina'],
    args: [0, 0],
    accion: dteList,
  },
  {
    nombre: 'dte get',
    uso: 'dte get <codigoGeneracion>',
    resumen: 'Detalle de un documento',
    opciones: [],
    args: [1, 1],
    accion: dteGet,
  },
  {
    nombre: 'dte json',
    uso: 'dte json <codigoGeneracion> [-o <archivo.json>]',
    resumen: 'JSON oficial del DTE (firma y sello)',
    opciones: ['output'],
    args: [1, 1],
    accion: dteJson,
  },
  {
    nombre: 'dte pdf',
    uso: 'dte pdf <codigoGeneracion> [-o <archivo.pdf>]',
    resumen: 'Descarga la representación gráfica en PDF',
    opciones: ['output'],
    args: [1, 1],
    accion: dtePdf,
  },
  {
    nombre: 'dte invalidar',
    uso: 'dte invalidar <codigoGeneracion> --tipo <1|2|3> [--motivo <texto>] [--reemplazo <codigo>] [--yes]',
    resumen:
      'Invalida un DTE procesado, o un evento de retorno u operaciones especiales (irreversible)',
    opciones: ['tipo', 'motivo', 'reemplazo', 'yes'],
    args: [1, 1],
    accion: dteInvalidar,
  },
  {
    nombre: 'dte retorno',
    uso: 'dte retorno <codigoGeneracion> <archivo.json | -> [--idempotency-key <k>] [--yes]',
    resumen: 'Registra un retorno (evento 18) sobre una Factura, Exportación o Sujeto Excluido',
    opciones: ['idempotency-key', 'yes'],
    args: [2, 2],
    accion: dteRetorno,
  },
  {
    nombre: 'eventos operaciones-especiales',
    uso: 'eventos operaciones-especiales <archivo.json | -> [--idempotency-key <k>] [--yes]',
    resumen: 'Informa facturas simplificadas o comprobantes de control interno (evento 17)',
    opciones: ['idempotency-key', 'yes'],
    args: [1, 1],
    accion: eventosOperacionesEspeciales,
  },
  {
    nombre: 'eventos list',
    uso: 'eventos list [--tipo retorno|operaciones_especiales]',
    resumen: 'Lista los eventos de retorno y operaciones especiales',
    opciones: ['tipo'],
    args: [0, 0],
    accion: eventosList,
  },
  {
    nombre: 'eventos get',
    uso: 'eventos get <codigoGeneracion>',
    resumen: 'Muestra un evento',
    opciones: [],
    args: [1, 1],
    accion: eventosGet,
  },
  {
    nombre: 'eventos json',
    uso: 'eventos json <codigoGeneracion> [-o <archivo.json>]',
    resumen: 'Descarga el archivo JSON oficial del evento',
    opciones: ['output'],
    args: [1, 1],
    accion: eventosJson,
  },
  {
    nombre: 'eventos pdf',
    uso: 'eventos pdf <codigoGeneracion> [-o <archivo.pdf>]',
    resumen: 'Descarga la representación gráfica del evento',
    opciones: ['output'],
    args: [1, 1],
    accion: eventosPdf,
  },
  {
    nombre: 'contingencia transmitir',
    uso: 'contingencia transmitir [--yes]',
    resumen: 'Transmite al MH los DTE en contingencia',
    opciones: ['yes'],
    args: [0, 0],
    accion: contingenciaTransmitir,
  },
  {
    nombre: 'certificacion estado',
    uso: 'certificacion estado',
    resumen: 'Avance de las pruebas mínimas que exige Hacienda',
    opciones: [],
    args: [0, 0],
    accion: certificacionEstado,
  },
  {
    nombre: 'certificacion ejecutar',
    uso: 'certificacion ejecutar [--cliente <id>] [--completo] [--desde-cero]',
    resumen: 'Emite las pruebas mínimas en el ambiente de pruebas hasta completarlas',
    opciones: ['cliente', 'completo', 'desde-cero'],
    args: [0, 0],
    accion: certificacionEjecutar,
  },
  {
    nombre: 'plataforma list',
    uso: 'plataforma list [--estado <pendiente|activo|desactivado>]',
    resumen: 'Tus clientes, su estado y qué les falta (→ el que estás usando)',
    opciones: ['estado'],
    args: [0, 0],
    accion: plataformaList,
  },
  {
    nombre: 'plataforma add',
    uso: 'plataforma add <nombre> [--external-id <id>] [--nit <nit>] [--nrc <nrc>] [--razon-social <texto>] [--correo <correo>] [--telefono <tel>]',
    resumen: 'Agrega un cliente con su propio espacio (sus datos prellenan su alta)',
    opciones: ['external-id', 'nit', 'nrc', 'razon-social', 'correo', 'telefono'],
    args: [1, 1],
    accion: plataformaAdd,
  },
  {
    nombre: 'plataforma enlace',
    uso: 'plataforma enlace <cliente> [--horas <1-168>]',
    resumen: 'Enlace de un solo uso para que el cliente active su cuenta',
    opciones: ['horas'],
    args: [1, 1],
    accion: plataformaEnlace,
  },
  {
    nombre: 'plataforma clave',
    uso: 'plataforma clave <cliente> [--nombre <texto>] [--live]',
    resumen: 'Crea una clave para el sistema del cliente (sólo emite a su nombre)',
    opciones: ['nombre', 'live', 'yes'],
    args: [1, 1],
    accion: plataformaClave,
  },
  {
    nombre: 'usar',
    uso: 'usar [<cliente>] [--live] | usar --yo',
    resumen: 'Actúa como un cliente: los demás comandos van a su espacio (--yo para volver)',
    opciones: ['live', 'yo', 'yes'],
    args: [0, 1],
    accion: usar,
  },
  {
    nombre: 'webhooks list',
    uso: 'webhooks list',
    resumen: 'Lista los webhooks (sin su secreto)',
    opciones: [],
    args: [0, 0],
    accion: webhooksList,
  },
  {
    nombre: 'webhooks add',
    uso: 'webhooks add <https://url> [--eventos <e1,e2>] [--descripcion <texto>]',
    resumen: 'Crea un webhook y muestra su secreto de firma una sola vez',
    opciones: ['eventos', 'descripcion'],
    args: [1, 1],
    accion: webhooksAdd,
  },
  {
    nombre: 'webhooks remove',
    uso: 'webhooks remove <id>',
    resumen: 'Elimina un webhook y su historial de entregas',
    opciones: [],
    args: [1, 1],
    accion: webhooksRemove,
  },
  {
    nombre: 'webhooks test',
    uso: 'webhooks test <id>',
    resumen: 'Envía un evento webhook.prueba (salida 1 si no se entrega)',
    opciones: [],
    args: [1, 1],
    accion: webhooksTest,
  },
  {
    nombre: 'webhooks deliveries',
    uso: 'webhooks deliveries <id>',
    resumen: 'Últimas 50 entregas de un webhook',
    opciones: [],
    args: [1, 1],
    accion: webhooksDeliveries,
  },
  {
    nombre: 'webhooks rotate',
    uso: 'webhooks rotate <id>',
    resumen: 'Genera un secreto de firma nuevo y lo muestra una vez',
    opciones: [],
    args: [1, 1],
    accion: webhooksRotate,
  },
  {
    nombre: 'uso',
    uso: 'uso [--desde <AAAA-MM-DD>] [--hasta <AAAA-MM-DD>]',
    resumen: 'Documentos emitidos, procesados y rechazados por día (por defecto, 30 días)',
    opciones: ['desde', 'hasta'],
    args: [0, 0],
    accion: uso,
  },
  {
    nombre: 'registros list',
    uso: 'registros list [--estado ok|error] [--origen api|mcp] [--limite <n>]',
    resumen: 'Últimas peticiones hechas con claves de API (requiere registros:read)',
    opciones: ['estado', 'origen', 'limite'],
    args: [0, 0],
    accion: registrosList,
  },
  {
    nombre: 'mcp',
    uso: 'mcp',
    resumen: 'Servidor MCP por stdio para Claude y otros clientes',
    opciones: [],
    args: [0, 0],
    accion: mcp,
  },
  {
    nombre: 'mcp install',
    uso: 'mcp install <agente…> | --todos [--remoto] [--imprimir] [--yes] [--url <url>]',
    resumen:
      'Agrega Open Factura a la configuración MCP de tus agentes (claude-code, claude-desktop, cursor, vscode, windsurf, codex, gemini, zed, cline, goose)',
    opciones: ['todos', 'remoto', 'imprimir', 'yes'],
    args: [0, 20],
    accion: mcpInstall,
  },
  {
    nombre: 'mcp agentes',
    uso: 'mcp agentes',
    resumen: 'Agentes compatibles, si se detectan en este equipo y su archivo de configuración',
    opciones: [],
    args: [0, 0],
    accion: mcpAgentes,
  },
]
