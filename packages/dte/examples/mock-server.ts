/**
 * MH simulado por HTTP para desarrollo local: npm run mock-mh
 * Apunte la app con MH_BASE_URL=http://localhost:8787. Acepta cualquier NIT con la contraseña MOCK_PASSWORD.
 */
import { createServer } from 'node:http'
import { crearMockMH } from '../src/mh/mock'

const password = process.env.MOCK_PASSWORD ?? 'Password-API-123!'
const puerto = Number(process.env.PORT ?? 8787)
const mock = crearMockMH({ usuarios: new Proxy({}, { get: () => password }) as Record<string, string> })

createServer(async (req, res) => {
  const cuerpo: Buffer[] = []
  for await (const parte of req) cuerpo.push(parte as Buffer)
  try {
    const respuesta = await mock.atender(new Request(`http://localhost:${puerto}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(cuerpo)
    }))
    res.writeHead(respuesta.status, Object.fromEntries(respuesta.headers))
    res.end(await respuesta.text())
    console.log(`${req.method} ${req.url} -> ${respuesta.status}`)
  } catch (error) {
    res.destroy()
    console.log(`${req.method} ${req.url} -> sin respuesta (${(error as Error).message})`)
  }
}).listen(puerto, () => console.log(`MH simulado en http://localhost:${puerto}  (contraseña de API: ${password})`))
