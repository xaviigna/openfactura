// Generado por scripts/generar.ts desde docs-site/public/openapi*.json. No lo edites a mano:
// cambia la API y ejecuta `bun run generar`.
/* eslint-disable */

export interface Nucleo {
  Emisor: {
    nit: string
    nrc: string
    nombre: string
    nombreComercial?: string | null
    codActividad: string
    descActividad: string
    departamento: string
    municipio: string
    distrito: string
    complemento: string
    telefono: string
    correo: string
    ambiente?: "00" | "01"
    responsableNombre?: string | null
    responsableTipoDoc?: string | null
    responsableNumDoc?: string | null
  }
  Credenciales: {
    apiPassword?: string
    certificado?: string
    certificadoPassword?: string
  }
  Establecimiento: {
    nombre: string
    tipo?: "01" | "02" | "04" | "07"
    codMh: string
    codInterno?: string | null
    departamento?: string | null
    municipio?: string | null
    distrito?: string | null
    complemento?: string | null
    telefono?: string | null
  }
  PuntoVenta: {
    establecimientoId: string
    nombre: string
    codMh: string
    codInterno?: string | null
  }
  ClienteEntrada: {
    tipoDocumento: "13" | "36" | "37" | "03" | "02"
    numDocumento: string
    nrc?: string | null
    nombre: string
    nombreComercial?: string | null
    codActividad?: string | null
    descActividad?: string | null
    departamento?: string | null
    municipio?: string | null
    distrito?: string | null
    complemento?: string | null
    telefono?: string | null
    correo?: string | "" | null
  }
  ProductoEntrada: {
    codigo: string
    descripcion: string
    precioUnitario: number
    tipoItem?: 1 | 2 | 3 | 4
    uniMedida?: number
    tipoVenta?: "gravada" | "exenta" | "noSujeta"
  }
  Emision: {
    tipoDte: "11" | "14" | "15" | "01" | "03" | "04" | "05" | "06" | "07" | "08" | "09"
    datos: Record<string, unknown>
    clienteId?: string
    puntoVentaId?: string
  }
  Invalidacion: {
    tipoAnulacion: 1 | 2 | 3
    motivoAnulacion?: string | null
    codigoGeneracionReemplazo?: string | null
    solicitante?: {
      nombre: string
      tipoDocumento: string
      numDocumento: string
    }
    responsable?: {
      nombre: string
      tipoDocumento: string
      numDocumento: string
    }
  }
  Retorno: {
    items: Array<{
      descripcion: string
      cantidad: number
      precioUni: number
      tipoItem?: 1 | 2 | 3 | 4
      codigo?: string | null
      uniMedida?: number
      descuento?: number
      tipoVenta?: "gravada" | "exenta" | "noSujeta"
      seguro?: number
      flete?: number
    }>
  }
  OperacionesEspeciales: {
    tipoDocumento: "97" | "02"
    fecha?: string
    items: Array<{
      descripcion: string
      precioUni: number
      cantidad?: number
      numDocumento?: string | null
      docDel?: string
      docAl?: string
      fechaEmision?: string
      tipoVenta?: "gravada" | "exenta" | "noSujeta"
      codigoGeneracionRef?: string
    }>
  }
  ClaveApiEntrada: {
    nombre: string
    modo: "test" | "live"
    scopes: Array<"dte:read" | "dte:emit" | "dte:invalidate" | "clientes:read" | "clientes:write" | "productos:read" | "productos:write" | "emisor:read" | "webhooks:manage" | "registros:read">
    expiraEnDias?: number | null
  }
  WebhookEntrada: {
    url: string
    descripcion?: string | null
    eventos: Array<"dte.procesado" | "dte.rechazado" | "dte.contingencia" | "dte.invalidado" | "retorno.procesado" | "retorno.invalidado" | "operaciones_especiales.procesado" | "operaciones_especiales.invalidado" | string>
    activo?: boolean
  }
  WebhookCambios: {
    url?: string
    descripcion?: string | null
    eventos?: Array<"dte.procesado" | "dte.rechazado" | "dte.contingencia" | "dte.invalidado" | "retorno.procesado" | "retorno.invalidado" | "operaciones_especiales.procesado" | "operaciones_especiales.invalidado" | string>
    activo?: boolean
  }
  Error: {
    error: {
      code: "datos_invalidos" | "dte_invalido" | "no_autenticado" | "plan_requerido" | "sin_permiso" | "origen_no_permitido" | "no_encontrado" | "sin_organizacion" | "sin_organizacion_activa" | "nit_bloqueado" | "emisor_no_configurado" | "credenciales_incompletas" | "sin_punto_venta" | "estado_invalido" | "ambiente_distinto" | "retorno_excedido" | "retorno_vigente" | "idempotencia_distinta" | "idempotencia_en_curso" | "cliente_repetido" | "producto_repetido" | "codigo_repetido" | "sin_archivo" | "limite_webhooks" | "simulador_inactivo" | "dte_rechazado" | "invalidacion_rechazada" | "contingencia_rechazada" | "evento_rechazado" | "limite_excedido" | "limite_plan" | "error_interno" | "mh_credenciales_rechazadas" | "mh_no_disponible" | "emision_fallida" | "emision_incierta"
      message: string
      /** Detalle según el código; puede faltar. */
      details?: Record<string, unknown>
    }
  }
  Documento: {
    id: string
    /** UUID en mayúsculas. */
    codigoGeneracion: string
    numeroControl: string
    tipoDte: "11" | "14" | "15" | "01" | "03" | "04" | "05" | "06" | "07" | "08" | "09"
    ambiente: "00" | "01"
    estado: "pendiente" | "procesado" | "rechazado" | "contingencia" | "invalidado"
    fechaEmision?: string
    horaEmision?: string
    receptorNombre?: string | null
    receptorDocumento?: string | null
    total: number
    selloRecibido?: string | null
    origen?: string
    error?: string | null
    /** Milisegundos desde 1970. */
    creado?: number
    /** Consulta pública en el portal del MH. */
    urlConsulta?: string | null
  }
  DocumentoDetalle: (Nucleo["Documento"]) & ({
    /** Estructura del DTE tal como se firmó. */
    dte?: Record<string, unknown>
    /** Última respuesta del MH. */
    respuestaMh?: Record<string, unknown> | null
    eventos?: Array<Record<string, unknown>>
  })
  ListaDocumentos: {
    items: Array<Nucleo["Documento"]>
    total: number
    pagina: number
    porPagina: number
    ambiente: "00" | "01"
  }
  Validacion: {
    dte: Record<string, unknown>
    problemas: Array<{
      ruta?: string
      mensaje?: string
      regla?: string
    }>
    total: number
    receptorNombre?: string | null
  }
  Evento: {
    id: string
    tipo: "retorno" | "operaciones_especiales"
    tipoEvento?: "18" | "17"
    codigoGeneracion: string
    ambiente: "00" | "01"
    estado: "procesado" | "rechazado" | "invalidado"
    selloRecibido?: string | null
    /** Documento de un retorno. */
    documentoId?: string | null
    /** Milisegundos desde 1970. */
    creado?: number
  }
  EventoDetalle: (Nucleo["Evento"]) & ({
    dte?: Record<string, unknown>
    respuestaMh?: Record<string, unknown> | null
  })
  Yo: {
    /** Nulo cuando autentica una clave de API. */
    usuario?: {
      id?: string
      nombre?: string
      correo?: string
    } | null
    rol?: string | null
    actor?: "usuario" | "clave"
    organizationId?: string
    permisos?: Array<"dte:read" | "dte:emit" | "dte:invalidate" | "clientes:read" | "clientes:write" | "productos:read" | "productos:write" | "emisor:read" | "emisor:write" | "claves:manage" | "webhooks:manage" | "auditoria:read" | "registros:read">
    ambiente?: "00" | "01"
    /** El servidor usa el simulador del MH. */
    simulador?: boolean
    /** Enlaces del panel que agregan las extensiones instaladas, filtrados por permisos. Vacío en una instalación estándar. */
    extensiones?: Array<{
      titulo: string
      ruta: string
      icono?: string | null
      grupo?: "desarrolladores" | "administracion" | "cuenta" | "mas"
    }>
    /** URL pública del servidor (`APP_URL`). */
    url?: string
    /** URL pública del servidor MCP remoto (`URL_MCP` o `<APP_URL>/mcp`). */
    mcp?: string
    /** Plan y uso de la cuenta, cuando una extensión los aporta. Nulo en una instalación propia. */
    cuenta?: {
      plan: {
        id: string
        nombre: string
      }
      uso?: Array<{
        etiqueta: string
        usado: number
        limite: number | null
      }>
      mejorar?: {
        titulo: string
        detalle: string
        ruta: string
      }
    } | null
  }
  Uso: {
    ambiente?: "00" | "01"
    desde?: string
    hasta?: string
    totales?: {
      emitidos?: number
      procesados?: number
      rechazados?: number
      monto?: number
    }
    dias?: Array<{
      fecha?: string
      emitidos?: number
      procesados?: number
      rechazados?: number
      monto?: number
    }>
  }
  Resumen: {
    ambiente?: "00" | "01"
    mes?: string
    porEstado?: Record<string, number>
    procesadosMes?: number
    totalMes?: number
    recientes?: Array<Nucleo["Documento"]>
    /** Documentos en contingencia en el ambiente activo; null si no hay. En producción el servidor la transmite solo cuando el MH vuelve a responder, salvo que pasen 3 días: entonces `requiereInforme` y, tras presentar el Informe Técnico de Contingencia (Normativa 2.0, regla 13.2.1.1), se transmite con `POST /contingencia/transmitir`. */
    contingencia?: {
      documentos: number
      /** Creación del documento más antiguo (ms desde epoch) */
      desde: number
      requiereInforme: boolean
    } | null
  }
  EstadoCredenciales: {
    apiPassword?: boolean
    certificado?: boolean
    certificadoNit?: string | null
    /** Generadas para el simulador del MH: los documentos no llegan a Hacienda. */
    simuladas?: boolean
    actualizado?: number | null
  }
  EmisorVista: {
    /** Datos fiscales; nulo si no está configurado. */
    emisor?: Record<string, unknown> | null
    establecimientos?: Array<Nucleo["EstablecimientoVista"]>
    credenciales?: {
      "00"?: Nucleo["EstadoCredenciales"]
      "01"?: Nucleo["EstadoCredenciales"]
    }
    ambienteActivo?: "00" | "01"
  }
  EstablecimientoVista: (Nucleo["Establecimiento"]) & ({
    id?: string
    puntosVenta?: Array<Record<string, unknown>>
  })
  Cliente: (Nucleo["ClienteEntrada"]) & ({
    id?: string
    organizationId?: string
    creado?: string
  })
  Producto: (Nucleo["ProductoEntrada"]) & ({
    id?: string
    organizationId?: string
    creado?: string
  })
  Catalogo: {
    id?: string
    nombre?: string
    total?: number
    valores?: Array<{
      codigo: string
      valor: string
      departamento?: string
    }>
  }
  Clave: {
    id?: string
    nombre?: string
    /** Primeros caracteres de la clave. */
    prefijo?: string
    modo?: "test" | "live"
    scopes?: Array<string>
    /** Milisegundos desde 1970; nulo si no expira. */
    expira?: number | null
    ultimoUso?: number | null
    /** Cuándo se revocó; nulo si sigue vigente. */
    revocada?: number | null
    creado?: number
    estado?: "activa" | "revocada" | "expirada"
  }
  ClaveCreada: (Nucleo["Clave"]) & ({
    /** La clave completa. Sólo esta vez. */
    clave: string
  })
  Webhook: {
    id: string
    url: string
    descripcion?: string | null
    eventos: Array<"dte.procesado" | "dte.rechazado" | "dte.contingencia" | "dte.invalidado" | "retorno.procesado" | "retorno.invalidado" | "operaciones_especiales.procesado" | "operaciones_especiales.invalidado">
    activo: boolean
    creado: number
    actualizado?: number | null
  }
  WebhookConSecreto: (Nucleo["Webhook"]) & ({
    /** whsec_…: clave de la firma HMAC. Sólo esta vez. */
    secreto: string
  })
  EntregaWebhook: {
    id: string
    webhookId: string
    evento: string
    estado: "pendiente" | "entregado" | "fallido"
    intentos: number
    ultimoStatus?: number | null
    ultimoError?: string | null
    proximoIntento?: number | null
    creado: number
    entregado?: number | null
  }
  RegistroAuditoria: {
    id?: string
    actorTipo?: string
    actorId?: string
    accion?: string
    recurso?: string
    recursoId?: string | null
    ip?: string | null
    detalle?: Record<string, unknown> | null
    creado?: string | number
  }
  RegistroApi: {
    id?: string
    /** Marca de tiempo en milisegundos. */
    creado?: number
    metodo?: string
    /** Patrón de la ruta, p. ej. `/api/v1/dte/:codigo`. */
    ruta?: string
    /** Estado HTTP de la respuesta. */
    estado?: number
    duracionMs?: number
    origen?: "api" | "mcp"
    clave?: {
      id?: string
      prefijo?: string | null
      nombre?: string | null
    }
  }
}

export interface Cloud {
  DatosCliente: {
    nit?: string
    nrc?: string
    razonSocial?: string
    nombreComercial?: string
    correo?: string
    telefono?: string
  } | null
  ClientePlataforma: {
    id?: string
    nombre?: string
    externalId?: string | null
    estado?: "pendiente" | "activo" | "desactivado"
    datos?: Cloud["DatosCliente"]
    /** Su espacio (existe desde que lo creas). */
    organizationId?: string | null
    preparacion?: "conectado" | "pruebas" | "produccion" | null
    falta?: string | null
    enlaceExpira?: number | null
    aceptado?: number | null
    creado?: number
  }
  EmpresaCliente: {
    nit?: string
    nrc?: string
    nombre?: string
    nombreComercial?: string | null
    actividad?: string
    direccion?: string
    telefono?: string
    correo?: string
    ambiente?: "00" | "01"
    credenciales?: {
      pruebas?: boolean
      produccion?: boolean
    }
  }
  ClaveEntrada: {
    nombre: string
    modo: "test" | "live"
    scopes: Array<string>
    expiraEnDias?: number | null
  }
  Clave: {
    id?: string
    nombre?: string
    prefijo?: string
    modo?: "test" | "live"
    estado?: string
    creado?: number
  }
  ClaveCreada: (Cloud["Clave"]) & ({
    /** Sólo aparece aquí. */
    clave?: string
  })
  WebhookEntrada: {
    url: string
    descripcion?: string | null
    eventos: Array<string>
  }
  Webhook: {
    id?: string
    url?: string
    descripcion?: string | null
    eventos?: Array<string>
    activo?: boolean
  }
  WebhookCreado: (Cloud["Webhook"]) & ({
    /** Sólo aparece aquí. */
    secreto?: string
  })
  Marca: {
    logo?: {
      tipo?: "png" | "jpg"
      /** data URL */
      url?: string
    } | null
    correoRespuesta?: string | null
    ocultarOpenFactura?: boolean
    /** Tu plan lo incluye (Pro y Platform). */
    puedeOcultar?: boolean
  }
  Envio: {
    id?: string
    para?: string
    origen?: "auto" | "manual"
    estado?: "pendiente" | "enviado" | "fallido"
    intentos?: number
    creado?: number
  }
  Certificacion: {
    estado?: "sin_iniciar" | "en_curso" | "detenida" | "completa"
    clienteCcfId?: string | null
    requisitos?: Record<string, unknown>
    avance?: Array<Record<string, unknown>>
    ultimoError?: string | null
  }
  Error: {
    error?: {
      code?: string
      message?: string
      details?: unknown
    }
  }
}

/** Cada operación de la API: parámetros de ruta, consulta, cuerpo y respuesta. */
export interface Operaciones {
  /** Quién hace la petición */
  yo_obtener: {
    params: never
    query: never
    cuerpo: never
    respuesta: Nucleo["Yo"]
  }
  /** Resumen del tablero */
  resumen_obtener: {
    params: never
    query: never
    cuerpo: never
    respuesta: Nucleo["Resumen"]
  }
  /** Uso por día */
  uso_obtener: {
    params: never
    query: { desde?: string; hasta?: string }
    cuerpo: never
    respuesta: Nucleo["Uso"]
  }
  /** Datos del emisor */
  emisor_obtener: {
    params: never
    query: never
    cuerpo: never
    respuesta: Nucleo["EmisorVista"]
  }
  /** Crear o actualizar el emisor */
  emisor_guardar: {
    params: never
    query: never
    cuerpo: Nucleo["Emisor"]
    respuesta: Nucleo["EmisorVista"]
  }
  /** Guardar credenciales del MH */
  emisor_credenciales_guardar: {
    params: { ambiente: string }
    query: never
    cuerpo: Nucleo["Credenciales"]
    respuesta: Nucleo["EstadoCredenciales"]
  }
  /** Generar credenciales de prueba (simulador) */
  emisor_credenciales_prueba: {
    params: never
    query: never
    cuerpo: never
    respuesta: Nucleo["EstadoCredenciales"]
  }
  /** Probar la conexión con el MH */
  emisor_probar: {
    params: never
    query: never
    cuerpo: never
    respuesta: {
      ok: boolean
      ambiente: "00" | "01"
      mensaje: string
    }
  }
  /** Listar establecimientos */
  establecimientos_listar: {
    params: never
    query: never
    cuerpo: never
    respuesta: Array<Nucleo["EstablecimientoVista"]>
  }
  /** Crear un establecimiento */
  establecimiento_crear: {
    params: never
    query: never
    cuerpo: Nucleo["Establecimiento"]
    respuesta: Array<Nucleo["EstablecimientoVista"]>
  }
  /** Actualizar un establecimiento */
  establecimiento_actualizar: {
    params: { id: string }
    query: never
    cuerpo: Nucleo["Establecimiento"]
    respuesta: Array<Nucleo["EstablecimientoVista"]>
  }
  /** Crear un punto de venta */
  punto_venta_crear: {
    params: never
    query: never
    cuerpo: Nucleo["PuntoVenta"]
    respuesta: Array<Nucleo["EstablecimientoVista"]>
  }
  /** Buscar clientes */
  clientes_listar: {
    params: never
    query: { q?: string; limite?: number }
    cuerpo: never
    respuesta: Array<Nucleo["Cliente"]>
  }
  /** Crear un cliente */
  cliente_crear: {
    params: never
    query: never
    cuerpo: Nucleo["ClienteEntrada"]
    respuesta: Nucleo["Cliente"]
  }
  /** Obtener un cliente */
  cliente_obtener: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: Nucleo["Cliente"]
  }
  /** Actualizar un cliente */
  cliente_actualizar: {
    params: { id: string }
    query: never
    cuerpo: Nucleo["ClienteEntrada"]
    respuesta: Nucleo["Cliente"]
  }
  /** Eliminar un cliente */
  cliente_eliminar: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: {
      eliminado: true
    }
  }
  /** Buscar productos */
  productos_listar: {
    params: never
    query: { q?: string; limite?: number }
    cuerpo: never
    respuesta: Array<Nucleo["Producto"]>
  }
  /** Crear un producto */
  producto_crear: {
    params: never
    query: never
    cuerpo: Nucleo["ProductoEntrada"]
    respuesta: Nucleo["Producto"]
  }
  /** Obtener un producto */
  producto_obtener: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: Nucleo["Producto"]
  }
  /** Actualizar un producto */
  producto_actualizar: {
    params: { id: string }
    query: never
    cuerpo: Nucleo["ProductoEntrada"]
    respuesta: Nucleo["Producto"]
  }
  /** Eliminar un producto */
  producto_eliminar: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: {
      eliminado: true
    }
  }
  /** Listar documentos */
  dte_listar: {
    params: never
    query: { tipo?: string; estado?: "pendiente" | "procesado" | "rechazado" | "contingencia" | "invalidado"; q?: string; desde?: string; hasta?: string; pagina?: number; porPagina?: number }
    cuerpo: never
    respuesta: Nucleo["ListaDocumentos"]
  }
  /** Emitir un DTE */
  dte_emitir: {
    params: never
    query: never
    cuerpo: Nucleo["Emision"]
    respuesta: Nucleo["Documento"]
  }
  /** Validar sin emitir */
  dte_validar: {
    params: never
    query: never
    cuerpo: Nucleo["Emision"]
    respuesta: Nucleo["Validacion"]
  }
  /** Obtener un documento */
  dte_obtener: {
    params: { codigo: string }
    query: never
    cuerpo: never
    respuesta: Nucleo["DocumentoDetalle"]
  }
  /** Archivo DTE oficial (JSON) */
  dte_json: {
    params: { codigo: string }
    query: never
    cuerpo: never
    respuesta: Record<string, unknown>
  }
  /** Representación gráfica (PDF) */
  dte_pdf: {
    params: { codigo: string }
    query: never
    cuerpo: never
    respuesta: ArrayBuffer
  }
  /** Invalidar un documento o un evento */
  dte_invalidar: {
    params: { codigo: string }
    query: never
    cuerpo: Nucleo["Invalidacion"]
    respuesta: Nucleo["DocumentoDetalle"] | {
      invalidado: true
      tipo: "retorno" | "operaciones_especiales"
      codigoGeneracion: string
    }
  }
  /** Evento de Retorno (18) */
  dte_retorno: {
    params: { codigo: string }
    query: never
    cuerpo: Nucleo["Retorno"]
    respuesta: Nucleo["Evento"]
  }
  /** Transmitir documentos en contingencia */
  contingencia_transmitir: {
    params: never
    query: never
    cuerpo: never
    respuesta: {
      /** Nulo si no había documentos en contingencia. */
      evento: {
        id?: string
        codigoGeneracion?: string
      } | null
      procesados: Array<Nucleo["Documento"]>
      rechazados: Array<Nucleo["Documento"]>
      restantes: number
    }
  }
  /** Evento de Operaciones Especiales (17) */
  operaciones_especiales_informar: {
    params: never
    query: never
    cuerpo: Nucleo["OperacionesEspeciales"]
    respuesta: Nucleo["Evento"]
  }
  /** Listar eventos */
  eventos_listar: {
    params: never
    query: { tipo?: "retorno" | "operaciones_especiales" }
    cuerpo: never
    respuesta: Array<Nucleo["Evento"]>
  }
  /** Obtener un evento */
  evento_obtener: {
    params: { codigo: string }
    query: never
    cuerpo: never
    respuesta: Nucleo["EventoDetalle"]
  }
  /** Archivo del evento (JSON) */
  evento_json: {
    params: { codigo: string }
    query: never
    cuerpo: never
    respuesta: Record<string, unknown>
  }
  /** Representación gráfica del evento (PDF) */
  evento_pdf: {
    params: { codigo: string }
    query: never
    cuerpo: never
    respuesta: ArrayBuffer
  }
  /** Listar catálogos del MH */
  catalogos_listar: {
    params: never
    query: never
    cuerpo: never
    respuesta: Array<{
      id?: string
      nombre?: string
      total?: number
    }>
  }
  /** Consultar un catálogo */
  catalogo_buscar: {
    params: { id: string }
    query: { q?: string; departamento?: string; limite?: number }
    cuerpo: never
    respuesta: Nucleo["Catalogo"]
  }
  /** Listar claves de API */
  claves_listar: {
    params: never
    query: never
    cuerpo: never
    respuesta: Array<Nucleo["Clave"]>
  }
  /** Crear una clave de API */
  clave_crear: {
    params: never
    query: never
    cuerpo: Nucleo["ClaveApiEntrada"]
    respuesta: Nucleo["ClaveCreada"]
  }
  /** Revocar una clave */
  clave_revocar: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: {
      revocada: true
    }
  }
  /** Listar webhooks */
  webhooks_listar: {
    params: never
    query: never
    cuerpo: never
    respuesta: Array<Nucleo["Webhook"]>
  }
  /** Crear un webhook */
  webhook_crear: {
    params: never
    query: never
    cuerpo: Nucleo["WebhookEntrada"]
    respuesta: Nucleo["WebhookConSecreto"]
  }
  /** Cambiar URL, descripción, eventos o activarlo/desactivarlo */
  webhook_actualizar: {
    params: { id: string }
    query: never
    cuerpo: Nucleo["WebhookCambios"]
    respuesta: Nucleo["Webhook"]
  }
  /** Eliminar un webhook y sus entregas */
  webhook_eliminar: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: {
      eliminado: true
    }
  }
  /** Generar un secreto nuevo */
  webhook_rotar_secreto: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: Nucleo["WebhookConSecreto"]
  }
  /** Enviar un evento `webhook.prueba` ahora */
  webhook_probar: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: {
      entregado: boolean
      status?: number | null
      error?: string | null
      entrega: Nucleo["EntregaWebhook"]
    }
  }
  /** Últimas 50 entregas de un webhook */
  webhook_entregas: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: Array<Nucleo["EntregaWebhook"]>
  }
  /** Reenviar una entrega ahora */
  webhook_entrega_reenviar: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: Nucleo["EntregaWebhook"]
  }
  /** Bitácora de auditoría */
  auditoria_listar: {
    params: never
    query: { antesDe?: number; limite?: number }
    cuerpo: never
    respuesta: Array<Nucleo["RegistroAuditoria"]>
  }
  /** Registros de peticiones de la API */
  registros_listar: {
    params: never
    query: { antesDe?: number; limite?: number; estado?: "ok" | "error"; origen?: "api" | "mcp"; claveId?: string }
    cuerpo: never
    respuesta: Array<Nucleo["RegistroApi"]>
  }
  /** Crear un cliente */
  plataforma_cliente_crear: {
    params: never
    query: never
    cuerpo: {
      nombre: string
      /** Tu propio id del cliente; único en tu cuenta. */
      externalId?: string | null
      datos?: Cloud["DatosCliente"]
    }
    respuesta: Cloud["ClientePlataforma"]
  }
  /** Listar clientes */
  plataforma_clientes_listar: {
    params: never
    query: { estado?: "pendiente" | "activo" | "desactivado"; externalId?: string }
    cuerpo: never
    respuesta: Array<Cloud["ClientePlataforma"]>
  }
  /** Obtener un cliente */
  plataforma_cliente_obtener: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: Cloud["ClientePlataforma"]
  }
  /** Eliminar o desactivar un cliente */
  plataforma_cliente_eliminar: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: ArrayBuffer
  }
  /** Crear el enlace de alta */
  plataforma_cliente_enlace: {
    params: { id: string }
    query: never
    cuerpo: {
      expiraEnHoras?: number
    }
    respuesta: {
      url?: string
      /** ms desde 1970 */
      expira?: number
    }
  }
  /** Ver su empresa ante Hacienda */
  plataforma_cliente_empresa: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: Cloud["EmpresaCliente"] | null
  }
  /** DTE del mes */
  plataforma_cliente_uso: {
    params: { id: string }
    query: { periodo?: string }
    cuerpo: never
    respuesta: {
      periodo?: string
      dte?: number
    }
  }
  /** Crear una clave para el cliente */
  plataforma_cliente_clave_crear: {
    params: { id: string }
    query: never
    cuerpo: Cloud["ClaveEntrada"]
    respuesta: Cloud["ClaveCreada"]
  }
  /** Listar sus claves */
  plataforma_cliente_claves: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: Array<Cloud["Clave"]>
  }
  /** Revocar una de sus claves */
  plataforma_cliente_clave_revocar: {
    params: { id: string; clave: string }
    query: never
    cuerpo: never
    respuesta: ArrayBuffer
  }
  /** Crear un webhook para el cliente */
  plataforma_cliente_webhook_crear: {
    params: { id: string }
    query: never
    cuerpo: Cloud["WebhookEntrada"]
    respuesta: Cloud["WebhookCreado"]
  }
  /** Listar sus webhooks */
  plataforma_cliente_webhooks: {
    params: { id: string }
    query: never
    cuerpo: never
    respuesta: Array<Cloud["Webhook"]>
  }
  /** Borrar uno de sus webhooks */
  plataforma_cliente_webhook_eliminar: {
    params: { id: string; webhook: string }
    query: never
    cuerpo: never
    respuesta: ArrayBuffer
  }
  /** Ver la marca */
  marca_obtener: {
    params: never
    query: never
    cuerpo: never
    respuesta: Cloud["Marca"]
  }
  /** Cambiar correo de respuesta u «Ocultar Open Factura» */
  marca_actualizar: {
    params: never
    query: never
    cuerpo: {
      correoRespuesta?: string | null
      ocultarOpenFactura?: boolean
    }
    respuesta: Cloud["Marca"]
  }
  /** Subir el logo */
  marca_logo_subir: {
    params: never
    query: never
    cuerpo: {
      /** Base64 (o data URL) del PNG/JPG */
      base64: string
    }
    respuesta: Cloud["Marca"]
  }
  /** Quitar el logo */
  marca_logo_quitar: {
    params: never
    query: never
    cuerpo: never
    respuesta: Cloud["Marca"]
  }
  /** Enviar un DTE por correo */
  dte_enviar_correo: {
    params: { codigo: string }
    query: never
    cuerpo: {
      /** Otra dirección; por defecto el receptor. */
      para?: string
    }
    respuesta: Cloud["Envio"]
  }
  /** Ver los envíos de un DTE */
  dte_envios_listar: {
    params: { codigo: string }
    query: never
    cuerpo: never
    respuesta: Array<Cloud["Envio"]>
  }
  /** Avance de las pruebas mínimas */
  certificacion_estado: {
    params: never
    query: never
    cuerpo: never
    respuesta: Cloud["Certificacion"]
  }
  /** Iniciar o retomar la certificación */
  certificacion_iniciar: {
    params: never
    query: never
    cuerpo: {
      clienteCcfId?: string | null
      desdeCero?: boolean
      alcance?: "minimo" | "completo"
    }
    respuesta: Cloud["Certificacion"]
  }
  /** Emitir la siguiente tanda */
  certificacion_avanzar: {
    params: never
    query: never
    cuerpo: never
    respuesta: Cloud["Certificacion"]
  }
}

export type IdOperacion = keyof Operaciones

export const RUTAS: Record<IdOperacion, { metodo: string; ruta: string; binaria?: true }> = {
  yo_obtener: { metodo: 'GET', ruta: '/api/v1/yo' },
  resumen_obtener: { metodo: 'GET', ruta: '/api/v1/resumen' },
  uso_obtener: { metodo: 'GET', ruta: '/api/v1/uso' },
  emisor_obtener: { metodo: 'GET', ruta: '/api/v1/emisor' },
  emisor_guardar: { metodo: 'PUT', ruta: '/api/v1/emisor' },
  emisor_credenciales_guardar: { metodo: 'PUT', ruta: '/api/v1/emisor/credenciales/:ambiente' },
  emisor_credenciales_prueba: { metodo: 'POST', ruta: '/api/v1/emisor/credenciales-prueba' },
  emisor_probar: { metodo: 'POST', ruta: '/api/v1/emisor/probar' },
  establecimientos_listar: { metodo: 'GET', ruta: '/api/v1/establecimientos' },
  establecimiento_crear: { metodo: 'POST', ruta: '/api/v1/establecimientos' },
  establecimiento_actualizar: { metodo: 'PUT', ruta: '/api/v1/establecimientos/:id' },
  punto_venta_crear: { metodo: 'POST', ruta: '/api/v1/puntos-venta' },
  clientes_listar: { metodo: 'GET', ruta: '/api/v1/clientes' },
  cliente_crear: { metodo: 'POST', ruta: '/api/v1/clientes' },
  cliente_obtener: { metodo: 'GET', ruta: '/api/v1/clientes/:id' },
  cliente_actualizar: { metodo: 'PUT', ruta: '/api/v1/clientes/:id' },
  cliente_eliminar: { metodo: 'DELETE', ruta: '/api/v1/clientes/:id' },
  productos_listar: { metodo: 'GET', ruta: '/api/v1/productos' },
  producto_crear: { metodo: 'POST', ruta: '/api/v1/productos' },
  producto_obtener: { metodo: 'GET', ruta: '/api/v1/productos/:id' },
  producto_actualizar: { metodo: 'PUT', ruta: '/api/v1/productos/:id' },
  producto_eliminar: { metodo: 'DELETE', ruta: '/api/v1/productos/:id' },
  dte_listar: { metodo: 'GET', ruta: '/api/v1/dte' },
  dte_emitir: { metodo: 'POST', ruta: '/api/v1/dte' },
  dte_validar: { metodo: 'POST', ruta: '/api/v1/dte/validar' },
  dte_obtener: { metodo: 'GET', ruta: '/api/v1/dte/:codigo' },
  dte_json: { metodo: 'GET', ruta: '/api/v1/dte/:codigo/json' },
  dte_pdf: { metodo: 'GET', ruta: '/api/v1/dte/:codigo/pdf', binaria: true },
  dte_invalidar: { metodo: 'POST', ruta: '/api/v1/dte/:codigo/invalidar' },
  dte_retorno: { metodo: 'POST', ruta: '/api/v1/dte/:codigo/retorno' },
  contingencia_transmitir: { metodo: 'POST', ruta: '/api/v1/contingencia/transmitir' },
  operaciones_especiales_informar: { metodo: 'POST', ruta: '/api/v1/eventos/operaciones-especiales' },
  eventos_listar: { metodo: 'GET', ruta: '/api/v1/eventos' },
  evento_obtener: { metodo: 'GET', ruta: '/api/v1/eventos/:codigo' },
  evento_json: { metodo: 'GET', ruta: '/api/v1/eventos/:codigo/json' },
  evento_pdf: { metodo: 'GET', ruta: '/api/v1/eventos/:codigo/pdf', binaria: true },
  catalogos_listar: { metodo: 'GET', ruta: '/api/v1/catalogos' },
  catalogo_buscar: { metodo: 'GET', ruta: '/api/v1/catalogos/:id' },
  claves_listar: { metodo: 'GET', ruta: '/api/v1/claves' },
  clave_crear: { metodo: 'POST', ruta: '/api/v1/claves' },
  clave_revocar: { metodo: 'DELETE', ruta: '/api/v1/claves/:id' },
  webhooks_listar: { metodo: 'GET', ruta: '/api/v1/webhooks' },
  webhook_crear: { metodo: 'POST', ruta: '/api/v1/webhooks' },
  webhook_actualizar: { metodo: 'PATCH', ruta: '/api/v1/webhooks/:id' },
  webhook_eliminar: { metodo: 'DELETE', ruta: '/api/v1/webhooks/:id' },
  webhook_rotar_secreto: { metodo: 'POST', ruta: '/api/v1/webhooks/:id/rotar-secreto' },
  webhook_probar: { metodo: 'POST', ruta: '/api/v1/webhooks/:id/probar' },
  webhook_entregas: { metodo: 'GET', ruta: '/api/v1/webhooks/:id/entregas' },
  webhook_entrega_reenviar: { metodo: 'POST', ruta: '/api/v1/webhooks/entregas/:id/reenviar' },
  auditoria_listar: { metodo: 'GET', ruta: '/api/v1/auditoria' },
  registros_listar: { metodo: 'GET', ruta: '/api/v1/registros' },
  plataforma_cliente_crear: { metodo: 'POST', ruta: '/cloud/plataforma/clientes' },
  plataforma_clientes_listar: { metodo: 'GET', ruta: '/cloud/plataforma/clientes' },
  plataforma_cliente_obtener: { metodo: 'GET', ruta: '/cloud/plataforma/clientes/:id' },
  plataforma_cliente_eliminar: { metodo: 'DELETE', ruta: '/cloud/plataforma/clientes/:id' },
  plataforma_cliente_enlace: { metodo: 'POST', ruta: '/cloud/plataforma/clientes/:id/enlace' },
  plataforma_cliente_empresa: { metodo: 'GET', ruta: '/cloud/plataforma/clientes/:id/empresa' },
  plataforma_cliente_uso: { metodo: 'GET', ruta: '/cloud/plataforma/clientes/:id/uso' },
  plataforma_cliente_clave_crear: { metodo: 'POST', ruta: '/cloud/plataforma/clientes/:id/claves' },
  plataforma_cliente_claves: { metodo: 'GET', ruta: '/cloud/plataforma/clientes/:id/claves' },
  plataforma_cliente_clave_revocar: { metodo: 'DELETE', ruta: '/cloud/plataforma/clientes/:id/claves/:clave' },
  plataforma_cliente_webhook_crear: { metodo: 'POST', ruta: '/cloud/plataforma/clientes/:id/webhooks' },
  plataforma_cliente_webhooks: { metodo: 'GET', ruta: '/cloud/plataforma/clientes/:id/webhooks' },
  plataforma_cliente_webhook_eliminar: { metodo: 'DELETE', ruta: '/cloud/plataforma/clientes/:id/webhooks/:webhook' },
  marca_obtener: { metodo: 'GET', ruta: '/api/v1/ext/marca' },
  marca_actualizar: { metodo: 'PUT', ruta: '/api/v1/ext/marca' },
  marca_logo_subir: { metodo: 'PUT', ruta: '/api/v1/ext/marca/logo' },
  marca_logo_quitar: { metodo: 'DELETE', ruta: '/api/v1/ext/marca/logo' },
  dte_enviar_correo: { metodo: 'POST', ruta: '/api/v1/ext/correo/dte/:codigo' },
  dte_envios_listar: { metodo: 'GET', ruta: '/api/v1/ext/correo/dte/:codigo' },
  certificacion_estado: { metodo: 'GET', ruta: '/api/v1/ext/certificacion' },
  certificacion_iniciar: { metodo: 'POST', ruta: '/api/v1/ext/certificacion/iniciar' },
  certificacion_avanzar: { metodo: 'POST', ruta: '/api/v1/ext/certificacion/avanzar' },
}
