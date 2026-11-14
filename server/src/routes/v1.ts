import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import {
  esquemaAmbiente,
  esquemaBusqueda,
  esquemaClaveApi,
  esquemaCliente,
  esquemaConsultaAuditoria,
  esquemaConsultaCatalogo,
  esquemaConsultaEventos,
  esquemaConsultaRegistros,
  esquemaConsultaUso,
  esquemaCredenciales,
  esquemaEmision,
  esquemaEmisor,
  esquemaEstablecimiento,
  esquemaInvalidacion,
  esquemaListaDtes,
  esquemaOperacionesEspeciales,
  esquemaProducto,
  esquemaPuntoVenta,
  esquemaRetorno,
  esquemaWebhook,
  esquemaWebhookCambios,
} from 'shared'
import { z } from 'zod'
import { exigir } from '../contexto'
import { cuentaDe, enlacesVisibles, eventosDeExtensiones } from '../extensiones'
import { invalido } from '../lib/errors'
import { autenticar, type Entorno } from '../middleware/actor'
import { listarAuditoria } from '../services/auditoria'
import { consultarCatalogo, listarCatalogos } from '../services/catalogos'
import { crearClave, listarClaves, revocarClave } from '../services/claves'
import {
  actualizarCliente,
  crearCliente,
  eliminarCliente,
  listarClientes,
  obtenerCliente,
} from '../services/clientes'
import {
  archivoJson,
  emitir,
  invalidar,
  listar,
  obtener,
  pdf,
  previsualizar,
  resumenTablero,
  transmitirContingencia,
} from '../services/dte'
import {
  actualizarEstablecimiento,
  ambienteActivo,
  cargarCredencialesPrueba,
  crearEstablecimiento,
  crearPuntoVenta,
  guardarCredenciales,
  guardarEmisor,
  listarEstablecimientos,
  obtenerEmisor,
  probarConexion,
} from '../services/emisor'
import {
  archivoEvento,
  informarOperacionesEspeciales,
  listarEventos,
  obtenerEvento,
  pdfEvento,
  retornar,
  type VistaEvento,
} from '../services/eventos'
import { ejecutarUnaVez } from '../services/idempotencia'
import {
  actualizarProducto,
  crearProducto,
  eliminarProducto,
  listarProductos,
  obtenerProducto,
} from '../services/productos'
import { listarRegistros } from '../services/registros'
import { obtenerUso } from '../services/uso'
import {
  actualizarWebhook,
  crearWebhook,
  eliminarWebhook,
  listarEntregas,
  listarWebhooks,
  probarWebhook,
  reenviarEntrega,
  rotarSecretoWebhook,
} from '../services/webhooks'

/** Valida con zod y responde 400 con la lista de problemas en el formato común de errores. */
const validar = <T extends z.ZodType, D extends 'json' | 'query' | 'param'>(
  destino: D,
  esquema: T,
) =>
  zValidator(destino, esquema, (resultado) => {
    if (!resultado.success) {
      throw invalido(
        'Datos inválidos',
        resultado.error.issues.map((i) => ({ ruta: i.path.join('.'), mensaje: i.message })),
      )
    }
  })

export const v1 = new Hono<Entorno>()
  .use(autenticar('api'))

  // --- Sesión -------------------------------------------------------------
  .get('/yo', async (c) => {
    const ctx = c.var.ctx
    return c.json({
      usuario: c.var.usuario ?? null,
      rol: c.var.rol ?? null,
      actor: ctx.actor.tipo,
      organizationId: ctx.actor.organizationId,
      permisos: [...ctx.actor.permisos],
      ambiente: await ambienteActivo(ctx),
      simulador: c.env.MH_SIMULADO === '1',
      /** URL pública del servidor y del MCP, para armar ejemplos. */
      url: c.env.APP_URL,
      mcp: c.env.URL_MCP || `${c.env.APP_URL}/mcp`,
      extensiones: enlacesVisibles(
        (c.var.extensiones ?? []).flatMap((e) => e.panel ?? []),
        ctx.actor,
      ),
      cuenta: await cuentaDe(ctx),
      capacidades: [...new Set((c.var.extensiones ?? []).flatMap((e) => e.capacidades ?? []))],
      eventosWebhook: eventosDeExtensiones(c.var.extensiones),
    })
  })
  .get('/resumen', async (c) => c.json(await resumenTablero(c.var.ctx)))
  .get('/uso', validar('query', esquemaConsultaUso), async (c) =>
    c.json(await obtenerUso(c.var.ctx, c.req.valid('query'))),
  )

  // --- Emisor -------------------------------------------------------------
  .get('/emisor', async (c) => c.json(await obtenerEmisor(c.var.ctx)))
  .put('/emisor', validar('json', esquemaEmisor), async (c) =>
    c.json(await guardarEmisor(c.var.ctx, c.req.valid('json'))),
  )
  .put(
    '/emisor/credenciales/:ambiente',
    validar('param', z.object({ ambiente: esquemaAmbiente })),
    validar('json', esquemaCredenciales),
    async (c) =>
      c.json(
        await guardarCredenciales(c.var.ctx, c.req.valid('param').ambiente, c.req.valid('json')),
      ),
  )
  .post('/emisor/credenciales-prueba', async (c) =>
    c.json(await cargarCredencialesPrueba(c.var.ctx)),
  )
  .post('/emisor/probar', async (c) => c.json(await probarConexion(c.var.ctx)))
  .get('/establecimientos', async (c) => {
    await obtenerEmisor(c.var.ctx)
    return c.json(await listarEstablecimientos(c.var.ctx))
  })
  .post('/establecimientos', validar('json', esquemaEstablecimiento), async (c) =>
    c.json(await crearEstablecimiento(c.var.ctx, c.req.valid('json')), 201),
  )
  .put('/establecimientos/:id', validar('json', esquemaEstablecimiento), async (c) =>
    c.json(await actualizarEstablecimiento(c.var.ctx, c.req.param('id'), c.req.valid('json'))),
  )
  .post('/puntos-venta', validar('json', esquemaPuntoVenta), async (c) =>
    c.json(await crearPuntoVenta(c.var.ctx, c.req.valid('json')), 201),
  )

  // --- Clientes -----------------------------------------------------------
  .get('/clientes', validar('query', esquemaBusqueda), async (c) =>
    c.json(await listarClientes(c.var.ctx, c.req.valid('query'))),
  )
  .post('/clientes', validar('json', esquemaCliente), async (c) =>
    c.json(await crearCliente(c.var.ctx, c.req.valid('json')), 201),
  )
  .get('/clientes/:id', async (c) => c.json(await obtenerCliente(c.var.ctx, c.req.param('id'))))
  .put('/clientes/:id', validar('json', esquemaCliente), async (c) =>
    c.json(await actualizarCliente(c.var.ctx, c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/clientes/:id', async (c) => c.json(await eliminarCliente(c.var.ctx, c.req.param('id'))))

  // --- Productos ----------------------------------------------------------
  .get('/productos', validar('query', esquemaBusqueda), async (c) =>
    c.json(await listarProductos(c.var.ctx, c.req.valid('query'))),
  )
  .post('/productos', validar('json', esquemaProducto), async (c) =>
    c.json(await crearProducto(c.var.ctx, c.req.valid('json')), 201),
  )
  .get('/productos/:id', async (c) => c.json(await obtenerProducto(c.var.ctx, c.req.param('id'))))
  .put('/productos/:id', validar('json', esquemaProducto), async (c) =>
    c.json(await actualizarProducto(c.var.ctx, c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/productos/:id', async (c) =>
    c.json(await eliminarProducto(c.var.ctx, c.req.param('id'))),
  )

  // --- DTE ----------------------------------------------------------------
  .get('/dte', validar('query', esquemaListaDtes), async (c) =>
    c.json(await listar(c.var.ctx, c.req.valid('query'))),
  )
  .post('/dte', validar('json', esquemaEmision), async (c) => {
    const entrada = c.req.valid('json')
    const ctx = c.var.ctx
    // El permiso se comprueba antes de mirar respuestas guardadas.
    exigir(ctx, 'dte:emit')
    const r = await ejecutarUnaVez(
      ctx,
      `dte:${await ambienteActivo(ctx)}`,
      c.req.header('idempotency-key'),
      entrada,
      () => emitir(ctx, entrada),
    )
    if (r.repetida) c.header('Idempotent-Replayed', 'true')
    return c.json(r.cuerpo as Awaited<ReturnType<typeof obtener>>, r.status)
  })
  .post('/dte/validar', validar('json', esquemaEmision), async (c) =>
    c.json(await previsualizar(c.var.ctx, c.req.valid('json'))),
  )
  .get('/dte/:codigo', async (c) => c.json(await obtener(c.var.ctx, c.req.param('codigo'))))
  .get('/dte/:codigo/json', async (c) => {
    const archivo = await archivoJson(c.var.ctx, c.req.param('codigo'))
    c.header(
      'Content-Disposition',
      `attachment; filename="${archivo.identificacion.codigoGeneracion}.json"`,
    )
    return c.json(archivo)
  })
  .get('/dte/:codigo/pdf', async (c) => {
    const { nombre, bytes } = await pdf(c.var.ctx, c.req.param('codigo'))
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
    })
  })
  .post('/dte/:codigo/invalidar', validar('json', esquemaInvalidacion), async (c) =>
    c.json(await invalidar(c.var.ctx, c.req.param('codigo'), c.req.valid('json'))),
  )
  .post('/dte/:codigo/retorno', validar('json', esquemaRetorno), async (c) => {
    const ctx = c.var.ctx
    exigir(ctx, 'dte:emit')
    const codigo = c.req.param('codigo')
    const r = await ejecutarUnaVez(
      ctx,
      `retorno:${await ambienteActivo(ctx)}:${codigo.toUpperCase()}`,
      c.req.header('idempotency-key'),
      c.req.valid('json'),
      () => retornar(ctx, codigo, c.req.valid('json')),
    )
    if (r.repetida) c.header('Idempotent-Replayed', 'true')
    return c.json(r.cuerpo as VistaEvento, r.status)
  })
  .post('/contingencia/transmitir', async (c) => c.json(await transmitirContingencia(c.var.ctx)))

  // --- Eventos de retorno (18) y operaciones especiales (17) ---------------
  .post(
    '/eventos/operaciones-especiales',
    validar('json', esquemaOperacionesEspeciales),
    async (c) => {
      const ctx = c.var.ctx
      exigir(ctx, 'dte:emit')
      const r = await ejecutarUnaVez(
        ctx,
        `operaciones_especiales:${await ambienteActivo(ctx)}`,
        c.req.header('idempotency-key'),
        c.req.valid('json'),
        () => informarOperacionesEspeciales(ctx, c.req.valid('json')),
      )
      if (r.repetida) c.header('Idempotent-Replayed', 'true')
      return c.json(r.cuerpo as VistaEvento, r.status)
    },
  )
  .get('/eventos', validar('query', esquemaConsultaEventos), async (c) =>
    c.json(await listarEventos(c.var.ctx, c.req.valid('query').tipo)),
  )
  .get('/eventos/:codigo', async (c) =>
    c.json(await obtenerEvento(c.var.ctx, c.req.param('codigo'))),
  )
  .get('/eventos/:codigo/json', async (c) => {
    const archivo = await archivoEvento(c.var.ctx, c.req.param('codigo'))
    c.header(
      'Content-Disposition',
      `attachment; filename="${archivo.identificacion.codigoGeneracion}.json"`,
    )
    return c.json(archivo)
  })
  .get('/eventos/:codigo/pdf', async (c) => {
    const { nombre, bytes } = await pdfEvento(c.var.ctx, c.req.param('codigo'))
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
    })
  })

  // --- Catálogos ----------------------------------------------------------
  .get('/catalogos', (c) => c.json(listarCatalogos()))
  .get('/catalogos/:id', validar('query', esquemaConsultaCatalogo), (c) =>
    c.json(consultarCatalogo(c.req.param('id').toUpperCase(), c.req.valid('query'))),
  )

  // --- Claves de API y auditoría -------------------------------------------
  .get('/claves', async (c) => c.json(await listarClaves(c.var.ctx)))
  .post('/claves', validar('json', esquemaClaveApi), async (c) =>
    c.json(await crearClave(c.var.ctx, c.req.valid('json')), 201),
  )
  .delete('/claves/:id', async (c) => c.json(await revocarClave(c.var.ctx, c.req.param('id'))))

  // --- Webhooks (`webhooks:manage`) ----------------------------------------
  .get('/webhooks', async (c) => c.json(await listarWebhooks(c.var.ctx)))
  .post('/webhooks', validar('json', esquemaWebhook), async (c) =>
    c.json(await crearWebhook(c.var.ctx, c.req.valid('json')), 201),
  )
  .patch('/webhooks/:id', validar('json', esquemaWebhookCambios), async (c) =>
    c.json(await actualizarWebhook(c.var.ctx, c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/webhooks/:id', async (c) => c.json(await eliminarWebhook(c.var.ctx, c.req.param('id'))))
  .post('/webhooks/:id/rotar-secreto', async (c) =>
    c.json(await rotarSecretoWebhook(c.var.ctx, c.req.param('id'))),
  )
  .post('/webhooks/:id/probar', async (c) =>
    c.json(await probarWebhook(c.var.ctx, c.req.param('id'))),
  )
  .get('/webhooks/:id/entregas', async (c) =>
    c.json(await listarEntregas(c.var.ctx, c.req.param('id'))),
  )
  .post('/webhooks/entregas/:id/reenviar', async (c) =>
    c.json(await reenviarEntrega(c.var.ctx, c.req.param('id'))),
  )
  .get('/auditoria', validar('query', esquemaConsultaAuditoria), async (c) =>
    c.json(await listarAuditoria(c.var.ctx, c.req.valid('query'))),
  )
  .get('/registros', validar('query', esquemaConsultaRegistros), async (c) =>
    c.json(await listarRegistros(c.var.ctx, c.req.valid('query'))),
  )
