import { SELF } from 'cloudflare:test'

const BASE = 'http://localhost'
let contador = 0

export const EMISOR = {
  nit: '0614-290786-102-3',
  nrc: '123456-7',
  nombre: 'EMPRESA DE PRUEBA, S.A. DE C.V.',
  nombreComercial: 'Open Factura',
  codActividad: '62010',
  descActividad: 'Programación informática',
  departamento: '06',
  municipio: '23',
  distrito: '14',
  complemento: 'Calle El Rosal #567',
  telefono: '22223333',
  correo: 'facturacion@ejemplo.com.sv',
  responsableNombre: 'Ana Prueba',
  responsableTipoDoc: '13',
  responsableNumDoc: '012345678',
}

export const FACTURA = {
  tipoDte: '01',
  datos: { items: [{ descripcion: 'Servicio', cantidad: 2, precioUni: 11.3 }] },
}

/** Cliente HTTP de pruebas: guarda las cookies de sesión o envía una clave de API. */
export class Cliente {
  private cookies = new Map<string, string>()
  // Cada cliente simula una IP distinta para no chocar con el límite por IP de las rutas de sesión.
  private ip =
    `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
  /** Worker que atiende las peticiones. Por defecto el de `wrangler.jsonc`; las pruebas de extensiones lo cambian. */
  despachar: (peticion: Request) => Promise<Response> = (p) => SELF.fetch(p)
  constructor(private clave?: string) {}

  async pedir(
    metodo: string,
    ruta: string,
    cuerpo?: unknown,
    encabezados: Record<string, string> = {},
  ) {
    const headers = new Headers({ Origin: BASE, 'cf-connecting-ip': this.ip, ...encabezados })
    if (cuerpo !== undefined) headers.set('Content-Type', 'application/json')
    if (this.clave) headers.set('Authorization', `Bearer ${this.clave}`)
    else if (this.cookies.size) {
      headers.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    }
    const respuesta = await this.despachar(
      new Request(`${BASE}${ruta}`, {
        method: metodo,
        headers,
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      }),
    )
    for (const cookie of respuesta.headers.getSetCookie()) {
      const [par] = cookie.split(';')
      const indice = par!.indexOf('=')
      this.cookies.set(par!.slice(0, indice), par!.slice(indice + 1))
    }
    return respuesta
  }

  async json(
    metodo: string,
    ruta: string,
    cuerpo?: unknown,
    encabezados?: Record<string, string>,
  ): Promise<{ status: number; cuerpo: any; headers: Headers }> {
    const r = await this.pedir(metodo, ruta, cuerpo, encabezados)
    return { status: r.status, cuerpo: await r.json(), headers: r.headers }
  }
}

/** Registra un usuario con su organización. Opcionalmente deja el emisor listo para emitir. */
export async function nuevaOrganizacion(opciones: { emisor?: boolean; nit?: string } = {}) {
  const n = ++contador
  const cliente = new Cliente()
  const correo = `usuario${n}-${crypto.randomUUID()}@ejemplo.com`
  const registro = await cliente.json('POST', '/api/auth/sign-up/email', {
    name: `Usuario ${n}`,
    email: correo,
    password: 'clave-larga-12345',
  })
  if (registro.status !== 200) throw new Error(`Registro falló: ${JSON.stringify(registro.cuerpo)}`)
  const organizacion = await cliente.json('POST', '/api/auth/organization/create', {
    name: `Empresa ${n}`,
    slug: `empresa-${n}-${crypto.randomUUID().slice(0, 8)}`,
  })
  if (organizacion.status !== 200)
    throw new Error(`Organización falló: ${JSON.stringify(organizacion.cuerpo)}`)
  if (opciones.emisor) {
    const emisor = await cliente.json('PUT', '/api/v1/emisor', {
      ...EMISOR,
      nit: opciones.nit ?? EMISOR.nit,
    })
    if (emisor.status !== 200) throw new Error(`Emisor falló: ${JSON.stringify(emisor.cuerpo)}`)
    const credenciales = await cliente.json('POST', '/api/v1/emisor/credenciales-prueba')
    if (credenciales.status !== 200)
      throw new Error(`Credenciales fallaron: ${JSON.stringify(credenciales.cuerpo)}`)
  }
  return {
    cliente,
    correo,
    organizationId: organizacion.cuerpo.id as string,
    userId: registro.cuerpo.user.id as string,
  }
}

export async function nuevaClave(
  cliente: Cliente,
  scopes: string[],
  extra: Record<string, unknown> = {},
) {
  const r = await cliente.json('POST', '/api/v1/claves', {
    nombre: 'Prueba',
    modo: 'test',
    scopes,
    ...extra,
  })
  if (r.status !== 201) throw new Error(`Clave falló: ${JSON.stringify(r.cuerpo)}`)
  return {
    id: r.cuerpo.id as string,
    clave: r.cuerpo.clave as string,
    cliente: new Cliente(r.cuerpo.clave),
  }
}
