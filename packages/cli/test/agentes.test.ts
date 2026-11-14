import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { upsertToml, upsertYaml } from '../src/agentes'
import { ejecutar } from '../src/cli'
import { guardarConfig } from '../src/config'
import { CLAVE_PRUEBA, crearEntorno, json } from './ayuda'

const URL_SERVIDOR = 'https://factura.ejemplo.sv'
const YO = { actor: 'clave', permisos: ['dte:read'], ambiente: '00' }

/** Entorno con una sesión guardada (`openfactura login`): la clave nunca va al agente. */
function conPerfil(opciones: Parameters<typeof crearEntorno>[0] = {}) {
  const t = crearEntorno(opciones)
  guardarConfig(t.ent.env, { perfiles: { default: { url: URL_SERVIDOR, apiKey: CLAVE_PRUEBA } } })
  return t
}

const leer = (ruta: string) => readFileSync(ruta, 'utf8')
const leerJson = (ruta: string) => JSON.parse(leer(ruta))
const escribir = (ruta: string, texto: string) => {
  mkdirSync(dirname(ruta), { recursive: true })
  writeFileSync(ruta, texto)
}
const respaldos = (ruta: string) =>
  readdirSync(dirname(ruta)).filter((f) => f.startsWith(`${ruta.split('/').pop()}.bak-`))
const modo = (ruta: string) => statSync(ruta).mode & 0o777

/** Programa falso en un PATH temporal. */
function binario(carpeta: string, nombre: string): Record<string, string> {
  const bin = join(carpeta, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, nombre), '#!/bin/sh\nexit 0\n')
  chmodSync(join(bin, nombre), 0o755)
  return { PATH: bin }
}

const RUTAS: Record<string, (casa: string) => string> = {
  'claude-desktop': (c) =>
    join(c, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
  cursor: (c) => join(c, '.cursor', 'mcp.json'),
  windsurf: (c) => join(c, '.codeium', 'windsurf', 'mcp_config.json'),
  gemini: (c) => join(c, '.gemini', 'settings.json'),
  zed: (c) => join(c, '.config', 'zed', 'settings.json'),
  cline: (c) => join(c, '.cline', 'data', 'settings', 'cline_mcp_settings.json'),
}
const RAIZ: Record<string, string> = { zed: 'context_servers' }

describe('mcp install: agentes con JSON', () => {
  for (const [id, ruta] of Object.entries(RUTAS)) {
    const raiz = RAIZ[id] ?? 'mcpServers'

    it(`${id}: crea el archivo sin la clave cuando hay perfil`, async () => {
      const t = conPerfil()
      expect(await ejecutar(['mcp', 'install', id, '--yes'], t.ent)).toBe(0)
      const datos = leerJson(ruta(t.carpeta))
      const entrada = datos[raiz].openfactura
      expect(entrada.command).toBe('npx')
      expect(entrada.args).toEqual(['-y', '@openfactura/cli', 'mcp'])
      expect(entrada.env).toEqual({ OPENFACTURA_URL: URL_SERVIDOR })
      expect(leer(ruta(t.carpeta))).not.toContain('of_test_')
      expect(t.stdout).toMatch(/^✓ .+: ~\//m)
    })

    it(`${id}: conserva otros servidores y claves, y deja un respaldo`, async () => {
      const t = conPerfil()
      const archivo = ruta(t.carpeta)
      const original = {
        tema: 'oscuro',
        [raiz]: { otro: { command: 'otro-mcp' }, openfactura: { command: 'viejo' } },
      }
      escribir(archivo, JSON.stringify(original, null, 4))
      expect(await ejecutar(['mcp', 'install', id, '--yes'], t.ent)).toBe(0)
      const datos = leerJson(archivo)
      expect(datos.tema).toBe('oscuro')
      expect(datos[raiz].otro).toEqual({ command: 'otro-mcp' })
      expect(datos[raiz].openfactura.command).toBe('npx')
      expect(leer(archivo)).toMatch(/^ {4}"tema"/m)
      const [respaldo] = respaldos(archivo)
      expect(respaldo).toMatch(/\.bak-\d{14}$/)
      expect(JSON.parse(leer(join(dirname(archivo), respaldo as string)))).toEqual(original)
    })
  }

  it('cursor: archivo con comentarios → no se toca e imprime el fragmento', async () => {
    const t = conPerfil()
    const archivo = RUTAS.cursor?.(t.carpeta) as string
    const texto = '{\n  // mío\n  "mcpServers": {},\n}\n'
    escribir(archivo, texto)
    expect(await ejecutar(['mcp', 'install', 'cursor', '--yes'], t.ent)).toBe(0)
    expect(leer(archivo)).toBe(texto)
    expect(respaldos(archivo)).toEqual([])
    expect(t.stdout).toMatch(/• Cursor: el archivo no es JSON estricto/)
    expect(t.stdout).toContain('Agrega a ~/.cursor/mcp.json:')
    expect(t.stdout).toContain('"openfactura"')
  })

  it('zed con comentarios (JSONC) → imprime instrucciones', async () => {
    const t = conPerfil()
    const archivo = RUTAS.zed?.(t.carpeta) as string
    escribir(archivo, '// Zed settings\n{ "theme": "One Dark" }\n')
    await ejecutar(['mcp', 'install', 'zed', '--yes'], t.ent)
    expect(leer(archivo)).toBe('// Zed settings\n{ "theme": "One Dark" }\n')
    expect(t.stdout).toContain('"context_servers"')
  })

  it('segunda instalación igual: sin cambios y sin respaldo', async () => {
    const t = conPerfil()
    await ejecutar(['mcp', 'install', 'cursor', '--yes'], t.ent)
    await ejecutar(['mcp', 'install', 'cursor', '--yes'], t.ent)
    expect(respaldos(RUTAS.cursor?.(t.carpeta) as string)).toEqual([])
    expect(t.stdout).toContain('ya estaba configurado')
  })

  it('claude-desktop en Windows y Linux usa la ruta documentada', async () => {
    const w = conPerfil({ plataforma: 'win32', env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' } })
    await ejecutar(['mcp', 'install', 'claude-desktop', '--imprimir'], w.ent)
    expect(w.stdout).toContain('C:\\Users\\x\\AppData\\Roaming\\Claude\\claude_desktop_config.json')
    const l = conPerfil({ plataforma: 'linux' })
    await ejecutar(['mcp', 'install', 'claude-desktop', '--yes'], l.ent)
    expect(existsSync(join(l.carpeta, '.config', 'Claude', 'claude_desktop_config.json'))).toBe(
      true,
    )
  })

  it('cline respeta CLINE_MCP_SETTINGS_PATH', async () => {
    const t = conPerfil()
    const propia = join(t.carpeta, 'otra', 'mcp.json')
    t.ent.env.CLINE_MCP_SETTINGS_PATH = propia
    await ejecutar(['mcp', 'install', 'cline', '--yes'], t.ent)
    expect(leerJson(propia).mcpServers.openfactura.disabled).toBe(false)
  })
})

describe('mcp install: clave', () => {
  it('sin perfil, con OPENFACTURA_API_KEY: la verifica y escribe el archivo 0600', async () => {
    const t = crearEntorno({
      env: { OPENFACTURA_API_KEY: CLAVE_PRUEBA, OPENFACTURA_URL: URL_SERVIDOR },
      respuestas: [json(YO)],
    })
    expect(await ejecutar(['mcp', 'install', 'cursor', '--yes'], t.ent)).toBe(0)
    expect(t.llamadas[0]?.url.pathname).toBe('/api/v1/yo')
    const archivo = RUTAS.cursor?.(t.carpeta) as string
    expect(leerJson(archivo).mcpServers.openfactura.env.OPENFACTURA_API_KEY).toBe(CLAVE_PRUEBA)
    expect(modo(archivo)).toBe(0o600)
    expect(t.stderr).toContain('openfactura login')
    expect(t.stderr + t.stdout).not.toContain(CLAVE_PRUEBA)
  })

  it('sin perfil ni clave en terminal: pide la clave oculta', async () => {
    const t = crearEntorno({
      esTTY: true,
      env: { OPENFACTURA_URL: URL_SERVIDOR },
      respuestas: [json(YO)],
      respuestasTerminal: [CLAVE_PRUEBA, 's'],
    })
    expect(await ejecutar(['mcp', 'install', 'gemini'], t.ent)).toBe(0)
    expect(t.preguntas[0]?.oculto).toBe(true)
    expect(t.preguntas[1]?.pregunta).toMatch(/Continuar/)
    expect(t.stderr).toContain('~/.gemini/settings.json')
  })

  it('sin perfil ni clave y sin terminal: salida 3', async () => {
    const t = crearEntorno()
    expect(await ejecutar(['mcp', 'install', 'cursor', '--yes'], t.ent)).toBe(3)
    expect(existsSync(RUTAS.cursor?.(t.carpeta) as string)).toBe(false)
  })

  it('el perfil gana: con perfil y OPENFACTURA_API_KEY no se copia la clave', async () => {
    const t = conPerfil({ env: { OPENFACTURA_API_KEY: CLAVE_PRUEBA } })
    await ejecutar(['mcp', 'install', 'windsurf', '--yes'], t.ent)
    expect(leer(RUTAS.windsurf?.(t.carpeta) as string)).not.toContain('of_test_')
    expect(t.llamadas).toHaveLength(0)
  })

  it('perfil no predeterminado: se pasa OPENFACTURA_PROFILE', async () => {
    const t = crearEntorno()
    guardarConfig(t.ent.env, { perfiles: { prod: { url: URL_SERVIDOR, apiKey: CLAVE_PRUEBA } } })
    await ejecutar(['mcp', 'install', 'cursor', '--yes', '--profile', 'prod'], t.ent)
    expect(leerJson(RUTAS.cursor?.(t.carpeta) as string).mcpServers.openfactura.env).toEqual({
      OPENFACTURA_URL: URL_SERVIDOR,
      OPENFACTURA_PROFILE: 'prod',
    })
  })

  it('--remoto: url /mcp y encabezado Bearer, archivo 0600', async () => {
    const t = conPerfil()
    await ejecutar(['mcp', 'install', 'cursor', 'gemini', 'windsurf', '--remoto', '--yes'], t.ent)
    const cursor = leerJson(RUTAS.cursor?.(t.carpeta) as string).mcpServers.openfactura
    expect(cursor).toEqual({
      url: `${URL_SERVIDOR}/mcp`,
      headers: { Authorization: `Bearer ${CLAVE_PRUEBA}` },
    })
    expect(modo(RUTAS.cursor?.(t.carpeta) as string)).toBe(0o600)
    expect(leerJson(RUTAS.gemini?.(t.carpeta) as string).mcpServers.openfactura.httpUrl).toBe(
      `${URL_SERVIDOR}/mcp`,
    )
    expect(leerJson(RUTAS.windsurf?.(t.carpeta) as string).mcpServers.openfactura.serverUrl).toBe(
      `${URL_SERVIDOR}/mcp`,
    )
  })

  it('--remoto contra la nube: usa la URL canónica https://openfactura.co/mcp', async () => {
    const t = crearEntorno()
    guardarConfig(t.ent.env, { perfiles: { default: { apiKey: CLAVE_PRUEBA } } })
    await ejecutar(['mcp', 'install', 'cursor', '--remoto', '--yes'], t.ent)
    expect(leerJson(RUTAS.cursor?.(t.carpeta) as string).mcpServers.openfactura.url).toBe(
      'https://openfactura.co/mcp',
    )
  })

  it('--remoto en Claude Desktop: no se escribe, se explica', async () => {
    const t = conPerfil()
    expect(await ejecutar(['mcp', 'install', 'claude-desktop', '--remoto', '--yes'], t.ent)).toBe(0)
    expect(existsSync(RUTAS['claude-desktop']?.(t.carpeta) as string)).toBe(false)
    expect(t.stdout).toContain('no admite --remoto')
    expect(t.stdout).not.toContain(CLAVE_PRUEBA)
  })
})

describe('mcp install: seguridad y opciones', () => {
  it('--imprimir no escribe nada y no muestra la clave', async () => {
    const t = crearEntorno({ env: { OPENFACTURA_API_KEY: CLAVE_PRUEBA } })
    expect(
      await ejecutar(['mcp', 'install', 'cursor', 'codex', 'goose', 'zed', '--imprimir'], t.ent),
    ).toBe(0)
    expect(readdirSync(t.carpeta)).toEqual([])
    expect(t.stdout).toContain('<CLAVE_DE_API>')
    expect(t.stdout).toContain('[mcp_servers.openfactura]')
    expect(t.stdout).toContain('extensions:')
    expect(t.stdout).not.toContain(CLAVE_PRUEBA)
    expect(t.llamadas).toHaveLength(0)
  })

  it('sin terminal y sin --yes: salida 2 y nada escrito', async () => {
    const t = conPerfil()
    expect(await ejecutar(['mcp', 'install', 'cursor'], t.ent)).toBe(2)
    expect(t.stderr).toContain('--yes')
    expect(existsSync(RUTAS.cursor?.(t.carpeta) as string)).toBe(false)
  })

  it('respuesta negativa: cancela sin escribir', async () => {
    const t = conPerfil({ esTTY: true, respuestasTerminal: ['n'] })
    expect(await ejecutar(['mcp', 'install', 'cursor'], t.ent)).toBe(1)
    expect(existsSync(RUTAS.cursor?.(t.carpeta) as string)).toBe(false)
  })

  it('agente desconocido o sin agentes: salida 2', async () => {
    const t = conPerfil()
    expect(await ejecutar(['mcp', 'install', 'notepad'], t.ent)).toBe(2)
    expect(await ejecutar(['mcp', 'install'], t.ent)).toBe(2)
    expect(await ejecutar(['mcp', 'install', 'cursor', '--todos'], t.ent)).toBe(2)
  })

  it('--json resume cada agente', async () => {
    const t = conPerfil()
    await ejecutar(['mcp', 'install', 'cursor', 'claude-code', '--yes', '--json'], t.ent)
    const datos = JSON.parse(t.stdout)
    expect(datos.clave).toBe('perfil')
    expect(datos.resultados.map((r: { estado: string }) => r.estado)).toEqual([
      'instalado',
      'manual',
    ])
  })

  it('--todos instala sólo en los agentes detectados', async () => {
    const t = conPerfil()
    mkdirSync(join(t.carpeta, '.cursor'))
    mkdirSync(join(t.carpeta, '.gemini'))
    Object.assign(t.ent.env, binario(t.carpeta, 'codex'))
    expect(await ejecutar(['mcp', 'install', '--todos', '--yes', '--json'], t.ent)).toBe(0)
    const ids = JSON.parse(t.stdout).resultados.map((r: { agente: string }) => r.agente)
    expect(ids).toEqual(['cursor', 'codex', 'gemini'])
    expect(existsSync(join(t.carpeta, '.codex', 'config.toml'))).toBe(true)
  })

  it('--todos sin agentes detectados: salida 1', async () => {
    const t = conPerfil()
    expect(await ejecutar(['mcp', 'install', '--todos', '--yes'], t.ent)).toBe(1)
  })

  it('mcp agentes lista los diez con su ruta', async () => {
    const t = conPerfil()
    mkdirSync(join(t.carpeta, '.cursor'))
    expect(await ejecutar(['mcp', 'agentes', '--json'], t.ent)).toBe(0)
    const filas = JSON.parse(t.stdout) as Array<{ agente: string; detectado: boolean }>
    expect(filas).toHaveLength(10)
    expect(filas.find((f) => f.agente === 'cursor')?.detectado).toBe(true)
    expect(filas.find((f) => f.agente === 'zed')?.detectado).toBe(false)
  })

  it('`mcp` sin subcomando sigue siendo el servidor stdio', async () => {
    const t = crearEntorno()
    expect(await ejecutar(['mcp'], t.ent)).toBe(3)
    expect(t.stderr).toContain('No hay una clave')
  })
})

describe('mcp install: Claude Code y VS Code', () => {
  it('claude-code con el binario: ejecuta `claude mcp add` sin shell', async () => {
    const t = conPerfil()
    Object.assign(t.ent.env, binario(t.carpeta, 'claude'))
    expect(await ejecutar(['mcp', 'install', 'claude-code', '--yes'], t.ent)).toBe(0)
    expect(t.procesos).toHaveLength(1)
    expect(t.procesos[0]?.programa).toBe(join(t.carpeta, 'bin', 'claude'))
    expect(t.procesos[0]?.args).toEqual([
      'mcp',
      'add',
      '-e',
      `OPENFACTURA_URL=${URL_SERVIDOR}`,
      '--scope',
      'user',
      '--transport',
      'stdio',
      'openfactura',
      '--',
      'npx',
      '-y',
      '@openfactura/cli',
      'mcp',
    ])
    expect(t.stdout).toContain('✓ Claude Code')
  })

  it('claude-code ya configurado: lo quita y lo vuelve a agregar', async () => {
    const t = conPerfil({
      procesos: [{ codigo: 1, salida: 'MCP server openfactura already exists in user config' }],
    })
    Object.assign(t.ent.env, binario(t.carpeta, 'claude'))
    expect(await ejecutar(['mcp', 'install', 'claude-code', '--yes'], t.ent)).toBe(0)
    expect(t.procesos.map((p) => p.args[1])).toEqual(['add', 'remove', 'add'])
  })

  it('claude-code sin el binario: imprime el comando', async () => {
    const t = conPerfil()
    expect(await ejecutar(['mcp', 'install', 'claude-code', '--yes'], t.ent)).toBe(0)
    expect(t.procesos).toHaveLength(0)
    expect(t.stdout).toContain('no se encontró «claude» en el PATH')
    expect(t.stdout).toContain(
      `claude mcp add -e OPENFACTURA_URL=${URL_SERVIDOR} --scope user --transport stdio openfactura -- npx -y @openfactura/cli mcp`,
    )
  })

  it('vscode con `code`: usa --add-mcp con el JSON del servidor', async () => {
    const t = conPerfil()
    Object.assign(t.ent.env, binario(t.carpeta, 'code'))
    await ejecutar(['mcp', 'install', 'vscode', '--yes'], t.ent)
    const [opcion, config] = t.procesos[0]?.args ?? []
    expect(opcion).toBe('--add-mcp')
    expect(JSON.parse(config as string)).toEqual({
      name: 'openfactura',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@openfactura/cli', 'mcp'],
      env: { OPENFACTURA_URL: URL_SERVIDOR },
    })
  })
})

describe('Codex (TOML)', () => {
  it('crea, reemplaza de forma idempotente y conserva el resto', async () => {
    const t = conPerfil()
    const archivo = join(t.carpeta, '.codex', 'config.toml')
    const previo = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.openfactura]',
      'command = "viejo"',
      '',
      '[mcp_servers.openfactura.env]',
      'X = "1"',
      '',
      '[mcp_servers.otro]',
      'command = "otro"',
      '',
    ].join('\n')
    escribir(archivo, previo)
    await ejecutar(['mcp', 'install', 'codex', '--yes'], t.ent)
    const primero = leer(archivo)
    expect(primero).toBe(
      [
        'model = "gpt-5"',
        '',
        '[mcp_servers.otro]',
        'command = "otro"',
        '',
        '[mcp_servers.openfactura]',
        'command = "npx"',
        'args = ["-y", "@openfactura/cli", "mcp"]',
        `env = { OPENFACTURA_URL = "${URL_SERVIDOR}" }`,
        '',
      ].join('\n'),
    )
    expect(respaldos(archivo)).toHaveLength(1)
    await ejecutar(['mcp', 'install', 'codex', '--yes'], t.ent)
    expect(leer(archivo)).toBe(primero)
    expect(upsertToml(primero, '[mcp_servers.openfactura]\nurl = "x"')).toBe(
      upsertToml(
        upsertToml(primero, '[mcp_servers.openfactura]\nurl = "x"'),
        '[mcp_servers.openfactura]\nurl = "x"',
      ),
    )
  })

  it('openfactura definido de otra forma: no se toca', () => {
    expect(() => upsertToml('mcp_servers.openfactura.command = "x"\n', '[t]')).toThrow()
    expect(() => upsertToml('mcp_servers = { a = 1 }\n', '[t]')).toThrow()
  })

  it('respeta CODEX_HOME', async () => {
    const t = conPerfil()
    t.ent.env.CODEX_HOME = join(t.carpeta, 'codex-propio')
    await ejecutar(['mcp', 'install', 'codex', '--yes'], t.ent)
    expect(leer(join(t.carpeta, 'codex-propio', 'config.toml'))).toContain(
      '[mcp_servers.openfactura]',
    )
  })
})

describe('Goose (YAML)', () => {
  const ENTRADA = ['openfactura:', '  cmd: npx', '  timeout: 300']

  it('crea config.yaml con la extensión stdio', async () => {
    const t = conPerfil()
    await ejecutar(['mcp', 'install', 'goose', '--yes'], t.ent)
    const texto = leer(join(t.carpeta, 'xdg', 'goose', 'config.yaml'))
    expect(texto).toMatch(/^extensions:\n {2}openfactura:\n {4}enabled: true\n {4}type: stdio\n/)
    expect(texto).toContain('    cmd: npx\n    args: ["-y", "@openfactura/cli", "mcp"]\n')
    expect(texto).toContain(`    envs: {"OPENFACTURA_URL": "${URL_SERVIDOR}"}\n`)
  })

  it('agrega a un extensions existente y conserva el resto', () => {
    const previo = [
      'GOOSE_PROVIDER: openai',
      'extensions:',
      '  developer:',
      '    bundled: true',
      '    args:',
      '    - a',
      '',
      'GOOSE_MODEL: gpt-5',
      '',
    ].join('\n')
    expect(upsertYaml(previo, ENTRADA)).toBe(
      [
        'GOOSE_PROVIDER: openai',
        'extensions:',
        '  developer:',
        '    bundled: true',
        '    args:',
        '    - a',
        '  openfactura:',
        '    cmd: npx',
        '    timeout: 300',
        '',
        'GOOSE_MODEL: gpt-5',
        '',
      ].join('\n'),
    )
  })

  it('reemplaza la extensión openfactura de forma idempotente', () => {
    const previo = [
      'extensions:',
      '  openfactura:',
      '    cmd: viejo',
      '    args:',
      '    - x',
      '  otra:',
      '    cmd: otra',
      '',
    ].join('\n')
    const una = upsertYaml(previo, ENTRADA)
    expect(una).toBe(
      [
        'extensions:',
        '  openfactura:',
        '    cmd: npx',
        '    timeout: 300',
        '  otra:',
        '    cmd: otra',
        '',
      ].join('\n'),
    )
    expect(upsertYaml(una, ENTRADA)).toBe(una)
  })

  it('agrega extensions al final si no existe, y convierte extensions: {}', () => {
    expect(upsertYaml('GOOSE_MODEL: x\n', ENTRADA)).toBe(
      'GOOSE_MODEL: x\nextensions:\n  openfactura:\n    cmd: npx\n    timeout: 300\n',
    )
    expect(upsertYaml('extensions: {}\n', ENTRADA)).toBe(
      'extensions:\n  openfactura:\n    cmd: npx\n    timeout: 300\n',
    )
  })

  it('formas que no se pueden editar con seguridad: no se tocan', async () => {
    for (const texto of [
      'extensions: { a: 1 }\n',
      '{ "extensions": {} }\n',
      'extensions:\n- a\n',
      'extensions:\n  openfactura: { cmd: x }\n',
      'extensions:\n  a: 1\nextensions:\n  b: 2\n',
    ])
      expect(() => upsertYaml(texto, ENTRADA), texto).toThrow()

    const t = conPerfil()
    const archivo = join(t.carpeta, 'xdg', 'goose', 'config.yaml')
    escribir(archivo, 'extensions: { a: 1 }\n')
    expect(await ejecutar(['mcp', 'install', 'goose', '--yes'], t.ent)).toBe(0)
    expect(leer(archivo)).toBe('extensions: { a: 1 }\n')
    expect(t.stdout).toMatch(/• Goose: .*no se modificó/)
  })

  it('--remoto: streamable_http con uri y encabezado', async () => {
    const t = conPerfil()
    await ejecutar(['mcp', 'install', 'goose', '--remoto', '--yes'], t.ent)
    const archivo = join(t.carpeta, 'xdg', 'goose', 'config.yaml')
    const texto = leer(archivo)
    expect(texto).toContain('    type: streamable_http\n')
    expect(texto).toContain(`    uri: "${URL_SERVIDOR}/mcp"\n`)
    expect(texto).toContain(`    headers: {"Authorization": "Bearer ${CLAVE_PRUEBA}"}\n`)
    expect(modo(archivo)).toBe(0o600)
  })
})
