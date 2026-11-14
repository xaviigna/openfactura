/**
 * API pública para autores de extensiones (`import … from 'server/extensiones'`). Todo lo que una
 * distribución necesita sale de aquí; lo demás del servidor es interno y puede cambiar.
 */

export type { McpServer } from '@modelcontextprotocol/server'
export type { OpcionesPdf } from '@openfactura/dte/pdf'
export type { Actor, Ctx } from './contexto'
export { actorDeMiembro, ambienteDeModo, exigir } from './contexto'
export * from './db'
export type { Bindings } from './env'
export type {
  CambioMiembro,
  CuentaExtension,
  EnlacePanel,
  Extension,
  GrupoPanel,
} from './extensiones'
export { ctxDeMiembro } from './extensiones'
export { crearWorker } from './index'
export { aleatorioBase62, cifrar, descifrar, hmacSha256Hex, nuevoId, sha256Hex } from './lib/crypto'
export {
  AppError,
  conflicto,
  invalido,
  mensajeDe,
  noAutenticado,
  noEncontrado,
  sinPermiso,
} from './lib/errors'
export { responder } from './mcp'
export { autenticar, autenticarUsuario, type Entorno, ipCliente } from './middleware/actor'
export { registrar } from './services/auditoria'
export { crearCliente, listarClientes, obtenerCliente } from './services/clientes'
export {
  archivoJson,
  emitir,
  invalidar,
  listar,
  obtener,
  pdf,
  previsualizar,
  transmitirContingencia,
  type VistaDocumento,
} from './services/dte'
export { ambienteActivo } from './services/emisor'
export {
  archivoEvento,
  informarOperacionesEspeciales,
  pdfEvento,
  retornar,
} from './services/eventos'
export { ejecutarUnaVez, type Respuesta } from './services/idempotencia'
export { consumir } from './services/limites'
export { publicar } from './services/webhooks'
