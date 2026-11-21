import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { type Cliente, EMISOR, FACTURA, nuevaClave, nuevaOrganizacion } from './ayudas'

const { responsableNombre, responsableTipoDoc, responsableNumDoc, ...SIN_RESPONSABLE } = EMISOR
const DUI = { tipoDocumento: '13', numDocumento: '012345678' }

async function orgSinResponsable() {
  const o = await nuevaOrganizacion()
  const e = await o.cliente.json('PUT', '/api/v1/emisor', SIN_RESPONSABLE)
  expect(e.status, JSON.stringify(e.cuerpo)).toBe(200)
  const c = await o.cliente.json('POST', '/api/v1/emisor/credenciales-prueba')
  expect(c.status).toBe(200)
  const { cuerpo: doc } = await o.cliente.json('POST', '/api/v1/dte', FACTURA)
  return { ...o, codigo: doc.codigoGeneracion as string }
}

const invalidar = (c: Cliente, codigo: string, extra: object = {}) =>
  c.json('POST', `/api/v1/dte/${codigo}/invalidar`, {
    tipoAnulacion: 2,
    motivoAnulacion: 'Operación rescindida',
    ...extra,
  })

const eventoDe = async (codigo: string) => {
  const f = await env.DB.prepare(
    "SELECT e.dte FROM evento e JOIN documento d ON d.id = e.documento_id WHERE d.codigo_generacion = ?1 AND e.tipo = 'invalidacion'",
  )
    .bind(codigo)
    .first<{ dte: string }>()
  return JSON.parse(f!.dte).motivo
}

describe('responsable de anulaciones', () => {
  it('sin responsable en la solicitud ni en el emisor: 409 accionable, sin datos personales', async () => {
    const o = await orgSinResponsable()
    const r = await invalidar(o.cliente, o.codigo)
    expect(r.status).toBe(409)
    expect(r.cuerpo.error.code).toBe('responsable_no_configurado')
    expect(r.cuerpo.error.message).toContain('datos del emisor')
    expect(JSON.stringify(r.cuerpo)).not.toContain(o.correo)
  })

  it('con el responsable configurado en el emisor, invalida sin pedirlo', async () => {
    const o = await orgSinResponsable()
    const g = await o.cliente.json('PUT', '/api/v1/emisor', {
      ...SIN_RESPONSABLE,
      responsableNombre,
      responsableTipoDoc,
      responsableNumDoc,
    })
    expect(g.status).toBe(200)
    const r = await invalidar(o.cliente, o.codigo)
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(200)
    expect((await eventoDe(o.codigo)).nombreResponsable).toBe(responsableNombre)
  })

  it('el responsable de la solicitud manda sobre el del emisor', async () => {
    const o = await orgSinResponsable()
    const r = await invalidar(o.cliente, o.codigo, {
      responsable: {
        nombre: 'Luis Explícito',
        tipoDocumento: '36',
        numDocumento: '06142907861023',
      },
    })
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(200)
    expect((await eventoDe(o.codigo)).nombreResponsable).toBe('Luis Explícito')
  })

  it('la primera vez que se configura el emisor, se rellena con el documento de quien lo crea', async () => {
    const o = await nuevaOrganizacion()
    const d = await o.cliente.json('PUT', '/api/v1/yo/documento', DUI)
    expect(d.status, JSON.stringify(d.cuerpo)).toBe(200)
    expect(JSON.stringify(d.cuerpo)).not.toContain(DUI.numDocumento)
    const e = await o.cliente.json('PUT', '/api/v1/emisor', SIN_RESPONSABLE)
    expect(e.cuerpo.emisor).toMatchObject({
      responsableTipoDoc: '13',
      responsableNumDoc: DUI.numDocumento,
    })
    expect(e.cuerpo.emisor.responsableNombre).toBeTruthy()
  })

  it('el solicitante por defecto es la persona que anula, si registró su documento', async () => {
    const o = await orgSinResponsable()
    await o.cliente.json('PUT', '/api/v1/yo/documento', DUI)
    const r = await invalidar(o.cliente, o.codigo, {
      responsable: {
        nombre: 'Luis Explícito',
        tipoDocumento: '36',
        numDocumento: '06142907861023',
      },
    })
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(200)
    expect((await eventoDe(o.codigo)).numDocSolicita).toBe(DUI.numDocumento)
  })

  it('valida el DUI (dígito verificador) y exige nombre, tipo y número juntos', async () => {
    const o = await nuevaOrganizacion()
    const malo = await o.cliente.json('PUT', '/api/v1/emisor', {
      ...EMISOR,
      responsableNumDoc: '012345679',
    })
    expect(malo.status).toBe(400)
    const incompleto = await o.cliente.json('PUT', '/api/v1/emisor', {
      ...SIN_RESPONSABLE,
      responsableNombre: 'Ana',
    })
    expect(incompleto.status).toBe(400)
    const miDuiMalo = await o.cliente.json('PUT', '/api/v1/yo/documento', {
      tipoDocumento: '13',
      numDocumento: '012345679',
    })
    expect(miDuiMalo.status).toBe(400)
  })

  it('cambiar el responsable queda en la bitácora sin el nombre ni el número', async () => {
    const o = await orgSinResponsable()
    await o.cliente.json('PUT', '/api/v1/emisor', { ...EMISOR })
    await o.cliente.json('PUT', '/api/v1/yo/documento', DUI)
    const filas = await env.DB.prepare(
      'SELECT accion, detalle FROM auditoria WHERE organization_id = ?1',
    )
      .bind(o.organizationId)
      .all<{ accion: string; detalle: string | null }>()
    const todo = JSON.stringify(filas.results)
    expect(todo).toContain('responsableCambiado')
    expect(todo).toContain('perfil.documento')
    expect(todo).not.toContain(DUI.numDocumento)
    expect(todo).not.toContain(responsableNombre)
  })

  it('una clave de API no registra documento de persona; un facturador sólo ve el suyo', async () => {
    const o = await nuevaOrganizacion({ emisor: true })
    const k = await nuevaClave(o.cliente, ['dte:invalidate'])
    expect((await k.cliente.json('PUT', '/api/v1/yo/documento', DUI)).status).toBe(403)
  })

  it('evalúa la invalidación: plazo, reemplazo por motivo y responsable', async () => {
    const o = await orgSinResponsable()
    const r = await o.cliente.json('GET', `/api/v1/dte/${o.codigo}/invalidacion`)
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(200)
    expect(r.cuerpo).toMatchObject({
      puedeInvalidar: true,
      fueraDePlazo: false,
      responsableConfigurado: false,
      bloqueos: [],
    })
    expect(r.cuerpo.motivos).toEqual([
      { tipoAnulacion: 1, requiereReemplazo: true, requiereMotivo: false },
      { tipoAnulacion: 2, requiereReemplazo: false, requiereMotivo: false },
      { tipoAnulacion: 3, requiereReemplazo: true, requiereMotivo: true },
    ])
    await o.cliente.json('PUT', '/api/v1/emisor', { ...EMISOR })
    await invalidar(o.cliente, o.codigo)
    const ya = await o.cliente.json('GET', `/api/v1/dte/${o.codigo}/invalidacion`)
    expect(ya.cuerpo.puedeInvalidar).toBe(false)
    expect(ya.cuerpo.bloqueos).toEqual(['estado_invalido'])
  })

  it('PUT /emisor/responsable guarda sólo el responsable (DUI por defecto) y valida el DUI', async () => {
    const o = await orgSinResponsable()
    const malo = await o.cliente.json('PUT', '/api/v1/emisor/responsable', {
      nombre: 'Ana',
      numDocumento: '012345679',
    })
    expect(malo.status).toBe(400)
    const ok = await o.cliente.json('PUT', '/api/v1/emisor/responsable', {
      nombre: 'Ana Gómez',
      numDocumento: DUI.numDocumento,
    })
    expect(ok.status, JSON.stringify(ok.cuerpo)).toBe(200)
    expect(ok.cuerpo.emisor).toMatchObject({
      responsableTipoDoc: '13',
      responsableNombre: 'Ana Gómez',
    })
    const r = await invalidar(o.cliente, o.codigo)
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(200)
    expect((await eventoDe(o.codigo)).nombreResponsable).toBe('Ana Gómez')
  })

  it('quien sólo puede leer el emisor ve el número del responsable enmascarado', async () => {
    const o = await nuevaOrganizacion({ emisor: true })
    const k = await nuevaClave(o.cliente, ['emisor:read'])
    const v = await k.cliente.json('GET', '/api/v1/emisor')
    expect(v.status).toBe(200)
    expect(v.cuerpo.emisor.responsableNumDoc).not.toBe(responsableNumDoc)
    expect(v.cuerpo.emisor.responsableNumDoc.endsWith(String(responsableNumDoc).slice(-3))).toBe(
      true,
    )
    expect(
      (
        await k.cliente.json('PUT', '/api/v1/emisor/responsable', {
          nombre: 'X',
          numDocumento: DUI.numDocumento,
        })
      ).status,
    ).toBe(403)
  })

  it('aislamiento: otra organización no evalúa ni invalida el documento, ni toca el responsable', async () => {
    const o = await orgSinResponsable()
    const otra = await nuevaOrganizacion({ emisor: true })
    expect((await otra.cliente.json('GET', `/api/v1/dte/${o.codigo}/invalidacion`)).status).toBe(
      404,
    )
    await otra.cliente.json('PUT', '/api/v1/emisor/responsable', {
      nombre: 'Otra',
      numDocumento: DUI.numDocumento,
    })
    const r = await o.cliente.json('GET', `/api/v1/dte/${o.codigo}/invalidacion`)
    expect(r.cuerpo.responsableConfigurado).toBe(false)
  })
})
