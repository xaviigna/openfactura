import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import publicado from '../../docs-site/public/openapi.json'
import { CODIGOS_ERROR, construirOpenApi, rutaOpenApi } from '../src/openapi'
import { v1 } from '../src/routes/v1'

const pedirSpec = async () => {
  const r = await SELF.fetch('http://localhost/api/v1/openapi.json')
  return { status: r.status, headers: r.headers, cuerpo: (await r.json()) as any }
}

describe('documento OpenAPI', () => {
  it('se sirve sin autenticación y parece OpenAPI 3.1', async () => {
    const { status, headers, cuerpo } = await pedirSpec()
    expect(status).toBe(200)
    expect(headers.get('content-type')).toContain('application/json')
    expect(cuerpo.openapi).toBe('3.1.0')
    expect(cuerpo.info.title).toBeTruthy()
    expect(cuerpo.servers[0].url).toBe('https://app.openfactura.co/api/v1')
    for (const ruta of ['/dte', '/dte/{codigo}/retorno', '/eventos/operaciones-especiales']) {
      expect(cuerpo.paths[ruta], ruta).toBeDefined()
    }
    expect(cuerpo.paths['/dte'].post.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/Emision',
    )
    expect(cuerpo.components.schemas.Emision.required).toEqual(['tipoDte', 'datos'])
    expect(cuerpo.components.securitySchemes.claveApi.scheme).toBe('bearer')
  })

  it('documenta cada ruta registrada en v1, y sólo esas', async () => {
    const { cuerpo } = await pedirSpec()
    // `/ext/<id>/…` son rutas de extensiones: no viven en `v1` ni en este documento.
    const registradas = new Set(
      v1.routes
        .filter((r) => r.method !== 'ALL' && !r.path.startsWith('/ext/'))
        .map((r) => `${r.method.toLowerCase()} ${rutaOpenApi(r.path)}`),
    )
    const documentadas = new Set<string>()
    for (const [ruta, metodos] of Object.entries(cuerpo.paths as Record<string, object>)) {
      for (const metodo of Object.keys(metodos)) documentadas.add(`${metodo} ${ruta}`)
    }
    documentadas.delete('get /openapi.json') // se registra en index.ts, antes de la autenticación
    expect([...documentadas].some((r) => r.includes('/ext/'))).toBe(false)
    expect([...registradas].filter((r) => !documentadas.has(r))).toEqual([])
    expect([...documentadas].filter((r) => !registradas.has(r))).toEqual([])
  })

  it('cada operación tiene operationId único y respuestas de error del sobre común', async () => {
    const { cuerpo } = await pedirSpec()
    const ids = new Set<string>()
    for (const metodos of Object.values(cuerpo.paths as Record<string, Record<string, any>>)) {
      for (const op of Object.values(metodos)) {
        expect(ids.has(op.operationId), op.operationId).toBe(false)
        ids.add(op.operationId)
        if (op.operationId !== 'openapi_obtener') expect(op.responses['401']).toBeDefined()
      }
    }
    const codigos = cuerpo.components.schemas.Error.properties.error.properties.code.enum
    expect(codigos).toEqual(Object.keys(CODIGOS_ERROR))
    expect(codigos).toContain('dte_rechazado')
    expect(cuerpo.paths['/dte'].post.parameters).toContainEqual({
      $ref: '#/components/parameters/IdempotencyKey',
    })
  })

  it('la copia del sitio de documentación está al día (bun run openapi)', () => {
    expect(publicado).toEqual(JSON.parse(JSON.stringify(construirOpenApi())))
  })
})
