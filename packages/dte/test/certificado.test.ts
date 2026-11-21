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
  it('expone el id (no el <serial> del algoritmo) y el vencimiento', async () => {
    const vence = new Date('2031-05-04T12:00:00Z')
    const { xml, certificado } = await generarCertificadoPrueba('06141234567890', 'x', { serie: 'abc123DEF', vence })
    expect(certificado.serie).toBe('abc123DEF')
    expect(certificado.vence).toBe(vence.getTime())
    expect(leerCertificadoMH(xml).serie).not.toBe('1.2.840.113549.1.1.11')
  })

  it('serie y vencimiento nulos si el archivo no los trae o no tienen forma válida', async () => {
    const { xml } = await generarCertificadoPrueba('06141234567890', 'x')
    const sin = xml.replace(/<_id>.*?<\/_id>/, '').replace(/<certificado>.*<\/certificado>/, '')
    expect(leerCertificadoMH(sin)).toMatchObject({ serie: null, vence: null })
    const malo = xml.replace(/<_id>.*?<\/_id>/, '<_id><script></_id>').replace(/<notAfter>.*?<\/notAfter>/, '<notAfter>basura</notAfter>')
    expect(leerCertificadoMH(malo)).toMatchObject({ serie: null, vence: null })
  })
})
