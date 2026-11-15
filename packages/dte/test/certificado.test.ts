import { describe, expect, it } from 'vitest'
import { generarCertificadoPrueba, leerCertificadoMH } from '../src/sign'

describe('leerCertificadoMH', () => {
  it('lee un certificado legítimo (y su tamaño cabe de sobra en el límite de 20 000)', async () => {
    const { xml } = await generarCertificadoPrueba('06141234567890', 'clave-segura')
    expect(xml.length).toBeLessThan(10_000)
    expect(leerCertificadoMH(xml).nit).toBe('06141234567890')
  })

  it('rechaza en pocos milisegundos 200 000 caracteres de <privateKey> sin cerrar', () => {
    const hostil = '<privateKey>'.repeat(Math.floor(200_000 / 12))
    const t0 = performance.now()
    expect(() => leerCertificadoMH(hostil)).toThrow(/Certificado inválido/)
    expect(performance.now() - t0).toBeLessThan(100)
  })

  it('un <nit> dentro de las llaves no sustituye al del certificado', async () => {
    const { xml } = await generarCertificadoPrueba('06141234567890', 'x')
    const falso = xml.replace('<keyType>PRIVATE', '<nit>999</nit><keyType>PRIVATE')
    expect(leerCertificadoMH(falso).nit).toBe('06141234567890')
  })
})
