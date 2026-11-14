import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import {
  EVENTOS_WEBHOOK,
  esquemaCliente,
  esquemaConsultaRegistros,
  esquemaConsultaUso,
  esquemaInvalidacion,
  esquemaOperacionesEspeciales,
  esquemaProducto,
  esquemaRetorno,
  esquemaWebhook,
  TIPOS_DTE,
} from 'shared'
import { z } from 'zod'
import { type Ctx, exigir } from './contexto'
import { AppError } from './lib/errors'
import { consultarCatalogo, listarCatalogos } from './services/catalogos'
import { crearCliente, listarClientes } from './services/clientes'
import { emitir, invalidar, listar, obtener, previsualizar } from './services/dte'
import { ambienteActivo, obtenerEmisor } from './services/emisor'
import {
  informarOperacionesEspeciales,
  listarEventos,
  obtenerEvento,
  retornar,
} from './services/eventos'
import { ejecutarUnaVez } from './services/idempotencia'
import { crearProducto, listarProductos } from './services/productos'
import { listarRegistros } from './services/registros'
import { obtenerUso } from './services/uso'
import { crearWebhook, eliminarWebhook, listarWebhooks, probarWebhook } from './services/webhooks'

const tipos = Object.keys(TIPOS_DTE) as [keyof typeof TIPOS_DTE, ...Array<keyof typeof TIPOS_DTE>]
const listaTipos = Object.entries(TIPOS_DTE)
  .map(([codigo, nombre]) => `${codigo} ${nombre}`)
  .join(', ')

const DATOS_DTE = `Datos del documento. Campos habituales:
- items: [{ descripcion, cantidad, precioUni, tipoItem?: 1 bien | 2 servicio, codigo?, uniMedida?: 59 unidad, descuento?, tipoVenta?: 'gravada'|'exenta'|'noSujeta' }]. En Factura (01) precioUni INCLUYE IVA; en CCF (03), notas y remisión va SIN IVA.
- receptor: { nit o tipoDocumento+numDocumento, nrc, nombre, codActividad, descActividad, direccion: { departamento, municipio, distrito, complemento }, telefono, correo }. En Factura es opcional bajo USD 25,000. Puede omitirse si envía clienteId.
- condicionOperacion?: 1 contado | 2 crédito | 3 otro; pagos?; credito?: { plazo, periodo }.
- documentosRelacionados (notas de crédito/débito): [{ tipoDocumento, tipoGeneracion: 2, numeroDocumento: <código de generación>, fechaEmision }].
- Comprobante de Liquidación (08): documentos: [{ tipoDte: 01|03|05|06|11|18, numeroDocumento, fechaEmision, ventaNoSuj?, ventaExenta?, ventaGravada? (sin IVA), exportaciones?, iva? (sólo F y Retorno), tributos?: [{ codigo, valor }], ivaPercibido?, anulado? }], montos en positivo. Receptor = mandante.
- Documento Contable de Liquidación (09): receptor (afiliado) con nit y correo; periodo: { inicio, fin }; valorOperaciones (IVA incluido); montoSinPercepcion?; comision? o porcentComision?; entrega: { nombre, documento }.
- Comprobante de Donación (15): receptor = donante (codPais?, codDomiciliado?); documentosAsociados: [{ descripcion, detalle }] (resolución del donatario); items: [{ tipoDonacion: 1 efectivo | 2 bien | 3 servicio, descripcion, cantidad?, valorUni, depreciacion? }].
08, 09 y 15 no admiten contingencia.
Los códigos de catálogo se consultan con catalogo_buscar.`

const entradaEmision = {
  tipoDte: z.enum(tipos).describe(`Tipo de documento: ${listaTipos}`),
  datos: z.record(z.string(), z.unknown()).describe(DATOS_DTE),
  clienteId: z.string().optional().describe('Id de un cliente guardado para usarlo como receptor'),
  puntoVentaId: z.string().optional().describe('Punto de venta emisor; por defecto el primero'),
}

type Resultado = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

/** Ejecuta un servicio y traduce su resultado o su error al formato de herramienta MCP. */
export async function responder(accion: () => Promise<unknown> | unknown): Promise<Resultado> {
  try {
    const datos = await accion()
    return {
      content: [{ type: 'text', text: JSON.stringify(datos, null, 2) }],
      structuredContent: { resultado: datos } as Record<string, unknown>,
    }
  } catch (error) {
    if (!(error instanceof AppError) && !(error instanceof z.ZodError)) console.error(error)
    const cuerpo =
      error instanceof AppError
        ? error.toJSON()
        : error instanceof z.ZodError
          ? {
              error: {
                code: 'datos_invalidos',
                message: 'Datos inválidos',
                details: error.issues.map((i) => ({ ruta: i.path.join('.'), mensaje: i.message })),
              },
            }
          : { error: { code: 'error_interno', message: 'Ocurrió un error inesperado' } }
    return { content: [{ type: 'text', text: JSON.stringify(cuerpo, null, 2) }], isError: true }
  }
}

const lectura = { readOnlyHint: true, openWorldHint: false } as const

/** Servidor MCP de una petición: las herramientas actúan con los permisos del actor autenticado. */
export function crearServidorMcp(ctx: Ctx): McpServer {
  const servidor = new McpServer({ name: 'openfactura', version: '0.1.0' })

  servidor.registerTool(
    'emisor_obtener',
    {
      title: 'Ver emisor',
      description:
        'Datos fiscales del emisor, sus establecimientos y puntos de venta, el ambiente activo (00 pruebas, 01 producción) y si las credenciales del MH están cargadas.',
      inputSchema: {},
      annotations: lectura,
    },
    () => responder(() => obtenerEmisor(ctx)),
  )

  servidor.registerTool(
    'catalogo_buscar',
    {
      title: 'Buscar en catálogos del MH',
      description:
        'Consulta un catálogo oficial (CAT-001 … CAT-033): CAT-012 departamentos, CAT-013 municipios, CAT-008 distritos, CAT-019 actividades económicas, CAT-014 unidades de medida, CAT-017 formas de pago, CAT-022 tipos de documento. Sin `id` devuelve la lista de catálogos.',
      inputSchema: {
        id: z.string().max(10).optional().describe('Por ejemplo CAT-019'),
        q: z.string().max(100).optional().describe('Texto a buscar en el código o la descripción'),
        departamento: z
          .string()
          .max(2)
          .optional()
          .describe('Filtra municipios o distritos por departamento'),
      },
      annotations: lectura,
    },
    ({ id, q, departamento }) =>
      responder(() =>
        id
          ? consultarCatalogo(id.toUpperCase(), { q, departamento, limite: 50 })
          : listarCatalogos(),
      ),
  )

  servidor.registerTool(
    'clientes_buscar',
    {
      title: 'Buscar clientes',
      description: 'Busca clientes guardados por nombre o número de documento.',
      inputSchema: { q: z.string().max(100).optional() },
      annotations: lectura,
    },
    ({ q }) => responder(() => listarClientes(ctx, { q, limite: 25 })),
  )

  servidor.registerTool(
    'cliente_crear',
    {
      title: 'Crear cliente',
      description:
        'Guarda un cliente para reutilizarlo como receptor. tipoDocumento: 36 NIT, 13 DUI, 03 pasaporte, 02 carné de residente, 37 otro.',
      inputSchema: esquemaCliente.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (datos) => responder(() => crearCliente(ctx, esquemaCliente.parse(datos))),
  )

  servidor.registerTool(
    'productos_buscar',
    {
      title: 'Buscar productos',
      description:
        'Busca productos y servicios guardados por código o descripción. El precio guardado es SIN IVA.',
      inputSchema: { q: z.string().max(100).optional() },
      annotations: lectura,
    },
    ({ q }) => responder(() => listarProductos(ctx, { q, limite: 25 })),
  )

  servidor.registerTool(
    'producto_crear',
    {
      title: 'Crear producto',
      description: 'Guarda un producto o servicio. precioUnitario va SIN IVA.',
      inputSchema: esquemaProducto.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (datos) => responder(() => crearProducto(ctx, esquemaProducto.parse(datos))),
  )

  servidor.registerTool(
    'dte_validar',
    {
      title: 'Validar un DTE sin emitirlo',
      description:
        'Construye el documento y lo valida contra el esquema oficial del MH. No consume número de control, no firma y no transmite. Úsalo antes de dte_emitir.',
      inputSchema: entradaEmision,
      annotations: lectura,
    },
    (entrada) => responder(() => previsualizar(ctx, entrada)),
  )

  servidor.registerTool(
    'dte_emitir',
    {
      title: 'Emitir un DTE',
      description:
        'Emite un documento tributario electrónico: lo firma y lo transmite al Ministerio de Hacienda. Tiene efecto fiscal y consume un número de control. Confirma los datos con el usuario antes de llamar. Devuelve estado "procesado" con sello, o "contingencia" si el MH no respondió.',
      inputSchema: {
        ...entradaEmision,
        idempotencyKey: z
          .string()
          .min(8)
          .max(200)
          .describe(
            'Identificador único de este intento. Repetirlo devuelve el mismo resultado sin emitir dos veces.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ idempotencyKey, ...entrada }) =>
      responder(async () => {
        exigir(ctx, 'dte:emit')
        const r = await ejecutarUnaVez(
          ctx,
          `dte:${await ambienteActivo(ctx)}`,
          idempotencyKey,
          entrada,
          () => emitir(ctx, entrada),
        )
        return r.cuerpo
      }),
  )

  servidor.registerTool(
    'dte_listar',
    {
      title: 'Listar documentos',
      description: 'Lista los DTE del ambiente activo, del más reciente al más antiguo.',
      inputSchema: {
        tipo: z.enum(tipos).optional(),
        estado: z
          .enum(['pendiente', 'procesado', 'rechazado', 'contingencia', 'invalidado'])
          .optional(),
        q: z
          .string()
          .max(100)
          .optional()
          .describe('Receptor, número de control o código de generación'),
        desde: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('AAAA-MM-DD'),
        hasta: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('AAAA-MM-DD'),
        pagina: z.number().int().min(1).optional(),
      },
      annotations: lectura,
    },
    (filtros) => responder(() => listar(ctx, { pagina: 1, porPagina: 25, ...filtros })),
  )

  servidor.registerTool(
    'dte_obtener',
    {
      title: 'Ver un documento',
      description:
        'Detalle de un DTE por código de generación: estado, sello, JSON oficial, respuesta del MH, eventos y enlace de consulta pública.',
      inputSchema: { codigoGeneracion: z.string().max(40) },
      annotations: lectura,
    },
    ({ codigoGeneracion }) => responder(() => obtener(ctx, codigoGeneracion)),
  )

  servidor.registerTool(
    'dte_invalidar',
    {
      title: 'Invalidar un DTE',
      description:
        'Transmite el evento de invalidación de un DTE procesado, o de un evento de retorno u operaciones especiales (usa su código de generación). Un DTE con retorno vigente exige invalidar antes el retorno. Es irreversible y tiene efecto fiscal: confirma con el usuario. tipoAnulacion: 1 error en la información (requiere codigoGeneracionReemplazo), 2 rescindir la operación, 3 otro (requiere motivo y reemplazo).',
      inputSchema: { codigoGeneracion: z.string().max(40), ...esquemaInvalidacion.shape },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ codigoGeneracion, ...entrada }) =>
      responder(() => invalidar(ctx, codigoGeneracion, esquemaInvalidacion.parse(entrada))),
  )

  servidor.registerTool(
    'dte_retorno',
    {
      title: 'Registrar un retorno (evento 18)',
      description:
        'Transmite un Evento de Retorno sobre una Factura (01), Factura de Exportación (11) o Sujeto Excluido (14) procesados: devolución de bienes, reembolso o envases, sin invalidar el documento. Plazo: 3 meses desde la fecha del DTE. La suma de retornos no puede superar el DTE. precioUni: en Factura CON IVA (como en la factura); en 11 y 14 SIN IVA. Tiene efecto fiscal: confirma con el usuario. Para un Crédito Fiscal usa una Nota de Crédito (05).',
      inputSchema: {
        codigoGeneracion: z.string().max(40).describe('Código de generación del DTE original'),
        ...esquemaRetorno.shape,
        idempotencyKey: z
          .string()
          .min(8)
          .max(200)
          .describe(
            'Identificador único de este intento. Repetirlo devuelve el mismo resultado sin transmitir dos veces.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ codigoGeneracion, idempotencyKey, ...entrada }) =>
      responder(async () => {
        exigir(ctx, 'dte:emit')
        const r = await ejecutarUnaVez(
          ctx,
          `retorno:${await ambienteActivo(ctx)}:${codigoGeneracion.toUpperCase()}`,
          idempotencyKey,
          entrada,
          () => retornar(ctx, codigoGeneracion, esquemaRetorno.parse(entrada)),
        )
        return r.cuerpo
      }),
  )

  servidor.registerTool(
    'operaciones_especiales_informar',
    {
      title: 'Informar operaciones especiales (evento 17)',
      description:
        'Transmite un Evento de Operaciones Especiales: informa al MH las facturas simplificadas (tipoDocumento 02, siempre por rangos docDel–docAl) o los comprobantes de control interno (97, uno a uno con numDocumento o por rangos, sin mezclar) de un periodo. precioUni SIN IVA. `fecha` (AAAA-MM-DD) define el periodo. Los documentos anulados van en un evento aparte con codigoGeneracionRef. Tiene efecto fiscal: confirma con el usuario.',
      inputSchema: {
        ...esquemaOperacionesEspeciales.shape,
        idempotencyKey: z
          .string()
          .min(8)
          .max(200)
          .describe(
            'Identificador único de este intento. Repetirlo devuelve el mismo resultado sin transmitir dos veces.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ idempotencyKey, ...entrada }) =>
      responder(async () => {
        exigir(ctx, 'dte:emit')
        const r = await ejecutarUnaVez(
          ctx,
          `operaciones_especiales:${await ambienteActivo(ctx)}`,
          idempotencyKey,
          entrada,
          () => informarOperacionesEspeciales(ctx, esquemaOperacionesEspeciales.parse(entrada)),
        )
        return r.cuerpo
      }),
  )

  servidor.registerTool(
    'eventos_listar',
    {
      title: 'Listar eventos',
      description:
        'Eventos de retorno y de operaciones especiales del ambiente activo (los 50 más recientes).',
      inputSchema: { tipo: z.enum(['retorno', 'operaciones_especiales']).optional() },
      annotations: lectura,
    },
    ({ tipo }) => responder(() => listarEventos(ctx, tipo)),
  )

  servidor.registerTool(
    'evento_obtener',
    {
      title: 'Ver un evento',
      description:
        'Detalle de un evento por código de generación: estado, sello, JSON oficial y respuesta del MH.',
      inputSchema: { codigoGeneracion: z.string().max(40) },
      annotations: lectura,
    },
    ({ codigoGeneracion }) => responder(() => obtenerEvento(ctx, codigoGeneracion)),
  )

  servidor.registerTool(
    'webhooks_listar',
    {
      title: 'Listar webhooks',
      description:
        'Webhooks de la organización: URL, eventos suscritos y si están activos. Nunca devuelve el secreto de firma.',
      inputSchema: {},
      annotations: lectura,
    },
    () => responder(() => listarWebhooks(ctx)),
  )

  servidor.registerTool(
    'webhook_crear',
    {
      title: 'Crear webhook',
      description: `Registra una URL https:// que recibirá un POST firmado cuando cambie el estado de un documento. Eventos: ${EVENTOS_WEBHOOK.join(', ')}. Devuelve el secreto de firma (whsec_…) UNA sola vez: entrégaselo al usuario para que verifique la firma OpenFactura-Signature.`,
      inputSchema: esquemaWebhook.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (datos) => responder(() => crearWebhook(ctx, esquemaWebhook.parse(datos))),
  )

  servidor.registerTool(
    'webhook_eliminar',
    {
      title: 'Eliminar webhook',
      description:
        'Elimina un webhook y su historial de entregas. Deja de recibir notificaciones de inmediato. Confirma con el usuario.',
      inputSchema: { id: z.string().max(40) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id }) => responder(() => eliminarWebhook(ctx, id)),
  )

  servidor.registerTool(
    'webhook_probar',
    {
      title: 'Probar webhook',
      description:
        'Envía ya un evento webhook.prueba firmado a la URL del webhook y devuelve si respondió 2xx, su estado HTTP o el error.',
      inputSchema: { id: z.string().max(40) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ id }) => responder(() => probarWebhook(ctx, id)),
  )

  servidor.registerTool(
    'uso_obtener',
    {
      title: 'Uso por día',
      description:
        'Documentos emitidos, procesados y rechazados y monto procesado por día en el ambiente de la clave. Sin fechas: los últimos 30 días (hora de El Salvador). Sólo incluye los días con movimiento.',
      inputSchema: {
        desde: z.string().optional().describe('AAAA-MM-DD'),
        hasta: z.string().optional().describe('AAAA-MM-DD'),
      },
      annotations: lectura,
    },
    (datos) => responder(() => obtenerUso(ctx, esquemaConsultaUso.parse(datos))),
  )

  servidor.registerTool(
    'registros_listar',
    {
      title: 'Registros de la API',
      description:
        'Peticiones hechas con las claves de API de la organización en los últimos 30 días: fecha, método, patrón de ruta, estado HTTP, duración, origen (api o mcp) y clave. Sirve para depurar una integración. Requiere el permiso registros:read.',
      inputSchema: {
        estado: z.enum(['ok', 'error']).optional().describe('error: sólo respuestas 4xx y 5xx'),
        origen: z.enum(['api', 'mcp']).optional(),
        claveId: z.string().max(40).optional().describe('Sólo las peticiones de esta clave'),
        limite: z.number().int().min(1).max(200).optional().describe('Por defecto 50'),
        antesDe: z.number().int().optional().describe('Marca de tiempo (ms) para paginar atrás'),
      },
      annotations: lectura,
    },
    (datos) => responder(() => listarRegistros(ctx, esquemaConsultaRegistros.parse(datos))),
  )

  // Una extensión que falle al registrar (p. ej. un nombre repetido) no tumba el MCP de todos: se
  // registra el error y siguen las herramientas del núcleo y de las demás extensiones.
  for (const e of ctx.extensiones ?? []) {
    try {
      e.mcp?.(servidor, ctx)
    } catch (error) {
      console.error(`Falló el MCP de la extensión ${e.id}`, error)
    }
  }

  return servidor
}

/** Atiende una petición MCP (Streamable HTTP sin estado) con un servidor nuevo por petición. */
export const atenderMcp = (ctx: Ctx, request: Request) =>
  createMcpHandler(() => crearServidorMcp(ctx), { legacy: 'stateless' }).fetch(request)
