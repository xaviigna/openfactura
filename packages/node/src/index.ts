/**
 * SDK de la API de Open Factura. Tipado desde las especificaciones OpenAPI, sin dependencias.
 *
 * ```ts
 * import { OpenFactura } from '@openfactura/node'
 * const of = new OpenFactura({ apiKey: process.env.OPENFACTURA_API_KEY! })
 * const doc = await of.dte.emitir({ tipoDte: '01', datos: { … } })
 * ```
 */
import { type OpcionesCliente, Transporte } from './cliente'
import type { Cloud, Nucleo, Operaciones } from './generado'

export { type OpcionesCliente, OpenFacturaError, URL_CLOUD } from './cliente'
export type { Cloud, IdOperacion, Nucleo, Operaciones } from './generado'
export { type EventoWebhook, FirmaInvalida, verificarWebhook } from './webhooks'

type Q<K extends keyof Operaciones> = Operaciones[K]['query']
type C<K extends keyof Operaciones> = Operaciones[K]['cuerpo']
type Opciones = { idempotencyKey?: string }

export class OpenFactura {
  private readonly t: Transporte

  constructor(opciones: OpcionesCliente | Transporte) {
    this.t = opciones instanceof Transporte ? opciones : new Transporte(opciones)
  }

  /**
   * El mismo cliente con otra clave. Con Plataforma: la clave del espacio de un cliente (créala
   * una vez con `plataforma.clientes.claves.crear` y guárdala), para emitir a su nombre.
   */
  comoCliente(apiKey: string): OpenFactura {
    return new OpenFactura(this.t.conClave(apiKey))
  }

  /** Quién eres con esta clave: organización, permisos, ambiente. */
  yo = () => this.t.llamar('yo_obtener', {})
  /** DTE emitidos y procesados por periodo. */
  uso = (query?: Q<'uso_obtener'>) => this.t.llamar('uso_obtener', { query })
  resumen = () => this.t.llamar('resumen_obtener', {})

  dte = {
    /** Emite un DTE. Lleva clave de idempotencia (generada si no la pasas): reintentar no duplica. */
    emitir: (entrada: C<'dte_emitir'>, o: Opciones = {}) =>
      this.t.llamar('dte_emitir', { cuerpo: entrada, idempotencyKey: o.idempotencyKey }),
    /** Valida sin emitir: devuelve los problemas y el total calculado. */
    validar: (entrada: C<'dte_validar'>) => this.t.llamar('dte_validar', { cuerpo: entrada }),
    listar: (query?: Q<'dte_listar'>) => this.t.llamar('dte_listar', { query }),
    obtener: (codigo: string) => this.t.llamar('dte_obtener', { params: { codigo } }),
    /** El JSON oficial firmado (con el sello de Hacienda). */
    json: (codigo: string) => this.t.llamar('dte_json', { params: { codigo } }),
    /** El PDF (representación gráfica). */
    pdf: (codigo: string) =>
      this.t.llamar('dte_pdf', { params: { codigo } }) as Promise<ArrayBuffer>,
    invalidar: (codigo: string, datos: C<'dte_invalidar'>, o: Opciones = {}) =>
      this.t.llamar('dte_invalidar', {
        params: { codigo },
        cuerpo: datos,
        idempotencyKey: o.idempotencyKey,
      }),
    retorno: (codigo: string, datos: C<'dte_retorno'>, o: Opciones = {}) =>
      this.t.llamar('dte_retorno', {
        params: { codigo },
        cuerpo: datos,
        idempotencyKey: o.idempotencyKey,
      }),
  }

  eventos = {
    listar: (query?: Q<'eventos_listar'>) => this.t.llamar('eventos_listar', { query }),
    obtener: (codigo: string) => this.t.llamar('evento_obtener', { params: { codigo } }),
    json: (codigo: string) => this.t.llamar('evento_json', { params: { codigo } }),
    pdf: (codigo: string) =>
      this.t.llamar('evento_pdf', { params: { codigo } }) as Promise<ArrayBuffer>,
    operacionesEspeciales: (datos: C<'operaciones_especiales_informar'>, o: Opciones = {}) =>
      this.t.llamar('operaciones_especiales_informar', {
        cuerpo: datos,
        idempotencyKey: o.idempotencyKey,
      }),
  }

  contingencia = {
    transmitir: () => this.t.llamar('contingencia_transmitir', {}),
  }

  emisor = {
    obtener: () => this.t.llamar('emisor_obtener', {}),
    guardar: (datos: C<'emisor_guardar'>) => this.t.llamar('emisor_guardar', { cuerpo: datos }),
    credenciales: (ambiente: '00' | '01', datos: C<'emisor_credenciales_guardar'>) =>
      this.t.llamar('emisor_credenciales_guardar', { params: { ambiente }, cuerpo: datos }),
    /** Credenciales del simulador del MH (para probar sin trámites). */
    credencialesDePrueba: () => this.t.llamar('emisor_credenciales_prueba', {}),
    probar: () => this.t.llamar('emisor_probar', {}),
    establecimientos: {
      listar: () => this.t.llamar('establecimientos_listar', {}),
      crear: (datos: C<'establecimiento_crear'>) =>
        this.t.llamar('establecimiento_crear', { cuerpo: datos }),
      actualizar: (id: string, datos: C<'establecimiento_actualizar'>) =>
        this.t.llamar('establecimiento_actualizar', { params: { id }, cuerpo: datos }),
    },
    puntosDeVenta: {
      crear: (datos: C<'punto_venta_crear'>) =>
        this.t.llamar('punto_venta_crear', { cuerpo: datos }),
    },
  }

  /** Clientes (receptores) a quienes facturas. */
  clientes = {
    listar: (query?: Q<'clientes_listar'>) => this.t.llamar('clientes_listar', { query }),
    crear: (datos: C<'cliente_crear'>) => this.t.llamar('cliente_crear', { cuerpo: datos }),
    obtener: (id: string) => this.t.llamar('cliente_obtener', { params: { id } }),
    actualizar: (id: string, datos: C<'cliente_actualizar'>) =>
      this.t.llamar('cliente_actualizar', { params: { id }, cuerpo: datos }),
    eliminar: (id: string) => this.t.llamar('cliente_eliminar', { params: { id } }),
  }

  productos = {
    listar: (query?: Q<'productos_listar'>) => this.t.llamar('productos_listar', { query }),
    crear: (datos: C<'producto_crear'>) => this.t.llamar('producto_crear', { cuerpo: datos }),
    obtener: (id: string) => this.t.llamar('producto_obtener', { params: { id } }),
    actualizar: (id: string, datos: C<'producto_actualizar'>) =>
      this.t.llamar('producto_actualizar', { params: { id }, cuerpo: datos }),
    eliminar: (id: string) => this.t.llamar('producto_eliminar', { params: { id } }),
  }

  catalogos = {
    listar: () => this.t.llamar('catalogos_listar', {}),
    buscar: (id: string, query?: Q<'catalogo_buscar'>) =>
      this.t.llamar('catalogo_buscar', { params: { id }, query }),
  }

  claves = {
    listar: () => this.t.llamar('claves_listar', {}),
    crear: (datos: C<'clave_crear'>) => this.t.llamar('clave_crear', { cuerpo: datos }),
    revocar: (id: string) => this.t.llamar('clave_revocar', { params: { id } }),
  }

  webhooks = {
    listar: () => this.t.llamar('webhooks_listar', {}),
    /** El secreto de firma (`whsec_…`) sólo aparece en esta respuesta. */
    crear: (datos: C<'webhook_crear'>) => this.t.llamar('webhook_crear', { cuerpo: datos }),
    actualizar: (id: string, cambios: C<'webhook_actualizar'>) =>
      this.t.llamar('webhook_actualizar', { params: { id }, cuerpo: cambios }),
    eliminar: (id: string) => this.t.llamar('webhook_eliminar', { params: { id } }),
    probar: (id: string) => this.t.llamar('webhook_probar', { params: { id } }),
    rotarSecreto: (id: string) => this.t.llamar('webhook_rotar_secreto', { params: { id } }),
    entregas: (id: string) => this.t.llamar('webhook_entregas', { params: { id } }),
    reenviar: (entregaId: string) =>
      this.t.llamar('webhook_entrega_reenviar', { params: { id: entregaId } }),
  }

  registros = {
    listar: (query?: Q<'registros_listar'>) => this.t.llamar('registros_listar', { query }),
  }

  auditoria = {
    listar: (query?: Q<'auditoria_listar'>) => this.t.llamar('auditoria_listar', { query }),
  }

  /**
   * Open Factura Cloud · Plataforma: las empresas de tus clientes, cada una en su espacio. Con una
   * clave tuya habilitada para Plataforma.
   */
  plataforma = {
    clientes: {
      crear: (datos: C<'plataforma_cliente_crear'>) =>
        this.t.llamar('plataforma_cliente_crear', { cuerpo: datos }),
      listar: (query?: Q<'plataforma_clientes_listar'>) =>
        this.t.llamar('plataforma_clientes_listar', { query }),
      obtener: (id: string) => this.t.llamar('plataforma_cliente_obtener', { params: { id } }),
      /** Pendiente: lo borra. Activo: lo desactiva y retira tus accesos (sus datos siguen suyos). */
      eliminar: (id: string) => this.t.llamar('plataforma_cliente_eliminar', { params: { id } }),
      /** Enlace de un solo uso para que el cliente active su cuenta. */
      enlace: (id: string, datos: C<'plataforma_cliente_enlace'> = {}) =>
        this.t.llamar('plataforma_cliente_enlace', { params: { id }, cuerpo: datos }),
      empresa: (id: string) => this.t.llamar('plataforma_cliente_empresa', { params: { id } }),
      uso: (id: string, query?: Q<'plataforma_cliente_uso'>) =>
        this.t.llamar('plataforma_cliente_uso', { params: { id }, query }),
      claves: {
        /** La clave completa sólo aparece aquí: guárdala y úsala con `comoCliente`. */
        crear: (id: string, datos: C<'plataforma_cliente_clave_crear'>) =>
          this.t.llamar('plataforma_cliente_clave_crear', { params: { id }, cuerpo: datos }),
        listar: (id: string) => this.t.llamar('plataforma_cliente_claves', { params: { id } }),
        revocar: (id: string, clave: string) =>
          this.t.llamar('plataforma_cliente_clave_revocar', { params: { id, clave } }),
      },
      webhooks: {
        crear: (id: string, datos: C<'plataforma_cliente_webhook_crear'>) =>
          this.t.llamar('plataforma_cliente_webhook_crear', { params: { id }, cuerpo: datos }),
        listar: (id: string) => this.t.llamar('plataforma_cliente_webhooks', { params: { id } }),
        eliminar: (id: string, webhook: string) =>
          this.t.llamar('plataforma_cliente_webhook_eliminar', { params: { id, webhook } }),
      },
    },
  }

  /** Open Factura Cloud · tu logo en el PDF y cómo salen los correos. */
  marca = {
    obtener: () => this.t.llamar('marca_obtener', {}),
    actualizar: (datos: C<'marca_actualizar'>) =>
      this.t.llamar('marca_actualizar', { cuerpo: datos }),
    subirLogo: (base64: string) => this.t.llamar('marca_logo_subir', { cuerpo: { base64 } }),
    quitarLogo: () => this.t.llamar('marca_logo_quitar', {}),
  }

  /** Open Factura Cloud · envío de DTE por correo con su PDF y JSON. */
  correo = {
    enviar: (codigo: string, datos: C<'dte_enviar_correo'> = {}) =>
      this.t.llamar('dte_enviar_correo', { params: { codigo }, cuerpo: datos }),
    envios: (codigo: string) => this.t.llamar('dte_envios_listar', { params: { codigo } }),
  }

  /** Open Factura Cloud · pruebas mínimas ante Hacienda. */
  certificacion = {
    estado: () => this.t.llamar('certificacion_estado', {}),
    iniciar: (datos: C<'certificacion_iniciar'> = {}) =>
      this.t.llamar('certificacion_iniciar', { cuerpo: datos }),
    avanzar: () => this.t.llamar('certificacion_avanzar', {}),
  }
}

/** Tipos de los recursos más usados, para tu código. */
export type Documento = Nucleo['Documento']
export type DocumentoDetalle = Nucleo['DocumentoDetalle']
export type Emision = Nucleo['Emision']
export type ClientePlataforma = Cloud['ClientePlataforma']
