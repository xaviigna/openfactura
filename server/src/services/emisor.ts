import {
  ClienteMH,
  type Emisor as EmisorSdk,
  type Firmante,
  generarCertificadoPrueba,
  leerCertificadoMH,
  type Persona,
  verificarClaveCertificado,
} from '@openfactura/dte'
import { and, eq } from 'drizzle-orm'
import type {
  Ambiente,
  esquemaCredenciales,
  esquemaEmisor,
  esquemaEstablecimiento,
  esquemaPuntoVenta,
} from 'shared'
import type { z } from 'zod'
import { ambienteDeModo, type Ctx, exigir } from '../contexto'
import { credencialMh, documento, emisor, establecimiento, puntoVenta } from '../db'
import { aleatorioBase62, cifrar, descifrar, nuevoId } from '../lib/crypto'
import { AppError, conflicto, invalido, mensajeDe, noEncontrado } from '../lib/errors'
import { registrar } from './auditoria'
import { simuladorPara } from './simulador'

const AMBIENTES: Ambiente[] = ['00', '01']
const aad = (organizationId: string, ambiente: Ambiente, campo: string) =>
  `${organizationId}|${ambiente}|${campo}`

export async function filaEmisor(ctx: Ctx) {
  const [fila] = await ctx.db
    .select()
    .from(emisor)
    .where(eq(emisor.organizationId, ctx.actor.organizationId))
  return fila ?? null
}

/** Ambiente del MH para esta petición: lo fija la clave de API o, en el panel, el emisor. */
export async function ambienteActivo(ctx: Ctx): Promise<Ambiente> {
  if (ctx.actor.modo) return ambienteDeModo(ctx.actor.modo)
  return (await filaEmisor(ctx))?.ambiente ?? '00'
}

async function estadoCredenciales(ctx: Ctx) {
  const filas = await ctx.db
    .select()
    .from(credencialMh)
    .where(eq(credencialMh.organizationId, ctx.actor.organizationId))
  return Object.fromEntries(
    AMBIENTES.map((ambiente) => {
      const f = filas.find((x) => x.ambiente === ambiente)
      return [
        ambiente,
        {
          apiPassword: !!f?.apiPasswordEnc,
          certificado: !!f?.certificadoEnc && !!f?.certPasswordEnc,
          certificadoNit: f?.certNit ?? null,
          simuladas: !!f?.simulada,
          actualizado: f?.actualizado?.getTime() ?? null,
        },
      ]
    }),
  ) as Record<
    Ambiente,
    {
      apiPassword: boolean
      certificado: boolean
      certificadoNit: string | null
      simuladas: boolean
      actualizado: number | null
    }
  >
}

export async function listarEstablecimientos(ctx: Ctx) {
  const org = ctx.actor.organizationId
  const [establecimientos, puntos] = await Promise.all([
    ctx.db.select().from(establecimiento).where(eq(establecimiento.organizationId, org)),
    ctx.db.select().from(puntoVenta).where(eq(puntoVenta.organizationId, org)),
  ])
  return establecimientos
    .sort((a, b) => a.codMh.localeCompare(b.codMh))
    .map((e) => ({
      ...e,
      puntosVenta: puntos
        .filter((p) => p.establecimientoId === e.id)
        .sort((a, b) => a.codMh.localeCompare(b.codMh)),
    }))
}

/** Datos del emisor, sus establecimientos y qué credenciales están cargadas (nunca los secretos). */
export async function obtenerEmisor(ctx: Ctx) {
  exigir(ctx, 'emisor:read')
  const [fila, establecimientos, credenciales] = await Promise.all([
    filaEmisor(ctx),
    listarEstablecimientos(ctx),
    estadoCredenciales(ctx),
  ])
  return { emisor: fila, establecimientos, credenciales, ambienteActivo: await ambienteActivo(ctx) }
}

export async function guardarEmisor(ctx: Ctx, datos: z.infer<typeof esquemaEmisor>) {
  exigir(ctx, 'emisor:write')
  const org = ctx.actor.organizationId
  const existente = await filaEmisor(ctx)
  if (existente && existente.nit !== datos.nit) {
    // Los documentos ya emitidos y el certificado están ligados al NIT.
    const [emitido] = await ctx.db
      .select({ id: documento.id })
      .from(documento)
      .where(eq(documento.organizationId, org))
      .limit(1)
    if (emitido) {
      throw conflicto('nit_bloqueado', 'El NIT no puede cambiarse después de emitir documentos')
    }
  }
  if (existente) {
    await ctx.db
      .update(emisor)
      .set({ ...datos, actualizado: new Date() })
      .where(eq(emisor.organizationId, org))
  } else {
    // Primera vez: se crea la casa matriz M001 con su punto de venta P001.
    const idEstablecimiento = nuevoId()
    await ctx.db.batch([
      ctx.db.insert(emisor).values({ id: nuevoId(), organizationId: org, ...datos }),
      ctx.db.insert(establecimiento).values({
        id: idEstablecimiento,
        organizationId: org,
        nombre: 'Casa matriz',
        tipo: '02',
        codMh: 'M001',
      }),
      ctx.db.insert(puntoVenta).values({
        id: nuevoId(),
        organizationId: org,
        establecimientoId: idEstablecimiento,
        nombre: 'Punto de venta 1',
        codMh: 'P001',
      }),
    ])
  }
  await registrar(ctx, existente ? 'emisor.actualizar' : 'emisor.crear', 'emisor', null, {
    ambiente: datos.ambiente ?? existente?.ambiente ?? '00',
  })
  return obtenerEmisor(ctx)
}

export async function guardarCredenciales(
  ctx: Ctx,
  ambiente: Ambiente,
  datos: z.infer<typeof esquemaCredenciales>,
  simulada = false,
) {
  exigir(ctx, 'emisor:write')
  const org = ctx.actor.organizationId
  const fila = await filaEmisor(ctx)
  if (!fila) throw conflicto('emisor_no_configurado', 'Registra primero los datos del emisor')
  if (!!datos.certificado !== !!datos.certificadoPassword) {
    throw invalido('Envía juntos el certificado (.crt) y la contraseña de tu llave privada')
  }

  // Cualquier credencial que sube el usuario saca al ambiente del simulador.
  const cambios: Partial<typeof credencialMh.$inferInsert> = { actualizado: new Date(), simulada }
  if (datos.apiPassword) {
    cambios.apiPasswordEnc = await cifrar(ctx.env, aad(org, ambiente, 'api'), datos.apiPassword)
    // Una contraseña nueva invalida el token guardado.
    cambios.tokenEnc = null
    cambios.tokenExpira = null
  }
  if (datos.certificado && datos.certificadoPassword) {
    let certificado: ReturnType<typeof leerCertificadoMH>
    try {
      certificado = leerCertificadoMH(datos.certificado)
    } catch (error) {
      throw invalido(mensajeDe(error, 'El archivo no es un certificado válido del MH'))
    }
    if (!(await verificarClaveCertificado(certificado, datos.certificadoPassword))) {
      throw invalido('La contraseña no corresponde a la llave privada del certificado')
    }
    const nitCertificado = certificado.nit.replace(/[^0-9]/g, '')
    if (nitCertificado !== fila.nit) {
      throw invalido(
        `El certificado pertenece al NIT ${nitCertificado}, pero el emisor es ${fila.nit}`,
      )
    }
    cambios.certificadoEnc = await cifrar(ctx.env, aad(org, ambiente, 'cert'), datos.certificado)
    cambios.certPasswordEnc = await cifrar(
      ctx.env,
      aad(org, ambiente, 'certpass'),
      datos.certificadoPassword,
    )
    cambios.certNit = nitCertificado
  }

  await ctx.db
    .insert(credencialMh)
    .values({ id: nuevoId(), organizationId: org, ambiente, ...cambios })
    .onConflictDoUpdate({
      target: [credencialMh.organizationId, credencialMh.ambiente],
      set: cambios,
    })
  await registrar(ctx, 'credenciales.guardar', 'credencial_mh', ambiente, {
    apiPassword: !!datos.apiPassword,
    certificado: !!datos.certificado,
  })
  return (await estadoCredenciales(ctx))[ambiente]
}

/**
 * Sólo con el simulador activo (MH_SIMULADO=1): genera un certificado de prueba y una contraseña
 * de API para el ambiente de pruebas, de modo que se pueda emitir sin credenciales de Hacienda.
 * Quedan marcadas como simuladas: sólo ellas se atienden con el simulador.
 */
export async function cargarCredencialesPrueba(ctx: Ctx) {
  exigir(ctx, 'emisor:write')
  if (ctx.env.MH_SIMULADO !== '1') {
    throw conflicto('simulador_inactivo', 'El simulador del MH no está activo en este servidor')
  }
  const fila = await filaEmisor(ctx)
  if (!fila) throw conflicto('emisor_no_configurado', 'Registra primero los datos del emisor')
  const certificadoPassword = aleatorioBase62(24)
  const { xml } = await generarCertificadoPrueba(fila.nit, certificadoPassword)
  return guardarCredenciales(
    ctx,
    '00',
    {
      apiPassword: aleatorioBase62(24),
      certificado: xml,
      certificadoPassword,
    },
    true,
  )
}

export async function crearEstablecimiento(
  ctx: Ctx,
  datos: z.infer<typeof esquemaEstablecimiento>,
) {
  exigir(ctx, 'emisor:write')
  const id = nuevoId()
  try {
    await ctx.db
      .insert(establecimiento)
      .values({ id, organizationId: ctx.actor.organizationId, ...datos })
  } catch {
    throw conflicto('codigo_repetido', `Ya existe un establecimiento con el código ${datos.codMh}`)
  }
  await registrar(ctx, 'establecimiento.crear', 'establecimiento', id, { codMh: datos.codMh })
  return listarEstablecimientos(ctx)
}

export async function actualizarEstablecimiento(
  ctx: Ctx,
  id: string,
  datos: z.infer<typeof esquemaEstablecimiento>,
) {
  exigir(ctx, 'emisor:write')
  const filtro = and(
    eq(establecimiento.id, id),
    eq(establecimiento.organizationId, ctx.actor.organizationId),
  )
  const [actual] = await ctx.db.select().from(establecimiento).where(filtro)
  if (!actual) throw noEncontrado('El establecimiento')
  try {
    await ctx.db.update(establecimiento).set(datos).where(filtro)
  } catch {
    throw conflicto('codigo_repetido', `Ya existe un establecimiento con el código ${datos.codMh}`)
  }
  await registrar(ctx, 'establecimiento.actualizar', 'establecimiento', id)
  return listarEstablecimientos(ctx)
}

export async function crearPuntoVenta(ctx: Ctx, datos: z.infer<typeof esquemaPuntoVenta>) {
  exigir(ctx, 'emisor:write')
  const org = ctx.actor.organizationId
  const [padre] = await ctx.db
    .select()
    .from(establecimiento)
    .where(
      and(eq(establecimiento.id, datos.establecimientoId), eq(establecimiento.organizationId, org)),
    )
  if (!padre) throw noEncontrado('El establecimiento')
  const id = nuevoId()
  try {
    await ctx.db.insert(puntoVenta).values({ id, organizationId: org, ...datos })
  } catch {
    throw conflicto(
      'codigo_repetido',
      `Ya existe el punto de venta ${datos.codMh} en ${padre.codMh}`,
    )
  }
  await registrar(ctx, 'punto_venta.crear', 'punto_venta', id, { codMh: datos.codMh })
  return listarEstablecimientos(ctx)
}

// ---------------------------------------------------------------------------
// Contexto de emisión: sólo para uso interno de los servicios de DTE.

export interface EmisorParaDte {
  ambiente: Ambiente
  emisor: EmisorSdk
  responsable: Persona | null
}

export interface ContextoEmision extends EmisorParaDte {
  cliente: ClienteMH
  firmante: Firmante
  /** Hay un token del MH guardado y vigente: no hace falta autenticar antes de transmitir. */
  tokenVigente: boolean
}

/**
 * Emisor en el formato del SDK para un punto de venta (por defecto el primero, o el que
 * corresponda a `codigos`). No necesita credenciales: sirve para previsualizar.
 */
export async function emisorParaDte(
  ctx: Ctx,
  seleccion: {
    puntoVentaId?: string
    codigos?: { establecimiento: string; puntoVenta: string }
  } = {},
): Promise<EmisorParaDte> {
  const fila = await filaEmisor(ctx)
  if (!fila)
    throw conflicto('emisor_no_configurado', 'Registra los datos del emisor antes de emitir')
  const ambiente = ctx.actor.modo ? ambienteDeModo(ctx.actor.modo) : fila.ambiente

  const establecimientos = await listarEstablecimientos(ctx)
  const puntos = establecimientos.flatMap((e) => e.puntosVenta.map((p) => ({ e, p })))
  const elegido = seleccion.puntoVentaId
    ? puntos.find((x) => x.p.id === seleccion.puntoVentaId)
    : seleccion.codigos
      ? puntos.find(
          (x) =>
            x.e.codMh === seleccion.codigos?.establecimiento &&
            x.p.codMh === seleccion.codigos?.puntoVenta,
        )
      : puntos[0]
  if (!elegido) {
    throw seleccion.puntoVentaId || seleccion.codigos
      ? noEncontrado('El punto de venta')
      : conflicto('sin_punto_venta', 'El emisor no tiene ningún punto de venta')
  }

  const { e, p } = elegido
  return {
    ambiente,
    emisor: {
      nit: fila.nit,
      nrc: fila.nrc,
      nombre: fila.nombre,
      codActividad: fila.codActividad,
      descActividad: fila.descActividad,
      nombreComercial: fila.nombreComercial,
      tipoEstablecimiento: e.tipo,
      direccion: {
        departamento: e.departamento ?? fila.departamento,
        municipio: e.municipio ?? fila.municipio,
        distrito: e.distrito ?? fila.distrito,
        complemento: e.complemento ?? fila.complemento,
      },
      telefono: e.telefono ?? fila.telefono,
      correo: fila.correo,
      codEstableMH: e.codMh,
      codPuntoVentaMH: p.codMh,
      codEstable: e.codInterno,
      codPuntoVenta: p.codInterno,
    },
    responsable:
      fila.responsableNombre && fila.responsableTipoDoc && fila.responsableNumDoc
        ? {
            nombre: fila.responsableNombre,
            tipoDocumento: fila.responsableTipoDoc,
            numDocumento: fila.responsableNumDoc,
          }
        : null,
  }
}

/**
 * Emisor más credenciales descifradas, listo para firmar y transmitir.
 * Lanza 409 con un código preciso si falta algo por configurar.
 */
export async function contextoEmision(
  ctx: Ctx,
  seleccion: Parameters<typeof emisorParaDte>[1] = {},
): Promise<ContextoEmision> {
  const org = ctx.actor.organizationId
  const base = await emisorParaDte(ctx, seleccion)
  const { ambiente } = base

  const [cred] = await ctx.db
    .select()
    .from(credencialMh)
    .where(and(eq(credencialMh.organizationId, org), eq(credencialMh.ambiente, ambiente)))
  if (!cred?.apiPasswordEnc || !cred.certificadoEnc || !cred.certPasswordEnc) {
    throw conflicto(
      'credenciales_incompletas',
      `Faltan la contraseña de API o el certificado del MH para el ambiente ${ambiente === '00' ? 'de pruebas' : 'de producción'}`,
      { ambiente },
    )
  }
  if (cred.simulada && ctx.env.MH_SIMULADO !== '1') {
    throw conflicto(
      'simulador_inactivo',
      'Estas credenciales son del simulador, que no está activo en este servidor. Carga las credenciales de pruebas del MH.',
    )
  }
  const [apiPassword, certificado, certPassword] = await Promise.all([
    descifrar(ctx.env, aad(org, ambiente, 'api'), cred.apiPasswordEnc),
    descifrar(ctx.env, aad(org, ambiente, 'cert'), cred.certificadoEnc),
    descifrar(ctx.env, aad(org, ambiente, 'certpass'), cred.certPasswordEnc),
  ])
  const token =
    cred.tokenEnc && cred.tokenExpira && cred.tokenExpira.getTime() > Date.now() + 60_000
      ? await descifrar(ctx.env, aad(org, ambiente, 'token'), cred.tokenEnc)
      : undefined

  return {
    ...base,
    tokenVigente: !!token,
    cliente: new ClienteMH({
      ambiente,
      usuario: base.emisor.nit,
      password: apiPassword,
      baseUrl: ctx.env.MH_BASE_URL || undefined,
      fetch:
        ctx.mhFetch ??
        (cred.simulada && ambiente === '00'
          ? simuladorPara(base.emisor.nit, apiPassword).fetch
          : undefined),
      userAgent: 'openfactura/0.1',
      token,
      // El token dura 24 h en producción y 48 h en pruebas: se guarda cifrado con margen de 1 h.
      alRenovarToken: async (nuevo) => {
        await ctx.db
          .update(credencialMh)
          .set({
            tokenEnc: await cifrar(ctx.env, aad(org, ambiente, 'token'), nuevo),
            tokenExpira: new Date(Date.now() + (ambiente === '01' ? 23 : 47) * 3_600_000),
          })
          .where(eq(credencialMh.id, cred.id))
      },
    }),
    firmante: { certificado, password: certPassword },
  }
}

/** Comprueba que la contraseña de API autentica contra el MH. */
export async function probarConexion(ctx: Ctx) {
  exigir(ctx, 'emisor:write')
  const { cliente, ambiente } = await contextoEmision(ctx)
  try {
    await cliente.autenticar()
    return { ok: true, ambiente, mensaje: 'El MH aceptó las credenciales' }
  } catch (error) {
    if (error instanceof AppError) throw error
    return { ok: false, ambiente, mensaje: mensajeDe(error, 'No se pudo conectar con el MH') }
  }
}
