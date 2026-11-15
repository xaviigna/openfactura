// Enlaces de instalación del servidor MCP remoto. La clave va como marcador: Cursor y VS Code no
// documentan cómo pedirla desde el enlace, así que el usuario la reemplaza en su mcp.json.
export const SITIO = 'https://docs.openfactura.co'
export const URL_MCP = 'https://openfactura.co/mcp'
export const CLAVE_EJEMPLO = 'of_test_TU_CLAVE'

const servidor = { url: URL_MCP, headers: { Authorization: `Bearer ${CLAVE_EJEMPLO}` } }

// https://cursor.com/docs/context/mcp/install-links: `config` es el objeto del servidor en base64.
export const enlaceCursor = `cursor://anysphere.cursor-deeplink/mcp/install?name=openfactura&config=${btoa(JSON.stringify(servidor))}`

// https://code.visualstudio.com/api/extension-guides/ai/mcp: JSON con `name`, codificado como URL.
export const enlaceVSCode = `vscode:mcp/install?${encodeURIComponent(
  JSON.stringify({ name: 'openfactura', type: 'http', ...servidor }),
)}`

export const enlacesInstalacion = {
  cursor: { nombre: 'Cursor', href: enlaceCursor },
  vscode: { nombre: 'VS Code', href: enlaceVSCode },
}

/** Idioma de una página: inglés bajo /en/, español en el resto. */
export type Idioma = 'es' | 'en'
export const idiomaDe = (lang?: string): Idioma => (lang === 'en' ? 'en' : 'es')
