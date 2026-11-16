import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../src/index'
import { Cliente, nuevaClave, nuevaOrganizacion } from './ayudas'

const despachar = async (peticion: Request) => {
  const contexto = createExecutionContext()
  const respuesta = await worker.fetch(peticion, env, contexto)
  await waitOnExecutionContext(contexto)
  return respuesta
}
const ACCEPT = { Accept: 'application/json, text/event-stream' }
const llamada = (i: number, pref: string) => ({
  jsonrpc: '2.0',
  id: i,
  method: 'tools/call',
  params: {
    name: 'cliente_crear',
    arguments: { tipoDocumento: '37', numDocumento: `${pref}-${i}`, nombre: `Cliente ${i}` },
  },
})
const cuenta = async (sql: string, ...args: unknown[]) =>
  (
    (await env.DB.prepare(sql)
      .bind(...args)
      .first()) as { n: number }
  ).n

describe('MCP: lotes JSON-RPC', () => {
  it('un lote de 50 llamadas se rechaza y no crea ningún cliente', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const k = await nuevaClave(cliente, ['clientes:read', 'clientes:write'], { modo: 'live' })
    const c = new Cliente(k.clave)
    c.despachar = despachar
    const lote = Array.from({ length: 50 }, (_, i) => llamada(i + 1, 'LOTE'))
    const r = await c.pedir('POST', '/mcp', lote, ACCEPT)
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { code: number } }).error.code).toBe(-32600)
    expect(
      await cuenta("SELECT COUNT(*) AS n FROM cliente WHERE num_documento LIKE 'LOTE-%'"),
    ).toBe(0)
  })

  it('una llamada suelta sigue funcionando', async () => {
    const { cliente } = await nuevaOrganizacion({ emisor: true })
    const k = await nuevaClave(cliente, ['clientes:read', 'clientes:write'], { modo: 'live' })
    const c = new Cliente(k.clave)
    c.despachar = despachar
    const r = await c.pedir('POST', '/mcp', llamada(1, 'SOLA'), ACCEPT)
    expect(r.status).toBe(200)
    await r.text()
    expect(await cuenta("SELECT COUNT(*) AS n FROM cliente WHERE num_documento = 'SOLA-1'")).toBe(1)
  })
})
