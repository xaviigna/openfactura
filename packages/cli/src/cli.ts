import { parseArgs } from 'node:util'
import pkg from '../package.json'
import { COMANDOS, type Comando, type Contexto, type Entorno, GRUPOS } from './comandos'
import { resolver } from './config'
import { ErrorApi, ErrorCli, ErrorUso, SALIDA } from './errores'
import { ClienteApi } from './http'

export const VERSION: string = pkg.version

type TipoOpcion = { type: 'string' | 'boolean'; short?: string; ayuda: string }

/** Todas las opciones de la CLI. Cada comando acepta las globales más las que declara. */
const OPCIONES: Record<string, TipoOpcion> = {
  help: { type: 'boolean', short: 'h', ayuda: 'Muestra esta ayuda' },
  version: { type: 'boolean', short: 'v', ayuda: 'Muestra la versión' },
  json: { type: 'boolean', ayuda: 'Imprime el JSON de la API (para scripts)' },
  url: { type: 'string', ayuda: 'URL del servidor (o OPENFACTURA_URL)' },
  profile: {
    type: 'string',
    ayuda: 'Perfil de configuración (o OPENFACTURA_PROFILE; por defecto «default»)',
  },
  yes: {
    type: 'boolean',
    short: 'y',
    ayuda: 'No pedir confirmación (claves de producción, cambios en la configuración de agentes)',
  },
  todos: { type: 'boolean', ayuda: 'Todos los agentes detectados en este equipo' },
  remoto: {
    type: 'boolean',
    ayuda: 'Conectar al servidor MCP remoto (<url>/mcp) con la clave en un encabezado',
  },
  imprimir: { type: 'boolean', ayuda: 'Sólo imprimir la configuración y el archivo destino' },
  key: { type: 'string', ayuda: 'Clave de API; si se omite, se pide sin mostrarla' },
  token: {
    type: 'string',
    ayuda: 'ADMIN_TOKEN de tu servidor (o OPENFACTURA_ADMIN_TOKEN); si se omite, se pide',
  },
  q: { type: 'string', ayuda: 'Texto a buscar' },
  file: {
    type: 'string',
    short: 'f',
    ayuda: 'Archivo JSON con los datos («-» lee la entrada estándar)',
  },
  output: { type: 'string', short: 'o', ayuda: 'Archivo de salida' },
  'idempotency-key': {
    type: 'string',
    ayuda: 'Clave de idempotencia; por defecto se genera un UUID',
  },
  tipo: {
    type: 'string',
    ayuda:
      'Tipo de DTE (01, 03…); al invalidar, tipo de anulación (1, 2, 3); en eventos, retorno | operaciones_especiales',
  },
  estado: {
    type: 'string',
    ayuda:
      'pendiente | procesado | rechazado | contingencia | invalidado; en registros, ok | error',
  },
  origen: { type: 'string', ayuda: 'api | mcp' },
  limite: { type: 'string', ayuda: 'Cantidad de filas (1 a 200; por defecto 50)' },
  desde: { type: 'string', ayuda: 'Fecha inicial AAAA-MM-DD' },
  hasta: { type: 'string', ayuda: 'Fecha final AAAA-MM-DD' },
  pagina: { type: 'string', ayuda: 'Número de página' },
  motivo: { type: 'string', ayuda: 'Motivo de la invalidación' },
  cliente: {
    type: 'string',
    ayuda: 'En la certificación, id del cliente contribuyente que recibe los CCF de prueba',
  },
  completo: {
    type: 'boolean',
    ayuda: 'En la certificación, incluye todos los documentos y eventos, no sólo los obligatorios',
  },
  'desde-cero': {
    type: 'boolean',
    ayuda: 'En la certificación, descarta el avance anterior y cuenta desde ahora',
  },
  reemplazo: { type: 'string', ayuda: 'Código de generación del DTE que reemplaza al invalidado' },
  'tipo-documento': {
    type: 'string',
    ayuda: '36 NIT | 13 DUI | 03 pasaporte | 02 carné de residente | 37 otro',
  },
  'num-documento': { type: 'string', ayuda: 'Número del documento' },
  nrc: { type: 'string', ayuda: 'NRC del contribuyente' },
  nombre: { type: 'string', ayuda: 'Nombre o razón social' },
  'nombre-comercial': { type: 'string', ayuda: 'Nombre comercial' },
  'cod-actividad': { type: 'string', ayuda: 'Código de actividad económica (CAT-019)' },
  'desc-actividad': { type: 'string', ayuda: 'Descripción de la actividad económica' },
  departamento: { type: 'string', ayuda: 'Código de departamento (CAT-012)' },
  municipio: { type: 'string', ayuda: 'Código de municipio (CAT-013)' },
  distrito: { type: 'string', ayuda: 'Código de distrito (CAT-008)' },
  complemento: { type: 'string', ayuda: 'Dirección' },
  telefono: { type: 'string', ayuda: 'Teléfono' },
  correo: { type: 'string', ayuda: 'Correo electrónico' },
  codigo: { type: 'string', ayuda: 'Código del producto' },
  descripcion: { type: 'string', ayuda: 'Descripción (del producto o del webhook)' },
  eventos: {
    type: 'string',
    ayuda:
      'Eventos del webhook separados por coma (por defecto todos): dte.procesado, dte.rechazado, dte.contingencia, dte.invalidado, retorno.procesado, retorno.invalidado, operaciones_especiales.procesado, operaciones_especiales.invalidado',
  },
  precio: { type: 'string', ayuda: 'Precio unitario SIN IVA' },
  'tipo-item': {
    type: 'string',
    ayuda: '1 bien | 2 servicio | 3 ambos | 4 otros tributos (por defecto 1)',
  },
  'uni-medida': { type: 'string', ayuda: 'Unidad de medida, CAT-014 (por defecto 59 = unidad)' },
  'external-id': { type: 'string', ayuda: 'En Plataforma, tu propio id del cliente' },
  nit: { type: 'string', ayuda: 'En Plataforma, NIT del cliente (prellena su alta)' },
  'razon-social': { type: 'string', ayuda: 'En Plataforma, razón social del cliente' },
  horas: {
    type: 'string',
    ayuda: 'Vigencia del enlace de alta en horas (1 a 168; por defecto 72)',
  },
  live: { type: 'boolean', ayuda: 'Clave de producción (of_live_); por defecto de pruebas' },
  yo: { type: 'boolean', ayuda: 'Vuelve a tu propia cuenta' },
  'tipo-venta': { type: 'string', ayuda: 'gravada | exenta | noSujeta (por defecto gravada)' },
}

const GLOBALES = ['help', 'json', 'url', 'profile']

const bandera = (nombre: string) => {
  const o = OPCIONES[nombre] as TipoOpcion
  return `${o.short ? `-${o.short}, ` : ''}--${nombre}${o.type === 'string' ? ' <valor>' : ''}`
}

const listaOpciones = (nombres: string[]) => {
  const ancho = Math.max(...nombres.map((n) => bandera(n).length))
  return nombres
    .map((n) => `  ${bandera(n).padEnd(ancho)}  ${(OPCIONES[n] as TipoOpcion).ayuda}`)
    .join('\n')
}

function ayudaGeneral(grupo?: string): string {
  const comandos = grupo ? COMANDOS.filter((c) => c.nombre.startsWith(`${grupo} `)) : COMANDOS
  const ancho = Math.max(...comandos.map((c) => c.nombre.length))
  return [
    grupo
      ? `openfactura ${grupo} — ${GRUPOS[grupo]}`
      : `openfactura ${VERSION} — facturación electrónica de El Salvador (DTE) desde la terminal`,
    '',
    `Uso: openfactura ${grupo ? `${grupo} <subcomando>` : '<comando>'} [opciones]`,
    '',
    'Comandos:',
    ...comandos.map((c) => `  ${c.nombre.padEnd(ancho)}  ${c.resumen}`),
    '',
    'Opciones globales:',
    listaOpciones(grupo ? GLOBALES : [...GLOBALES, 'version']),
    '',
    'Usa `openfactura <comando> --help` para ver las opciones de un comando.',
    ...(grupo
      ? []
      : [
          '',
          'Entorno: OPENFACTURA_API_KEY, OPENFACTURA_URL, OPENFACTURA_PROFILE.',
          'Salida: 0 bien · 1 error de la API o de validación · 2 uso incorrecto · 3 sin autenticar · 4 límite de peticiones.',
        ]),
  ].join('\n')
}

function ayudaComando(comando: Comando): string {
  return [
    comando.resumen,
    '',
    `Uso: openfactura ${comando.uso}`,
    ...(comando.opciones.length ? ['', 'Opciones:', listaOpciones(comando.opciones)] : []),
    '',
    'Opciones globales:',
    listaOpciones(GLOBALES),
  ].join('\n')
}

function analizar(argv: string[]) {
  try {
    const opciones = Object.fromEntries(
      Object.entries(OPCIONES).map(([nombre, { type, short }]) => [
        nombre,
        short ? { type, short } : { type },
      ]),
    )
    return parseArgs({ args: argv, options: opciones, allowPositionals: true, strict: true })
  } catch (error) {
    const { code, message } = error as { code?: string; message: string }
    const opcion = /'(-[^' ]*)/.exec(message)?.[1]
    if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION')
      throw new ErrorUso(`Opción desconocida: ${opcion ?? message}`)
    if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      throw new ErrorUso(
        opcion ? `La opción ${opcion} está mal usada: revisa si lleva o no un valor.` : message,
      )
    }
    throw new ErrorUso(message)
  }
}

function informarError(error: unknown, ent: Entorno, json: boolean): number {
  if (error instanceof ErrorUso) {
    ent.stderr(`Error: ${error.message}`)
    ent.stderr('Usa `openfactura --help` para ver los comandos.')
    return SALIDA.uso
  }
  if (error instanceof ErrorApi) {
    if (json) {
      ent.stderr(
        JSON.stringify(
          error.retryAfter === null
            ? error.cuerpo
            : { ...error.cuerpo, retryAfter: error.retryAfter },
          null,
          2,
        ),
      )
      return error.salida
    }
    ent.stderr(`Error [${error.code}]: ${error.message}`)
    for (const linea of detalles(error)) ent.stderr(`  ${linea}`)
    if (error.status === 401)
      ent.stderr('  Revisa OPENFACTURA_API_KEY o ejecuta `openfactura login`.')
    if (error.status === 429) {
      ent.stderr(
        `  Retry-After: ${error.retryAfter ?? '?'} (segundos que debes esperar antes de reintentar)`,
      )
    }
    return error.salida
  }
  if (error instanceof ErrorCli) {
    ent.stderr(
      json ? JSON.stringify(error.cuerpo, null, 2) : `Error [${error.code}]: ${error.message}`,
    )
    return error.salida
  }
  ent.stderr(
    `Error inesperado: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  )
  return SALIDA.error
}

/** Líneas legibles para los `details` de cada error de la API. */
function detalles(error: ErrorApi): string[] {
  const d = error.details as Record<string, unknown> | unknown[] | undefined | null
  if (d === undefined || d === null) return []
  const problema = (p: { ruta?: unknown; mensaje?: unknown }) =>
    `${p.ruta || '(raíz)'}: ${p.mensaje}`
  if (Array.isArray(d)) return d.map((p) => problema(p as object))
  if (Array.isArray(d.problemas)) return d.problemas.map((p) => problema(p as object))
  if (d.mh && typeof d.mh === 'object') {
    const mh = d.mh as { codigo?: unknown; mensaje?: unknown; observaciones?: unknown }
    const observaciones = Array.isArray(mh.observaciones) ? mh.observaciones : []
    return [
      `MH ${mh.codigo ?? ''}: ${mh.mensaje ?? ''}`.trim(),
      ...observaciones.map((o) => `- ${o}`),
    ]
  }
  if (typeof d.permiso === 'string') return [`Permiso que falta en la clave: ${d.permiso}`]
  return [JSON.stringify(d)]
}

/** Ejecuta la CLI y devuelve el código de salida. No toca `process`: todo pasa por `ent`. */
export async function ejecutar(argv: string[], ent: Entorno): Promise<number> {
  // Vale aunque el análisis falle: los errores de uso respetan --json en lo posible.
  let json = argv.includes('--json')
  try {
    const { values, positionals } = analizar(argv)
    const valores = values as Record<string, string | boolean | undefined>
    json = valores.json === true

    const [primero, segundo] = positionals
    if (!primero) {
      if (valores.version) {
        ent.stdout(VERSION)
        return SALIDA.ok
      }
      if (valores.help) {
        ent.stdout(ayudaGeneral())
        return SALIDA.ok
      }
      throw new ErrorUso('Falta el comando.')
    }

    const esGrupo = Object.hasOwn(GRUPOS, primero)
    const nombre = esGrupo ? `${primero} ${segundo ?? ''}`.trim() : primero
    const comando = COMANDOS.find((c) => c.nombre === nombre)
    if (!comando) {
      if (esGrupo && !segundo && valores.help) {
        ent.stdout(ayudaGeneral(primero))
        return SALIDA.ok
      }
      const disponibles = COMANDOS.filter((c) => c.nombre.startsWith(`${primero} `)).map(
        (c) => c.nombre.split(' ')[1],
      )
      throw new ErrorUso(
        esGrupo
          ? `${segundo ? `Subcomando desconocido: ${primero} ${segundo}.` : `Falta el subcomando de «${primero}».`} Disponibles: ${disponibles.join(', ')}`
          : `Comando desconocido: ${primero}`,
      )
    }
    if (valores.help) {
      ent.stdout(ayudaComando(comando))
      return SALIDA.ok
    }

    const permitidas = new Set([...GLOBALES, ...comando.opciones])
    const sobrante = Object.keys(valores).find((opcion) => !permitidas.has(opcion))
    if (sobrante)
      throw new ErrorUso(
        `La opción --${sobrante} no aplica a «${comando.nombre}».\nUso: openfactura ${comando.uso}`,
      )

    const args = positionals.slice(esGrupo ? 2 : 1)
    const [minimo, maximo] = comando.args
    if (args.length < minimo || args.length > maximo) {
      throw new ErrorUso(
        `${args.length < minimo ? 'Faltan argumentos' : `Sobran argumentos (${args.slice(maximo).join(' ')})`}.\nUso: openfactura ${comando.uso}`,
      )
    }

    const cfg = resolver(ent.env, {
      url: valores.url as string | undefined,
      perfil: valores.profile as string | undefined,
    })
    let cliente: ClienteApi | undefined
    let plataforma: ClienteApi | undefined
    const ctx: Contexto = {
      ent,
      version: VERSION,
      args,
      json,
      si: valores.yes === true,
      cfg,
      op: (opcion) =>
        typeof valores[opcion] === 'string' ? (valores[opcion] as string) : undefined,
      bandera: (opcion) => valores[opcion] === true,
      api: () => {
        if (!cfg.apiKey) {
          throw new ErrorCli(
            'No hay una clave de API. Ejecuta `openfactura login` o define OPENFACTURA_API_KEY.',
            'no_autenticado',
            SALIDA.noAutenticado,
          )
        }
        if (!cliente) {
          const { protocol, hostname } = new URL(cfg.url)
          if (protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
            ent.stderr(`Aviso: ${cfg.url} no usa HTTPS; la clave de API viaja sin cifrar.`)
          }
          cliente = new ClienteApi({
            url: cfg.url,
            apiKey: cfg.apiKey,
            version: VERSION,
            fetch: ent.fetch,
          })
        }
        return cliente
      },
      apiPlataforma: () => {
        if (!cfg.apiKeyPropia) {
          throw new ErrorCli(
            'No hay una clave de API. Ejecuta `openfactura login` con una clave habilitada para Plataforma.',
            'no_autenticado',
            SALIDA.noAutenticado,
          )
        }
        plataforma ??= new ClienteApi({
          url: cfg.url,
          apiKey: cfg.apiKeyPropia,
          version: VERSION,
          fetch: ent.fetch,
          base: '/cloud/plataforma',
        })
        return plataforma
      },
    }
    return (await comando.accion(ctx)) ?? SALIDA.ok
  } catch (error) {
    return informarError(error, ent, json)
  }
}
