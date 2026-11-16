import { describe, expect, it } from 'vitest'
import { ejecutar } from '../src/cli'
import { CLAVE_PRUEBA, crearEntorno, json } from './ayuda'

const URL_SERVIDOR = 'https://factura.ejemplo.sv'
const CLAVE_CLIENTE = 'of_test_clienteCasaBarista0123456789abcdef'
const env = { OPENFACTURA_URL: URL_SERVIDOR }
const BASE = `${URL_SERVIDOR}/api/v1/ext/marca/plataforma`

const MARCA = {
  activa: true,
  nombre: 'Tu Marca',
  color: null,
  logo: null,
  correoSoporte: 'ayuda@tumarca.com',
  whatsappSoporte: null,
  urlBase: 'https://tu-marca.ejemplo.net',
  dominios: [{ id: 'd1', host: 'facturas.tumarca.com', estado: 'activo' }],
}

/** Una sesión guardada (login) en un entorno nuevo de pruebas. */
async function conSesion() {
  const t = crearEntorno({ env, respuestas: [json({ actor: 'clave', ambiente: '00' })] })
  expect(await ejecutar(['login', '--key', CLAVE_PRUEBA], t.ent)).toBe(0)
  return t.ent.env as Record<string, string>
}

describe('marca-blanca (sólo lectura)', () => {
  it('estado muestra la dirección y los dominios, y dice que se cambia en el panel', async () => {
    const e = await conSesion()
    const t = crearEntorno({ env: e, respuestas: [json(MARCA)] })
    expect(await ejecutar(['marca-blanca', 'estado'], t.ent)).toBe(0)
    expect(t.llamadas[0]?.url.href).toBe(BASE)
    expect(t.llamadas[0]?.metodo).toBe('GET')
    expect(t.stdout).toContain('https://tu-marca.ejemplo.net')
    expect(t.stdout).toContain('facturas.tumarca.com')
    expect(t.stdout).toContain('en el panel')
  })

  it('usa tu clave aunque estés actuando como un cliente', async () => {
    const e = await conSesion()
    const usar = crearEntorno({
      env: e,
      respuestas: [
        json([{ id: 'cli_1', nombre: 'Casa Barista', externalId: null, estado: 'activo' }]),
        json({ id: 'k1', clave: CLAVE_CLIENTE }, 201),
      ],
    })
    expect(await ejecutar(['usar', 'Casa Barista'], usar.ent)).toBe(0)
    const t = crearEntorno({ env: e, respuestas: [json(MARCA)] })
    expect(await ejecutar(['marca-blanca', 'estado'], t.ent)).toBe(0)
    expect(t.llamadas[0]?.headers.get('Authorization')).toBe(`Bearer ${CLAVE_PRUEBA}`)
  })

  it('dominios list lista host, estado e id; sin dominios lo dice', async () => {
    const e = await conSesion()
    const t = crearEntorno({
      env: e,
      respuestas: [
        json({ disponible: true, limite: 3, destino: null, dominios: MARCA.dominios }),
        json({ disponible: true, limite: 3, destino: null, dominios: [] }),
      ],
    })
    expect(await ejecutar(['dominios', 'list'], t.ent)).toBe(0)
    expect(t.llamadas[0]?.url.href).toBe(`${BASE}/dominios`)
    expect(t.stdout).toContain('facturas.tumarca.com')
    expect(await ejecutar(['dominios', 'list'], t.ent)).toBe(0)
    expect(t.stdout).toContain('Todavía no tienes dominios propios')
  })

  it('no hay comandos para cambiarla: se hace en el panel', async () => {
    const e = await conSesion()
    for (const args of [
      ['marca-blanca', 'activar'],
      ['dominios', 'add', 'facturas.tumarca.com'],
    ]) {
      const t = crearEntorno({ env: e })
      expect(await ejecutar(args, t.ent)).toBe(2)
      expect(t.llamadas).toHaveLength(0)
    }
  })
})
