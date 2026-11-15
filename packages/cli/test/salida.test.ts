import { describe, expect, it } from 'vitest'
import { ejecutar } from '../src/cli'
import { CLAVE_PRUEBA, crearEntorno, errorApi, json } from './ayuda'

const ESC = '\u001b'
const BEL = '\u0007'
const CSI8 = '\u009b'
const NOMBRE = `ACME${ESC}]0;PWNED${BEL}${ESC}[2J${CSI8}31m\u007f\u0000`
// biome-ignore lint/suspicious/noControlCharactersInRegex: se buscan controles a propósito
const CONTROLES = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/

describe('salida legible sin caracteres de control', () => {
  it('clientes list no imprime secuencias de escape guardadas en el nombre', async () => {
    const t = crearEntorno({
      env: { OPENFACTURA_API_KEY: CLAVE_PRUEBA },
      respuestas: [
        json([
          {
            id: 'c1',
            tipoDocumento: '37',
            numDocumento: 'X1',
            nombre: NOMBRE,
            nrc: null,
            correo: null,
          },
        ]),
      ],
    })
    expect(await ejecutar(['clientes', 'list'], t.ent)).toBe(0)
    expect(CONTROLES.test(t.stdout)).toBe(false)
    expect(t.stdout).toContain('ACME')
  })

  it('--json deja el dato intacto', async () => {
    const t = crearEntorno({
      env: { OPENFACTURA_API_KEY: CLAVE_PRUEBA },
      respuestas: [
        json([
          {
            id: 'c1',
            tipoDocumento: '37',
            numDocumento: 'X1',
            nombre: NOMBRE,
            nrc: null,
            correo: null,
          },
        ]),
      ],
    })
    await ejecutar(['clientes', 'list', '--json'], t.ent)
    expect(JSON.parse(t.stdout)[0].nombre).toBe(NOMBRE)
  })

  it('el mensaje y los detalles de un error de la API se limpian', async () => {
    const t = crearEntorno({
      env: { OPENFACTURA_API_KEY: CLAVE_PRUEBA },
      respuestas: [
        errorApi(400, `x${ESC}[2J`, `malo${ESC}]0;PWNED${BEL}`, [
          { ruta: `a${ESC}`, mensaje: `m${CSI8}` },
        ]),
      ],
    })
    await ejecutar(['clientes', 'list'], t.ent)
    expect(CONTROLES.test(t.stderr)).toBe(false)
    expect(t.stderr).toContain('malo')
  })
})
