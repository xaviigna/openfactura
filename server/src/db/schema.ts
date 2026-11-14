import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { organization, user } from './auth-schema'

const id = () => text('id').primaryKey()
const org = () =>
  text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' })
const creado = () =>
  integer('creado', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)

/** Datos fiscales del contribuyente. Uno por organización. */
export const emisor = sqliteTable(
  'emisor',
  {
    id: id(),
    organizationId: org(),
    nit: text('nit').notNull(),
    nrc: text('nrc').notNull(),
    nombre: text('nombre').notNull(),
    nombreComercial: text('nombre_comercial'),
    /** CAT-019 */
    codActividad: text('cod_actividad').notNull(),
    descActividad: text('desc_actividad').notNull(),
    /** CAT-012 / CAT-013 / CAT-008 */
    departamento: text('departamento').notNull(),
    municipio: text('municipio').notNull(),
    distrito: text('distrito').notNull(),
    complemento: text('complemento').notNull(),
    telefono: text('telefono').notNull(),
    correo: text('correo').notNull(),
    /** Ambiente en el que emite el panel: 00 pruebas, 01 producción. */
    ambiente: text('ambiente', { enum: ['00', '01'] })
      .notNull()
      .default('00'),
    /** Responsable que firma los eventos de invalidación y contingencia. */
    responsableNombre: text('responsable_nombre'),
    /** CAT-022 */
    responsableTipoDoc: text('responsable_tipo_doc'),
    responsableNumDoc: text('responsable_num_doc'),
    creado: creado(),
    actualizado: integer('actualizado', { mode: 'timestamp_ms' }),
  },
  (t) => [uniqueIndex('emisor_org_uq').on(t.organizationId)],
)

export const establecimiento = sqliteTable(
  'establecimiento',
  {
    id: id(),
    organizationId: org(),
    nombre: text('nombre').notNull(),
    /** CAT-009: 01 sucursal, 02 casa matriz, 04 bodega, 07 patio. */
    tipo: text('tipo').notNull().default('02'),
    /** Código asignado por el MH (M001…). Forma parte del número de control. */
    codMh: text('cod_mh').notNull(),
    codInterno: text('cod_interno'),
    /** Dirección propia; si falta se usa la del emisor. */
    departamento: text('departamento'),
    municipio: text('municipio'),
    distrito: text('distrito'),
    complemento: text('complemento'),
    telefono: text('telefono'),
    creado: creado(),
  },
  (t) => [uniqueIndex('establecimiento_org_cod_uq').on(t.organizationId, t.codMh)],
)

export const puntoVenta = sqliteTable(
  'punto_venta',
  {
    id: id(),
    organizationId: org(),
    establecimientoId: text('establecimiento_id')
      .notNull()
      .references(() => establecimiento.id, { onDelete: 'cascade' }),
    nombre: text('nombre').notNull(),
    /** Código asignado por el MH (P001…). */
    codMh: text('cod_mh').notNull(),
    codInterno: text('cod_interno'),
    creado: creado(),
  },
  (t) => [
    uniqueIndex('punto_venta_estab_cod_uq').on(t.establecimientoId, t.codMh),
    index('punto_venta_org_idx').on(t.organizationId),
  ],
)

/** Secretos del MH cifrados (AES-256-GCM). Nunca salen del servidor. */
export const credencialMh = sqliteTable(
  'credencial_mh',
  {
    id: id(),
    organizationId: org(),
    ambiente: text('ambiente', { enum: ['00', '01'] }).notNull(),
    apiPasswordEnc: text('api_password_enc'),
    certificadoEnc: text('certificado_enc'),
    certPasswordEnc: text('cert_password_enc'),
    certNit: text('cert_nit'),
    tokenEnc: text('token_enc'),
    tokenExpira: integer('token_expira', { mode: 'timestamp_ms' }),
    /** Generadas por el servidor para el simulador del MH. Las que sube el usuario van a Hacienda. */
    simulada: integer('simulada', { mode: 'boolean' }).notNull().default(false),
    actualizado: integer('actualizado', { mode: 'timestamp_ms' }),
  },
  (t) => [uniqueIndex('credencial_org_ambiente_uq').on(t.organizationId, t.ambiente)],
)

export const cliente = sqliteTable(
  'cliente',
  {
    id: id(),
    organizationId: org(),
    /** CAT-022: 36 NIT, 13 DUI, 03 pasaporte, 02 carné de residente, 37 otro. */
    tipoDocumento: text('tipo_documento').notNull(),
    numDocumento: text('num_documento').notNull(),
    nrc: text('nrc'),
    nombre: text('nombre').notNull(),
    nombreComercial: text('nombre_comercial'),
    codActividad: text('cod_actividad'),
    descActividad: text('desc_actividad'),
    departamento: text('departamento'),
    municipio: text('municipio'),
    distrito: text('distrito'),
    complemento: text('complemento'),
    telefono: text('telefono'),
    correo: text('correo'),
    creado: creado(),
  },
  (t) => [
    uniqueIndex('cliente_org_doc_uq').on(t.organizationId, t.tipoDocumento, t.numDocumento),
    index('cliente_org_nombre_idx').on(t.organizationId, t.nombre),
  ],
)

export const producto = sqliteTable(
  'producto',
  {
    id: id(),
    organizationId: org(),
    codigo: text('codigo').notNull(),
    descripcion: text('descripcion').notNull(),
    /** Precio unitario SIN IVA. */
    precioUnitario: real('precio_unitario').notNull(),
    /** CAT-011: 1 bien, 2 servicio, 3 ambos, 4 otros tributos. */
    tipoItem: integer('tipo_item').notNull().default(1),
    /** CAT-014. 59 = unidad. */
    uniMedida: integer('uni_medida').notNull().default(59),
    tipoVenta: text('tipo_venta', { enum: ['gravada', 'exenta', 'noSujeta'] })
      .notNull()
      .default('gravada'),
    creado: creado(),
  },
  (t) => [uniqueIndex('producto_org_codigo_uq').on(t.organizationId, t.codigo)],
)

/** Último correlativo consumido por serie del número de control. */
export const correlativo = sqliteTable(
  'correlativo',
  {
    organizationId: org(),
    ambiente: text('ambiente').notNull(),
    tipoDte: text('tipo_dte').notNull(),
    codEstable: text('cod_estable').notNull(),
    codPuntoVenta: text('cod_punto_venta').notNull(),
    anio: integer('anio').notNull(),
    ultimo: integer('ultimo').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.ambiente, t.tipoDte, t.codEstable, t.codPuntoVenta, t.anio],
    }),
  ],
)

export const ESTADOS_DTE = [
  'pendiente',
  'procesado',
  'rechazado',
  'contingencia',
  'invalidado',
] as const
export type EstadoDte = (typeof ESTADOS_DTE)[number]

/** Resumen de cada DTE. El JSON completo vive en `documento_archivo`. */
export const documento = sqliteTable(
  'documento',
  {
    id: id(),
    organizationId: org(),
    codigoGeneracion: text('codigo_generacion').notNull(),
    numeroControl: text('numero_control').notNull(),
    tipoDte: text('tipo_dte').notNull(),
    ambiente: text('ambiente', { enum: ['00', '01'] }).notNull(),
    estado: text('estado', { enum: ESTADOS_DTE }).notNull().default('pendiente'),
    fechaEmision: text('fecha_emision').notNull(),
    horaEmision: text('hora_emision').notNull(),
    receptorNombre: text('receptor_nombre'),
    receptorDocumento: text('receptor_documento'),
    /** Total a pagar en centavos de USD. */
    totalCentavos: integer('total_centavos').notNull().default(0),
    selloRecibido: text('sello_recibido'),
    clienteId: text('cliente_id').references(() => cliente.id, { onDelete: 'set null' }),
    /** panel | api | mcp */
    origen: text('origen').notNull().default('panel'),
    actorTipo: text('actor_tipo').notNull(),
    actorId: text('actor_id').notNull(),
    /** JSON: { codigo, mensaje, observaciones? } */
    error: text('error'),
    creado: creado(),
  },
  (t) => [
    uniqueIndex('documento_codigo_uq').on(t.codigoGeneracion),
    uniqueIndex('documento_org_numero_uq').on(t.organizationId, t.ambiente, t.numeroControl),
    index('documento_org_fecha_idx').on(t.organizationId, t.ambiente, t.fechaEmision),
    index('documento_org_estado_idx').on(t.organizationId, t.estado),
  ],
)

export const documentoArchivo = sqliteTable('documento_archivo', {
  documentoId: text('documento_id')
    .primaryKey()
    .references(() => documento.id, { onDelete: 'cascade' }),
  /** Estructura oficial del DTE (JSON). */
  dte: text('dte').notNull(),
  /** JWS transmitido. */
  firma: text('firma'),
  /** Respuesta del MH (JSON). */
  respuestaMh: text('respuesta_mh'),
})

export const evento = sqliteTable(
  'evento',
  {
    id: id(),
    organizationId: org(),
    tipo: text('tipo', {
      enum: ['invalidacion', 'contingencia', 'retorno', 'operaciones_especiales'],
    }).notNull(),
    codigoGeneracion: text('codigo_generacion').notNull(),
    /** Ambiente del MH del evento (los anteriores a esta columna se completan desde su JSON). */
    ambiente: text('ambiente', { enum: ['00', '01'] }),
    documentoId: text('documento_id').references(() => documento.id, { onDelete: 'set null' }),
    /** `invalidado`: un retorno al que luego se le aplicó un evento de invalidación. */
    estado: text('estado', { enum: ['procesado', 'rechazado', 'invalidado'] }).notNull(),
    selloRecibido: text('sello_recibido'),
    dte: text('dte').notNull(),
    firma: text('firma'),
    respuestaMh: text('respuesta_mh'),
    creado: creado(),
  },
  (t) => [
    uniqueIndex('evento_codigo_uq').on(t.codigoGeneracion),
    index('evento_org_doc_idx').on(t.organizationId, t.documentoId),
  ],
)

/** Claves de API. Sólo se guarda el hash; la clave completa se muestra una vez. */
export const claveApi = sqliteTable(
  'clave_api',
  {
    id: id(),
    organizationId: org(),
    nombre: text('nombre').notNull(),
    /** Inicio visible de la clave, para reconocerla en listados. */
    prefijo: text('prefijo').notNull(),
    /** SHA-256 (hex) de la clave completa. */
    hash: text('hash').notNull(),
    /** test → ambiente 00 del MH; live → ambiente 01. */
    modo: text('modo', { enum: ['test', 'live'] }).notNull(),
    /** JSON: lista de permisos concedidos. */
    scopes: text('scopes').notNull(),
    expira: integer('expira', { mode: 'timestamp_ms' }),
    ultimoUso: integer('ultimo_uso', { mode: 'timestamp_ms' }),
    revocada: integer('revocada', { mode: 'timestamp_ms' }),
    creadoPor: text('creado_por').references(() => user.id, { onDelete: 'set null' }),
    creado: creado(),
  },
  (t) => [uniqueIndex('clave_hash_uq').on(t.hash), index('clave_org_idx').on(t.organizationId)],
)

/**
 * Una fila por petición hecha con clave de API (REST o MCP). Sólo metadatos: nunca cuerpos,
 * encabezados ni parámetros de consulta. El cron borra lo que pasa de 30 días.
 */
export const registroApi = sqliteTable(
  'registro_api',
  {
    id: id(),
    organizationId: org(),
    claveId: text('clave_id')
      .notNull()
      .references(() => claveApi.id, { onDelete: 'cascade' }),
    metodo: text('metodo').notNull(),
    /** Patrón de la ruta (`/api/v1/dte/:codigo`), no la URL: sin identificadores ni consulta. */
    ruta: text('ruta').notNull(),
    /** Estado HTTP de la respuesta. */
    estado: integer('estado').notNull(),
    duracionMs: integer('duracion_ms').notNull(),
    /** api | mcp */
    origen: text('origen').notNull(),
    creado: creado(),
  },
  (t) => [
    index('registro_api_org_creado_idx').on(t.organizationId, t.creado),
    index('registro_api_creado_idx').on(t.creado),
  ],
)

/** Destinos a los que se notifican cambios de estado. El secreto de firma va cifrado. */
export const webhook = sqliteTable(
  'webhook',
  {
    id: id(),
    organizationId: org(),
    url: text('url').notNull(),
    descripcion: text('descripcion'),
    /** JSON: lista de eventos suscritos. */
    eventos: text('eventos').notNull(),
    /** whsec_… cifrado con `cifrar()`; AAD ligado a la organización y al webhook. */
    secretoEnc: text('secreto_enc').notNull(),
    activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
    /** Persona que lo creó (como en las claves); `null` si lo creó una clave o el sistema. */
    creadoPor: text('creado_por').references(() => user.id, { onDelete: 'set null' }),
    /** Clave de API que lo creó; `null` si lo creó una persona o el sistema. */
    creadoPorClave: text('creado_por_clave'),
    creado: creado(),
    actualizado: integer('actualizado', { mode: 'timestamp_ms' }),
  },
  (t) => [index('webhook_org_idx').on(t.organizationId)],
)

export const ESTADOS_ENTREGA = ['pendiente', 'entregado', 'fallido'] as const

/** Cada notificación a un webhook, con sus intentos. */
export const webhookEntrega = sqliteTable(
  'webhook_entrega',
  {
    id: id(),
    organizationId: org(),
    webhookId: text('webhook_id')
      .notNull()
      .references(() => webhook.id, { onDelete: 'cascade' }),
    evento: text('evento').notNull(),
    /** Cuerpo exacto que se firma y se envía. */
    payload: text('payload').notNull(),
    estado: text('estado', { enum: ESTADOS_ENTREGA }).notNull().default('pendiente'),
    intentos: integer('intentos').notNull().default(0),
    ultimoStatus: integer('ultimo_status'),
    /** Motivo breve del último fallo (nunca el cuerpo de la respuesta ni secretos). */
    ultimoError: text('ultimo_error'),
    proximoIntento: integer('proximo_intento', { mode: 'timestamp_ms' }),
    creado: creado(),
    entregado: integer('entregado', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('webhook_entrega_cola_idx').on(t.estado, t.proximoIntento),
    index('webhook_entrega_webhook_idx').on(t.webhookId, t.creado),
  ],
)

/** Respuestas guardadas por Idempotency-Key, para que un reintento no emita dos veces. */
export const idempotencia = sqliteTable(
  'idempotencia',
  {
    organizationId: org(),
    clave: text('clave').notNull(),
    hashPeticion: text('hash_peticion').notNull(),
    /** null mientras la petición original sigue en curso. */
    status: integer('status'),
    respuesta: text('respuesta'),
    creado: creado(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.clave] })],
)

export const auditoria = sqliteTable(
  'auditoria',
  {
    id: id(),
    organizationId: org(),
    /** usuario | clave */
    actorTipo: text('actor_tipo').notNull(),
    actorId: text('actor_id').notNull(),
    accion: text('accion').notNull(),
    recurso: text('recurso').notNull(),
    recursoId: text('recurso_id'),
    ip: text('ip'),
    detalle: text('detalle'),
    creado: creado(),
  },
  (t) => [index('auditoria_org_creado_idx').on(t.organizationId, t.creado)],
)

/** Contadores de ventana fija para el límite de peticiones. */
export const ventanaLimite = sqliteTable(
  'ventana_limite',
  {
    bucket: text('bucket').notNull(),
    ventanaInicio: integer('ventana_inicio').notNull(),
    cuenta: integer('cuenta').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.ventanaInicio] })],
)
