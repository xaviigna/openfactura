import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { Cliente, EMISOR, FACTURA, nuevaClave, nuevaOrganizacion } from './ayudas'

describe('sesión y organización', () => {
  it('rechaza peticiones sin sesión ni clave', async () => {
    const r = await new Cliente().json('GET', '/api/v1/yo')
    expect(r.status).toBe(401)
    expect(r.cuerpo.error.code).toBe('no_autenticado')
  })

  it('un usuario sin organización recibe 409', async () => {
    const cliente = new Cliente()
    await cliente.json('POST', '/api/auth/sign-up/email', {
      name: 'Sin organización',
      email: `solo-${crypto.randomUUID()}@ejemplo.com`,
      password: 'clave-larga-12345',
    })
    const r = await cliente.json('GET', '/api/v1/yo')
    expect(r.status).toBe(409)
    expect(r.cuerpo.error.code).toBe('sin_organizacion')
  })

  it('el propietario tiene todos los permisos', async () => {
    const { cliente } = await nuevaOrganizacion()
    const r = await cliente.json('GET', '/api/v1/yo')
    expect(r.status).toBe(200)
    expect(r.cuerpo.rol).toBe('owner')
    expect(r.cuerpo.permisos).toContain('claves:manage')
    expect(r.cuerpo.ambiente).toBe('00')
    expect(r.cuerpo.mcp).toBe('http://localhost/mcp')
  })

  it('no guarda la contraseña en claro', async () => {
    await nuevaOrganizacion()
    const fila = await env.DB.prepare(
      "SELECT password FROM account WHERE provider_id = 'credential' LIMIT 1",
    ).first<{ password: string }>()
    expect(fila?.password).toMatch(/^pbkdf2-sha256\$6\$100000\$/)
    expect(fila?.password).not.toContain('clave-larga-12345')
  })
})

describe('emisor y credenciales', () => {
  it('normaliza NIT y NRC y crea M001/P001', async () => {
    const { cliente } = await nuevaOrganizacion()
    const r = await cliente.json('PUT', '/api/v1/emisor', EMISOR)
    expect(r.status).toBe(200)
    expect(r.cuerpo.emisor.nit).toBe('06142907861023')
    expect(r.cuerpo.emisor.nrc).toBe('1234567')
    expect(r.cuerpo.establecimientos[0].codMh).toBe('M001')
    expect(r.cuerpo.establecimientos[0].puntosVenta[0].codMh).toBe('P001')
  })

  it('valida los datos del emisor', async () => {
    const { cliente } = await nuevaOrganizacion()
    const r = await cliente.json('PUT', '/api/v1/emisor', {
      ...EMISOR,
      nit: '123',
      correo: 'no-es-correo',
    })
    expect(r.status).toBe(400)
    expect(r.cuerpo.error.code).toBe('datos_invalidos')
    expect(r.cuerpo.error.details.map((d: { ruta: string }) => d.ruta)).toEqual(
      expect.arrayContaining(['nit', 'correo']),
    )
  })

  it('nunca devuelve los secretos y los guarda cifrados', async () => {
    const { cliente, organizationId } = await nuevaOrganizacion({ emisor: true })
    await cliente.json('PUT', '/api/v1/emisor/credenciales/00', {
      apiPassword: 'secreto-del-mh-XYZ',
    })
    const r = await cliente.pedir('GET', '/api/v1/emisor')
    const texto = await r.text()
    expect(texto).not.toContain('secreto-del-mh-XYZ')
    expect(texto).not.toContain('privateKey')
    expect(JSON.parse(texto).credenciales['00']).toMatchObject({
      apiPassword: true,
      certificado: true,
    })

    const fila = await env.DB.prepare(
      'SELECT api_password_enc, certificado_enc FROM credencial_mh WHERE organization_id = ?1',
    )
      .bind(organizationId)
      .first<{ api_password_enc: string; certificado_enc: string }>()
    expect(fila?.api_password_enc).toMatch(/^v1\./)
    expect(fila?.api_password_enc).not.toContain('secreto-del-mh-XYZ')
    expect(fila?.certificado_enc).not.toContain('privateKey')
  })

  it('rechaza un certificado de otro NIT o con contraseña equivocada', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const { generarCertificadoPrueba } = await import('@openfactura/dte')
    const ajeno = await generarCertificadoPrueba('06140101901010', 'clave')
    const otroNit = await cliente.json('PUT', '/api/v1/emisor/credenciales/00', {
      certificado: ajeno.xml,
      certificadoPassword: 'clave',
    })
    expect(otroNit.status).toBe(400)
    expect(otroNit.cuerpo.error.message).toContain('06140101901010')

    const propio = await generarCertificadoPrueba('06142907861023', 'clave')
    const malaClave = await cliente.json('PUT', '/api/v1/emisor/credenciales/00', {
      certificado: propio.xml,
      certificadoPassword: 'otra',
    })
    expect(malaClave.status).toBe(400)
  })

  it('sin credenciales no se puede emitir', async () => {
    const { cliente } = await nuevaOrganizacion()
    await cliente.json('PUT', '/api/v1/emisor', EMISOR)
    const r = await cliente.json('POST', '/api/v1/dte', FACTURA)
    expect(r.status).toBe(409)
    expect(r.cuerpo.error.code).toBe('credenciales_incompletas')
  })
})

describe('emisión', () => {
  it('emite una factura, la sella y entrega JSON y PDF', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const r = await cliente.json('POST', '/api/v1/dte', FACTURA)
    expect(r.status).toBe(201)
    expect(r.cuerpo).toMatchObject({
      estado: 'procesado',
      numeroControl: 'DTE-01-M001P001-000000000000001',
      total: 22.6,
      origen: 'panel',
      ambiente: '00',
    })
    expect(r.cuerpo.selloRecibido).toBeTruthy()

    const codigo = r.cuerpo.codigoGeneracion
    const archivo = await cliente.json('GET', `/api/v1/dte/${codigo}/json`)
    expect(archivo.cuerpo.selloRecibido).toBe(r.cuerpo.selloRecibido)
    expect(archivo.cuerpo.firmaElectronica.split('.')).toHaveLength(3)

    const pdf = await cliente.pedir('GET', `/api/v1/dte/${codigo}/pdf`)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 4))).toBe('%PDF')
  })

  it('un documento inválido no consume número de control', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const malo = await cliente.json('POST', '/api/v1/dte', { tipoDte: '01', datos: { items: [] } })
    expect(malo.status).toBe(400)
    const sinReceptor = await cliente.json('POST', '/api/v1/dte', {
      tipoDte: '03',
      datos: { items: [{ descripcion: 'x', cantidad: 1, precioUni: 1 }] },
    })
    expect(sinReceptor.status).toBe(400)
    const bueno = await cliente.json('POST', '/api/v1/dte', FACTURA)
    expect(bueno.cuerpo.numeroControl).toBe('DTE-01-M001P001-000000000000001')
  })

  it('emisiones simultáneas reciben correlativos consecutivos y distintos', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    // La primera deja el token del MH guardado; las demás corren en paralelo.
    await cliente.json('POST', '/api/v1/dte', FACTURA)
    const respuestas = await Promise.all(
      Array.from({ length: 12 }, () => cliente.json('POST', '/api/v1/dte', FACTURA)),
    )
    expect(respuestas.every((r) => r.status === 201)).toBe(true)
    const correlativos = respuestas
      .map((r) => Number(r.cuerpo.numeroControl.slice(-15)))
      .sort((a, b) => a - b)
    expect(correlativos).toEqual(Array.from({ length: 12 }, (_, i) => i + 2))
  })

  it('cada tipo de DTE lleva su propia serie', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const c = await cliente.json('POST', '/api/v1/clientes', {
      tipoDocumento: '36',
      numDocumento: '0614-290786-103-1',
      nrc: '234567-8',
      nombre: 'CLIENTE CONTRIBUYENTE, S.A. DE C.V.',
      codActividad: '46900',
      descActividad: 'Venta al por mayor de otros productos',
      departamento: '06',
      municipio: '23',
      distrito: '14',
      complemento: 'Av. Olímpica #100',
      telefono: '22445566',
      correo: 'compras@cliente.com.sv',
    })
    expect(c.status).toBe(201)
    await cliente.json('POST', '/api/v1/dte', FACTURA)
    const ccf = await cliente.json('POST', '/api/v1/dte', {
      tipoDte: '03',
      clienteId: c.cuerpo.id,
      datos: { items: [{ descripcion: 'Licencia', cantidad: 1, precioUni: 100 }] },
    })
    expect(ccf.status).toBe(201)
    expect(ccf.cuerpo.numeroControl).toBe('DTE-03-M001P001-000000000000001')
    expect(ccf.cuerpo.total).toBe(113)
    expect(ccf.cuerpo.receptorNombre).toBe('CLIENTE CONTRIBUYENTE, S.A. DE C.V.')

    // En el Comprobante de Retención el total es el IVA retenido.
    const retencion = await cliente.json('POST', '/api/v1/dte/validar', {
      tipoDte: '07',
      clienteId: c.cuerpo.id,
      datos: {
        items: [
          {
            tipoDte: '03',
            tipoGeneracion: 2,
            numeroDocumento: crypto.randomUUID().toUpperCase(),
            fechaEmision: '2026-01-15',
            montoSujetoGrav: 1000,
            codigoRetencionMH: '22',
          },
        ],
      },
    })
    expect(retencion.status).toBe(200)
    expect(retencion.cuerpo.problemas).toEqual([])
    expect(retencion.cuerpo.total).toBe(10)
  })

  it('emite liquidación (08), documento contable de liquidación (09) y donación (15)', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const c = await cliente.json('POST', '/api/v1/clientes', {
      tipoDocumento: '36',
      numDocumento: '0614-290786-103-1',
      nrc: '234567-8',
      nombre: 'MANDANTE, S.A. DE C.V.',
      codActividad: '46900',
      descActividad: 'Venta al por mayor de otros productos',
      departamento: '06',
      municipio: '23',
      distrito: '14',
      complemento: 'Av. Olímpica #100',
      telefono: '22445566',
      correo: 'compras@cliente.com.sv',
    })
    const liquidacion = await cliente.json('POST', '/api/v1/dte', {
      tipoDte: '08',
      clienteId: c.cuerpo.id,
      datos: {
        documentos: [
          {
            tipoDte: '03',
            numeroDocumento: crypto.randomUUID(),
            fechaEmision: '2026-11-03',
            ventaGravada: 500,
            ivaPercibido: 5,
          },
        ],
      },
    })
    expect(liquidacion.status).toBe(201)
    expect(liquidacion.cuerpo.numeroControl).toBe('DTE-08-M001P001-000000000000001')
    expect(liquidacion.cuerpo.total).toBe(570)
    expect(liquidacion.cuerpo.receptorNombre).toBe('MANDANTE, S.A. DE C.V.')

    const contable = await cliente.json('POST', '/api/v1/dte', {
      tipoDte: '09',
      clienteId: c.cuerpo.id,
      datos: {
        periodo: { inicio: '2026-11-01', fin: '2026-11-07' },
        valorOperaciones: 1130,
        porcentComision: 3,
        entrega: { nombre: 'Ana López', documento: '01234567-8' },
      },
    })
    expect(contable.status).toBe(201)
    expect(contable.cuerpo.total).toBe(1071.69)
    expect(contable.cuerpo.receptorDocumento).toBe('06142907861031')

    const donacion = await cliente.json('POST', '/api/v1/dte', {
      tipoDte: '15',
      clienteId: c.cuerpo.id,
      datos: {
        documentosAsociados: [{ descripcion: 'Resolución', detalle: 'RES-01-2026' }],
        items: [{ tipoDonacion: 2, descripcion: 'Computadoras', cantidad: 2, valorUni: 300 }],
      },
    })
    expect(donacion.status).toBe(201)
    expect(donacion.cuerpo.total).toBe(600)

    // Un afiliado sin NIT no sirve para el 09: el error se da antes de gastar correlativo.
    const sinNit = await cliente.json('POST', '/api/v1/dte/validar', {
      tipoDte: '09',
      datos: {
        receptor: { nombre: 'X', correo: 'x@y.sv' },
        periodo: { inicio: '2026-11-01', fin: '2026-11-07' },
        valorOperaciones: 10,
        entrega: { nombre: 'A', documento: '1' },
      },
    })
    expect(sinNit.status).toBe(400)
  })

  it('Idempotency-Key evita emitir dos veces', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const llave = { 'Idempotency-Key': 'pedido-1001' }
    const primera = await cliente.json('POST', '/api/v1/dte', FACTURA, llave)
    const segunda = await cliente.json('POST', '/api/v1/dte', FACTURA, llave)
    expect(segunda.status).toBe(201)
    expect(segunda.cuerpo.codigoGeneracion).toBe(primera.cuerpo.codigoGeneracion)
    expect(segunda.headers.get('Idempotent-Replayed')).toBe('true')

    const distinta = await cliente.json(
      'POST',
      '/api/v1/dte',
      { ...FACTURA, datos: { items: [{ descripcion: 'Otro', cantidad: 1, precioUni: 1 }] } },
      llave,
    )
    expect(distinta.status).toBe(409)
    expect(distinta.cuerpo.error.code).toBe('idempotencia_distinta')

    const lista = await cliente.json('GET', '/api/v1/dte')
    expect(lista.cuerpo.total).toBe(1)
  })

  it('invalida un documento procesado y no permite invalidarlo dos veces', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const { cuerpo: doc } = await cliente.json('POST', '/api/v1/dte', FACTURA)
    const r = await cliente.json('POST', `/api/v1/dte/${doc.codigoGeneracion}/invalidar`, {
      tipoAnulacion: 2,
      motivoAnulacion: 'Operación rescindida',
    })
    expect(r.status).toBe(200)
    expect(r.cuerpo.estado).toBe('invalidado')
    expect(r.cuerpo.eventos[0]).toMatchObject({ tipo: 'invalidacion', estado: 'procesado' })

    const otra = await cliente.json('POST', `/api/v1/dte/${doc.codigoGeneracion}/invalidar`, {
      tipoAnulacion: 2,
      motivoAnulacion: 'De nuevo',
    })
    expect(otra.status).toBe(409)
    expect(otra.cuerpo.error.code).toBe('estado_invalido')
  })
})

describe('aislamiento entre organizaciones', () => {
  it('una organización no ve ni toca los datos de otra', async () => {
    const a = await nuevaOrganizacion({ emisor: true })
    const b = await nuevaOrganizacion({ emisor: true })
    const { cuerpo: doc } = await a.cliente.json('POST', '/api/v1/dte', FACTURA)
    const { cuerpo: cliente } = await a.cliente.json('POST', '/api/v1/clientes', {
      tipoDocumento: '13',
      numDocumento: '01234567-8',
      nombre: 'Cliente de A',
    })
    const { cuerpo: producto } = await a.cliente.json('POST', '/api/v1/productos', {
      codigo: 'P-1',
      descripcion: 'Producto de A',
      precioUnitario: 10,
    })
    const claveA = await nuevaClave(a.cliente, ['dte:read'])
    const { cuerpo: retorno } = await a.cliente.json(
      'POST',
      `/api/v1/dte/${doc.codigoGeneracion}/retorno`,
      { items: [{ descripcion: 'Servicio', cantidad: 1, precioUni: 11.3 }] },
    )

    for (const ruta of [
      `/api/v1/eventos/${retorno.codigoGeneracion}`,
      `/api/v1/eventos/${retorno.codigoGeneracion}/json`,
      `/api/v1/eventos/${retorno.codigoGeneracion}/pdf`,
      `/api/v1/dte/${doc.codigoGeneracion}`,
      `/api/v1/dte/${doc.id}`,
      `/api/v1/dte/${doc.codigoGeneracion}/json`,
      `/api/v1/dte/${doc.codigoGeneracion}/pdf`,
      `/api/v1/clientes/${cliente.id}`,
      `/api/v1/productos/${producto.id}`,
    ]) {
      expect((await b.cliente.pedir('GET', ruta)).status, ruta).toBe(404)
    }
    expect((await b.cliente.json('GET', '/api/v1/dte')).cuerpo.total).toBe(0)
    expect((await b.cliente.json('GET', '/api/v1/eventos')).cuerpo).toHaveLength(0)
    const retornoAjeno = await b.cliente.json(
      'POST',
      `/api/v1/dte/${doc.codigoGeneracion}/retorno`,
      {
        items: [{ descripcion: 'Servicio', cantidad: 1, precioUni: 11.3 }],
      },
    )
    expect(retornoAjeno.status).toBe(404)
    expect(
      (
        await b.cliente.pedir('POST', `/api/v1/dte/${retorno.codigoGeneracion}/invalidar`, {
          tipoAnulacion: 2,
        })
      ).status,
    ).toBe(404)
    expect((await b.cliente.json('GET', '/api/v1/clientes')).cuerpo).toHaveLength(0)
    expect((await b.cliente.json('GET', '/api/v1/claves')).cuerpo).toHaveLength(0)
    expect((await b.cliente.pedir('DELETE', `/api/v1/clientes/${cliente.id}`)).status).toBe(404)
    expect((await b.cliente.pedir('DELETE', `/api/v1/claves/${claveA.id}`)).status).toBe(404)
    expect(
      (
        await b.cliente.pedir('POST', `/api/v1/dte/${doc.codigoGeneracion}/invalidar`, {
          tipoAnulacion: 2,
        })
      ).status,
    ).toBe(404)
    // Tampoco puede usar un cliente ajeno como receptor.
    const ajeno = await b.cliente.json('POST', '/api/v1/dte', { ...FACTURA, clienteId: cliente.id })
    expect(ajeno.status).toBe(404)
    // La clave de A sigue viendo sólo lo de A.
    expect((await claveA.cliente.json('GET', '/api/v1/dte')).cuerpo.total).toBe(1)

    // Webhooks y sus entregas: B no los ve, no los prueba, no los cambia ni los borra.
    const envios = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('ok'))
    try {
      const { cuerpo: webhook } = await a.cliente.json('POST', '/api/v1/webhooks', {
        url: 'https://receptor.ejemplo.com/hook',
        eventos: ['dte.procesado'],
      })
      const { cuerpo: prueba } = await a.cliente.json(
        'POST',
        `/api/v1/webhooks/${webhook.id}/probar`,
      )
      expect(prueba.entregado).toBe(true)
      expect((await b.cliente.json('GET', '/api/v1/webhooks')).cuerpo).toHaveLength(0)
      for (const [metodo, ruta, cuerpo] of [
        ['GET', `/api/v1/webhooks/${webhook.id}/entregas`],
        ['POST', `/api/v1/webhooks/${webhook.id}/probar`],
        ['POST', `/api/v1/webhooks/${webhook.id}/rotar-secreto`],
        ['PATCH', `/api/v1/webhooks/${webhook.id}`, { activo: false }],
        ['DELETE', `/api/v1/webhooks/${webhook.id}`],
        ['POST', `/api/v1/webhooks/entregas/${prueba.entrega.id}/reenviar`],
      ] as Array<[string, string, unknown?]>) {
        expect((await b.cliente.pedir(metodo, ruta, cuerpo)).status, `${metodo} ${ruta}`).toBe(404)
      }
      expect(envios).toHaveBeenCalledTimes(1)
      // Lo que emite B no se notifica a los webhooks de A.
      await b.cliente.json('POST', '/api/v1/dte', FACTURA)
      const entregas = await a.cliente.json('GET', `/api/v1/webhooks/${webhook.id}/entregas`)
      expect(entregas.cuerpo).toHaveLength(1)
      expect((await a.cliente.json('GET', '/api/v1/webhooks')).cuerpo[0].activo).toBe(true)
    } finally {
      envios.mockRestore()
    }
  })
})

describe('claves de API', () => {
  it('guarda sólo el hash y muestra la clave una vez', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const { clave, id } = await nuevaClave(cliente, ['dte:read'])
    expect(clave).toMatch(/^of_test_[0-9A-Za-z]{40}$/)
    const fila = await env.DB.prepare('SELECT hash, prefijo FROM clave_api WHERE id = ?1')
      .bind(id)
      .first<{ hash: string; prefijo: string }>()
    expect(fila?.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(fila?.prefijo).toBe(clave.slice(0, 14))
    const lista = await cliente.pedir('GET', '/api/v1/claves')
    expect(await lista.text()).not.toContain(clave)
  })

  it('aplica los permisos de la clave', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const lectura = await nuevaClave(cliente, ['dte:read'])
    expect((await lectura.cliente.json('GET', '/api/v1/dte')).status).toBe(200)
    const emitir = await lectura.cliente.json('POST', '/api/v1/dte', FACTURA)
    expect(emitir.status).toBe(403)
    expect(emitir.cuerpo.error.details.permiso).toBe('dte:emit')
    expect((await lectura.cliente.json('GET', '/api/v1/clientes')).status).toBe(403)
    // Una clave nunca administra claves, credenciales ni auditoría.
    expect((await lectura.cliente.json('GET', '/api/v1/claves')).status).toBe(403)
    expect((await lectura.cliente.json('PUT', '/api/v1/emisor', EMISOR)).status).toBe(403)
    expect((await lectura.cliente.json('GET', '/api/v1/auditoria')).status).toBe(403)

    const emisora = await nuevaClave(cliente, ['dte:read', 'dte:emit'])
    const ok = await emisora.cliente.json('POST', '/api/v1/dte', FACTURA)
    expect(ok.status).toBe(201)
    expect(ok.cuerpo.origen).toBe('api')
  })

  it('no acepta permisos que una clave no puede llevar', async () => {
    const { cliente } = await nuevaOrganizacion()
    const r = await cliente.json('POST', '/api/v1/claves', {
      nombre: 'Demasiado',
      modo: 'test',
      scopes: ['claves:manage'],
    })
    expect(r.status).toBe(400)
  })

  it('rechaza claves revocadas, expiradas, inventadas o mal formadas', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const { clave, id, cliente: conClave } = await nuevaClave(cliente, ['dte:read'])
    expect((await conClave.json('GET', '/api/v1/dte')).status).toBe(200)

    expect((await cliente.json('DELETE', `/api/v1/claves/${id}`)).status).toBe(200)
    expect((await conClave.json('GET', '/api/v1/dte')).status).toBe(401)

    const expirada = await nuevaClave(cliente, ['dte:read'], { expiraEnDias: 1 })
    await env.DB.prepare('UPDATE clave_api SET expira = ?1 WHERE id = ?2')
      .bind(Date.now() - 1000, expirada.id)
      .run()
    expect((await expirada.cliente.json('GET', '/api/v1/dte')).status).toBe(401)

    const inventada = `of_test_${'0'.repeat(40)}`
    expect((await new Cliente(inventada).json('GET', '/api/v1/dte')).status).toBe(401)
    expect((await new Cliente('no-es-una-clave').json('GET', '/api/v1/dte')).status).toBe(401)
    expect(
      (await new Cliente(clave.replace('of_test_', 'of_live_')).json('GET', '/api/v1/dte')).status,
    ).toBe(401)
  })

  it('una clave live opera en producción y no ve documentos de pruebas', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const { cuerpo: doc } = await cliente.json('POST', '/api/v1/dte', FACTURA)
    const live = await nuevaClave(cliente, ['dte:read', 'dte:emit'], { modo: 'live' })
    expect(live.clave).toMatch(/^of_live_/)
    expect((await live.cliente.json('GET', '/api/v1/yo')).cuerpo.ambiente).toBe('01')
    expect((await live.cliente.json('GET', '/api/v1/dte')).cuerpo.total).toBe(0)
    expect((await live.cliente.pedir('GET', `/api/v1/dte/${doc.codigoGeneracion}`)).status).toBe(
      404,
    )
    // No hay credenciales de producción y el simulador nunca atiende ese ambiente.
    const emitir = await live.cliente.json('POST', '/api/v1/dte', FACTURA)
    expect(emitir.status).toBe(409)
    expect(emitir.cuerpo.error.details.ambiente).toBe('01')
  })

  it('limita las peticiones por clave y avisa con encabezados', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const { cliente: conClave } = await nuevaClave(cliente, ['dte:read'])
    const primera = await conClave.pedir('GET', '/api/v1/catalogos')
    expect(primera.headers.get('RateLimit-Limit')).toBe('40')
    expect(Number(primera.headers.get('RateLimit-Remaining'))).toBe(39)

    let bloqueada: Response | undefined
    // La ventana es de un minuto fijo: se piden suficientes para superar el límite de 40 aunque
    // el minuto cambie a mitad de la prueba.
    for (let i = 0; i < 85 && !bloqueada; i++) {
      const r = await conClave.pedir('GET', '/api/v1/catalogos')
      if (r.status === 429) bloqueada = r
    }
    expect(bloqueada).toBeDefined()
    expect(Number(bloqueada!.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(((await bloqueada!.json()) as { error: { code: string } }).error.code).toBe(
      'limite_excedido',
    )
    // El límite es por clave: la sesión del panel no se ve afectada.
    expect((await cliente.pedir('GET', '/api/v1/catalogos')).status).toBe(200)
  })
})

describe('roles', () => {
  it('un facturador emite pero no administra', async () => {
    const { cliente, organizationId } = await nuevaOrganizacion({ emisor: true })
    // Se degrada el rol directamente: invitar a otro usuario requeriría correo.
    await env.DB.prepare("UPDATE member SET role = 'member' WHERE organization_id = ?1")
      .bind(organizationId)
      .run()
    const yo = await cliente.json('GET', '/api/v1/yo')
    expect(yo.cuerpo.rol).toBe('member')
    expect(yo.cuerpo.permisos).not.toContain('emisor:write')
    expect((await cliente.json('POST', '/api/v1/dte', FACTURA)).status).toBe(201)
    expect((await cliente.json('PUT', '/api/v1/emisor', EMISOR)).status).toBe(403)
    expect((await cliente.json('GET', '/api/v1/claves')).status).toBe(403)
    expect((await cliente.json('GET', '/api/v1/auditoria')).status).toBe(403)
    const { cuerpo: doc } = await cliente.json('GET', '/api/v1/dte')
    expect(
      (
        await cliente.json('POST', `/api/v1/dte/${doc.items[0].codigoGeneracion}/invalidar`, {
          tipoAnulacion: 2,
        })
      ).status,
    ).toBe(403)
  })
})

describe('CSRF', () => {
  it('rechaza cambios con cookie desde otro origen', async () => {
    const { cliente } = await nuevaOrganizacion()
    const r = await cliente.json('PUT', '/api/v1/emisor', EMISOR, {
      Origin: 'https://sitio-malicioso.example',
    })
    expect(r.status).toBe(403)
    expect(r.cuerpo.error.code).toBe('origen_no_permitido')
  })
})

describe('MCP', () => {
  const mcp = (cliente: Cliente, cuerpo: unknown) =>
    cliente.pedir('POST', '/mcp', cuerpo, { Accept: 'application/json, text/event-stream' })
  const leer = async (r: Response) => {
    const texto = await r.text()
    const datos = texto.includes('data:') ? texto.split('data:').pop()! : texto
    return JSON.parse(datos)
  }

  it('exige clave de API', async () => {
    const r = await mcp(new Cliente(), { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(r.status).toBe(401)
    expect(r.headers.get('WWW-Authenticate')).toContain('Bearer')
  })

  it('lista herramientas y emite respetando los permisos de la clave', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const { cliente: conClave } = await nuevaClave(cliente, ['dte:read', 'dte:emit', 'emisor:read'])

    const lista = await leer(await mcp(conClave, { jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    const nombres = lista.result.tools.map((t: { name: string }) => t.name)
    expect(nombres).toEqual(
      expect.arrayContaining([
        'dte_emitir',
        'dte_validar',
        'dte_invalidar',
        'catalogo_buscar',
        'dte_retorno',
        'operaciones_especiales_informar',
        'eventos_listar',
        'evento_obtener',
        'webhooks_listar',
        'webhook_crear',
        'webhook_eliminar',
        'webhook_probar',
      ]),
    )

    const emitir = await leer(
      await mcp(conClave, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'dte_emitir', arguments: { ...FACTURA, idempotencyKey: 'mcp-intento-1' } },
      }),
    )
    expect(emitir.result.isError).toBeFalsy()
    expect(emitir.result.structuredContent.resultado).toMatchObject({
      estado: 'procesado',
      origen: 'mcp',
    })

    const sinPermiso = await leer(
      await mcp(conClave, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'clientes_buscar', arguments: {} },
      }),
    )
    expect(sinPermiso.result.isError).toBe(true)
    expect(sinPermiso.result.content[0].text).toContain('sin_permiso')
  })

  it('administra webhooks con webhooks:manage y nunca lista el secreto', async () => {
    const { cliente } = await nuevaOrganizacion()
    const { cliente: conClave } = await nuevaClave(cliente, ['webhooks:manage'])
    const llamar = async (id: number, name: string, args: Record<string, unknown> = {}) =>
      (
        await leer(
          await mcp(conClave, {
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        )
      ).result
    const creado = await llamar(1, 'webhook_crear', {
      url: 'https://receptor.ejemplo.com/hook',
      eventos: ['dte.procesado'],
    })
    expect(creado.isError).toBeFalsy()
    const { secreto, id } = creado.structuredContent.resultado
    expect(secreto).toMatch(/^whsec_/)
    const lista = await llamar(2, 'webhooks_listar')
    expect(lista.content[0].text).not.toContain(secreto)
    expect(lista.structuredContent.resultado).toHaveLength(1)
    expect((await llamar(3, 'webhook_eliminar', { id })).structuredContent.resultado).toEqual({
      eliminado: true,
    })
    const ssrf = await llamar(4, 'webhook_crear', {
      url: 'https://169.254.169.254/',
      eventos: ['dte.procesado'],
    })
    expect(ssrf.isError).toBe(true)
  })
})

describe('endurecimiento', () => {
  it('una respuesta idempotente no se repite a quien no puede emitir ni a otro ambiente', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const llave = { 'Idempotency-Key': 'pedido-compartido' }
    const original = await cliente.json('POST', '/api/v1/dte', FACTURA, llave)
    expect(original.status).toBe(201)

    const sinEmitir = await nuevaClave(cliente, ['clientes:read'])
    const intento = await sinEmitir.cliente.json('POST', '/api/v1/dte', FACTURA, llave)
    expect(intento.status).toBe(403)

    const live = await nuevaClave(cliente, ['dte:read', 'dte:emit'], { modo: 'live' })
    const enProduccion = await live.cliente.json('POST', '/api/v1/dte', FACTURA, llave)
    expect(enProduccion.headers.get('Idempotent-Replayed')).toBeNull()
    expect(enProduccion.status).toBe(409) // sin credenciales de producción: no repite la de pruebas
  })

  it('/mcp no acepta cookies de sesión', async () => {
    const { cliente } = await nuevaOrganizacion()
    const r = await cliente.pedir('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(r.status).toBe(401)
  })

  it('un cuerpo que no es JSON válido da 400, no 500', async () => {
    const { cliente } = await nuevaOrganizacion()
    const r = await cliente.pedir('PUT', '/api/v1/emisor', undefined, {
      'Content-Type': 'application/json',
    })
    expect(r.status).toBe(400)
  })

  it('con varias organizaciones y ninguna activa no adivina', async () => {
    const { cliente, correo } = await nuevaOrganizacion()
    await cliente.json('POST', '/api/auth/organization/create', {
      name: 'Segunda empresa',
      slug: `segunda-${crypto.randomUUID().slice(0, 8)}`,
    })
    const otraSesion = new Cliente()
    await otraSesion.json('POST', '/api/auth/sign-in/email', {
      email: correo,
      password: 'clave-larga-12345',
    })
    const r = await otraSesion.json('GET', '/api/v1/yo')
    expect(r.status).toBe(409)
    expect(r.cuerpo.error.code).toBe('sin_organizacion_activa')
    expect(r.cuerpo.error.details.organizaciones).toHaveLength(2)
  })

  it('actualizar el emisor sin indicar ambiente conserva el actual; el NIT se bloquea tras emitir', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    await cliente.json('PUT', '/api/v1/emisor', { ...EMISOR, ambiente: '01' })
    const sinAmbiente = await cliente.json('PUT', '/api/v1/emisor', EMISOR)
    expect(sinAmbiente.cuerpo.emisor.ambiente).toBe('01')
    await cliente.json('PUT', '/api/v1/emisor', { ...EMISOR, ambiente: '00' })
    expect((await cliente.json('POST', '/api/v1/dte', FACTURA)).status).toBe(201)
    const otroNit = await cliente.json('PUT', '/api/v1/emisor', {
      ...EMISOR,
      nit: '0614-010190-101-0',
    })
    expect(otroNit.status).toBe(409)
    expect(otroNit.cuerpo.error.code).toBe('nit_bloqueado')
  })

  it('no filtra errores internos cuando los datos están mal formados', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const r = await cliente.json('POST', '/api/v1/dte/validar', {
      tipoDte: '03',
      datos: { items: [{ descripcion: 'x', cantidad: 1, precioUni: 1 }] },
    })
    expect(r.status).toBe(400)
    expect(r.cuerpo.error.message).not.toMatch(/Cannot read|undefined/)
  })
})
