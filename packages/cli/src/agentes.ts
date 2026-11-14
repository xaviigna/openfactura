import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, posix, win32 } from 'node:path'
import type { Contexto } from './comandos'
import {
  type Env,
  enmascarar,
  esClaveValida,
  leerConfig,
  URL_MCP_CLOUD,
  URL_POR_DEFECTO,
} from './config'
import { ErrorCli, ErrorUso, SALIDA } from './errores'
import { ClienteApi } from './http'

/** Nombre del servidor en la configuración de cada agente. */
const NOMBRE = 'openfactura'
const PAQUETE = ['-y', '@openfactura/cli', 'mcp']
/** Lo que se imprime en lugar de la clave: nunca se muestra completa. */
const MARCADOR = '<CLAVE_DE_API>'
const DESCRIPCION = 'Facturación electrónica de El Salvador (Open Factura)'

/**
 * Local: el agente lanza `npx -y @openfactura/cli mcp`. Remoto: HTTP a `<url>/mcp` con Bearer (en la
 * nube, la URL canónica `https://openfactura.co/mcp`).
 */
export type Servidor =
  | { tipo: 'local'; env: Record<string, string>; clave: string | null }
  | { tipo: 'remoto'; url: string; clave: string }

/** Lo que el instalador sabe del equipo; las pruebas lo sustituyen. */
export interface Equipo {
  env: Env
  plataforma: NodeJS.Platform
}

type Formato = 'json' | 'toml' | 'yaml' | 'claude' | 'vscode'

interface Agente {
  id: string
  nombre: string
  /** Qué hacer para que el agente cargue el cambio. */
  despues: string
  /** Documentación oficial de la ruta y el formato. */
  docs: string
  formato: Formato
  /** Archivo de configuración (formatos de archivo). */
  ruta?: (e: Equipo) => string
  /** Clave raíz del JSON. */
  raiz?: string
  /** Entrada `openfactura` para JSON; `null` = el agente no admite ese modo. */
  entrada?: (s: Servidor) => unknown
  /** Programa del agente, para detectarlo y (Claude Code, VS Code) para instalar. */
  binario?: string
  carpetas: (e: Equipo) => string[]
}

// ───────────────────────────── rutas ─────────────────────────────

const ruta = (e: Equipo) => (e.plataforma === 'win32' ? win32 : posix)
const inicio = (e: Equipo) => e.env.HOME || e.env.USERPROFILE || homedir()
const enInicio = (e: Equipo, ...partes: string[]) => ruta(e).join(inicio(e), ...partes)
const appData = (e: Equipo) => e.env.APPDATA || enInicio(e, 'AppData', 'Roaming')
/** `$XDG_CONFIG_HOME` (si es absoluta) o `~/.config`. */
const xdg = (e: Equipo) =>
  e.env.XDG_CONFIG_HOME && ruta(e).isAbsolute(e.env.XDG_CONFIG_HOME)
    ? e.env.XDG_CONFIG_HOME
    : enInicio(e, '.config')

const codexHome = (e: Equipo) =>
  e.env.CODEX_HOME && ruta(e).isAbsolute(e.env.CODEX_HOME)
    ? e.env.CODEX_HOME
    : enInicio(e, '.codex')

/** Entrada stdio común: `command`, `args`, `env`. */
const stdio = (s: Servidor) =>
  s.tipo === 'local' ? { command: 'npx', args: PAQUETE, env: s.env } : null
const bearer = (s: { clave: string }) => ({ Authorization: `Bearer ${s.clave}` })

export const AGENTES: Agente[] = [
  {
    id: 'claude-code',
    nombre: 'Claude Code',
    despues: 'abre una sesión nueva de Claude Code',
    // https://code.claude.com/docs/en/mcp — `claude mcp add [--scope user] … -- <comando>`
    docs: 'https://code.claude.com/docs/en/mcp',
    formato: 'claude',
    binario: 'claude',
    carpetas: (e) => [enInicio(e, '.claude')],
  },
  {
    id: 'claude-desktop',
    nombre: 'Claude Desktop',
    despues: 'cierra y vuelve a abrir Claude Desktop',
    // https://modelcontextprotocol.io/docs/develop/connect-local-servers — `mcpServers`, sólo stdio
    // (los remotos se agregan como conectores desde la aplicación).
    docs: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
    formato: 'json',
    raiz: 'mcpServers',
    ruta: (e) =>
      e.plataforma === 'darwin'
        ? enInicio(e, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : e.plataforma === 'win32'
          ? ruta(e).join(appData(e), 'Claude', 'claude_desktop_config.json')
          : enInicio(e, '.config', 'Claude', 'claude_desktop_config.json'),
    entrada: stdio,
    carpetas: (e) => [ruta(e).dirname(rutaDe('claude-desktop', e))],
  },
  {
    id: 'cursor',
    nombre: 'Cursor',
    despues: 'reinicia Cursor',
    // https://cursor.com/docs/context/mcp — `~/.cursor/mcp.json`, `mcpServers`
    docs: 'https://cursor.com/docs/context/mcp',
    formato: 'json',
    raiz: 'mcpServers',
    ruta: (e) => enInicio(e, '.cursor', 'mcp.json'),
    entrada: (s) =>
      s.tipo === 'local'
        ? { type: 'stdio', command: 'npx', args: PAQUETE, env: s.env }
        : { url: s.url, headers: bearer(s) },
    binario: 'cursor',
    carpetas: (e) => [enInicio(e, '.cursor')],
  },
  {
    id: 'vscode',
    nombre: 'VS Code',
    despues: 'recarga la ventana de VS Code',
    // https://code.visualstudio.com/docs/agents/reference/mcp-configuration — la ruta del `mcp.json`
    // de usuario no está documentada por sistema; se usa `code --add-mcp '<json>'`.
    docs: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',
    formato: 'vscode',
    binario: 'code',
    carpetas: (e) => [
      e.plataforma === 'darwin'
        ? enInicio(e, 'Library', 'Application Support', 'Code', 'User')
        : e.plataforma === 'win32'
          ? ruta(e).join(appData(e), 'Code', 'User')
          : ruta(e).join(xdg(e), 'Code', 'User'),
    ],
  },
  {
    id: 'windsurf',
    nombre: 'Windsurf',
    despues: 'pulsa «Refresh» en los servidores MCP de Cascade o reinicia Windsurf',
    // https://docs.windsurf.com/plugins/cascade/mcp — `~/.codeium/windsurf/mcp_config.json`,
    // `mcpServers`; remotos con `serverUrl` y `headers`.
    docs: 'https://docs.windsurf.com/plugins/cascade/mcp',
    formato: 'json',
    raiz: 'mcpServers',
    ruta: (e) => enInicio(e, '.codeium', 'windsurf', 'mcp_config.json'),
    entrada: (s) => stdio(s) ?? (s.tipo === 'remoto' && { serverUrl: s.url, headers: bearer(s) }),
    binario: 'windsurf',
    carpetas: (e) => [enInicio(e, '.codeium', 'windsurf')],
  },
  {
    id: 'codex',
    nombre: 'Codex CLI',
    despues: 'abre una sesión nueva de Codex',
    // https://developers.openai.com/codex/mcp — `~/.codex/config.toml`, `[mcp_servers.<nombre>]`
    docs: 'https://developers.openai.com/codex/mcp',
    formato: 'toml',
    ruta: (e) => ruta(e).join(codexHome(e), 'config.toml'),
    binario: 'codex',
    carpetas: (e) => [codexHome(e)],
  },
  {
    id: 'gemini',
    nombre: 'Gemini CLI',
    despues: 'reinicia Gemini CLI',
    // https://geminicli.com/docs/tools/mcp-server/ — `~/.gemini/settings.json`, `mcpServers`;
    // remotos HTTP con `httpUrl` y `headers`.
    docs: 'https://geminicli.com/docs/tools/mcp-server/',
    formato: 'json',
    raiz: 'mcpServers',
    ruta: (e) => enInicio(e, '.gemini', 'settings.json'),
    entrada: (s) => stdio(s) ?? (s.tipo === 'remoto' && { httpUrl: s.url, headers: bearer(s) }),
    binario: 'gemini',
    carpetas: (e) => [enInicio(e, '.gemini')],
  },
  {
    id: 'zed',
    nombre: 'Zed',
    despues: 'Zed aplica el cambio al guardar',
    // https://zed.dev/docs/ai/mcp — `context_servers`. Ruta: crates/paths/src/paths.rs de Zed
    // (macOS `~/.config/zed`, Linux `$XDG_CONFIG_HOME/zed`, Windows `%APPDATA%\Zed`).
    docs: 'https://zed.dev/docs/ai/mcp',
    formato: 'json',
    raiz: 'context_servers',
    ruta: (e) =>
      e.plataforma === 'win32'
        ? ruta(e).join(appData(e), 'Zed', 'settings.json')
        : e.plataforma === 'darwin'
          ? enInicio(e, '.config', 'zed', 'settings.json')
          : ruta(e).join(xdg(e), 'zed', 'settings.json'),
    entrada: (s) => stdio(s) ?? (s.tipo === 'remoto' && { url: s.url, headers: bearer(s) }),
    binario: 'zed',
    carpetas: (e) => [ruta(e).dirname(rutaDe('zed', e))],
  },
  {
    id: 'cline',
    nombre: 'Cline',
    despues: 'reinicia Cline (o tu editor)',
    // https://docs.cline.bot/getting-started/config — `~/.cline/data/settings/cline_mcp_settings.json`,
    // compartido por la extensión, la CLI y el SDK (CLINE_MCP_SETTINGS_PATH, CLINE_DATA_DIR, CLINE_DIR).
    // Formato: https://docs.cline.bot/mcp/configuring-mcp-servers (`type: streamableHttp` en remotos).
    docs: 'https://docs.cline.bot/getting-started/config',
    formato: 'json',
    raiz: 'mcpServers',
    ruta: (e) => {
      const r = ruta(e)
      const absoluta = (v?: string) => (v && r.isAbsolute(v) ? v : undefined)
      const explicita = absoluta(e.env.CLINE_MCP_SETTINGS_PATH)
      if (explicita) return explicita
      const datos =
        absoluta(e.env.CLINE_DATA_DIR) ??
        r.join(absoluta(e.env.CLINE_DIR) ?? enInicio(e, '.cline'), 'data')
      return r.join(datos, 'settings', 'cline_mcp_settings.json')
    },
    entrada: (s) =>
      s.tipo === 'local'
        ? { command: 'npx', args: PAQUETE, env: s.env, disabled: false }
        : { type: 'streamableHttp', url: s.url, headers: bearer(s), disabled: false },
    binario: 'cline',
    carpetas: (e) => [enInicio(e, '.cline')],
  },
  {
    id: 'goose',
    nombre: 'Goose',
    despues: 'reinicia Goose',
    // https://goose-docs.ai/docs/guides/config-files — `~/.config/goose/config.yaml`
    // (Windows `%APPDATA%\Block\goose\config\config.yaml`), `extensions:`.
    docs: 'https://goose-docs.ai/docs/guides/config-files',
    formato: 'yaml',
    ruta: (e) =>
      e.plataforma === 'win32'
        ? ruta(e).join(appData(e), 'Block', 'goose', 'config', 'config.yaml')
        : ruta(e).join(xdg(e), 'goose', 'config.yaml'),
    binario: 'goose',
    carpetas: (e) => [ruta(e).dirname(rutaDe('goose', e))],
  },
]

const agente = (id: string) => AGENTES.find((a) => a.id === id) as Agente
const rutaDe = (id: string, e: Equipo) => (agente(id).ruta as (e: Equipo) => string)(e)

/** Busca un programa en el PATH, sin ejecutar nada. */
export function buscarBinario(nombre: string, e: Equipo): string | null {
  const win = e.plataforma === 'win32'
  const extensiones = win ? (e.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const carpeta of (e.env.PATH ?? e.env.Path ?? '').split(win ? ';' : ':')) {
    if (!carpeta) continue
    for (const ext of extensiones) {
      const candidato = ruta(e).join(carpeta, nombre + ext)
      try {
        if (!statSync(candidato).isFile()) continue
        if (!win) accessSync(candidato, constants.X_OK)
        return candidato
      } catch {}
    }
  }
  return null
}

export function detectado(a: Agente, e: Equipo): boolean {
  return Boolean((a.binario && buscarBinario(a.binario, e)) || a.carpetas(e).some(existsSync))
}

// ───────────────────────────── formatos ─────────────────────────────

/** El archivo existe pero no se puede modificar sin riesgo: se imprimen instrucciones. */
class ErrorFormato extends Error {}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Agrega o reemplaza `<raiz>.openfactura` sin tocar el resto. Sólo JSON estricto. */
export function upsertJson(texto: string | null, raiz: string, entrada: unknown): string {
  let datos: Record<string, unknown> = {}
  let sangria: string | number = 2
  if (texto?.trim()) {
    let valor: unknown
    try {
      valor = JSON.parse(texto)
    } catch {
      throw new ErrorFormato('no es JSON estricto (¿comentarios o comas finales?)')
    }
    if (!esObjeto(valor)) throw new ErrorFormato('la raíz no es un objeto JSON')
    datos = valor
    sangria = /^([ \t]+)"/m.exec(texto)?.[1] ?? 2
  }
  const servidores = datos[raiz] ?? {}
  if (!esObjeto(servidores)) throw new ErrorFormato(`«${raiz}» no es un objeto`)
  datos[raiz] = { ...servidores, [NOMBRE]: entrada }
  return `${JSON.stringify(datos, null, sangria)}\n`
}

const cadena = (v: string) => JSON.stringify(v)
const tomlTablaEnLinea = (o: Record<string, string>) =>
  `{ ${Object.entries(o)
    .map(([k, v]) => `${/^[A-Za-z0-9_-]+$/.test(k) ? k : cadena(k)} = ${cadena(v)}`)
    .join(', ')} }`

export function tablaToml(s: Servidor): string {
  return [
    `[mcp_servers.${NOMBRE}]`,
    ...(s.tipo === 'local'
      ? [
          'command = "npx"',
          `args = [${PAQUETE.map(cadena).join(', ')}]`,
          `env = ${tomlTablaEnLinea(s.env)}`,
        ]
      : [`url = ${cadena(s.url)}`, `http_headers = ${tomlTablaEnLinea(bearer(s))}`]),
  ].join('\n')
}

const CABECERA_NUESTRA =
  /^\s*\[\s*mcp_servers\s*\.\s*(?:openfactura|"openfactura"|'openfactura')\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$/
const CABECERA = /^\s*\[/

/**
 * Reemplaza la tabla `[mcp_servers.openfactura]` (y sus subtablas) o la agrega al final. No hay
 * analizador TOML: si el servidor aparece definido de otra forma, no se toca el archivo.
 */
export function upsertToml(texto: string | null, tabla: string): string {
  const lineas = (texto ?? '').split(/\r?\n/)
  const quedan: string[] = []
  let dentro = false
  let habia = false
  for (const linea of lineas) {
    if (CABECERA_NUESTRA.test(linea)) {
      dentro = habia = true
      continue
    }
    if (dentro && CABECERA.test(linea)) dentro = false
    if (!dentro) quedan.push(linea)
  }
  const resto = quedan.join('\n')
  if (habia && /"""|'''/.test(texto ?? ''))
    throw new ErrorFormato(
      'tiene cadenas multilínea; no se puede reemplazar la tabla con seguridad',
    )
  if (/^\s*mcp_servers\s*=/m.test(resto))
    throw new ErrorFormato('define mcp_servers como tabla en línea')
  if (/^\s*(?:mcp_servers\s*\.\s*)?["']?openfactura["']?\s*[.=]/m.test(resto))
    throw new ErrorFormato('ya define openfactura de otra forma')
  const base = resto.replace(/\s+$/, '')
  return `${base ? `${base}\n\n` : ''}${tabla}\n`
}

/** Extensión de Goose, con sangría relativa de dos espacios. */
export function extensionGoose(s: Servidor): string[] {
  const comunes = [`name: ${NOMBRE}`, `description: ${cadena(DESCRIPCION)}`]
  const campos =
    s.tipo === 'local'
      ? [
          'type: stdio',
          ...comunes,
          'cmd: npx',
          `args: [${PAQUETE.map(cadena).join(', ')}]`,
          `envs: {${Object.entries(s.env)
            .map(([k, v]) => `${cadena(k)}: ${cadena(v)}`)
            .join(', ')}}`,
        ]
      : [
          'type: streamable_http',
          ...comunes,
          `uri: ${cadena(s.url)}`,
          `headers: {"Authorization": ${cadena(`Bearer ${s.clave}`)}}`,
          'envs: {}',
        ]
  return [
    `${NOMBRE}:`,
    ...['enabled: true', ...campos, 'env_keys: []', 'timeout: 300'].map((c) => `  ${c}`),
  ]
}

const sangriaDe = (l: string) => /^ */.exec(l)?.[0].length ?? 0
const vacia = (l: string) => /^\s*(#.*)?$/.test(l)

/**
 * Agrega o reemplaza `extensions.openfactura` en el YAML de Goose sin analizador: sólo en el
 * estilo de bloque que escribe Goose. Ante cualquier forma inesperada, no se toca el archivo.
 */
export function upsertYaml(texto: string | null, entrada: string[]): string {
  const bloque = (sangria: number) =>
    entrada.map((l) => ' '.repeat(sangria) + l.replace(/^ {2}/, ' '.repeat(sangria)))
  if (!texto?.trim()) return `extensions:\n${bloque(2).join('\n')}\n`
  const lineas = texto.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n')
  if (lineas.some((l) => /^\s*\t/.test(l))) throw new ErrorFormato('tiene sangría con tabuladores')
  const primera = lineas.find((l) => !vacia(l) && !/^---\s*$/.test(l)) ?? ''
  if (/^\s*[{[]/.test(primera) || lineas.some((l) => /^(---|\.\.\.)\s*\S/.test(l)))
    throw new ErrorFormato('no usa el estilo de bloque de Goose')
  if (lineas.filter((l) => /^---\s*$/.test(l)).length > 1)
    throw new ErrorFormato('tiene varios documentos YAML')
  if (lineas.some((l) => /^["']extensions["']\s*:/.test(l)))
    throw new ErrorFormato('usa una clave «extensions» entre comillas')

  const indices = lineas.flatMap((l, i) => (/^extensions\s*:/.test(l) ? [i] : []))
  if (indices.length > 1) throw new ErrorFormato('tiene «extensions» repetido')
  if (indices.length === 0) return `${lineas.join('\n')}\nextensions:\n${bloque(2).join('\n')}\n`

  const i = indices[0] as number
  const valor = (lineas[i] as string).replace(/^extensions\s*:/, '')
  if (/^\s*\{\s*\}\s*(#.*)?$/.test(valor)) lineas[i] = 'extensions:'
  else if (!vacia(valor)) throw new ErrorFormato('«extensions» no está en estilo de bloque')

  let fin = i + 1
  while (fin < lineas.length) {
    const l = lineas[fin] as string
    if (!vacia(l) && sangriaDe(l) === 0) break
    fin++
  }
  if (fin < lineas.length && /^-/.test(lineas[fin] as string))
    throw new ErrorFormato('«extensions» no es un mapa')

  const contenido = lineas.slice(i + 1, fin).filter((l) => !vacia(l))
  const hijo = contenido.length ? sangriaDe(contenido[0] as string) : 2
  if (contenido.some((l) => sangriaDe(l) < hijo))
    throw new ErrorFormato('la sangría de «extensions» es irregular')

  const propia = new RegExp(`^ {${hijo}}(?:${NOMBRE}|"${NOMBRE}"|'${NOMBRE}')\\s*:(.*)$`)
  const desde = lineas.findIndex((l, k) => k > i && k < fin && propia.test(l))
  let hasta: number
  let insertar: number
  if (desde === -1) {
    insertar = fin
    while (insertar > i + 1 && vacia(lineas[insertar - 1] as string)) insertar--
    hasta = insertar
  } else {
    if (!vacia((propia.exec(lineas[desde] as string) as RegExpExecArray)[1] as string))
      throw new ErrorFormato('la extensión openfactura no está en estilo de bloque')
    hasta = desde + 1
    while (hasta < fin) {
      const l = lineas[hasta] as string
      if (!vacia(l) && sangriaDe(l) <= hijo) break
      hasta++
    }
    while (hasta > desde + 1 && vacia(lineas[hasta - 1] as string)) hasta--
    insertar = desde
  }
  lineas.splice(insertar, hasta - insertar, ...bloque(hijo))
  return `${lineas.join('\n')}\n`
}

// ───────────────────────────── plan ─────────────────────────────

type Plan =
  | { tipo: 'archivo'; ruta: string; contenido: string; actual: string | null; conClave: boolean }
  | { tipo: 'comando'; programa: string; args: string[]; visible: string }
  | { tipo: 'manual'; motivo: string; ruta?: string }

/** Comillas simples de shell sólo cuando hacen falta. */
const citar = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)

function argsClaude(s: Servidor): string[] {
  return s.tipo === 'local'
    ? [
        'mcp',
        'add',
        ...Object.entries(s.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
        '--scope',
        'user',
        '--transport',
        'stdio',
        NOMBRE,
        '--',
        'npx',
        ...PAQUETE,
      ]
    : [
        'mcp',
        'add',
        '--scope',
        'user',
        '--transport',
        'http',
        NOMBRE,
        s.url,
        '--header',
        `Authorization: Bearer ${s.clave}`,
      ]
}

function argsVscode(s: Servidor): string[] {
  const config =
    s.tipo === 'local'
      ? { name: NOMBRE, type: 'stdio', command: 'npx', args: PAQUETE, env: s.env }
      : { name: NOMBRE, type: 'http', url: s.url, headers: bearer(s) }
  return ['--add-mcp', JSON.stringify(config)]
}

/** Texto para pegar a mano en la configuración del agente. */
export function fragmento(a: Agente, s: Servidor): string {
  switch (a.formato) {
    case 'claude':
      return ['claude', ...argsClaude(s)].map(citar).join(' ')
    case 'vscode':
      return ['code', ...argsVscode(s)].map(citar).join(' ')
    case 'toml':
      return tablaToml(s)
    case 'yaml':
      return ['extensions:', ...extensionGoose(s).map((l) => `  ${l}`)].join('\n')
    default:
      return JSON.stringify(
        { [a.raiz as string]: { [NOMBRE]: (a.entrada as (s: Servidor) => unknown)(s) } },
        null,
        2,
      )
  }
}

const admiteRemoto = (a: Agente, s: Servidor) =>
  a.formato !== 'json' || Boolean((a.entrada as (s: Servidor) => unknown)(s))

function leer(rutaArchivo: string): string | null {
  try {
    return readFileSync(rutaArchivo, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function planificar(a: Agente, e: Equipo, s: Servidor): Plan {
  if (!admiteRemoto(a, s))
    return {
      tipo: 'manual',
      motivo: `${a.nombre} no admite --remoto con encabezados; usa el modo local`,
    }
  if (a.formato === 'claude' || a.formato === 'vscode') {
    const programa = buscarBinario(a.binario as string, e)
    if (!programa) return { tipo: 'manual', motivo: `no se encontró «${a.binario}» en el PATH` }
    if (e.plataforma === 'win32' && /\.(cmd|bat)$/i.test(programa))
      return {
        tipo: 'manual',
        motivo: `«${a.binario}» es un script .cmd; ejecuta el comando a mano`,
      }
    const args = a.formato === 'claude' ? argsClaude(s) : argsVscode(s)
    return {
      tipo: 'comando',
      programa,
      args,
      visible: `${a.binario} ${args[0]} ${args[1] ?? ''}`.trim(),
    }
  }
  const destino = (a.ruta as (e: Equipo) => string)(e)
  try {
    const actual = leer(destino)
    const contenido =
      a.formato === 'toml'
        ? upsertToml(actual, tablaToml(s))
        : a.formato === 'yaml'
          ? upsertYaml(actual, extensionGoose(s))
          : upsertJson(actual, a.raiz as string, (a.entrada as (s: Servidor) => unknown)(s))
    return { tipo: 'archivo', ruta: destino, contenido, actual, conClave: s.clave !== null }
  } catch (error) {
    if (error instanceof ErrorFormato)
      return {
        tipo: 'manual',
        motivo: `el archivo ${error.message}; no se modificó`,
        ruta: destino,
      }
    return { tipo: 'manual', motivo: `no se pudo leer: ${(error as Error).message}`, ruta: destino }
  }
}

const sello = (d: Date) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n, i) => String(n).padStart(i ? 2 : 4, '0'))
    .join('')

/**
 * Escribe de forma atómica (temporal + rename) y deja antes un respaldo `<archivo>.bak-AAAAMMDDhhmmss`.
 * Con clave, el archivo queda en 0600. Si es un enlace simbólico se escribe su destino.
 */
export function escribirSeguro(
  destino: string,
  contenido: string,
  conClave: boolean,
  ahora = new Date(),
): string | null {
  const real = existsSync(destino) ? realpathSync(destino) : destino
  let modo = conClave ? 0o600 : 0o644
  let respaldo: string | null = null
  if (existsSync(real)) {
    const anterior = statSync(real).mode & 0o777
    if (!conClave) modo = anterior
    respaldo = `${destino}.bak-${sello(ahora)}`
    for (let n = 1; existsSync(respaldo); n++) respaldo = `${destino}.bak-${sello(ahora)}-${n}`
    copyFileSync(real, respaldo, constants.COPYFILE_EXCL)
    chmodSync(respaldo, anterior)
  } else {
    mkdirSync(dirname(real), { recursive: true, mode: 0o700 })
  }
  const temporal = `${real}.${process.pid}.tmp`
  rmSync(temporal, { force: true })
  writeFileSync(temporal, contenido, { mode: modo, flag: 'wx' })
  chmodSync(temporal, modo)
  renameSync(temporal, real)
  return respaldo
}

// ───────────────────────────── comandos ─────────────────────────────

interface Resultado {
  agente: string
  nombre: string
  estado: 'instalado' | 'sin_cambios' | 'manual' | 'impreso' | 'error'
  destino: string | null
  respaldo?: string | null
  motivo?: string
  fragmento?: string
}

const equipo = (ctx: Contexto): Equipo => ({ env: ctx.ent.env, plataforma: ctx.ent.plataforma })

/** `~/…` en lugar de la carpeta personal, para que las rutas sean legibles. */
function corta(e: Equipo, p: string): string {
  const casa = inicio(e)
  return p === casa || p.startsWith(casa + ruta(e).sep) ? `~${p.slice(casa.length)}` : p
}

function elegir(ctx: Contexto): Agente[] {
  const e = equipo(ctx)
  const ids = [...new Set(ctx.args)]
  const desconocidos = ids.filter((id) => !AGENTES.some((a) => a.id === id))
  if (desconocidos.length)
    throw new ErrorUso(
      `Agente desconocido: ${desconocidos.join(', ')}. Disponibles: ${AGENTES.map((a) => a.id).join(', ')}`,
    )
  if (ctx.bandera('todos')) {
    if (ids.length) throw new ErrorUso('Usa --todos o una lista de agentes, no ambos.')
    const hallados = AGENTES.filter((a) => detectado(a, e))
    if (!hallados.length)
      throw new ErrorCli(
        'No se detectó ningún agente en este equipo. Indícalo por su nombre: `openfactura mcp agentes`.',
        'sin_agentes',
      )
    return hallados
  }
  if (!ids.length)
    throw new ErrorUso(
      `Indica uno o más agentes o usa --todos. Disponibles: ${AGENTES.map((a) => a.id).join(', ')}`,
    )
  return ids.map(agente)
}

/** Clave que irá en la configuración del agente, o `null` si basta con el perfil guardado. */
async function claveParaAgentes(ctx: Contexto, remoto: boolean): Promise<string | null> {
  const delPerfil = leerConfig(ctx.ent.env).perfiles[ctx.cfg.perfil]?.apiKey
  if (!remoto && delPerfil) return null
  let clave = ctx.cfg.apiKey
  const verificar = !clave || clave !== delPerfil
  if (!clave) {
    if (!ctx.ent.esTTY)
      throw new ErrorCli(
        'No hay una clave de API. Ejecuta `openfactura login` (recomendado) o define OPENFACTURA_API_KEY.',
        'no_autenticado',
        SALIDA.noAutenticado,
      )
    ctx.ent.stderr(
      'No hay una sesión guardada. Recomendado: `openfactura login` y repetir este comando,',
    )
    ctx.ent.stderr('así la clave no se copia en la configuración de cada agente.')
    clave = (await ctx.ent.preguntar('Clave de API (of_test_… u of_live_…): ', true)).trim()
  }
  if (!esClaveValida(clave))
    throw new ErrorUso('La clave de API debe empezar con of_test_ o of_live_.')
  if (verificar) {
    await new ClienteApi({
      url: ctx.cfg.url,
      apiKey: clave,
      version: ctx.version,
      fetch: ctx.ent.fetch,
    }).pedir('GET', '/yo')
  }
  ctx.ent.stderr(
    `Aviso: la clave ${enmascarar(clave)} se escribirá en la configuración de los agentes (archivos 0600).${remoto ? '' : ' Con `openfactura login` no haría falta.'}`,
  )
  return clave
}

function servidor(ctx: Contexto, remoto: boolean, clave: string | null): Servidor {
  if (remoto) {
    const url = ctx.cfg.url === URL_POR_DEFECTO ? URL_MCP_CLOUD : `${ctx.cfg.url}/mcp`
    return { tipo: 'remoto', url, clave: clave ?? MARCADOR }
  }
  const env: Record<string, string> = { OPENFACTURA_URL: ctx.cfg.url }
  if (ctx.cfg.perfil !== 'default') env.OPENFACTURA_PROFILE = ctx.cfg.perfil
  if (clave) env.OPENFACTURA_API_KEY = clave
  return { tipo: 'local', env, clave }
}

/** Mismo servidor con la clave sustituida por un marcador, para imprimirlo. */
const visible = (s: Servidor): Servidor =>
  s.tipo === 'remoto'
    ? { ...s, clave: MARCADOR }
    : s.clave
      ? { ...s, env: { ...s.env, OPENFACTURA_API_KEY: MARCADOR }, clave: MARCADOR }
      : s

async function confirmarCambios(ctx: Contexto, lineas: string[]): Promise<void> {
  if (ctx.si || !lineas.length) return
  if (!ctx.ent.esTTY)
    throw new ErrorUso(
      'Vas a modificar la configuración de tus agentes y no hay una terminal para confirmar: agrega --yes.',
    )
  ctx.ent.stderr('Se modificará (con respaldo de cada archivo):')
  for (const l of lineas) ctx.ent.stderr(`  ${l}`)
  const respuesta = await ctx.ent.preguntar('¿Continuar? [s/N] ')
  if (!/^(s|si|sí|y|yes)$/i.test(respuesta.trim()))
    throw new ErrorCli('Operación cancelada.', 'cancelado')
}

export async function mcpInstall(ctx: Contexto): Promise<number> {
  const e = equipo(ctx)
  const agentes = elegir(ctx)
  const remoto = ctx.bandera('remoto')
  const imprimir = ctx.bandera('imprimir')
  const tienePerfil = Boolean(leerConfig(ctx.ent.env).perfiles[ctx.cfg.perfil]?.apiKey)

  const clave = imprimir
    ? remoto || !tienePerfil
      ? MARCADOR
      : null
    : await claveParaAgentes(ctx, remoto)
  const real = servidor(ctx, remoto, clave)
  const mostrado = visible(real)

  const planes = agentes.map((a) => ({
    a,
    plan: imprimir
      ? ({
          tipo: 'manual',
          motivo: 'impreso',
          ruta: a.ruta?.(e),
        } as Plan)
      : planificar(a, e, real),
  }))

  await confirmarCambios(
    ctx,
    planes.flatMap(({ a, plan }) =>
      plan.tipo === 'archivo'
        ? plan.contenido === plan.actual
          ? []
          : [`${a.nombre}: ${corta(e, plan.ruta)}`]
        : plan.tipo === 'comando'
          ? [`${a.nombre}: ${plan.visible} (alcance user)`]
          : [],
    ),
  )

  const resultados: Resultado[] = []
  for (const { a, plan } of planes) {
    const base = { agente: a.id, nombre: a.nombre }
    if (plan.tipo === 'manual') {
      resultados.push({
        ...base,
        estado: imprimir ? 'impreso' : 'manual',
        destino: plan.ruta ?? null,
        ...(imprimir ? {} : { motivo: plan.motivo }),
        fragmento: fragmento(a, mostrado),
      })
      continue
    }
    try {
      if (plan.tipo === 'archivo') {
        if (plan.contenido === plan.actual) {
          resultados.push({ ...base, estado: 'sin_cambios', destino: plan.ruta })
          continue
        }
        const respaldo = escribirSeguro(plan.ruta, plan.contenido, plan.conClave)
        resultados.push({ ...base, estado: 'instalado', destino: plan.ruta, respaldo })
        continue
      }
      let r = await ctx.ent.ejecutarProceso(plan.programa, plan.args)
      if (r.codigo !== 0 && a.formato === 'claude' && /already exists|ya existe/i.test(r.salida)) {
        await ctx.ent.ejecutarProceso(plan.programa, ['mcp', 'remove', '--scope', 'user', NOMBRE])
        r = await ctx.ent.ejecutarProceso(plan.programa, plan.args)
      }
      if (r.codigo !== 0) {
        resultados.push({
          ...base,
          estado: 'manual',
          destino: null,
          motivo: `«${plan.visible}» falló (${
            r.salida
              .trim()
              .split('\n')[0]
              ?.replaceAll(clave ?? MARCADOR, MARCADOR) || `código ${r.codigo}`
          })`,
          fragmento: fragmento(a, mostrado),
        })
        continue
      }
      resultados.push({ ...base, estado: 'instalado', destino: plan.visible })
    } catch (error) {
      resultados.push({ ...base, estado: 'error', destino: null, motivo: (error as Error).message })
    }
  }

  if (ctx.json) {
    ctx.ent.stdout(
      JSON.stringify(
        {
          modo: remoto ? 'remoto' : 'local',
          servidor: ctx.cfg.url,
          clave: imprimir ? 'marcador' : clave ? 'en_configuracion' : 'perfil',
          resultados,
        },
        null,
        2,
      ),
    )
  } else {
    for (const r of resultados) {
      const a = agente(r.agente)
      const destino = r.destino ? corta(e, r.destino) : null
      if (r.estado === 'instalado' || r.estado === 'sin_cambios') {
        ctx.ent.stdout(
          `✓ ${r.nombre}: ${destino} (${r.estado === 'sin_cambios' ? 'ya estaba configurado' : a.despues})`,
        )
        if (r.respaldo) ctx.ent.stdout(`  respaldo: ${corta(e, r.respaldo)}`)
      } else if (r.estado === 'error') {
        ctx.ent.stdout(`✗ ${r.nombre}: ${r.motivo}`)
      } else {
        const donde =
          a.formato === 'claude' || a.formato === 'vscode' ? 'Ejecuta:' : `Agrega a ${destino}:`
        ctx.ent.stdout(
          r.estado === 'impreso'
            ? `• ${r.nombre} — ${donde}`
            : `• ${r.nombre}: ${r.motivo}. ${donde}`,
        )
        ctx.ent.stdout((r.fragmento as string).replace(/^/gm, '    '))
      }
    }
    if (!remoto && !clave && !imprimir)
      ctx.ent.stdout(
        `La clave no se copió: el servidor usa el perfil «${ctx.cfg.perfil}» de \`openfactura login\`.`,
      )
  }
  return resultados.some((r) => r.estado === 'error') ? SALIDA.error : SALIDA.ok
}

export async function mcpAgentes(ctx: Contexto): Promise<undefined> {
  const e = equipo(ctx)
  const filas = AGENTES.map((a) => ({
    agente: a.id,
    nombre: a.nombre,
    detectado: detectado(a, e),
    destino:
      a.formato === 'claude'
        ? 'claude mcp add'
        : a.formato === 'vscode'
          ? 'code --add-mcp'
          : (a.ruta as (e: Equipo) => string)(e),
    docs: a.docs,
  }))
  if (ctx.json) ctx.ent.stdout(JSON.stringify(filas, null, 2))
  else {
    // Sin `tabla()`: las rutas largas no deben recortarse.
    const ancho = Math.max(...filas.map((f) => f.agente.length))
    ctx.ent.stdout(`${'AGENTE'.padEnd(ancho)}  DETECTADO  CONFIGURACIÓN`)
    for (const f of filas)
      ctx.ent.stdout(
        `${f.agente.padEnd(ancho)}  ${(f.detectado ? 'sí' : 'no').padEnd(9)}  ${corta(e, f.destino)}`,
      )
  }
  return undefined
}
