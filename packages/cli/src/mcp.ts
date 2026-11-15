import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { ErrorApi, ErrorCli } from './errores'
import {
  cliente,
  ESTADOS_DTE,
  EVENTOS_WEBHOOK,
  invalidacion,
  operacionesEspeciales,
  producto,
  retorno,
  TIPOS_DTE,
  tipoDte,
  webhook,
} from './esquemas'
import type { ClienteApi } from './http'

const listaTipos = Object.entries(TIPOS_DTE)
  .map(([codigo, nombre]) => `${codigo} ${nombre}`)
  .join(', ')

const DATOS_DTE = `Datos del documento. Campos habituales:
- items: [{ descripcion, cantidad, precioUni, tipoItem?: 1 bien | 2 servicio, codigo?, uniMedida?: 59 unidad, descuento?, tipoVenta?: 'gravada'|'exenta'|'noSujeta' }]. En Factura (01) precioUni INCLUYE IVA; en CCF (03), notas y remisión va SIN IVA.
- receptor: { nit o tipoDocumento+numDocumento, nrc, nombre, codActividad, descActividad, direccion: { departamento, municipio, distrito, complemento }, telefono, correo }. En Factura es opcional bajo USD 25,000. Puede omitirse si envías clienteId.
- condicionOperacion?: 1 contado | 2 crédito | 3 otro; pagos?; credito?: { plazo, periodo }.
- documentosRelacionados (notas de crédito/débito): [{ tipoDocumento, tipoGeneracion: 2, numeroDocumento: <código de generación>, fechaEmision }].
- Comprobante de Liquidación (08): documentos: [{ tipoDte: 01|03|05|06|11|18, numeroDocumento, fechaEmision, ventaNoSuj?, ventaExenta?, ventaGravada? (sin IVA), exportaciones?, iva? (sólo F y Retorno), tributos?: [{ codigo, valor }], ivaPercibido?, anulado? }], montos en positivo. Receptor = mandante.
- Documento Contable de Liquidación (09): receptor (afiliado) con nit y correo; periodo: { inicio, fin }; valorOperaciones (IVA incluido); montoSinPercepcion?; comision? o porcentComision?; entrega: { nombre, documento }.
- Comprobante de Donación (15): receptor = donante (codPais?, codDomiciliado?); documentosAsociados: [{ descripcion, detalle }] (resolución del donatario); items: [{ tipoDonacion: 1 efectivo | 2 bien | 3 servicio, descripcion, cantidad?, valorUni, depreciacion? }].
08, 09 y 15 no admiten contingencia.
Los códigos de catálogo se consultan con catalogo_buscar.`

const entradaEmision = {
  tipoDte: tipoDte.describe(`Tipo de documento: ${listaTipos}`),
  datos: z.record(z.string(), z.unknown()).describe(DATOS_DTE),
  clienteId: z.string().optional().describe('Id de un cliente guardado para usarlo como receptor'),
  puntoVentaId: z.string().optional().describe('Punto de venta emisor; por defecto el primero'),
}

interface Resultado {
  [clave: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

/** Llama a la API y traduce su respuesta o su error al formato de herramienta MCP. */
async function responder(accion: () => Promise<{ datos: unknown }>): Promise<Resultado> {
  try {
    const { datos } = await accion()
    return {
      content: [{ type: 'text', text: JSON.stringify(datos, null, 2) }],
      structuredContent: { resultado: datos },
    }
  } catch (error) {
    const cuerpo =
      error instanceof ErrorApi || error instanceof ErrorCli
        ? error.cuerpo
        : { error: { code: 'error_interno', message: 'Ocurrió un error inesperado' } }
    return { content: [{ type: 'text', text: JSON.stringify(cuerpo, null, 2) }], isError: true }
  }
}

const lectura = { readOnlyHint: true, openWorldHint: false } as const
const ruta = (segmento: string) => encodeURIComponent(segmento)

/** Las mismas herramientas que el servidor MCP remoto (`/mcp`), implementadas sobre la API REST. */
export function crearServidorMcp(api: ClienteApi, version: string): McpServer {
  const servidor = new McpServer({ name: 'openfactura', version })

  servidor.registerTool(
    'emisor_obtener',
    {
      title: 'Ver emisor',
      description:
        'Datos fiscales del emisor, sus establecimientos y puntos de venta, el ambiente activo (00 pruebas, 01 producción) y si las credenciales del MH están cargadas.',
      inputSchema: z.object({}),
      annotations: lectura,
    },
    () => responder(() => api.pedir('GET', '/emisor')),
  )

  servidor.registerTool(
    'catalogo_buscar',
    {
      title: 'Buscar en catálogos del MH',
      description:
        'Consulta un catálogo oficial (CAT-001 … CAT-033): CAT-012 departamentos, CAT-013 municipios, CAT-008 distritos, CAT-019 actividades económicas, CAT-014 unidades de medida, CAT-017 formas de pago, CAT-022 tipos de documento. Sin `id` devuelve la lista de catálogos.',
      inputSchema: z.object({
        id: z.string().optional().describe('Por ejemplo CAT-019'),
        q: z.string().optional().describe('Texto a buscar en el código o la descripción'),
        departamento: z
          .string()
          .optional()
          .describe('Filtra municipios o distritos por departamento'),
      }),
      annotations: lectura,
    },
    ({ id, q, departamento }) =>
      responder(() =>
        id
          ? api.pedir('GET', `/catalogos/${ruta(id.toUpperCase())}`, {
              query: { q, departamento, limite: 50 },
            })
          : api.pedir('GET', '/catalogos'),
      ),
  )

  servidor.registerTool(
    'clientes_buscar',
    {
      title: 'Buscar clientes',
      description: 'Busca clientes guardados por nombre o número de documento.',
      inputSchema: z.object({ q: z.string().optional() }),
      annotations: lectura,
    },
    ({ q }) => responder(() => api.pedir('GET', '/clientes', { query: { q, limite: 25 } })),
  )

  servidor.registerTool(
    'cliente_crear',
    {
      title: 'Crear cliente',
      description:
        'Guarda un cliente para reutilizarlo como receptor. tipoDocumento: 36 NIT, 13 DUI, 03 pasaporte, 02 carné de residente, 37 otro.',
      inputSchema: cliente,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (datos) => responder(() => api.pedir('POST', '/clientes', { cuerpo: datos })),
  )

  servidor.registerTool(
    'productos_buscar',
    {
      title: 'Buscar productos',
      description:
        'Busca productos y servicios guardados por código o descripción. El precio guardado es SIN IVA.',
      inputSchema: z.object({ q: z.string().optional() }),
      annotations: lectura,
    },
    ({ q }) => responder(() => api.pedir('GET', '/productos', { query: { q, limite: 25 } })),
  )

  servidor.registerTool(
    'producto_crear',
    {
      title: 'Crear producto',
      description: 'Guarda un producto o servicio. precioUnitario va SIN IVA.',
      inputSchema: producto,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (datos) => responder(() => api.pedir('POST', '/productos', { cuerpo: datos })),
  )

  servidor.registerTool(
    'dte_validar',
    {
      title: 'Validar un DTE sin emitirlo',
      description:
        'Construye el documento y lo valida contra el esquema oficial del MH. No consume número de control, no firma y no transmite. Úsalo antes de dte_emitir.',
      inputSchema: z.object(entradaEmision),
      annotations: lectura,
    },
    (entrada) => responder(() => api.pedir('POST', '/dte/validar', { cuerpo: entrada })),
  )

  servidor.registerTool(
    'dte_emitir',
    {
      title: 'Emitir un DTE',
      description:
        'Emite un documento tributario electrónico: lo firma y lo transmite al Ministerio de Hacienda. Tiene efecto fiscal y consume un número de control. Confirma los datos con el usuario antes de llamar. Devuelve estado "procesado" con sello, o "contingencia" si el MH no respondió.',
      inputSchema: z.object({
        ...entradaEmision,
        idempotencyKey: z
          .string()
          .min(8)
          .max(200)
          .describe(
            'Identificador único de este intento. Repetirlo devuelve el mismo resultado sin emitir dos veces.',
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ idempotencyKey, ...entrada }) =>
      responder(() =>
        api.pedir('POST', '/dte', {
          cuerpo: entrada,
          headers: { 'Idempotency-Key': idempotencyKey },
        }),
      ),
  )

  servidor.registerTool(
    'dte_listar',
    {
      title: 'Listar documentos',
      description: 'Lista los DTE del ambiente activo, del más reciente al más antiguo.',
      inputSchema: z.object({
        tipo: tipoDte.optional(),
        estado: z.enum(ESTADOS_DTE).optional(),
        q: z.string().optional().describe('Receptor, número de control o código de generación'),
        desde: z.string().optional().describe('AAAA-MM-DD'),
        hasta: z.string().optional().describe('AAAA-MM-DD'),
        pagina: z.number().int().min(1).optional(),
      }),
      annotations: lectura,
    },
    (filtros) =>
      responder(() =>
        api.pedir('GET', '/dte', { query: { pagina: 1, porPagina: 25, ...filtros } }),
      ),
  )

  servidor.registerTool(
    'dte_obtener',
    {
      title: 'Ver un documento',
      description:
        'Detalle de un DTE por código de generación: estado, sello, JSON oficial, respuesta del MH, eventos y enlace de consulta pública.',
      inputSchema: z.object({ codigoGeneracion: z.string() }),
      annotations: lectura,
    },
    ({ codigoGeneracion }) => responder(() => api.pedir('GET', `/dte/${ruta(codigoGeneracion)}`)),
  )

  servidor.registerTool(
    'dte_invalidar',
    {
      title: 'Invalidar un DTE',
      description:
        'Transmite el evento de invalidación de un DTE procesado, o de un evento de retorno u operaciones especiales (usa su código de generación). Un DTE con retorno vigente exige invalidar antes el retorno. Es irreversible y tiene efecto fiscal: confirma con el usuario. tipoAnulacion: 1 error en la información (requiere codigoGeneracionReemplazo), 2 rescindir la operación, 3 otro (requiere motivo y reemplazo).',
      inputSchema: z.object({ codigoGeneracion: z.string(), ...invalidacion.shape }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ codigoGeneracion, ...entrada }) =>
      responder(() =>
        api.pedir('POST', `/dte/${ruta(codigoGeneracion)}/invalidar`, { cuerpo: entrada }),
      ),
  )

  servidor.registerTool(
    'certificacion_estado',
    {
      title: 'Estado de la certificación ante Hacienda',
      description:
        'Pruebas mínimas que exige el MH para autorizar al emisor (90 Facturas, 75 Créditos Fiscales, 5 invalidaciones y 5 contingencias): requisitos, avance por meta y el último rechazo. Sólo en el ambiente de pruebas y en Open Factura Cloud.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => responder(() => api.pedir('GET', '/ext/certificacion')),
  )

  servidor.registerTool(
    'certificacion_avanzar',
    {
      title: 'Avanzar la certificación ante Hacienda',
      description:
        'Emite la siguiente tanda (hasta 5) de pruebas mínimas en el ambiente de pruebas; la inicia si aún no existe. Los documentos no tienen valor fiscal. Llama de nuevo mientras estado sea "en_curso". Si queda "detenida", muestra ultimoError al usuario antes de reintentar: el MH rechazó una prueba. Sólo en Open Factura Cloud.',
      inputSchema: z.object({
        clienteCcfId: z
          .string()
          .optional()
          .describe('Cliente contribuyente receptor de los CCF; por defecto el propio emisor'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ clienteCcfId }) =>
      responder(async () => {
        await api.pedir('POST', '/ext/certificacion/iniciar', {
          cuerpo: clienteCcfId ? { clienteCcfId } : {},
        })
        return api.pedir('POST', '/ext/certificacion/avanzar')
      }),
  )

  servidor.registerTool(
    'dte_retorno',
    {
      title: 'Registrar un retorno (evento 18)',
      description:
        'Transmite un Evento de Retorno sobre una Factura (01), Factura de Exportación (11) o Sujeto Excluido (14) procesados: devolución de bienes, reembolso o envases, sin invalidar el documento. Plazo: 3 meses desde la fecha del DTE. La suma de retornos no puede superar el DTE. Tiene efecto fiscal: confirma con el usuario. Para un Crédito Fiscal usa una Nota de Crédito (05).',
      inputSchema: z.object({
        codigoGeneracion: z.string().describe('Código de generación del DTE original'),
        ...retorno.shape,
        idempotencyKey: z
          .string()
          .min(8)
          .max(200)
          .describe(
            'Identificador único de este intento. Repetirlo devuelve el mismo resultado sin transmitir dos veces.',
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ codigoGeneracion, idempotencyKey, ...entrada }) =>
      responder(() =>
        api.pedir('POST', `/dte/${ruta(codigoGeneracion)}/retorno`, {
          cuerpo: entrada,
          headers: { 'Idempotency-Key': idempotencyKey },
        }),
      ),
  )

  servidor.registerTool(
    'operaciones_especiales_informar',
    {
      title: 'Informar operaciones especiales (evento 17)',
      description:
        'Transmite un Evento de Operaciones Especiales: informa al MH las facturas simplificadas (02, siempre por rangos docDel–docAl) o los comprobantes de control interno (97, uno a uno con numDocumento o por rangos, sin mezclar) de un periodo. precioUni SIN IVA. Los documentos anulados van en un evento aparte con codigoGeneracionRef. Tiene efecto fiscal: confirma con el usuario.',
      inputSchema: z.object({
        ...operacionesEspeciales.shape,
        idempotencyKey: z
          .string()
          .min(8)
          .max(200)
          .describe(
            'Identificador único de este intento. Repetirlo devuelve el mismo resultado sin transmitir dos veces.',
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ idempotencyKey, ...entrada }) =>
      responder(() =>
        api.pedir('POST', '/eventos/operaciones-especiales', {
          cuerpo: entrada,
          headers: { 'Idempotency-Key': idempotencyKey },
        }),
      ),
  )

  servidor.registerTool(
    'eventos_listar',
    {
      title: 'Listar eventos',
      description:
        'Eventos de retorno y de operaciones especiales del ambiente activo (los 50 más recientes).',
      inputSchema: z.object({ tipo: z.enum(['retorno', 'operaciones_especiales']).optional() }),
      annotations: lectura,
    },
    ({ tipo }) => responder(() => api.pedir('GET', '/eventos', { query: { tipo } })),
  )

  servidor.registerTool(
    'evento_obtener',
    {
      title: 'Ver un evento',
      description:
        'Detalle de un evento por código de generación: estado, sello, JSON oficial y respuesta del MH.',
      inputSchema: z.object({ codigoGeneracion: z.string() }),
      annotations: lectura,
    },
    ({ codigoGeneracion }) =>
      responder(() => api.pedir('GET', `/eventos/${ruta(codigoGeneracion)}`)),
  )

  servidor.registerTool(
    'webhooks_listar',
    {
      title: 'Listar webhooks',
      description:
        'Webhooks de la organización: URL, eventos suscritos y si están activos. Nunca devuelve el secreto de firma.',
      inputSchema: z.object({}),
      annotations: lectura,
    },
    () => responder(() => api.pedir('GET', '/webhooks')),
  )

  servidor.registerTool(
    'webhook_crear',
    {
      title: 'Crear webhook',
      description: `Registra una URL https:// que recibirá un POST firmado cuando cambie el estado de un documento. Eventos: ${EVENTOS_WEBHOOK.join(', ')}. Devuelve el secreto de firma (whsec_…) UNA sola vez: entrégaselo al usuario para que verifique la firma OpenFactura-Signature.`,
      inputSchema: webhook,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (datos) => responder(() => api.pedir('POST', '/webhooks', { cuerpo: datos })),
  )

  servidor.registerTool(
    'webhook_eliminar',
    {
      title: 'Eliminar webhook',
      description:
        'Elimina un webhook y su historial de entregas. Deja de recibir notificaciones de inmediato. Confirma con el usuario.',
      inputSchema: z.object({ id: z.string() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id }) => responder(() => api.pedir('DELETE', `/webhooks/${ruta(id)}`)),
  )

  servidor.registerTool(
    'webhook_probar',
    {
      title: 'Probar webhook',
      description:
        'Envía ya un evento webhook.prueba firmado a la URL del webhook y devuelve si respondió 2xx, su estado HTTP o el error.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ id }) => responder(() => api.pedir('POST', `/webhooks/${ruta(id)}/probar`)),
  )

  servidor.registerTool(
    'uso_obtener',
    {
      title: 'Uso por día',
      description:
        'Documentos emitidos, procesados y rechazados y monto procesado por día en el ambiente de la clave. Sin fechas: los últimos 30 días (hora de El Salvador). Sólo incluye los días con movimiento.',
      inputSchema: z.object({
        desde: z.string().optional().describe('AAAA-MM-DD'),
        hasta: z.string().optional().describe('AAAA-MM-DD'),
      }),
      annotations: lectura,
    },
    (query) => responder(() => api.pedir('GET', '/uso', { query })),
  )

  servidor.registerTool(
    'registros_listar',
    {
      title: 'Registros de la API',
      description:
        'Peticiones hechas con las claves de API de la organización en los últimos 30 días: fecha, método, patrón de ruta, estado HTTP, duración, origen (api o mcp) y clave. Sirve para depurar una integración. Requiere el permiso registros:read.',
      inputSchema: z.object({
        estado: z.enum(['ok', 'error']).optional().describe('error: sólo respuestas 4xx y 5xx'),
        origen: z.enum(['api', 'mcp']).optional(),
        claveId: z.string().max(40).optional().describe('Sólo las peticiones de esta clave'),
        limite: z.number().int().min(1).max(200).optional().describe('Por defecto 50'),
        antesDe: z.number().int().optional().describe('Marca de tiempo (ms) para paginar atrás'),
      }),
      annotations: lectura,
    },
    (query) => responder(() => api.pedir('GET', '/registros', { query })),
  )

  return servidor
}

/**
 * Sirve MCP por stdio hasta que el cliente cierra la entrada estándar.
 * Regla de stdio: stdout lleva sólo mensajes del protocolo; todo registro va a stderr.
 */
export function servirMcp(api: ClienteApi, version: string): Promise<void> {
  return new Promise((resolve) => {
    const conexion = serveStdio(() => crearServidorMcp(api, version), {
      onerror: (error) => process.stderr.write(`openfactura mcp: ${error.message}\n`),
    })
    const cerrar = () => void conexion.close().finally(resolve)
    process.stdin.once('end', cerrar)
    process.stdin.once('close', cerrar)
  })
}
