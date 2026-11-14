#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { ejecutar } from './cli'
import type { Entorno } from './comandos'
import { ErrorCli } from './errores'

async function leerEntrada(): Promise<string> {
  const partes: Buffer[] = []
  for await (const parte of process.stdin) partes.push(Buffer.from(parte))
  return Buffer.concat(partes).toString('utf8')
}

/** Pregunta en la terminal (por stderr, para no ensuciar stdout). `oculto` no muestra lo tecleado. */
function preguntar(pregunta: string, oculto = false): Promise<string> {
  const { stdin, stderr } = process
  return new Promise((resolve, reject) => {
    let texto = ''
    stderr.write(pregunta)
    if (oculto) stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    const terminar = (accion: () => void) => {
      stdin.off('data', alRecibir)
      if (oculto) {
        stdin.setRawMode(false)
        stderr.write('\n')
      }
      stdin.pause()
      accion()
    }
    const alRecibir = (dato: string) => {
      for (const letra of dato) {
        if (letra === '\n' || letra === '\r' || letra === '\u0004')
          return terminar(() => resolve(texto))
        if (letra === '\u0003')
          return terminar(() => reject(new ErrorCli('Operación cancelada.', 'cancelado')))
        if (letra === '\u007f' || letra === '\b') texto = texto.slice(0, -1)
        else if (letra >= ' ') texto += letra
      }
    }
    stdin.on('data', alRecibir)
  })
}

const entorno: Entorno = {
  env: process.env,
  fetch: (...args) => fetch(...args),
  stdout: (linea) => void process.stdout.write(`${linea}\n`),
  stderr: (linea) => void process.stderr.write(`${linea}\n`),
  leerEntrada,
  esTTY: Boolean(process.stdin.isTTY),
  preguntar,
  cwd: process.cwd(),
  plataforma: process.platform,
  ejecutarProceso: (programa, args) =>
    new Promise((resolve) => {
      let salida = ''
      const hijo = spawn(programa, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      hijo.stdout.on('data', (d) => (salida += d))
      hijo.stderr.on('data', (d) => (salida += d))
      hijo.on('error', (error) => resolve({ codigo: -1, salida: error.message }))
      hijo.on('close', (codigo) => resolve({ codigo: codigo ?? -1, salida }))
    }),
}

// Una tubería cerrada por el lector (`| head`) no es un error.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0)
})

process.exitCode = await ejecutar(process.argv.slice(2), entorno)
