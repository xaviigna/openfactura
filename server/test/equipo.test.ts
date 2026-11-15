import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { Cliente, nuevaOrganizacion } from './ayudas'

type Org = Awaited<ReturnType<typeof nuevaOrganizacion>>

async function cuenta(correo: string) {
  const c = new Cliente()
  const r = await c.json('POST', '/api/auth/sign-up/email', {
    name: 'Cuenta ficticia',
    email: correo,
    password: 'clave-larga-12345',
  })
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(200)
  return { cliente: c, userId: r.cuerpo.user.id as string }
}

/** Suma a la organización una cuenta nueva con ese rol (invitación real, aceptada). */
async function sumar(o: Org, rol: 'admin' | 'member') {
  const correo = `miembro-${crypto.randomUUID()}@ejemplo.com`
  const inv = await o.cliente.json('POST', '/api/auth/organization/invite-member', {
    email: correo,
    role: rol,
    organizationId: o.organizationId,
  })
  expect(inv.status, JSON.stringify(inv.cuerpo)).toBe(200)
  const a = await cuenta(correo)
  const acepta = await a.cliente.json('POST', '/api/auth/organization/accept-invitation', {
    invitationId: inv.cuerpo.id,
  })
  expect(acepta.status, JSON.stringify(acepta.cuerpo)).toBe(200)
  const m = await env.DB.prepare(
    'SELECT id FROM member WHERE organization_id = ?1 AND user_id = ?2',
  )
    .bind(o.organizationId, a.userId)
    .first<{ id: string }>()
  return { ...a, memberId: m!.id }
}

/** El admin invita a otra dirección; devuelve la invitación y la cuenta de esa dirección. */
async function invitaElAdmin(o: Org, admin: Awaited<ReturnType<typeof sumar>>) {
  const correo = `invitada-${crypto.randomUUID()}@ejemplo.com`
  const inv = await admin.cliente.json('POST', '/api/auth/organization/invite-member', {
    email: correo,
    role: 'admin',
    organizationId: o.organizationId,
  })
  expect(inv.status, JSON.stringify(inv.cuerpo)).toBe(200)
  return { id: inv.cuerpo.id as string, invitada: await cuenta(correo) }
}

const estado = (id: string) =>
  env.DB.prepare('SELECT status FROM invitation WHERE id = ?1')
    .bind(id)
    .first<{ status: string }>()
    .then((f) => f?.status)

const aceptar = (c: Cliente, invitationId: string) =>
  c.json('POST', '/api/auth/organization/accept-invitation', { invitationId })

describe('invitaciones de quien ya no puede invitar', () => {
  it('quitar al admin cancela sus invitaciones pendientes y no se aceptan', async () => {
    const o = await nuevaOrganizacion()
    const admin = await sumar(o, 'admin')
    const { id, invitada } = await invitaElAdmin(o, admin)
    const quitar = await o.cliente.json('POST', '/api/auth/organization/remove-member', {
      memberIdOrEmail: admin.memberId,
      organizationId: o.organizationId,
    })
    expect(quitar.status, JSON.stringify(quitar.cuerpo)).toBe(200)
    expect(await estado(id)).toBe('canceled')
    expect((await aceptar(invitada.cliente, id)).status).not.toBe(200)
    const m = await env.DB.prepare('SELECT 1 FROM member WHERE user_id = ?1')
      .bind(invitada.userId)
      .first()
    expect(m).toBeNull()
  })

  it('bajar al admin a facturador cancela sus invitaciones pendientes', async () => {
    const o = await nuevaOrganizacion()
    const admin = await sumar(o, 'admin')
    const { id, invitada } = await invitaElAdmin(o, admin)
    const bajar = await o.cliente.json('POST', '/api/auth/organization/update-member-role', {
      memberId: admin.memberId,
      role: 'member',
      organizationId: o.organizationId,
    })
    expect(bajar.status, JSON.stringify(bajar.cuerpo)).toBe(200)
    expect(await estado(id)).toBe('canceled')
    expect((await aceptar(invitada.cliente, id)).status).not.toBe(200)
  })

  it('si el admin sale por su cuenta, sus invitaciones pendientes se cancelan', async () => {
    const o = await nuevaOrganizacion()
    const admin = await sumar(o, 'admin')
    const { id } = await invitaElAdmin(o, admin)
    const sale = await admin.cliente.json('POST', '/api/auth/organization/leave', {
      organizationId: o.organizationId,
    })
    expect(sale.status, JSON.stringify(sale.cuerpo)).toBe(200)
    expect(await estado(id)).toBe('canceled')
  })

  it('una invitación pendiente cuyo autor ya no es miembro no se acepta aunque siga pendiente', async () => {
    const o = await nuevaOrganizacion()
    const admin = await sumar(o, 'admin')
    const { id, invitada } = await invitaElAdmin(o, admin)
    // Simula una fila que quedó pendiente (p. ej. de antes de esta corrección).
    await env.DB.prepare('DELETE FROM member WHERE id = ?1').bind(admin.memberId).run()
    expect(await estado(id)).toBe('pending')
    const r = await aceptar(invitada.cliente, id)
    expect(r.status).toBe(403)
    expect(r.cuerpo.code).toBe('invitacion_sin_vigencia')
  })

  it('las invitaciones ya aceptadas se conservan al quitar a quien invitó', async () => {
    const o = await nuevaOrganizacion()
    const admin = await sumar(o, 'admin')
    const { id, invitada } = await invitaElAdmin(o, admin)
    expect((await aceptar(invitada.cliente, id)).status).toBe(200)
    await o.cliente.json('POST', '/api/auth/organization/remove-member', {
      memberIdOrEmail: admin.memberId,
      organizationId: o.organizationId,
    })
    expect(await estado(id)).toBe('accepted')
  })

  it('con el autor vigente la invitación se acepta como siempre', async () => {
    const o = await nuevaOrganizacion()
    const admin = await sumar(o, 'admin')
    const { id, invitada } = await invitaElAdmin(o, admin)
    expect((await aceptar(invitada.cliente, id)).status).toBe(200)
  })
})

describe('amplia con roles en lista', () => {
  it('acepta el rol nuevo como lista sin fallar', async () => {
    const { amplia } = await import('../src/lib/equipo')
    expect(amplia('admin', ['member'])).toBe(false)
    expect(amplia('member', ['admin'])).toBe(true)
    expect(amplia('admin', 'owner,member')).toBe(true)
  })
})
