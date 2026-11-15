import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  enmascarar,
  guardarConfig,
  leerConfig,
  normalizarUrl,
  resolver,
  rutaConfig,
} from '../src/config'
import { ErrorCli, ErrorUso } from '../src/errores'
import { CLAVE_PRUEBA, crearEntorno } from './ayuda'

const modo = (ruta: string) => statSync(ruta).mode & 0o777

describe('configuración', () => {
  it('usa XDG_CONFIG_HOME y, si falta, ~/.config', () => {
    expect(rutaConfig({ XDG_CONFIG_HOME: '/tmp/xdg', HOME: '/home/ana' })).toBe(
      '/tmp/xdg/openfactura/config.json',
    )
    expect(rutaConfig({ HOME: '/home/ana' })).toBe('/home/ana/.config/openfactura/config.json')
    expect(rutaConfig({ XDG_CONFIG_HOME: 'relativa', HOME: '/home/ana' })).toBe(
      '/home/ana/.config/openfactura/config.json',
    )
  })

  it('guarda el archivo con modo 0600 y el directorio con 0700', () => {
    const { ent } = crearEntorno()
    const ruta = guardarConfig(ent.env, {
      perfiles: { default: { url: 'https://a.sv', apiKey: CLAVE_PRUEBA } },
    })
    expect(ruta).toBe(rutaConfig(ent.env))
    expect(modo(ruta)).toBe(0o600)
    expect(modo(dirname(ruta))).toBe(0o700)
    expect(leerConfig(ent.env).perfiles.default?.apiKey).toBe(CLAVE_PRUEBA)
  })

  it('corrige los permisos de un archivo y un directorio que ya existían abiertos', () => {
    const { ent } = crearEntorno()
    const ruta = rutaConfig(ent.env)
    mkdirSync(dirname(ruta), { recursive: true, mode: 0o755 })
    writeFileSync(ruta, '{}', { mode: 0o644 })
    guardarConfig(ent.env, { perfiles: {} })
    expect(modo(ruta)).toBe(0o600)
    expect(modo(dirname(ruta))).toBe(0o700)
  })

  it('sin archivo devuelve una configuración vacía; con JSON roto, un error claro', () => {
    const { ent } = crearEntorno()
    expect(leerConfig(ent.env)).toEqual({ perfiles: {} })
    mkdirSync(dirname(rutaConfig(ent.env)), { recursive: true })
    writeFileSync(rutaConfig(ent.env), '{ roto')
    expect(() => leerConfig(ent.env)).toThrow(ErrorCli)
  })

  describe('precedencia', () => {
    const preparar = (env: Record<string, string> = {}) => {
      const { ent } = crearEntorno({ env })
      guardarConfig(ent.env, {
        perfiles: {
          default: { url: 'https://guardada.sv', apiKey: 'of_test_guardada000000000000' },
          prod: { url: 'https://prod.sv', apiKey: 'of_live_produccion0000000000' },
        },
      })
      return ent.env
    }

    it('URL: --url > OPENFACTURA_URL > config > localhost', () => {
      const env = preparar({ OPENFACTURA_URL: 'https://entorno.sv' })
      expect(resolver(env, { url: 'https://opcion.sv' })).toMatchObject({
        url: 'https://opcion.sv',
        origenUrl: 'opción',
      })
      expect(resolver(env)).toMatchObject({ url: 'https://entorno.sv', origenUrl: 'entorno' })
      expect(resolver(preparar())).toMatchObject({
        url: 'https://guardada.sv',
        origenUrl: 'config',
      })
      expect(resolver(crearEntorno().ent.env)).toMatchObject({
        url: 'https://app.openfactura.co',
        origenUrl: 'defecto',
        apiKey: null,
      })
    })

    it('clave: OPENFACTURA_API_KEY > config', () => {
      expect(resolver(preparar({ OPENFACTURA_API_KEY: CLAVE_PRUEBA }))).toMatchObject({
        apiKey: CLAVE_PRUEBA,
        origenClave: 'entorno',
      })
      expect(resolver(preparar())).toMatchObject({
        apiKey: 'of_test_guardada000000000000',
        origenClave: 'config',
      })
    })

    it('perfil: --profile > OPENFACTURA_PROFILE > default', () => {
      const env = preparar({ OPENFACTURA_PROFILE: 'prod' })
      expect(resolver(env)).toMatchObject({
        perfil: 'prod',
        url: 'https://prod.sv',
        apiKey: 'of_live_produccion0000000000',
      })
      expect(resolver(env, { perfil: 'default' })).toMatchObject({
        perfil: 'default',
        url: 'https://guardada.sv',
      })
      expect(resolver(env, { perfil: 'nuevo' })).toMatchObject({
        perfil: 'nuevo',
        url: 'https://app.openfactura.co',
        apiKey: null,
      })
      expect(() => resolver(env, { perfil: '../x' })).toThrow(ErrorUso)
    })
  })

  it('normaliza la URL del servidor', () => {
    expect(normalizarUrl('https://factura.ejemplo.sv/')).toBe('https://factura.ejemplo.sv')
    expect(normalizarUrl('http://localhost:8788/api/v1/')).toBe('http://localhost:8788')
    expect(() => normalizarUrl('factura.ejemplo.sv')).toThrow(ErrorUso)
    expect(() => normalizarUrl('ftp://factura.ejemplo.sv')).toThrow(ErrorUso)
    expect(() => normalizarUrl('https://ana:secreto@factura.ejemplo.sv')).toThrow(ErrorUso)
  })

  it('enmascara la clave: 14 caracteres y puntos suspensivos', () => {
    expect(enmascarar(CLAVE_PRUEBA)).toBe('of_test_abcdef…')
    expect(enmascarar(CLAVE_PRUEBA)).toHaveLength(15)
  })

  it('el archivo guardado queda dentro de la carpeta temporal de la prueba', () => {
    const { ent, carpeta } = crearEntorno()
    expect(guardarConfig(ent.env, { perfiles: {} })).toBe(
      join(carpeta, 'xdg', 'openfactura', 'config.json'),
    )
  })
})
