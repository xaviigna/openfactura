import { z } from 'zod'

/**
 * Formas de entrada de las herramientas MCP. Reproducen las del servidor remoto para que ambos
 * anuncien las mismas herramientas; la validación definitiva la hace siempre la API.
 */

export const TIPOS_DTE = {
  '01': 'Factura',
  '03': 'Comprobante de Crédito Fiscal',
  '04': 'Nota de Remisión',
  '05': 'Nota de Crédito',
  '06': 'Nota de Débito',
  '07': 'Comprobante de Retención',
  '08': 'Comprobante de Liquidación',
  '09': 'Documento Contable de Liquidación',
  '11': 'Factura de Exportación',
  '14': 'Factura de Sujeto Excluido',
  '15': 'Comprobante de Donación',
} as const

export const ESTADOS_DTE = [
  'pendiente',
  'procesado',
  'rechazado',
  'contingencia',
  'invalidado',
] as const

export const NOMBRE_AMBIENTE: Record<string, string> = { '00': 'Pruebas', '01': 'Producción' }

const codigosTipo = Object.keys(TIPOS_DTE) as [
  keyof typeof TIPOS_DTE,
  ...Array<keyof typeof TIPOS_DTE>,
]

const texto = (max = 250) => z.string().trim().min(1).max(max)
const opcional = (max = 250) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null)

export const tipoDte = z.enum(codigosTipo)

export const cliente = z.object({
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

export const producto = z.object({
  codigo: texto(25),
  descripcion: texto(1000),
  precioUnitario: z.number().nonnegative().max(99_999_999_999),
  tipoItem: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
  uniMedida: z.number().int().min(1).max(99).default(59),
  tipoVenta: z.enum(['gravada', 'exenta', 'noSujeta']).default('gravada'),
})

const persona = z.object({
  nombre: texto(100),
  tipoDocumento: z.string().min(2).max(2),
  numDocumento: texto(20),
})

export const invalidacion = z.object({
  tipoAnulacion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  motivoAnulacion: opcional(250),
  codigoGeneracionReemplazo: opcional(36),
  solicitante: persona.optional(),
  responsable: persona.optional(),
})

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD')

export const retorno = z.object({
  items: z
    .array(
      z.object({
        descripcion: texto(1000),
        cantidad: z.number().positive(),
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
    .max(2000)
    .describe(
      'Bienes que se retornan. precioUni: en Factura (01) CON IVA, como en la factura; en Exportación (11) y Sujeto Excluido (14) SIN IVA.',
    ),
})

export const operacionesEspeciales = z.object({
  tipoDocumento: z
    .enum(['02', '97'])
    .describe('02 factura de venta simplificada (por rangos), 97 comprobante de control interno'),
  fecha: fecha.optional().describe('Fecha del evento; define el periodo informado'),
  items: z
    .array(
      z.object({
        descripcion: texto(1500),
        precioUni: z.number().nonnegative().describe('SIN IVA'),
        cantidad: z.number().int().positive().optional(),
        numDocumento: opcional(36),
        docDel: z.string().trim().min(1).max(36).optional(),
        docAl: z.string().trim().min(1).max(36).optional(),
        fechaEmision: fecha.optional(),
        tipoVenta: z.enum(['gravada', 'exenta', 'noSujeta']).optional(),
        codigoGeneracionRef: z.string().length(36).optional(),
      }),
    )
    .min(1)
    .max(2000),
})

/** Eventos de webhook: contrato público del servidor. */
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

export const webhook = z.object({
  url: z.string().max(2000).describe('URL https:// pública que recibirá los POST firmados'),
  descripcion: opcional(200),
  eventos: z.array(z.enum(EVENTOS_WEBHOOK)).min(1).describe('Eventos a los que se suscribe'),
  activo: z.boolean().optional(),
})
