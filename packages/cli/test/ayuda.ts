import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Entorno } from '../src/comandos'

export const CLAVE_PRUEBA = 'of_test_abcdefghijklmnopqrstuvwxyz0123456789'
export const CLAVE_PRODUCCION = 'of_live_abcdefghijklmnopqrstuvwxyz0123456789'

export interface Llamada {
  url: URL
  metodo: string
  headers: Headers
  cuerpo: unknown
}

type Respuesta = Response | ((llamada: Llamada) => Response) | Error

export const json = (cuerpo: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

export const errorApi = (
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers = {},
) =>
  json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status, headers)

/** Entorno de pruebas: `fetch` falso con respuestas en cola, salidas capturadas y config temporal. */
export function crearEntorno(
  opciones: {
    env?: Record<string, string>
    respuestas?: Respuesta[]
    esTTY?: boolean
    entrada?: string
    respuestasTerminal?: string[]
    plataforma?: NodeJS.Platform
    procesos?: Array<{ codigo: number; salida: string }>
  } = {},
) {
  const carpeta = mkdtempSync(join(tmpdir(), 'openfactura-cli-'))
  const llamadas: Llamada[] = []
  const salida: string[] = []
  const errores: string[] = []
  const preguntas: Array<{ pregunta: string; oculto: boolean }> = []
  const cola = [...(opciones.respuestas ?? [])]
  const terminal = [...(opciones.respuestasTerminal ?? [])]
  const procesos: Array<{ programa: string; args: string[] }> = []
  const colaProcesos = [...(opciones.procesos ?? [])]

  const ent: Entorno = {
    env: { XDG_CONFIG_HOME: join(carpeta, 'xdg'), HOME: carpeta, ...opciones.env },
    fetch: (async (entrada: string | URL | Request, init?: RequestInit) => {
      const llamada: Llamada = {
        url: new URL(String(entrada)),
        metodo: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        cuerpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      }
      llamadas.push(llamada)
      const siguiente = cola.shift()
      if (!siguiente) throw new Error(`fetch inesperado: ${llamada.metodo} ${llamada.url}`)
      if (siguiente instanceof Error) throw siguiente
      return typeof siguiente === 'function' ? siguiente(llamada) : siguiente
    }) as typeof fetch,
    stdout: (linea) => void salida.push(linea),
    stderr: (linea) => void errores.push(linea),
    leerEntrada: async () => opciones.entrada ?? '',
    esTTY: opciones.esTTY ?? false,
    preguntar: async (pregunta, oculto = false) => {
      preguntas.push({ pregunta, oculto })
      return terminal.shift() ?? ''
    },
    cwd: carpeta,
    plataforma: opciones.plataforma ?? 'darwin',
    ejecutarProceso: async (programa, args) => {
      procesos.push({ programa, args })
      return colaProcesos.shift() ?? { codigo: 0, salida: '' }
    },
  }
  return {
    ent,
    carpeta,
    llamadas,
    preguntas,
    procesos,
    get stdout() {
      return salida.join('\n')
    },
    get stderr() {
      return errores.join('\n')
    },
  }
}
