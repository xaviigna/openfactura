import { z } from 'zod'
import { PERMISOS_CLAVE } from './permisos'
import { TIPOS_DTE } from './tipos'

const texto = (max = 250) => z.string().trim().min(1, 'Este dato es obligatorio').max(max)
const opcional = (max = 250) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null)
const soloDigitos = (v: string) => v.replace(/[^0-9]/g, '')

export const esquemaAmbiente = z.enum(['00', '01'])

export const esquemaEmisor = z.object({
  nit: z
    .string()
    .transform(soloDigitos)
    .refine(
      (v) => v.length === 14 || v.length === 9,
      'El NIT debe tener 14 dígitos (o 9 si es DUI homologado)',
    ),
  nrc: z
    .string()
    .transform(soloDigitos)
    .refine((v) => v.length >= 2 && v.length <= 8, 'El NRC debe tener de 2 a 8 dígitos'),
  nombre: texto(),
  nombreComercial: opcional(150),
  codActividad: texto(6),
  descActividad: texto(150),
  departamento: texto(2),
  municipio: texto(2),
  distrito: texto(2),
  complemento: texto(200),
  telefono: z.string().trim().min(8).max(30),
  correo: z.email().max(100),
  /** Si se omite al actualizar, se conserva el ambiente actual (nuevo emisor: pruebas). */
  ambiente: esquemaAmbiente.optional(),
  responsableNombre: opcional(100),
  responsableTipoDoc: opcional(2),
  responsableNumDoc: opcional(20),
})
export type EmisorEntrada = z.input<typeof esquemaEmisor>

export const esquemaCredenciales = z.object({
  /** Contraseña de API del MH (no la del portal ni la del certificado). */
  apiPassword: z.string().min(1).max(200).optional(),
  /** Contenido XML del archivo .crt descargado del portal de Hacienda. */
  certificado: z.string().min(1).max(200_000).optional(),
  /** Contraseña de la llave privada del certificado. */
  certificadoPassword: z.string().min(1).max(200).optional(),
})

export const esquemaEstablecimiento = z.object({
  nombre: texto(100),
  tipo: z.enum(['01', '02', '04', '07']).default('01'),
  codMh: z.string().regex(/^[MBSP]\d{3}$/, 'Usa M|B|S|P seguido de 3 dígitos, por ejemplo S002'),
  codInterno: opcional(10),
  departamento: opcional(2),
  municipio: opcional(2),
  distrito: opcional(2),
  complemento: opcional(200),
  telefono: opcional(30),
})

export const esquemaPuntoVenta = z.object({
  establecimientoId: z.string().min(1),
  nombre: texto(100),
  codMh: z.string().regex(/^P\d{3}$/, 'Usa P seguido de 3 dígitos, por ejemplo P002'),
  codInterno: opcional(15),
})

export const esquemaCliente = z.object({
  tipoDocumento: z.enum(['36', '13', '03', '02', '37']),
  numDocumento: texto(20),
  nrc: opcional(8),
  nombre: texto(),
  nombreComercial: opcional(150),
  codActividad: opcional(6),
  descActividad: opcional(150),
  departamento: opcional(2),
  municipio: opcional(2),
  distrito: opcional(2),
  complemento: opcional(200),
  telefono: opcional(30),
  correo: z
    .union([z.email().max(100), z.literal('')])
    .nullish()
    .transform((v) => v || null),
})
export type ClienteEntrada = z.input<typeof esquemaCliente>

export const esquemaProducto = z.object({
  codigo: texto(25),
  descripcion: texto(1000),
  /** Precio unitario sin IVA. */
  precioUnitario: z.number().nonnegative().max(99_999_999_999),
  tipoItem: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
  uniMedida: z.number().int().min(1).max(99).default(59),
  tipoVenta: z.enum(['gravada', 'exenta', 'noSujeta']).default('gravada'),
})
export type ProductoEntrada = z.input<typeof esquemaProducto>

const tiposDte = Object.keys(TIPOS_DTE) as [
  keyof typeof TIPOS_DTE,
  ...Array<keyof typeof TIPOS_DTE>,
]

export const esquemaEmision = z.object({
  tipoDte: z.enum(tiposDte),
  /**
   * Entrada del constructor del SDK para ese tipo (FacturaInput, CreditoFiscalInput, NotaInput…):
   * `items`, `receptor`, `condicionOperacion`, `pagos`, `documentosRelacionados`, etc.
   */
  datos: z.record(z.string(), z.unknown()),
  /** Si se indica y `datos.receptor` falta, el receptor se toma del cliente guardado. */
  clienteId: z.string().optional(),
  /** Punto de venta que emite. Por defecto el primero del emisor. */
  puntoVentaId: z.string().optional(),
})
export type EmisionEntrada = z.infer<typeof esquemaEmision>

const persona = z.object({
  nombre: texto(100),
  tipoDocumento: z.string().min(2).max(2),
  numDocumento: texto(20),
})

export const esquemaInvalidacion = z.object({
  /** CAT-024: 1 error en la información, 2 rescindir la operación, 3 otro. */
  tipoAnulacion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  motivoAnulacion: opcional(250),
  /** Código de generación del DTE que reemplaza al invalidado (requerido en los tipos 1 y 3). */
  codigoGeneracionReemplazo: opcional(36),
  /** Quien solicita la invalidación. Por defecto, el receptor del documento. */
  solicitante: persona.optional(),
  /** Quien la realiza. Por defecto, el responsable configurado en el emisor. */
  responsable: persona.optional(),
})
export type InvalidacionEntrada = z.infer<typeof esquemaInvalidacion>

export const esquemaClaveApi = z.object({
  nombre: texto(80),
  modo: z.enum(['test', 'live']),
  scopes: z.array(z.enum(PERMISOS_CLAVE)).min(1),
  /** Días hasta que la clave deja de funcionar. Sin valor: no expira. */
  expiraEnDias: z.number().int().min(1).max(3650).nullish(),
})
export type ClaveApiEntrada = z.infer<typeof esquemaClaveApi>

export const esquemaListaDtes = z.object({
  tipo: z.string().optional(),
  estado: z.enum(['pendiente', 'procesado', 'rechazado', 'contingencia', 'invalidado']).optional(),
  q: z.string().trim().max(100).optional(),
  desde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  hasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(25),
})
export type ListaDtesEntrada = z.infer<typeof esquemaListaDtes>

const fechaAAAAMMDD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD')

/** Evento de Retorno (18): bienes devueltos de una Factura, Factura de Exportación o Sujeto Excluido. */
export const esquemaRetorno = z.object({
  items: z
    .array(
      z.object({
        descripcion: texto(1000),
        cantidad: z.number().positive(),
        /** Factura (01): con IVA, como en la factura. Exportación y Sujeto Excluido: sin IVA. */
        precioUni: z.number().nonnegative(),
        tipoItem: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
        codigo: opcional(25),
        uniMedida: z.number().int().min(1).max(99).optional(),
        descuento: z.number().nonnegative().optional(),
        tipoVenta: z.enum(['gravada', 'exenta', 'noSujeta']).optional(),
        seguro: z.number().nonnegative().optional(),
        flete: z.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(2000),
})
export type RetornoEntrada = z.infer<typeof esquemaRetorno>

/** Evento de Operaciones Especiales (17): facturas simplificadas o comprobantes de control interno. */
export const esquemaOperacionesEspeciales = z.object({
  /** CAT-023: 02 factura de venta simplificada, 97 comprobante de control interno. */
  tipoDocumento: z.enum(['02', '97']),
  /** Fecha del evento: define el periodo que se informa. Por defecto, hoy. */
  fecha: fechaAAAAMMDD.optional(),
  items: z
    .array(
      z.object({
        descripcion: texto(1500),
        /** Sin IVA, también en facturas simplificadas. */
        precioUni: z.number().nonnegative(),
        cantidad: z.number().int().positive().optional(),
        numDocumento: opcional(36),
        docDel: z.string().trim().min(1).max(36).optional(),
        docAl: z.string().trim().min(1).max(36).optional(),
        fechaEmision: fechaAAAAMMDD.optional(),
        tipoVenta: z.enum(['gravada', 'exenta', 'noSujeta']).optional(),
        codigoGeneracionRef: z.string().length(36).optional(),
      }),
    )
    .min(1)
    .max(2000),
})
export type OperacionesEspecialesEntrada = z.infer<typeof esquemaOperacionesEspeciales>

/** Búsqueda en clientes y productos (`?q=&limite=`). */
export const esquemaBusqueda = z.object({
  q: z.string().max(100).optional(),
  limite: z.coerce.number().int().min(1).max(500).optional(),
})

/** Filtros de `GET /catalogos/:id`. */
export const esquemaConsultaCatalogo = z.object({
  q: z.string().max(100).optional(),
  departamento: z.string().max(2).optional(),
  limite: z.coerce.number().int().min(1).max(2000).optional(),
})

/** Paginación de la bitácora de auditoría. */
export const esquemaConsultaAuditoria = z.object({
  antesDe: z.coerce.number().int().optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
})

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD')

/** Rango de `GET /uso`. Sin fechas: los últimos 30 días (hora de El Salvador). */
export const esquemaConsultaUso = z.object({
  desde: fechaIso.optional(),
  hasta: fechaIso.optional(),
})
export type ConsultaUso = z.infer<typeof esquemaConsultaUso>

/** Filtros de `GET /registros`. */
export const esquemaConsultaRegistros = z.object({
  antesDe: z.coerce.number().int().optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
  /** `error`: sólo respuestas 4xx y 5xx. */
  estado: z.enum(['ok', 'error']).optional(),
  origen: z.enum(['api', 'mcp']).optional(),
  claveId: z.string().max(40).optional(),
})
export type ConsultaRegistros = z.infer<typeof esquemaConsultaRegistros>

/** Filtro de `GET /eventos`. */
export const esquemaConsultaEventos = z.object({
  tipo: z.enum(['retorno', 'operaciones_especiales']).optional(),
})

// ---------------------------------------------------------------------------
// Webhooks salientes

/** Eventos que se notifican por webhook. Son contrato público: no se renombran. */
export const EVENTOS_WEBHOOK = [
  'dte.procesado',
  'dte.rechazado',
  'dte.contingencia',
  'dte.invalidado',
  'retorno.procesado',
  'retorno.invalidado',
  'operaciones_especiales.procesado',
  'operaciones_especiales.invalidado',
] as const
export type EventoWebhook = (typeof EVENTOS_WEBHOOK)[number]

export const DESCRIPCION_EVENTO_WEBHOOK: Record<EventoWebhook, string> = {
  'dte.procesado': 'El MH selló un documento (también al transmitir una contingencia)',
  'dte.rechazado': 'El MH rechazó un documento',
  'dte.contingencia': 'Un documento quedó firmado en contingencia porque el MH no respondió',
  'dte.invalidado': 'Se invalidó un documento',
  'retorno.procesado': 'El MH selló un evento de retorno (18)',
  'retorno.invalidado': 'Se invalidó un evento de retorno',
  'operaciones_especiales.procesado': 'El MH selló un evento de operaciones especiales (17)',
  'operaciones_especiales.invalidado': 'Se invalidó un evento de operaciones especiales',
}

export const MAX_WEBHOOKS = 10

/** IPv4 en rangos que no son internet pública: privados, loopback, enlace local, CGNAT, etc. */
function ipv4Reservada(host: string): boolean {
  const partes = host.split('.').map(Number)
  if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false
  }
  const [a, b] = partes as [number, number, number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

/** IPv6 (sin corchetes) de loopback, sin especificar, local única, enlace local o con IPv4 dentro. */
function ipv6Reservada(host: string): boolean {
  const h = host.toLowerCase()
  return (
    h === '::' ||
    h === '::1' ||
    /^f[cd]/.test(h) ||
    /^fe[89ab]/.test(h) ||
    h.startsWith('::ffff:') ||
    h.startsWith('64:ff9b:') ||
    h.startsWith('2002:')
  )
}

/**
 * Motivo por el que una URL no sirve como destino de webhook, o `null` si sirve.
 * Exige `https://`; `http://localhost` sólo se acepta con `permitirLocal` (desarrollo).
 * Bloquea destinos internos (SSRF): IPs privadas, `localhost`, `*.local`, `*.internal`.
 */
export function problemaUrlWebhook(texto: string, opciones: { permitirLocal: boolean }) {
  let url: URL
  try {
    url = new URL(texto)
  } catch {
    return 'No es una URL válida'
  }
  if (url.username || url.password) return 'La URL no puede llevar usuario ni contraseña'
  // El analizador de URL ya normaliza las IP escritas en decimal, octal o hexadecimal.
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  if (url.protocol === 'http:' && local && opciones.permitirLocal) return null
  if (url.protocol !== 'https:') return 'La URL debe empezar con https://'
  if (
    local ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    ipv4Reservada(host) ||
    (host.startsWith('[') && ipv6Reservada(host.slice(1, -1)))
  ) {
    return 'La URL apunta a una red privada o local'
  }
  if (!host.includes('.') && !host.startsWith('[')) return 'Usa un nombre de dominio completo'
  return null
}

/** Aquí se valida la forma; el servidor vuelve a comprobarla según su configuración. */
const urlWebhook = z
  .string()
  .trim()
  .max(2000)
  .superRefine((url, c) => {
    const problema = problemaUrlWebhook(url, { permitirLocal: true })
    if (problema) c.addIssue({ code: 'custom', message: problema })
  })

/**
 * Nombre de un evento que declara una extensión (`recurso.accion`). El servidor sólo acepta los que
 * declara alguna extensión activa; los del núcleo son EVENTOS_WEBHOOK.
 */
export const NOMBRE_EVENTO_EXTENSION = /^[a-z][a-z_]*\.[a-z_]+$/

const eventosWebhook = z
  .array(
    z.union([
      z.enum(EVENTOS_WEBHOOK),
      z.string().regex(NOMBRE_EVENTO_EXTENSION, 'Evento desconocido'),
    ]),
  )
  .min(1, 'Elige al menos un evento')
  .transform((eventos) => [...new Set(eventos)])

export const esquemaWebhook = z.object({
  url: urlWebhook,
  descripcion: opcional(200),
  eventos: eventosWebhook,
  activo: z.boolean().default(true),
})
export type WebhookEntrada = z.infer<typeof esquemaWebhook>

export const esquemaWebhookCambios = z
  .object({
    url: urlWebhook.optional(),
    /** `null` o '' la borran; ausente la deja como está. */
    descripcion: z.string().trim().max(200).nullable().optional(),
    eventos: eventosWebhook.optional(),
    activo: z.boolean().optional(),
  })
  .refine((c) => Object.values(c).some((v) => v !== undefined), 'Indica al menos un cambio')
export type WebhookCambios = z.infer<typeof esquemaWebhookCambios>
