import type { App } from './index'

/**
 * Tipo de la API para clientes RPC de Hono:
 *   import { hc } from 'hono/client'
 *   import type { AppType } from 'server/client'
 *   const api = hc<AppType>('/')
 */
export type AppType = App
