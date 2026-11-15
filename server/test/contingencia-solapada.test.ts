import { env } from 'cloudflare:test'
import { crearMockMH } from '@openfactura/dte/mock'
import { PERMISOS } from 'shared'
import { expect, it } from 'vitest'
import type { Ctx } from '../src/contexto'
import { crearDb } from '../src/db'
import { emitir, obtener, transmitirContingencia } from '../src/services/dte'
import { guardarCredenciales, guardarEmisor } from '../src/services/emisor'
import { EMISOR, nuevaOrganizacion } from './ayudas'

const NIT = '06142907861023'
const PASS = 'api-de-prueba'
const FACTURA = {
  tipoDte: '01' as const,
  datos: { items: [{ descripcion: 'Servicio', cantidad: 1, precioUni: 11.3 }] },
}

it('dos corridas de contingencia solapadas no dejan rechazado un documento sellado por el MH', async () => {
  const { organizationId, userId } = await nuevaOrganizacion()
  const mock = crearMockMH({ usuarios: { [NIT]: PASS } })
  const st = { caido: false, hook: null as null | (() => Promise<void>) }
  const mhFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    if (st.caido) throw new TypeError('fetch failed')
    if (st.hook && url.pathname === '/fesv/contingencia') {
      const h = st.hook
      st.hook = null
      await h()
    }
    return mock.fetch(input, init)
  }
  const mk = (): Ctx => ({
    env,
    db: crearDb(env.DB),
    actor: {
      tipo: 'usuario',
      id: userId,
      organizationId,
      permisos: new Set(PERMISOS),
      origen: 'panel',
    },
    mhFetch,
  })
  const ctxA = mk()
  const ctxB = mk()
  const { esquemaEmisor } = await import('shared')
  await guardarEmisor(ctxA, esquemaEmisor.parse(EMISOR))
  const { generarCertificadoPrueba } = await import('@openfactura/dte')
  const { xml } = await generarCertificadoPrueba(NIT, 'clave-cert')
  await guardarCredenciales(ctxA, '00', {
    apiPassword: PASS,
    certificado: xml,
    certificadoPassword: 'clave-cert',
  })
  expect((await emitir(ctxA, FACTURA)).status).toBe(201)
  st.caido = true
  const c1 = (await emitir(ctxA, FACTURA)).cuerpo as { codigoGeneracion: string }
  const c2 = (await emitir(ctxA, FACTURA)).cuerpo as { codigoGeneracion: string }
  st.caido = false
  let rA: any
  // Run B has already read its list; run A completes before B's first MH call.
  st.hook = async () => {
    rA = await transmitirContingencia(ctxA)
  }
  const rB = await transmitirContingencia(ctxB)
  const fin = await Promise.all(
    [c1, c2].map(async (c) => {
      const d = await obtener(ctxA, c.codigoGeneracion)
      return {
        estado: d.estado,
        sellado: !!d.selloRecibido,
        selladoEnMh: mock.recibidos.has(c.codigoGeneracion),
        error: d.error,
      }
    }),
  )
  expect(fin.filter((f) => f.selladoEnMh && f.estado === 'rechazado').length).toBe(0)
  expect(fin.every((f) => f.estado === 'procesado' && f.sellado)).toBe(true)
  expect(rB.rechazados.length).toBe(0)
  expect((rA?.procesados.length ?? 0) + rB.procesados.length).toBe(2)
})
