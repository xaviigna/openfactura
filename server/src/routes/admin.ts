/**
 * Administración de una instalación propia (ver lib/admin.ts): crear y listar organizaciones con
 * ADMIN_TOKEN. Sin ADMIN_TOKEN estas rutas responden 404, como si no existieran.
 */
import { zValidator } from '@hono/zod-validator'
import { desc } from 'drizzle-orm'
import { Hono } from 'hono'
import { PERMISOS } from 'shared'
import { z } from 'zod'
import type { Ctx } from '../contexto'
import { crearDb, organization } from '../db'
import { esTokenAdmin, LARGO_MINIMO_ADMIN } from '../lib/admin'
import { aleatorioBase62, nuevoId } from '../lib/crypto'
import { AppError, invalido, noAutenticado } from '../lib/errors'
import { type Entorno, limitarPorIp } from '../middleware/actor'
import { registrar } from '../services/auditoria'

const esquemaOrganizacion = z.object({ nombre: z.string().trim().min(1).max(120) })

/** Identificador legible: minúsculas, sin acentos, con un sufijo para evitar choques. */
const aSlug = (nombre: string) =>
  `${
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'organizacion'
  }-${aleatorioBase62(6).toLowerCase()}`

export const admin = new Hono<Entorno>()
  // Sin ADMIN_TOKEN la administración no existe: 404 antes de tocar la base.
  .use(async (c, next) => {
    const token = c.env.ADMIN_TOKEN
    if (!token || token.length < LARGO_MINIMO_ADMIN) {
      throw new AppError(404, 'no_encontrado', 'Ruta no encontrada')
    }
    await next()
  })
  // Pocas peticiones por IP: frena el tanteo del token.
  .use(limitarPorIp('admin', 30))
  .use(async (c, next) => {
    const [esquema, valor] = (c.req.header('authorization') ?? '').trim().split(/\s+/)
    if (esquema?.toLowerCase() !== 'bearer' || !(await esTokenAdmin(c.env, valor))) {
      c.header('WWW-Authenticate', 'Bearer error="invalid_token"')
      throw noAutenticado('Envía ADMIN_TOKEN en el encabezado Authorization')
    }
    await next()
  })

  .get('/organizaciones', async (c) => {
    const filas = await crearDb(c.env.DB)
      .select({ id: organization.id, nombre: organization.name, slug: organization.slug })
      .from(organization)
      .orderBy(desc(organization.createdAt))
    return c.json(filas)
  })

  .post(
    '/organizaciones',
    zValidator('json', esquemaOrganizacion, (r) => {
      if (!r.success) {
        throw invalido(
          'Datos inválidos',
          r.error.issues.map((i) => ({ ruta: i.path.join('.'), mensaje: i.message })),
        )
      }
    }),
    async (c) => {
      const { nombre } = c.req.valid('json')
      const db = crearDb(c.env.DB)
      const id = nuevoId()
      const slug = aSlug(nombre)
      await db.insert(organization).values({ id, name: nombre, slug, createdAt: new Date() })
      const ctx: Ctx = {
        env: c.env,
        db,
        actor: {
          tipo: 'sistema',
          id: 'admin',
          organizationId: id,
          permisos: new Set(PERMISOS),
          origen: 'api',
          ip: c.req.header('cf-connecting-ip'),
        },
      }
      await registrar(ctx, 'organizacion.crear', 'organizacion', id, { nombre })
      return c.json({ id, nombre, slug }, 201)
    },
  )
