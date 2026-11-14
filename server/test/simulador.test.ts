import { env } from 'cloudflare:test'
import { PERMISOS } from 'shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '../src/contexto'
import { crearDb } from '../src/db'
import {
  cargarCredencialesPrueba,
  guardarCredenciales,
  guardarEmisor,
  obtenerEmisor,
  probarConexion,
} from '../src/services/emisor'
import { crearWebhook } from '../src/services/webhooks'
import { EMISOR, nuevaOrganizacion } from './ayudas'

const MH_OFICIAL = 'https://mh-oficial.prueba'

/** Organización con emisor y un `fetch` global espiado: ninguna petición sale a la red. */
async function entorno(vars: Partial<typeof env> = {}) {
  const { organizationId, userId } = await nuevaOrganizacion()
  const ctx: Ctx = {
    env: { ...env, MH_BASE_URL: MH_OFICIAL, ...vars },
    db: crearDb(env.DB),
    actor: {
      tipo: 'usuario',
      id: userId,
      organizationId,
      permisos: new Set(PERMISOS),
      origen: 'panel',
    },
  }
  const { esquemaEmisor } = await import('shared')
  await guardarEmisor(ctx, esquemaEmisor.parse(EMISOR))
  const red = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      Response.json({ status: 'ERROR', message: 'Usuario no valido' }, { status: 401 }),
    )
  return { ctx, red }
}

const urls = (red: { mock: { calls: unknown[][] } }) =>
  red.mock.calls.map(([entrada]) => String(entrada instanceof Request ? entrada.url : entrada))

afterEach(() => vi.restoreAllMocks())

describe('simulador del MH', () => {
  it('las credenciales generadas se atienden con el simulador, sin salir a la red', async () => {
    const { ctx, red } = await entorno()
    await cargarCredencialesPrueba(ctx)
    expect((await obtenerEmisor(ctx)).credenciales['00'].simuladas).toBe(true)
    expect(await probarConexion(ctx)).toMatchObject({ ok: true, ambiente: '00' })
    expect(red).not.toHaveBeenCalled()
  })

  it('las credenciales que sube el usuario van a Hacienda aunque el simulador esté activo', async () => {
    const { ctx, red } = await entorno()
    const { generarCertificadoPrueba } = await import('@openfactura/dte')
    const { xml } = await generarCertificadoPrueba(EMISOR.nit, 'clave-cert')
    await guardarCredenciales(ctx, '00', {
      apiPassword: 'contraseña-del-mh',
      certificado: xml,
      certificadoPassword: 'clave-cert',
    })
    expect((await obtenerEmisor(ctx)).credenciales['00'].simuladas).toBe(false)
    const r = await probarConexion(ctx)
    expect(r.ok).toBe(false)
    expect(urls(red).some((u) => u.startsWith(MH_OFICIAL))).toBe(true)
  })

  it('reemplazar una parte de las credenciales generadas las saca del simulador', async () => {
    const { ctx, red } = await entorno()
    await cargarCredencialesPrueba(ctx)
    await guardarCredenciales(ctx, '00', { apiPassword: 'contraseña-real-del-mh' })
    expect((await obtenerEmisor(ctx)).credenciales['00'].simuladas).toBe(false)
    await probarConexion(ctx)
    expect(urls(red).some((u) => u.startsWith(MH_OFICIAL))).toBe(true)
  })

  it('sin el simulador, las credenciales generadas no se envían a Hacienda', async () => {
    const { ctx, red } = await entorno()
    await cargarCredencialesPrueba(ctx)
    ctx.env = { ...ctx.env, MH_SIMULADO: undefined }
    const error = await probarConexion(ctx).catch((e) => e)
    expect(error.code).toBe('simulador_inactivo')
    expect(red).not.toHaveBeenCalled()
    await expect(cargarCredencialesPrueba(ctx)).rejects.toMatchObject({
      code: 'simulador_inactivo',
    })
  })

  it('el simulador ya no habilita webhooks a localhost: sólo WEBHOOKS_LOCAL=1', async () => {
    const { ctx } = await entorno({ MH_SIMULADO: '1', WEBHOOKS_LOCAL: undefined })
    const local = {
      url: 'http://localhost:8080/hook',
      descripcion: null,
      eventos: ['dte.procesado' as const],
      activo: true,
    }
    await expect(crearWebhook(ctx, local)).rejects.toMatchObject({ code: 'datos_invalidos' })
    ctx.env = { ...ctx.env, WEBHOOKS_LOCAL: '1' }
    await expect(crearWebhook(ctx, local)).resolves.toMatchObject({ url: local.url })
  })
})
