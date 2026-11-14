import { drizzle } from 'drizzle-orm/d1'
import * as auth from './auth-schema'
import * as dominio from './schema'

export const esquema = { ...auth, ...dominio }
export const crearDb = (d1: D1Database) => drizzle(d1, { schema: esquema })
export type Db = ReturnType<typeof crearDb>
export * from './auth-schema'
export * from './schema'
