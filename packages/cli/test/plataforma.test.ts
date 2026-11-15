import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ejecutar } from '../src/cli'
import { rutaConfig } from '../src/config'
import { CLAVE_PRUEBA, crearEntorno, json } from './ayuda'

const URL_SERVIDOR = 'https://factura.ejemplo.sv'
const CLAVE_CLIENTE = 'of_test_clienteCasaBarista0123456789abcdef'
const CASA_BARISTA = {
  id: 'cli_1',
  nombre: 'Casa Barista',
  externalId: 'cb-1',
  estado: 'pendiente',
  preparacion: 'conectado',
  falta: 'Los datos de su empresa',
  organizationId: 'org_cb',
}
const env = { OPENFACTURA_URL: URL_SERVIDOR }

/** Una sesión guardada (login) en un entorno nuevo de pruebas. */
async function conSesion() {
  const t = crearEntorno({ env, respuestas: [json({ actor: 'clave', ambiente: '00' })] })
  expect(await ejecutar(['login', '--key', CLAVE_PRUEBA], t.ent)).toBe(0)
  return t.ent.env as Record<string, string>
}

describe('plataforma', () => {
  it('add crea el cliente con tu clave en /cloud/plataforma y sugiere los siguientes pasos', async () => {
    const e = await conSesion()
    const t = crearEntorno({ env: e, respuestas: [json(CASA_BARISTA, 201)] })
    expect(
      await ejecutar(
        [
          'plataforma',
          'add',
          'Casa Barista',
          '--external-id',
          'cb-1',
          '--nit',
          '0614-290786-102-3',
        ],
        t.ent,
      ),
    ).toBe(0)
    const [llamada] = t.llamadas
    expect(llamada?.url.href).toBe(`${URL_SERVIDOR}/cloud/plataforma/clientes`)
    expect(llamada?.headers.get('Authorization')).toBe(`Bearer ${CLAVE_PRUEBA}`)
    expect(llamada?.cuerpo).toEqual({
      nombre: 'Casa Barista',
      externalId: 'cb-1',
      datos: { nit: '0614-290786-102-3' },
    })
    expect(t.stdout).toContain('openfactura usar cb-1')
  })

  it('usar crea una vez la clave del cliente; los comandos actúan como él hasta usar --yo', async () => {
    const e = await conSesion()
    const t = crearEntorno({
      env: e,
      respuestas: [json([CASA_BARISTA]), json({ id: 'k1', clave: CLAVE_CLIENTE }, 201)],
    })
    expect(await ejecutar(['usar', 'Casa Barista'], t.ent)).toBe(0)
    expect(t.llamadas[1]?.url.pathname).toBe('/cloud/plataforma/clientes/cli_1/claves')
    expect(t.llamadas[1]?.cuerpo).toMatchObject({ modo: 'test' })
    expect(t.stdout).not.toContain(CLAVE_CLIENTE)
    const guardado = JSON.parse(readFileSync(rutaConfig(t.ent.env), 'utf8')).perfiles.default
    expect(guardado).toMatchObject({
      apiKey: CLAVE_PRUEBA,
      usando: 'cli_1',
      clientes: { cli_1: { nombre: 'Casa Barista', apiKey: CLAVE_CLIENTE } },
    })

    // La API normal va con la clave del cliente; Plataforma sigue con la tuya.
    const despues = crearEntorno({
      env: e,
      respuestas: [json({ actor: 'clave' }), json([CASA_BARISTA])],
    })
    expect(await ejecutar(['whoami'], despues.ent)).toBe(0)
    expect(despues.llamadas[0]?.headers.get('Authorization')).toBe(`Bearer ${CLAVE_CLIENTE}`)
    expect(despues.stdout).toContain('Actuando como')
    expect(await ejecutar(['plataforma', 'list'], despues.ent)).toBe(0)
    expect(despues.llamadas[1]?.headers.get('Authorization')).toBe(`Bearer ${CLAVE_PRUEBA}`)
    expect(despues.stdout).toContain('→')

    // Volver a usarlo no crea otra clave.
    const otra = crearEntorno({ env: e, respuestas: [json([CASA_BARISTA])] })
    expect(await ejecutar(['usar', 'cb-1'], otra.ent)).toBe(0)
    expect(otra.llamadas).toHaveLength(1)

    const vuelta = crearEntorno({ env: e, respuestas: [json({ actor: 'clave' })] })
    expect(await ejecutar(['usar', '--yo'], vuelta.ent)).toBe(0)
    expect(await ejecutar(['whoami'], vuelta.ent)).toBe(0)
    expect(vuelta.llamadas[0]?.headers.get('Authorization')).toBe(`Bearer ${CLAVE_PRUEBA}`)
  })

  it('una clave de producción para un cliente pide confirmación (o --yes)', async () => {
    const e = await conSesion()
    const sinTerminal = crearEntorno({ env: e, respuestas: [json([CASA_BARISTA])] })
    expect(await ejecutar(['plataforma', 'clave', 'cb-1', '--live'], sinTerminal.ent)).toBe(2)
    expect(sinTerminal.stderr).toContain('--yes')

    const conYes = crearEntorno({
      env: e,
      respuestas: [json([CASA_BARISTA]), json({ id: 'k2', clave: 'of_live_x' }, 201)],
    })
    expect(await ejecutar(['plataforma', 'clave', 'cb-1', '--live', '--yes'], conYes.ent)).toBe(0)
    expect(conYes.llamadas[1]?.cuerpo).toMatchObject({ modo: 'live' })
  })

  it('un nombre que no existe o se repite pide el id', async () => {
    const e = await conSesion()
    const nadie = crearEntorno({ env: e, respuestas: [json([CASA_BARISTA])] })
    expect(await ejecutar(['plataforma', 'enlace', 'Otro'], nadie.ent)).toBe(1)
    const repetido = crearEntorno({
      env: e,
      respuestas: [json([CASA_BARISTA, { ...CASA_BARISTA, id: 'cli_2', externalId: null }])],
    })
    expect(await ejecutar(['plataforma', 'enlace', 'casa barista'], repetido.ent)).toBe(2)
    expect(repetido.stderr).toContain('cli_1, cli_2')
  })
})
