import { fechaHoraSV } from '@openfactura/dte'
import { describe, expect, it } from 'vitest'
import { FACTURA, nuevaClave, nuevaOrganizacion } from './ayudas'

const SILLA = { items: [{ descripcion: 'Servicio', cantidad: 1, precioUni: 11.3 }] }

describe('evento de retorno (18)', () => {
  it('retorna parte de una factura, entrega JSON y PDF y no deja retornar de más', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const { cuerpo: doc } = await cliente.json('POST', '/api/v1/dte', FACTURA)

    const r = await cliente.json('POST', `/api/v1/dte/${doc.codigoGeneracion}/retorno`, SILLA)
    expect(r.status).toBe(201)
    expect(r.cuerpo).toMatchObject({
      tipo: 'retorno',
      tipoEvento: '18',
      estado: 'procesado',
      ambiente: '00',
    })
    expect(r.cuerpo.selloRecibido).toBeTruthy()

    const detalle = await cliente.json('GET', `/api/v1/eventos/${r.cuerpo.codigoGeneracion}`)
    expect(detalle.cuerpo.dte.documentoRelacionado[0].codigoGeneracion).toBe(doc.codigoGeneracion)
    expect(detalle.cuerpo.dte.resumen).toMatchObject({ montoTotalOperacion: 11.3, totalIva: 1.3 })
    const json = await cliente.json('GET', `/api/v1/eventos/${r.cuerpo.codigoGeneracion}/json`)
    expect(json.cuerpo.firmaElectronica).toBeTruthy()
    const pdf = await cliente.pedir('GET', `/api/v1/eventos/${r.cuerpo.codigoGeneracion}/pdf`)
    expect(pdf.headers.get('Content-Type')).toBe('application/pdf')

    const enDocumento = await cliente.json('GET', `/api/v1/dte/${doc.codigoGeneracion}`)
    expect(enDocumento.cuerpo.eventos[0]).toMatchObject({ tipo: 'retorno', estado: 'procesado' })

    // Quedan 11.30 de 22.60: un retorno de 22.60 se rechaza antes de ir al MH.
    const demas = await cliente.json('POST', `/api/v1/dte/${doc.codigoGeneracion}/retorno`, {
      items: [{ descripcion: 'Servicio', cantidad: 2, precioUni: 11.3 }],
    })
    expect(demas.status).toBe(409)
    expect(demas.cuerpo.error).toMatchObject({
      code: 'retorno_excedido',
      details: { disponible: 11.3 },
    })
  })

  it('un DTE con retorno vigente no se invalida hasta invalidar el retorno', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const { cuerpo: doc } = await cliente.json('POST', '/api/v1/dte', FACTURA)
    const { cuerpo: retorno } = await cliente.json(
      'POST',
      `/api/v1/dte/${doc.codigoGeneracion}/retorno`,
      SILLA,
    )

    const bloqueado = await cliente.json('POST', `/api/v1/dte/${doc.codigoGeneracion}/invalidar`, {
      tipoAnulacion: 2,
    })
    expect(bloqueado.status).toBe(409)
    expect(bloqueado.cuerpo.error).toMatchObject({
      code: 'retorno_vigente',
      details: { codigoGeneracion: retorno.codigoGeneracion },
    })

    const anulaRetorno = await cliente.json(
      'POST',
      `/api/v1/dte/${retorno.codigoGeneracion}/invalidar`,
      { tipoAnulacion: 2, motivoAnulacion: 'Retorno registrado por error' },
    )
    expect(anulaRetorno.status).toBe(200)
    expect(anulaRetorno.cuerpo).toMatchObject({ invalidado: true, tipo: 'retorno' })
    expect(
      (await cliente.json('GET', `/api/v1/eventos/${retorno.codigoGeneracion}`)).cuerpo.estado,
    ).toBe('invalidado')

    const ahora = await cliente.json('POST', `/api/v1/dte/${doc.codigoGeneracion}/invalidar`, {
      tipoAnulacion: 2,
    })
    expect(ahora.status).toBe(200)
    expect(ahora.cuerpo.estado).toBe('invalidado')
  })

  it('no aplica a un Crédito Fiscal y respeta Idempotency-Key y permisos', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const ccf = await cliente.json('POST', '/api/v1/dte', {
      tipoDte: '03',
      datos: {
        receptor: {
          nit: '06142907861031',
          nrc: '2345678',
          nombre: 'CLIENTE, S.A. DE C.V.',
          codActividad: '46900',
          descActividad: 'Venta al por mayor',
          direccion: { departamento: '06', municipio: '23', distrito: '14', complemento: 'Av. 1' },
        },
        items: [{ descripcion: 'Licencia', cantidad: 1, precioUni: 100 }],
      },
    })
    const noAplica = await cliente.json(
      'POST',
      `/api/v1/dte/${ccf.cuerpo.codigoGeneracion}/retorno`,
      SILLA,
    )
    expect(noAplica.status).toBe(400)
    expect(noAplica.cuerpo.error.message).toContain('Nota de Crédito')

    const { cuerpo: doc } = await cliente.json('POST', '/api/v1/dte', FACTURA)
    const ruta = `/api/v1/dte/${doc.codigoGeneracion}/retorno`
    const primero = await cliente.json('POST', ruta, SILLA, { 'Idempotency-Key': 'retorno-1' })
    const repetido = await cliente.json('POST', ruta, SILLA, { 'Idempotency-Key': 'retorno-1' })
    expect(repetido.headers.get('Idempotent-Replayed')).toBe('true')
    expect(repetido.cuerpo.codigoGeneracion).toBe(primero.cuerpo.codigoGeneracion)

    const { cliente: soloLectura } = await nuevaClave(cliente, ['dte:read'])
    const sinPermiso = await soloLectura.json('POST', ruta, SILLA)
    expect(sinPermiso.status).toBe(403)
  })
})

describe('evento de operaciones especiales (17)', () => {
  it('con la fecha de hoy no declara una hora de emisión futura', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const hoy = fechaHoraSV()
    const r = await cliente.json('POST', '/api/v1/eventos/operaciones-especiales', {
      tipoDocumento: '02',
      fecha: hoy.fecha,
      items: [{ descripcion: 'Facturas simplificadas', docDel: '1', docAl: '5', precioUni: 10 }],
    })
    expect(r.status).toBe(201)
    const detalle = await cliente.json('GET', `/api/v1/eventos/${r.cuerpo.codigoGeneracion}`)
    const id = detalle.cuerpo.dte.identificacion
    expect(id.fecEmi).toBe(hoy.fecha)
    expect(id.horEmi <= fechaHoraSV().hora || fechaHoraSV().fecha !== hoy.fecha).toBe(true)
    expect(id.horEmi >= hoy.hora).toBe(true)
  })

  it('informa facturas simplificadas por rangos y aparece en el listado', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const r = await cliente.json('POST', '/api/v1/eventos/operaciones-especiales', {
      tipoDocumento: '02',
      items: [
        { descripcion: 'Facturas simplificadas', docDel: '1', docAl: '25', precioUni: 10 },
        {
          descripcion: 'Facturas simplificadas',
          docDel: '26',
          docAl: '26',
          precioUni: 5,
          tipoVenta: 'exenta',
        },
      ],
    })
    expect(r.status).toBe(201)
    expect(r.cuerpo).toMatchObject({
      tipo: 'operaciones_especiales',
      tipoEvento: '17',
      estado: 'procesado',
    })
    const detalle = await cliente.json('GET', `/api/v1/eventos/${r.cuerpo.codigoGeneracion}`)
    expect(detalle.cuerpo.dte.resumen).toMatchObject({
      totalGravada: 250,
      totalExenta: 5,
      total: 287.5,
    })

    const lista = await cliente.json('GET', '/api/v1/eventos?tipo=operaciones_especiales')
    expect(lista.cuerpo.map((e: { codigoGeneracion: string }) => e.codigoGeneracion)).toEqual([
      r.cuerpo.codigoGeneracion,
    ])
  })

  it('rechaza mezclar uno a uno con rangos y fechas futuras', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const mezcla = await cliente.json('POST', '/api/v1/eventos/operaciones-especiales', {
      tipoDocumento: '97',
      items: [
        { descripcion: 'x', numDocumento: 'A1', fechaEmision: '2026-01-01', precioUni: 1 },
        { descripcion: 'x', docDel: '1', docAl: '2', precioUni: 1 },
      ],
    })
    expect(mezcla.status).toBe(400)
    const futura = await cliente.json('POST', '/api/v1/eventos/operaciones-especiales', {
      tipoDocumento: '02',
      fecha: '2999-01-01',
      items: [{ descripcion: 'x', docDel: '1', docAl: '2', precioUni: 1 }],
    })
    expect(futura.status).toBe(400)
  })
})
