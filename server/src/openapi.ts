/**
 * Documento OpenAPI 3.1 de la API REST (`/api/v1`).
 *
 * Los cuerpos y los parámetros de consulta salen de los esquemas zod de `shared` con
 * `z.toJSONSchema()`; las respuestas que zod no modela (Documento, Evento, error) se declaran aquí
 * a mano, igual que en `docs/api.md`.
 *
 * Para documentar una ruta nueva agregue una entrada a `RUTAS` con la misma ruta que en Hono
 * (`/dte/:codigo`). La prueba `server/test/openapi.test.ts` falla si una ruta de `v1` no aparece.
 *
 * Las rutas `/api/v1/ext/<id>/…` son de extensiones (ver `extensiones.ts`): no se registran en `v1`
 * y quedan fuera de este documento a propósito; cada distribución documenta las suyas.
 */
import {
  EVENTOS_WEBHOOK,
  esquemaBusqueda,
  esquemaClaveApi,
  esquemaCliente,
  esquemaConsultaAuditoria,
  esquemaConsultaCatalogo,
  esquemaConsultaEventos,
  esquemaConsultaRegistros,
  esquemaConsultaUso,
  esquemaCredenciales,
  esquemaEmision,
  esquemaEmisor,
  esquemaEstablecimiento,
  esquemaInvalidacion,
  esquemaListaDtes,
  esquemaOperacionesEspeciales,
  esquemaProducto,
  esquemaPuntoVenta,
  esquemaRetorno,
  esquemaWebhook,
  esquemaWebhookCambios,
  PERMISOS,
  type Permiso,
  TIPOS_DTE,
} from 'shared'
import { z } from 'zod'

type Esquema = Record<string, unknown>
type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete'

export const SERVIDOR = 'https://app.openfactura.co/api/v1'

const ref = (nombre: string): Esquema => ({ $ref: `#/components/schemas/${nombre}` })
const lista = (nombre: string): Esquema => ({ type: 'array', items: ref(nombre) })
const objeto = (properties: Record<string, Esquema>, required?: string[]): Esquema => ({
  type: 'object',
  properties,
  ...(required ? { required } : {}),
})
const texto: Esquema = { type: 'string' }
const textoONulo: Esquema = { type: ['string', 'null'] }
const numero: Esquema = { type: 'number' }
const entero: Esquema = { type: 'integer' }
const booleano: Esquema = { type: 'boolean' }
const ambiente: Esquema = { type: 'string', enum: ['00', '01'] }
const libre: Esquema = { type: 'object', additionalProperties: true }

/** Cuerpos de petición: esquemas zod de `shared`, publicados como componentes con nombre. */
const ENTRADAS = {
  Emisor: esquemaEmisor,
  Credenciales: esquemaCredenciales,
  Establecimiento: esquemaEstablecimiento,
  PuntoVenta: esquemaPuntoVenta,
  ClienteEntrada: esquemaCliente,
  ProductoEntrada: esquemaProducto,
  Emision: esquemaEmision,
  Invalidacion: esquemaInvalidacion,
  Retorno: esquemaRetorno,
  OperacionesEspeciales: esquemaOperacionesEspeciales,
  ClaveApiEntrada: esquemaClaveApi,
  WebhookEntrada: esquemaWebhook,
  WebhookCambios: esquemaWebhookCambios,
} as const
type Entrada = keyof typeof ENTRADAS

/** Código de error → estado HTTP. Fuente: `docs/api.md` y `server/src/lib/errors.ts`. */
export const CODIGOS_ERROR: Record<string, number> = {
  datos_invalidos: 400,
  dte_invalido: 400,
  no_autenticado: 401,
  plan_requerido: 402,
  sin_permiso: 403,
  origen_no_permitido: 403,
  no_encontrado: 404,
  sin_organizacion: 409,
  sin_organizacion_activa: 409,
  nit_bloqueado: 409,
  emisor_no_configurado: 409,
  credenciales_incompletas: 409,
  sin_punto_venta: 409,
  estado_invalido: 409,
  ambiente_distinto: 409,
  retorno_excedido: 409,
  retorno_vigente: 409,
  idempotencia_distinta: 409,
  idempotencia_en_curso: 409,
  cliente_repetido: 409,
  producto_repetido: 409,
  codigo_repetido: 409,
  sin_archivo: 409,
  limite_webhooks: 409,
  simulador_inactivo: 409,
  dte_rechazado: 422,
  invalidacion_rechazada: 422,
  contingencia_rechazada: 422,
  evento_rechazado: 422,
  limite_excedido: 429,
  limite_plan: 429,
  error_interno: 500,
  mh_credenciales_rechazadas: 502,
  mh_no_disponible: 502,
  emision_fallida: 502,
  emision_incierta: 502,
}

const DESCRIPCION_ESTADO: Record<number, string> = {
  400: 'Cuerpo o parámetros inválidos (`details` = `[{ ruta, mensaje }]`), o el DTE no cumple el esquema del MH (`details.problemas`).',
  401: 'Falta sesión, o la clave de API no es válida, fue revocada o expiró.',
  402: 'El plan de la cuenta no incluye la operación. Sólo lo devuelven distribuciones con planes (una instalación propia nunca).',
  403: 'Falta un permiso (`details.permiso`) o el origen de la petición con cookie no está permitido.',
  404: 'El recurso no existe en esta organización.',
  409: 'Falta configurar algo o hay un conflicto.',
  422: 'El MH rechazó el documento o el evento; `details.mh` = `{ codigo, mensaje, observaciones[] }`.',
  429: 'Límite de peticiones excedido (`Retry-After` indica cuántos segundos esperar) o, en distribuciones con planes, límite del plan alcanzado (`limite_plan`).',
  500: 'Error inesperado del servidor.',
  502: 'Problema hablando con el MH o al firmar. Con `emision_incierta` consulta `details.codigoGeneracion` antes de reintentar.',
}

export interface Respuesta {
  descripcion: string
  /** Esquema JSON del cuerpo, o `'pdf'` para un archivo PDF. */
  esquema?: Esquema | 'pdf'
}

/** Una operación de la API. Una entrada por método y ruta. */
export interface Ruta {
  metodo: Metodo
  /** Ruta relativa a `/api/v1`, con la sintaxis de Hono (`/dte/:codigo`). */
  ruta: string
  /** `operationId`: estable, en snake_case, como las herramientas MCP. */
  id: string
  etiqueta: string
  resumen: string
  descripcion?: string
  /** Permiso que exige el servicio. Sin valor: basta con estar autenticado. */
  permiso?: Permiso
  /** Sin autenticación (sólo el propio documento OpenAPI). */
  publica?: boolean
  consulta?: z.ZodObject
  cuerpo?: Entrada
  /** Admite `Idempotency-Key`. */
  idempotente?: boolean
  respuestas: Record<number, Respuesta>
  /** Estados de error propios de la ruta, además de 400/401/403/429 comunes. */
  errores?: number[]
}

const PARAMETROS: Record<string, { descripcion: string; esquema?: Esquema }> = {
  codigo: { descripcion: 'Código de generación (UUID) o id interno.' },
  id: { descripcion: 'Identificador del recurso.' },
  ambiente: { descripcion: '`00` pruebas, `01` producción.', esquema: ambiente },
}

const ok = (descripcion: string, esquema?: Esquema | 'pdf'): Record<number, Respuesta> => ({
  200: { descripcion, esquema },
})

export const RUTAS: Ruta[] = [
  // --- Documento OpenAPI ---------------------------------------------------
  {
    metodo: 'get',
    ruta: '/openapi.json',
    id: 'openapi_obtener',
    etiqueta: 'Sesión',
    resumen: 'Documento OpenAPI 3.1 de esta API',
    publica: true,
    respuestas: ok('Este documento.', libre),
  },

  // --- Sesión -------------------------------------------------------------
  {
    metodo: 'get',
    ruta: '/yo',
    id: 'yo_obtener',
    etiqueta: 'Sesión',
    resumen: 'Quién hace la petición',
    descripcion: 'Usuario o clave, organización, permisos y ambiente activo del MH.',
    respuestas: ok('Actor autenticado.', ref('Yo')),
  },
  {
    metodo: 'get',
    ruta: '/resumen',
    id: 'resumen_obtener',
    etiqueta: 'Sesión',
    resumen: 'Resumen del tablero',
    permiso: 'dte:read',
    respuestas: ok('Totales del mes y documentos recientes.', ref('Resumen')),
  },
  {
    metodo: 'get',
    ruta: '/uso',
    id: 'uso_obtener',
    etiqueta: 'Sesión',
    resumen: 'Uso por día',
    descripcion:
      'Documentos emitidos, procesados y rechazados y monto procesado por día en el ambiente activo. Sin fechas: los últimos 30 días (hora de El Salvador). Rango máximo: 366 días. Sólo incluye los días con movimiento.',
    permiso: 'dte:read',
    consulta: esquemaConsultaUso,
    respuestas: ok('Totales del rango y detalle por día.', ref('Uso')),
  },

  // --- Emisor -------------------------------------------------------------
  {
    metodo: 'get',
    ruta: '/emisor',
    id: 'emisor_obtener',
    etiqueta: 'Emisor',
    resumen: 'Datos del emisor',
    descripcion:
      'Datos fiscales, establecimientos con sus puntos de venta y el estado de las credenciales del MH por ambiente (sólo banderas; los secretos nunca se devuelven).',
    permiso: 'emisor:read',
    respuestas: ok('Emisor.', ref('EmisorVista')),
  },
  {
    metodo: 'put',
    ruta: '/emisor',
    id: 'emisor_guardar',
    etiqueta: 'Emisor',
    resumen: 'Crear o actualizar el emisor',
    descripcion:
      'La primera vez crea el establecimiento `M001` y el punto de venta `P001`. Si se omite `ambiente` se conserva el actual.',
    permiso: 'emisor:write',
    cuerpo: 'Emisor',
    respuestas: ok('Emisor guardado.', ref('EmisorVista')),
    errores: [409],
  },
  {
    metodo: 'put',
    ruta: '/emisor/credenciales/:ambiente',
    id: 'emisor_credenciales_guardar',
    etiqueta: 'Emisor',
    resumen: 'Guardar credenciales del MH',
    descripcion:
      '`certificado` es el contenido XML del `.crt` de Hacienda y va siempre con su contraseña. Se verifica que la contraseña abra la llave y que el NIT del certificado sea el del emisor. Los secretos se cifran y nunca se devuelven.',
    permiso: 'emisor:write',
    cuerpo: 'Credenciales',
    respuestas: ok('Estado de las credenciales de ese ambiente.', ref('EstadoCredenciales')),
    errores: [409],
  },
  {
    metodo: 'post',
    ruta: '/emisor/credenciales-prueba',
    id: 'emisor_credenciales_prueba',
    etiqueta: 'Emisor',
    resumen: 'Generar credenciales de prueba (simulador)',
    descripcion:
      'Sólo en servidores con `MH_SIMULADO=1`: genera un certificado y una contraseña de prueba para el ambiente `00`, atendidos por el simulador del MH. Sólo estas credenciales usan el simulador: las que sube el usuario van a Hacienda. Sin el simulador responde `409 simulador_inactivo`.',
    permiso: 'emisor:write',
    respuestas: ok('Estado de las credenciales del ambiente 00.', ref('EstadoCredenciales')),
    errores: [409],
  },
  {
    metodo: 'post',
    ruta: '/emisor/probar',
    id: 'emisor_probar',
    etiqueta: 'Emisor',
    resumen: 'Probar la conexión con el MH',
    permiso: 'emisor:write',
    respuestas: ok(
      'Resultado de autenticarse contra el MH.',
      objeto({ ok: booleano, ambiente, mensaje: texto }, ['ok', 'ambiente', 'mensaje']),
    ),
    errores: [409],
  },
  {
    metodo: 'get',
    ruta: '/establecimientos',
    id: 'establecimientos_listar',
    etiqueta: 'Emisor',
    resumen: 'Listar establecimientos',
    permiso: 'emisor:read',
    respuestas: ok('Establecimientos con sus puntos de venta.', lista('EstablecimientoVista')),
  },
  {
    metodo: 'post',
    ruta: '/establecimientos',
    id: 'establecimiento_crear',
    etiqueta: 'Emisor',
    resumen: 'Crear un establecimiento',
    permiso: 'emisor:write',
    cuerpo: 'Establecimiento',
    respuestas: {
      201: {
        descripcion: 'Lista actualizada de establecimientos.',
        esquema: lista('EstablecimientoVista'),
      },
    },
    errores: [409],
  },
  {
    metodo: 'put',
    ruta: '/establecimientos/:id',
    id: 'establecimiento_actualizar',
    etiqueta: 'Emisor',
    resumen: 'Actualizar un establecimiento',
    permiso: 'emisor:write',
    cuerpo: 'Establecimiento',
    respuestas: ok('Lista actualizada de establecimientos.', lista('EstablecimientoVista')),
    errores: [404, 409],
  },
  {
    metodo: 'post',
    ruta: '/puntos-venta',
    id: 'punto_venta_crear',
    etiqueta: 'Emisor',
    resumen: 'Crear un punto de venta',
    permiso: 'emisor:write',
    cuerpo: 'PuntoVenta',
    respuestas: {
      201: {
        descripcion: 'Lista actualizada de establecimientos.',
        esquema: lista('EstablecimientoVista'),
      },
    },
    errores: [404, 409],
  },

  // --- Clientes -----------------------------------------------------------
  {
    metodo: 'get',
    ruta: '/clientes',
    id: 'clientes_listar',
    etiqueta: 'Clientes',
    resumen: 'Buscar clientes',
    descripcion:
      '`q` busca por nombre, nombre comercial o número de documento. Hasta 100 por defecto.',
    permiso: 'clientes:read',
    consulta: esquemaBusqueda,
    respuestas: ok('Clientes.', lista('Cliente')),
  },
  {
    metodo: 'post',
    ruta: '/clientes',
    id: 'cliente_crear',
    etiqueta: 'Clientes',
    resumen: 'Crear un cliente',
    permiso: 'clientes:write',
    cuerpo: 'ClienteEntrada',
    respuestas: { 201: { descripcion: 'Cliente creado.', esquema: ref('Cliente') } },
    errores: [409],
  },
  {
    metodo: 'get',
    ruta: '/clientes/:id',
    id: 'cliente_obtener',
    etiqueta: 'Clientes',
    resumen: 'Obtener un cliente',
    permiso: 'clientes:read',
    respuestas: ok('Cliente.', ref('Cliente')),
    errores: [404],
  },
  {
    metodo: 'put',
    ruta: '/clientes/:id',
    id: 'cliente_actualizar',
    etiqueta: 'Clientes',
    resumen: 'Actualizar un cliente',
    permiso: 'clientes:write',
    cuerpo: 'ClienteEntrada',
    respuestas: ok('Cliente actualizado.', ref('Cliente')),
    errores: [404, 409],
  },
  {
    metodo: 'delete',
    ruta: '/clientes/:id',
    id: 'cliente_eliminar',
    etiqueta: 'Clientes',
    resumen: 'Eliminar un cliente',
    permiso: 'clientes:write',
    respuestas: ok('Eliminado.', objeto({ eliminado: { const: true } }, ['eliminado'])),
    errores: [404],
  },

  // --- Productos ----------------------------------------------------------
  {
    metodo: 'get',
    ruta: '/productos',
    id: 'productos_listar',
    etiqueta: 'Productos',
    resumen: 'Buscar productos',
    descripcion: '`q` busca por descripción o código. Hasta 100 por defecto.',
    permiso: 'productos:read',
    consulta: esquemaBusqueda,
    respuestas: ok('Productos.', lista('Producto')),
  },
  {
    metodo: 'post',
    ruta: '/productos',
    id: 'producto_crear',
    etiqueta: 'Productos',
    resumen: 'Crear un producto',
    descripcion: '`precioUnitario` va sin IVA.',
    permiso: 'productos:write',
    cuerpo: 'ProductoEntrada',
    respuestas: { 201: { descripcion: 'Producto creado.', esquema: ref('Producto') } },
    errores: [409],
  },
  {
    metodo: 'get',
    ruta: '/productos/:id',
    id: 'producto_obtener',
    etiqueta: 'Productos',
    resumen: 'Obtener un producto',
    permiso: 'productos:read',
    respuestas: ok('Producto.', ref('Producto')),
    errores: [404],
  },
  {
    metodo: 'put',
    ruta: '/productos/:id',
    id: 'producto_actualizar',
    etiqueta: 'Productos',
    resumen: 'Actualizar un producto',
    permiso: 'productos:write',
    cuerpo: 'ProductoEntrada',
    respuestas: ok('Producto actualizado.', ref('Producto')),
    errores: [404, 409],
  },
  {
    metodo: 'delete',
    ruta: '/productos/:id',
    id: 'producto_eliminar',
    etiqueta: 'Productos',
    resumen: 'Eliminar un producto',
    permiso: 'productos:write',
    respuestas: ok('Eliminado.', objeto({ eliminado: { const: true } }, ['eliminado'])),
    errores: [404],
  },

  // --- DTE ----------------------------------------------------------------
  {
    metodo: 'get',
    ruta: '/dte',
    id: 'dte_listar',
    etiqueta: 'DTE',
    resumen: 'Listar documentos',
    descripcion:
      'Documentos del ambiente activo. `q` busca por receptor, número de control o código de generación; `desde`/`hasta` en formato AAAA-MM-DD.',
    permiso: 'dte:read',
    consulta: esquemaListaDtes,
    respuestas: ok('Página de documentos.', ref('ListaDocumentos')),
  },
  {
    metodo: 'post',
    ruta: '/dte',
    id: 'dte_emitir',
    etiqueta: 'DTE',
    resumen: 'Emitir un DTE',
    descripcion:
      'Construye, valida, firma y transmite el documento al MH. `datos` es la entrada del constructor del SDK `@openfactura/dte` para ese tipo. En Factura (01) `precioUni` incluye IVA; en Crédito Fiscal, notas y remisión va sin IVA. Si se envía `clienteId` y falta `datos.receptor`, el receptor se toma del cliente guardado. El Comprobante de Liquidación (08), el Documento Contable de Liquidación (09) y el Comprobante de Donación (15) no admiten contingencia: con el MH caído responden `mh_no_disponible`.',
    permiso: 'dte:emit',
    cuerpo: 'Emision',
    idempotente: true,
    respuestas: {
      201: { descripcion: 'Procesado por el MH, con `selloRecibido`.', esquema: ref('Documento') },
      202: {
        descripcion:
          'Contingencia: el MH no respondió; el DTE quedó firmado y se transmite después.',
        esquema: ref('Documento'),
      },
    },
    errores: [404, 409, 422, 502],
  },
  {
    metodo: 'post',
    ruta: '/dte/validar',
    id: 'dte_validar',
    etiqueta: 'DTE',
    resumen: 'Validar sin emitir',
    descripcion:
      'Construye el DTE y lo valida contra el esquema del MH. No consume número de control, no firma y no transmite.',
    permiso: 'dte:emit',
    cuerpo: 'Emision',
    respuestas: ok('DTE construido, problemas y total.', ref('Validacion')),
    errores: [404, 409],
  },
  {
    metodo: 'get',
    ruta: '/dte/:codigo',
    id: 'dte_obtener',
    etiqueta: 'DTE',
    resumen: 'Obtener un documento',
    permiso: 'dte:read',
    respuestas: ok(
      'Documento con su DTE, la respuesta del MH y sus eventos.',
      ref('DocumentoDetalle'),
    ),
    errores: [404],
  },
  {
    metodo: 'get',
    ruta: '/dte/:codigo/json',
    id: 'dte_json',
    etiqueta: 'DTE',
    resumen: 'Archivo DTE oficial (JSON)',
    descripcion:
      'Estructura del DTE más `firmaElectronica` y `selloRecibido`, para entregar al receptor.',
    permiso: 'dte:read',
    respuestas: ok('Archivo DTE.', libre),
    errores: [404, 409],
  },
  {
    metodo: 'get',
    ruta: '/dte/:codigo/pdf',
    id: 'dte_pdf',
    etiqueta: 'DTE',
    resumen: 'Representación gráfica (PDF)',
    permiso: 'dte:read',
    respuestas: ok('PDF del documento.', 'pdf'),
    errores: [404, 409],
  },
  {
    metodo: 'post',
    ruta: '/dte/:codigo/invalidar',
    id: 'dte_invalidar',
    etiqueta: 'DTE',
    resumen: 'Invalidar un documento o un evento',
    descripcion:
      'Irreversible. `tipoAnulacion`: 1 error en la información (requiere `codigoGeneracionReemplazo`), 2 rescindir la operación, 3 otro (requiere motivo y reemplazo). `:codigo` también puede ser un evento de retorno u operaciones especiales: entonces responde `{ invalidado, tipo, codigoGeneracion }`. Un DTE con un retorno vigente responde `409 retorno_vigente`.',
    permiso: 'dte:invalidate',
    cuerpo: 'Invalidacion',
    respuestas: ok('Documento invalidado, o el evento invalidado.', {
      oneOf: [
        ref('DocumentoDetalle'),
        objeto(
          {
            invalidado: { const: true },
            tipo: { type: 'string', enum: ['retorno', 'operaciones_especiales'] },
            codigoGeneracion: texto,
          },
          ['invalidado', 'tipo', 'codigoGeneracion'],
        ),
      ],
    }),
    errores: [404, 409, 422, 502],
  },
  {
    metodo: 'post',
    ruta: '/dte/:codigo/retorno',
    id: 'dte_retorno',
    etiqueta: 'Eventos',
    resumen: 'Evento de Retorno (18)',
    descripcion:
      'Devolución de bienes, reembolsos o envases sobre una Factura (01), Factura de Exportación (11) o Sujeto Excluido (14) procesados, sin invalidar el documento. `precioUni` como en el documento original (en Factura, con IVA). Plazo: 3 meses desde la fecha del DTE. La suma de los retornos no puede superar el documento (`409 retorno_excedido` con `details.disponible`).',
    permiso: 'dte:emit',
    cuerpo: 'Retorno',
    idempotente: true,
    respuestas: { 201: { descripcion: 'Evento procesado.', esquema: ref('Evento') } },
    errores: [404, 409, 422, 502],
  },
  {
    metodo: 'post',
    ruta: '/contingencia/transmitir',
    id: 'contingencia_transmitir',
    etiqueta: 'DTE',
    resumen: 'Transmitir documentos en contingencia',
    descripcion:
      'Envía el evento de contingencia con los documentos en estado `contingencia` del ambiente activo (hasta 40 por llamada) y luego transmite cada uno. Si `restantes` es mayor que 0, vuelve a llamar. Requiere el responsable configurado en el emisor.',
    permiso: 'dte:invalidate',
    respuestas: ok(
      'Resultado del lote.',
      objeto(
        {
          evento: {
            type: ['object', 'null'],
            properties: { id: texto, codigoGeneracion: texto },
            description: 'Nulo si no había documentos en contingencia.',
          },
          procesados: lista('Documento'),
          rechazados: lista('Documento'),
          restantes: entero,
        },
        ['evento', 'procesados', 'rechazados', 'restantes'],
      ),
    ),
    errores: [409, 422, 502],
  },

  // --- Eventos ------------------------------------------------------------
  {
    metodo: 'post',
    ruta: '/eventos/operaciones-especiales',
    id: 'operaciones_especiales_informar',
    etiqueta: 'Eventos',
    resumen: 'Evento de Operaciones Especiales (17)',
    descripcion:
      'Informa facturas simplificadas (`tipoDocumento: "02"`, siempre por rangos `docDel`–`docAl`) o comprobantes de control interno (`"97"`, uno a uno o por rangos; no se mezclan). Precios sin IVA. `fecha` define el periodo (por defecto hoy, nunca futura).',
    permiso: 'dte:emit',
    cuerpo: 'OperacionesEspeciales',
    idempotente: true,
    respuestas: { 201: { descripcion: 'Evento procesado.', esquema: ref('Evento') } },
    errores: [409, 422, 502],
  },
  {
    metodo: 'get',
    ruta: '/eventos',
    id: 'eventos_listar',
    etiqueta: 'Eventos',
    resumen: 'Listar eventos',
    descripcion:
      'Los 50 eventos de retorno u operaciones especiales más recientes del ambiente activo.',
    permiso: 'dte:read',
    consulta: esquemaConsultaEventos,
    respuestas: ok('Eventos.', lista('Evento')),
  },
  {
    metodo: 'get',
    ruta: '/eventos/:codigo',
    id: 'evento_obtener',
    etiqueta: 'Eventos',
    resumen: 'Obtener un evento',
    permiso: 'dte:read',
    respuestas: ok('Evento con su JSON y la respuesta del MH.', ref('EventoDetalle')),
    errores: [404],
  },
  {
    metodo: 'get',
    ruta: '/eventos/:codigo/json',
    id: 'evento_json',
    etiqueta: 'Eventos',
    resumen: 'Archivo del evento (JSON)',
    permiso: 'dte:read',
    respuestas: ok('Archivo del evento firmado, con sello.', libre),
    errores: [404],
  },
  {
    metodo: 'get',
    ruta: '/eventos/:codigo/pdf',
    id: 'evento_pdf',
    etiqueta: 'Eventos',
    resumen: 'Representación gráfica del evento (PDF)',
    permiso: 'dte:read',
    respuestas: ok('PDF del evento.', 'pdf'),
    errores: [404],
  },

  // --- Catálogos ----------------------------------------------------------
  {
    metodo: 'get',
    ruta: '/catalogos',
    id: 'catalogos_listar',
    etiqueta: 'Catálogos',
    resumen: 'Listar catálogos del MH',
    respuestas: ok('Catálogos disponibles.', {
      type: 'array',
      items: objeto({ id: texto, nombre: texto, total: entero }),
    }),
  },
  {
    metodo: 'get',
    ruta: '/catalogos/:id',
    id: 'catalogo_buscar',
    etiqueta: 'Catálogos',
    resumen: 'Consultar un catálogo',
    descripcion:
      '`CAT-012` departamentos, `CAT-013` municipios (filtra con `departamento`), `CAT-008` distritos, `CAT-019` actividades económicas (50 por defecto; usa `q`), `CAT-014` unidades, `CAT-017` formas de pago, `CAT-022` documentos.',
    consulta: esquemaConsultaCatalogo,
    respuestas: ok('Valores del catálogo.', ref('Catalogo')),
    errores: [404],
  },

  // --- Claves de API y auditoría -------------------------------------------
  {
    metodo: 'get',
    ruta: '/claves',
    id: 'claves_listar',
    etiqueta: 'Claves de API',
    resumen: 'Listar claves de API',
    permiso: 'claves:manage',
    respuestas: ok('Claves (nunca la clave completa).', lista('Clave')),
  },
  {
    metodo: 'post',
    ruta: '/claves',
    id: 'clave_crear',
    etiqueta: 'Claves de API',
    resumen: 'Crear una clave de API',
    descripcion:
      'La clave completa (`clave`) se devuelve sólo en esta respuesta. Una clave nunca puede llevar `emisor:write`, `claves:manage` ni `auditoria:read`.',
    permiso: 'claves:manage',
    cuerpo: 'ClaveApiEntrada',
    respuestas: { 201: { descripcion: 'Clave creada.', esquema: ref('ClaveCreada') } },
  },
  {
    metodo: 'delete',
    ruta: '/claves/:id',
    id: 'clave_revocar',
    etiqueta: 'Claves de API',
    resumen: 'Revocar una clave',
    permiso: 'claves:manage',
    respuestas: ok('Revocada de inmediato.', objeto({ revocada: { const: true } }, ['revocada'])),
    errores: [404],
  },
  {
    metodo: 'get',
    ruta: '/webhooks',
    id: 'webhooks_listar',
    etiqueta: 'Webhooks',
    resumen: 'Listar webhooks',
    permiso: 'webhooks:manage',
    respuestas: ok('Webhooks de la organización (nunca el secreto).', lista('Webhook')),
  },
  {
    metodo: 'post',
    ruta: '/webhooks',
    id: 'webhook_crear',
    etiqueta: 'Webhooks',
    resumen: 'Crear un webhook',
    descripcion:
      'Sólo `https://` y nunca destinos privados o locales. Máximo 10 por organización. El secreto (`whsec_…`) se devuelve sólo en esta respuesta.',
    permiso: 'webhooks:manage',
    cuerpo: 'WebhookEntrada',
    respuestas: { 201: { descripcion: 'Webhook creado.', esquema: ref('WebhookConSecreto') } },
    errores: [409],
  },
  {
    metodo: 'patch',
    ruta: '/webhooks/:id',
    id: 'webhook_actualizar',
    etiqueta: 'Webhooks',
    resumen: 'Cambiar URL, descripción, eventos o activarlo/desactivarlo',
    permiso: 'webhooks:manage',
    cuerpo: 'WebhookCambios',
    respuestas: ok('Webhook actualizado.', ref('Webhook')),
    errores: [404],
  },
  {
    metodo: 'delete',
    ruta: '/webhooks/:id',
    id: 'webhook_eliminar',
    etiqueta: 'Webhooks',
    resumen: 'Eliminar un webhook y sus entregas',
    permiso: 'webhooks:manage',
    respuestas: ok('Eliminado.', objeto({ eliminado: { const: true } }, ['eliminado'])),
    errores: [404],
  },
  {
    metodo: 'post',
    ruta: '/webhooks/:id/rotar-secreto',
    id: 'webhook_rotar_secreto',
    etiqueta: 'Webhooks',
    resumen: 'Generar un secreto nuevo',
    descripcion: 'El secreto anterior deja de valer de inmediato. El nuevo se devuelve sólo aquí.',
    permiso: 'webhooks:manage',
    respuestas: ok('Webhook con el secreto nuevo.', ref('WebhookConSecreto')),
    errores: [404],
  },
  {
    metodo: 'post',
    ruta: '/webhooks/:id/probar',
    id: 'webhook_probar',
    etiqueta: 'Webhooks',
    resumen: 'Enviar un evento `webhook.prueba` ahora',
    permiso: 'webhooks:manage',
    respuestas: ok(
      'Resultado del envío (no se reintenta).',
      objeto(
        {
          entregado: booleano,
          status: { type: ['integer', 'null'] },
          error: textoONulo,
          entrega: ref('EntregaWebhook'),
        },
        ['entregado', 'entrega'],
      ),
    ),
    errores: [404],
  },
  {
    metodo: 'get',
    ruta: '/webhooks/:id/entregas',
    id: 'webhook_entregas',
    etiqueta: 'Webhooks',
    resumen: 'Últimas 50 entregas de un webhook',
    permiso: 'webhooks:manage',
    respuestas: ok(
      'Entregas, de la más reciente a la más antigua (sin el cuerpo).',
      lista('EntregaWebhook'),
    ),
    errores: [404],
  },
  {
    metodo: 'post',
    ruta: '/webhooks/entregas/:id/reenviar',
    id: 'webhook_entrega_reenviar',
    etiqueta: 'Webhooks',
    resumen: 'Reenviar una entrega ahora',
    descripcion: 'Mismo cuerpo, firma nueva; reinicia el calendario de reintentos.',
    permiso: 'webhooks:manage',
    respuestas: ok('Entrega tras el envío.', ref('EntregaWebhook')),
    errores: [404],
  },
  {
    metodo: 'get',
    ruta: '/auditoria',
    id: 'auditoria_listar',
    etiqueta: 'Auditoría',
    resumen: 'Bitácora de auditoría',
    descripcion: 'Paginación hacia atrás con `antesDe` (marca de tiempo en milisegundos).',
    permiso: 'auditoria:read',
    consulta: esquemaConsultaAuditoria,
    respuestas: ok('Registros, del más reciente al más antiguo.', lista('RegistroAuditoria')),
  },
  {
    metodo: 'get',
    ruta: '/registros',
    id: 'registros_listar',
    etiqueta: 'Registros',
    resumen: 'Registros de peticiones de la API',
    descripcion:
      'Peticiones hechas con claves de API (REST y MCP) en los últimos 30 días: método, patrón de ruta, estado HTTP, duración y clave. Nunca guarda cuerpos, encabezados ni parámetros. Paginación hacia atrás con `antesDe` (marca de tiempo en milisegundos).',
    permiso: 'registros:read',
    consulta: esquemaConsultaRegistros,
    respuestas: ok('Peticiones, de la más reciente a la más antigua.', lista('RegistroApi')),
  },
]

// ---------------------------------------------------------------------------
// Componentes de respuesta escritos a mano (ver `docs/api.md`).

const ESTADOS_DOCUMENTO = ['pendiente', 'procesado', 'rechazado', 'contingencia', 'invalidado']

const RESPUESTAS_ESQUEMAS: Record<string, Esquema> = {
  Error: objeto(
    {
      error: objeto(
        {
          code: { type: 'string', enum: Object.keys(CODIGOS_ERROR) },
          message: texto,
          details: { description: 'Detalle según el código; puede faltar.' },
        },
        ['code', 'message'],
      ),
    },
    ['error'],
  ),
  Documento: objeto(
    {
      id: texto,
      codigoGeneracion: { type: 'string', description: 'UUID en mayúsculas.' },
      numeroControl: { type: 'string', examples: ['DTE-01-M001P001-000000000000001'] },
      tipoDte: { type: 'string', enum: Object.keys(TIPOS_DTE) },
      ambiente,
      estado: { type: 'string', enum: ESTADOS_DOCUMENTO },
      fechaEmision: { type: 'string', format: 'date' },
      horaEmision: { type: 'string', examples: ['01:38:12'] },
      receptorNombre: textoONulo,
      receptorDocumento: textoONulo,
      total: numero,
      selloRecibido: textoONulo,
      origen: { type: 'string', examples: ['panel', 'api', 'mcp'] },
      error: textoONulo,
      creado: { type: 'integer', description: 'Milisegundos desde 1970.' },
      urlConsulta: {
        type: ['string', 'null'],
        description: 'Consulta pública en el portal del MH.',
      },
    },
    ['id', 'codigoGeneracion', 'numeroControl', 'tipoDte', 'ambiente', 'estado', 'total'],
  ),
  DocumentoDetalle: {
    allOf: [
      ref('Documento'),
      objeto({
        dte: { ...libre, description: 'Estructura del DTE tal como se firmó.' },
        respuestaMh: { type: ['object', 'null'], description: 'Última respuesta del MH.' },
        eventos: { type: 'array', items: libre },
      }),
    ],
  },
  ListaDocumentos: objeto(
    {
      items: lista('Documento'),
      total: entero,
      pagina: entero,
      porPagina: entero,
      ambiente,
    },
    ['items', 'total', 'pagina', 'porPagina', 'ambiente'],
  ),
  Validacion: objeto(
    {
      dte: libre,
      problemas: {
        type: 'array',
        items: objeto({ ruta: texto, mensaje: texto, regla: texto }),
      },
      total: numero,
      receptorNombre: textoONulo,
    },
    ['dte', 'problemas', 'total'],
  ),
  Evento: objeto(
    {
      id: texto,
      tipo: { type: 'string', enum: ['retorno', 'operaciones_especiales'] },
      tipoEvento: { type: 'string', enum: ['18', '17'] },
      codigoGeneracion: texto,
      ambiente,
      estado: { type: 'string', enum: ['procesado', 'rechazado', 'invalidado'] },
      selloRecibido: textoONulo,
      documentoId: { type: ['string', 'null'], description: 'Documento de un retorno.' },
      creado: { type: 'integer', description: 'Milisegundos desde 1970.' },
    },
    ['id', 'tipo', 'codigoGeneracion', 'ambiente', 'estado'],
  ),
  EventoDetalle: {
    allOf: [ref('Evento'), objeto({ dte: libre, respuestaMh: { type: ['object', 'null'] } })],
  },
  Yo: objeto({
    usuario: {
      type: ['object', 'null'],
      properties: { id: texto, nombre: texto, correo: texto },
      description: 'Nulo cuando autentica una clave de API.',
    },
    rol: textoONulo,
    actor: { type: 'string', enum: ['usuario', 'clave'] },
    organizationId: texto,
    permisos: { type: 'array', items: { type: 'string', enum: [...PERMISOS] } },
    ambiente,
    simulador: { type: 'boolean', description: 'El servidor usa el simulador del MH.' },
    extensiones: {
      type: 'array',
      description:
        'Enlaces del panel que agregan las extensiones instaladas, filtrados por permisos. Vacío en una instalación estándar.',
      items: objeto(
        {
          titulo: texto,
          ruta: texto,
          icono: textoONulo,
          grupo: { type: 'string', enum: ['desarrolladores', 'administracion', 'cuenta', 'mas'] },
        },
        ['titulo', 'ruta'],
      ),
    },
    url: { type: 'string', description: 'URL pública del servidor (`APP_URL`).' },
    mcp: {
      type: 'string',
      description: 'URL pública del servidor MCP remoto (`URL_MCP` o `<APP_URL>/mcp`).',
    },
    cuenta: {
      type: ['object', 'null'],
      description:
        'Plan y uso de la cuenta, cuando una extensión los aporta. Nulo en una instalación propia.',
      properties: {
        plan: objeto({ id: texto, nombre: texto }, ['id', 'nombre']),
        uso: {
          type: 'array',
          items: objeto({ etiqueta: texto, usado: numero, limite: { type: ['number', 'null'] } }, [
            'etiqueta',
            'usado',
            'limite',
          ]),
        },
        mejorar: objeto({ titulo: texto, detalle: texto, ruta: texto }, [
          'titulo',
          'detalle',
          'ruta',
        ]),
      },
      required: ['plan'],
    },
  }),
  Uso: objeto({
    ambiente,
    desde: texto,
    hasta: texto,
    totales: objeto({ emitidos: entero, procesados: entero, rechazados: entero, monto: numero }),
    dias: {
      type: 'array',
      items: objeto({
        fecha: texto,
        emitidos: entero,
        procesados: entero,
        rechazados: entero,
        monto: numero,
      }),
    },
  }),
  Resumen: objeto({
    ambiente,
    mes: texto,
    porEstado: { type: 'object', additionalProperties: entero },
    procesadosMes: entero,
    totalMes: numero,
    recientes: lista('Documento'),
    contingencia: {
      type: ['object', 'null'],
      description:
        'Documentos en contingencia en el ambiente activo; null si no hay. En producción el servidor la transmite solo cuando el MH vuelve a responder, salvo que pasen 3 días: entonces `requiereInforme` y, tras presentar el Informe Técnico de Contingencia (Normativa 2.0, regla 13.2.1.1), se transmite con `POST /contingencia/transmitir`.',
      properties: {
        documentos: entero,
        desde: { ...entero, description: 'Creación del documento más antiguo (ms desde epoch)' },
        requiereInforme: booleano,
      },
      required: ['documentos', 'desde', 'requiereInforme'],
    },
  }),
  EstadoCredenciales: objeto({
    apiPassword: booleano,
    certificado: booleano,
    certificadoNit: textoONulo,
    simuladas: {
      type: 'boolean',
      description: 'Generadas para el simulador del MH: los documentos no llegan a Hacienda.',
    },
    actualizado: { type: ['integer', 'null'] },
  }),
  EmisorVista: objeto({
    emisor: {
      type: ['object', 'null'],
      description: 'Datos fiscales; nulo si no está configurado.',
    },
    establecimientos: lista('EstablecimientoVista'),
    credenciales: objeto({ '00': ref('EstadoCredenciales'), '01': ref('EstadoCredenciales') }),
    ambienteActivo: ambiente,
  }),
  EstablecimientoVista: {
    allOf: [
      ref('Establecimiento'),
      objeto({ id: texto, puntosVenta: { type: 'array', items: libre } }),
    ],
  },
  Cliente: {
    allOf: [ref('ClienteEntrada'), objeto({ id: texto, organizationId: texto, creado: texto })],
  },
  Producto: {
    allOf: [ref('ProductoEntrada'), objeto({ id: texto, organizationId: texto, creado: texto })],
  },
  Catalogo: objeto({
    id: texto,
    nombre: texto,
    total: entero,
    valores: {
      type: 'array',
      items: objeto({ codigo: texto, valor: texto, departamento: texto }, ['codigo', 'valor']),
    },
  }),
  Clave: objeto({
    id: texto,
    nombre: texto,
    prefijo: { type: 'string', description: 'Primeros caracteres de la clave.' },
    modo: { type: 'string', enum: ['test', 'live'] },
    scopes: { type: 'array', items: texto },
    expira: {
      type: ['integer', 'null'],
      description: 'Milisegundos desde 1970; nulo si no expira.',
    },
    ultimoUso: { type: ['integer', 'null'] },
    revocada: {
      type: ['integer', 'null'],
      description: 'Cuándo se revocó; nulo si sigue vigente.',
    },
    creado: entero,
    estado: { type: 'string', enum: ['activa', 'revocada', 'expirada'] },
  }),
  ClaveCreada: {
    allOf: [
      ref('Clave'),
      objeto({ clave: { type: 'string', description: 'La clave completa. Sólo esta vez.' } }, [
        'clave',
      ]),
    ],
  },
  Webhook: objeto(
    {
      id: texto,
      url: texto,
      descripcion: textoONulo,
      eventos: { type: 'array', items: { type: 'string', enum: [...EVENTOS_WEBHOOK] } },
      activo: booleano,
      creado: entero,
      actualizado: { type: ['integer', 'null'] },
    },
    ['id', 'url', 'eventos', 'activo', 'creado'],
  ),
  WebhookConSecreto: {
    allOf: [
      ref('Webhook'),
      objeto(
        {
          secreto: {
            type: 'string',
            description: 'whsec_…: clave de la firma HMAC. Sólo esta vez.',
          },
        },
        ['secreto'],
      ),
    ],
  },
  EntregaWebhook: objeto(
    {
      id: texto,
      webhookId: texto,
      evento: texto,
      estado: { type: 'string', enum: ['pendiente', 'entregado', 'fallido'] },
      intentos: entero,
      ultimoStatus: { type: ['integer', 'null'] },
      ultimoError: textoONulo,
      proximoIntento: { type: ['integer', 'null'] },
      creado: entero,
      entregado: { type: ['integer', 'null'] },
    },
    ['id', 'webhookId', 'evento', 'estado', 'intentos', 'creado'],
  ),
  RegistroAuditoria: objeto({
    id: texto,
    actorTipo: texto,
    actorId: texto,
    accion: texto,
    recurso: texto,
    recursoId: textoONulo,
    ip: textoONulo,
    detalle: { type: ['object', 'null'] },
    creado: { type: ['string', 'integer'] },
  }),
  RegistroApi: objeto({
    id: texto,
    creado: { type: 'integer', description: 'Marca de tiempo en milisegundos.' },
    metodo: texto,
    ruta: { type: 'string', description: 'Patrón de la ruta, p. ej. `/api/v1/dte/:codigo`.' },
    estado: { type: 'integer', description: 'Estado HTTP de la respuesta.' },
    duracionMs: entero,
    origen: { type: 'string', enum: ['api', 'mcp'] },
    clave: objeto({ id: texto, prefijo: textoONulo, nombre: textoONulo }),
  }),
}

// ---------------------------------------------------------------------------
// Construcción del documento.

const aJsonSchema = (esquema: z.ZodType): Esquema => {
  const { $schema: _, ...resto } = z.toJSONSchema(esquema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Esquema
  return resto
}

/** `/dte/:codigo` → `/dte/{codigo}`. */
export const rutaOpenApi = (ruta: string) => ruta.replace(/:(\w+)/g, '{$1}')

const respuestaError = (estado: number) => ({
  $ref: `#/components/responses/Error${estado}`,
})

const encabezadosLimite = {
  'RateLimit-Limit': { $ref: '#/components/headers/RateLimit-Limit' },
  'RateLimit-Remaining': { $ref: '#/components/headers/RateLimit-Remaining' },
  'RateLimit-Reset': { $ref: '#/components/headers/RateLimit-Reset' },
}

function operacion(r: Ruta) {
  const parametros: Esquema[] = [...r.ruta.matchAll(/:(\w+)/g)].map(([, nombre]) => ({
    name: nombre,
    in: 'path',
    required: true,
    description: PARAMETROS[nombre!]?.descripcion,
    schema: PARAMETROS[nombre!]?.esquema ?? texto,
  }))
  if (r.consulta) {
    const js = aJsonSchema(r.consulta) as {
      properties: Record<string, Esquema>
      required?: string[]
    }
    for (const [nombre, schema] of Object.entries(js.properties)) {
      parametros.push({
        name: nombre,
        in: 'query',
        required: js.required?.includes(nombre) ?? false,
        schema,
      })
    }
  }
  if (r.idempotente) parametros.push({ $ref: '#/components/parameters/IdempotencyKey' })

  const respuestas: Record<string, unknown> = {}
  for (const [estado, { descripcion, esquema }] of Object.entries(r.respuestas)) {
    respuestas[estado] = {
      description: descripcion,
      ...(r.publica ? {} : { headers: encabezadosLimite }),
      ...(esquema === 'pdf'
        ? { content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }
        : esquema
          ? { content: { 'application/json': { schema: esquema } } }
          : {}),
    }
    if (r.idempotente) {
      ;(respuestas[estado] as { headers: Record<string, unknown> }).headers['Idempotent-Replayed'] =
        { $ref: '#/components/headers/Idempotent-Replayed' }
    }
  }
  if (!r.publica) {
    const errores = new Set([400, 401, 403, 429, ...(r.errores ?? [])])
    // Las distribuciones con planes pueden impedir una emisión (`antesDeEmitir`).
    if (r.id === 'dte_emitir') errores.add(402)
    for (const estado of [...errores].sort((a, b) => a - b))
      respuestas[estado] = respuestaError(estado)
  }

  const permiso = r.permiso ? `\n\nPermiso: \`${r.permiso}\`.` : ''
  return {
    operationId: r.id,
    tags: [r.etiqueta],
    summary: r.resumen,
    ...(r.descripcion || permiso ? { description: `${r.descripcion ?? ''}${permiso}`.trim() } : {}),
    ...(r.publica ? { security: [] } : {}),
    ...(r.permiso ? { 'x-permiso': r.permiso } : {}),
    ...(parametros.length ? { parameters: parametros } : {}),
    ...(r.cuerpo
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref(r.cuerpo) } },
          },
        }
      : {}),
    responses: respuestas,
  }
}

const ETIQUETAS = [
  ['Sesión', 'Identidad del actor y tablero.'],
  ['Emisor', 'Datos fiscales, establecimientos, puntos de venta y credenciales del MH.'],
  ['Clientes', 'Receptores guardados.'],
  ['Productos', 'Catálogo de productos y servicios (precios sin IVA).'],
  ['DTE', 'Emisión, consulta, invalidación y contingencia de documentos.'],
  ['Eventos', 'Evento de Retorno (18) y Operaciones Especiales (17).'],
  ['Catálogos', 'Catálogos oficiales del MH (CAT-xxx).'],
  ['Claves de API', 'Claves `of_test_…` y `of_live_…`. Sólo desde una sesión del panel.'],
  [
    'Webhooks',
    'Notificaciones firmadas (HMAC-SHA256) cuando cambia el estado de un documento o evento.',
  ],
  ['Auditoría', 'Bitácora de acciones de la organización.'],
  ['Registros', 'Peticiones hechas con claves de API (sólo metadatos; 30 días).'],
] as const

export function construirOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const r of RUTAS) {
    const ruta = rutaOpenApi(r.ruta)
    paths[ruta] ??= {}
    paths[ruta][r.metodo] = operacion(r)
  }

  const estados = [...new Set(Object.values(CODIGOS_ERROR))].sort((a, b) => a - b)
  const responses = Object.fromEntries(
    estados.map((estado) => {
      const codigos = Object.entries(CODIGOS_ERROR)
        .filter(([, s]) => s === estado)
        .map(([c]) => `\`${c}\``)
        .join(', ')
      return [
        `Error${estado}`,
        {
          description: `${DESCRIPCION_ESTADO[estado]} Códigos: ${codigos}.`,
          ...(estado === 429
            ? { headers: { 'Retry-After': { $ref: '#/components/headers/Retry-After' } } }
            : {}),
          content: { 'application/json': { schema: ref('Error') } },
        },
      ]
    }),
  )

  return {
    openapi: '3.1.0',
    info: {
      title: 'API de Open Factura',
      version: '1.0.0',
      summary: 'Facturación electrónica de El Salvador (DTE, Normativa 2.0).',
      description:
        'API REST de Open Factura. Todo es JSON. Autentícate con una clave de API (`Authorization: Bearer of_test_…` para el ambiente de pruebas `00`, `of_live_…` para producción `01`) o con la cookie de sesión del panel. Errores: `{ "error": { "code", "message", "details" } }`; decide siempre por `code`. Límite: 120 peticiones por minuto por clave, con encabezados `RateLimit-*`.',
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
      contact: { name: 'Open Factura', url: 'https://github.com/xaviigna/openfactura' },
    },
    externalDocs: { description: 'Documentación', url: 'https://docs.openfactura.co' },
    servers: [{ url: SERVIDOR, description: 'Open Factura en la nube' }],
    security: [{ claveApi: [] }, { sesion: [] }],
    tags: ETIQUETAS.map(([name, description]) => ({ name, description })),
    paths,
    components: {
      securitySchemes: {
        claveApi: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'of_test_… | of_live_…',
          description:
            'Clave de API creada en el panel (Ajustes → Claves de API). `of_test_…` trabaja en el ambiente de pruebas del MH (`00`) y `of_live_…` en producción (`01`). Lleva los permisos elegidos al crearla.',
        },
        sesion: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description:
            'Cookie de sesión del panel web (Better Auth, `/api/auth/*`; con HTTPS lleva el prefijo `__Secure-`). Las peticiones que modifican datos deben venir del mismo origen. No se acepta en `/mcp`.',
        },
      },
      parameters: {
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description:
            'Hasta 200 caracteres. Repetir con la misma clave y el mismo cuerpo devuelve la respuesta original con `Idempotent-Replayed: true`, sin emitir dos veces; con otro cuerpo: `409 idempotencia_distinta`. Se conservan 24 horas, por ambiente.',
          schema: { type: 'string', maxLength: 200 },
        },
      },
      headers: {
        'RateLimit-Limit': {
          description: 'Peticiones permitidas por minuto (sólo con clave de API).',
          schema: entero,
        },
        'RateLimit-Remaining': {
          description: 'Peticiones restantes en la ventana actual (sólo con clave de API).',
          schema: entero,
        },
        'RateLimit-Reset': {
          description: 'Segundos hasta que se reinicia la ventana (sólo con clave de API).',
          schema: entero,
        },
        'Retry-After': { description: 'Segundos que hay que esperar.', schema: entero },
        'Idempotent-Replayed': {
          description: '`true` cuando la respuesta es la guardada de un intento anterior.',
          schema: { type: 'string', enum: ['true'] },
        },
      },
      responses,
      schemas: {
        ...Object.fromEntries(Object.entries(ENTRADAS).map(([n, e]) => [n, aJsonSchema(e)])),
        ...RESPUESTAS_ESQUEMAS,
      },
    },
  }
}

let serializado: string | undefined
/** El documento serializado, construido una sola vez por isolate. */
export const openApiJson = () => {
  serializado ??= JSON.stringify(construirOpenApi())
  return serializado
}
