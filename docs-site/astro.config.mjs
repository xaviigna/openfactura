import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi'
import { gruposAntesDeLaApi, gruposDespuesDeLaApi } from './src/navegacion.mjs'
import { temaCodigo } from './src/tema-codigo.mjs'

// starlight-openapi convierte la ruta en una URL file:// que su lector no decodifica bien cuando la
// carpeta tiene espacios u otros caracteres especiales (por ejemplo «Open factura/»). En ese caso se
// lee una copia temporal del documento.
const rutaLegible = (archivo) => {
  const especificacion = fileURLToPath(new URL(`./public/${archivo}`, import.meta.url))
  if (/^[\w./-]+$/.test(especificacion)) return especificacion
  const copia = join(mkdtempSync(join(tmpdir(), 'openfactura-docs-')), archivo)
  copyFileSync(especificacion, copia)
  return copia
}
const rutaEspecificacion = rutaLegible('openapi.json')
// Lo que suma Open Factura Cloud (Plataforma, Marca, Correo, Certificación), escrito a mano.
const rutaEspecificacionCloud = rutaLegible('openapi-cloud.json')

// Sitio estático (sin runtime de servidor) para Cloudflare Pages en docs.openfactura.co.
// La referencia de la API se genera desde public/openapi.json (`cd server && bun run openapi`).
export default defineConfig({
  site: 'https://docs.openfactura.co',
  integrations: [
    starlight({
      title: 'Open Factura',
      description:
        'Documentación de Open Factura: facturación electrónica de El Salvador (DTE) con API, MCP, CLI y SDK de código abierto.',
      defaultLocale: 'root',
      // Español en la raíz (/) e inglés en /en/. La referencia de la API se genera en español.
      locales: { root: { label: 'Español', lang: 'es' }, en: { label: 'English', lang: 'en' } },
      favicon: '/favicon.svg',
      logo: { src: './src/assets/logo.svg', alt: '' },
      customCss: ['./src/styles/marca.css'],
      // Mismo aspecto que openfactura.co: sólo tema oscuro, la fuente del sistema y Geist Mono.
      head: [
        { tag: 'meta', attrs: { name: 'color-scheme', content: 'dark' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#0A0A0A' } },
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400..600&display=swap',
          },
        },
      ],
      components: {
        Footer: './src/components/Footer.astro',
        PageTitle: './src/components/PageTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      expressiveCode: {
        themes: [temaCodigo],
        styleOverrides: {
          borderRadius: '12px',
          borderColor: '#262626',
          codeFontFamily: 'var(--__sl-font-mono)',
          uiFontFamily: 'var(--__sl-font)',
          codeBackground: '#141414',
          frames: {
            editorTabBarBackground: '#111111',
            editorActiveTabBackground: '#141414',
            editorActiveTabIndicatorTopColor: '#00C87E',
            editorTabBarBorderBottomColor: '#262626',
            terminalTitlebarBackground: '#111111',
            terminalTitlebarBorderBottomColor: '#262626',
            terminalBackground: '#141414',
            inlineButtonForeground: '#B4B4B4',
            inlineButtonBorder: '#262626',
            tooltipSuccessBackground: '#00C87E',
            tooltipSuccessForeground: '#04130C',
            frameBoxShadowCssValue: 'none',
          },
        },
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/xaviigna/openfactura' },
      ],
      editLink: { baseUrl: 'https://github.com/xaviigna/openfactura/edit/main/docs-site/' },
      lastUpdated: false,
      plugins: [
        starlightOpenAPI([
          {
            base: 'api',
            schema: rutaEspecificacion,
            sidebar: { label: 'Referencia de la API', collapsed: false },
          },
          {
            base: 'api-cloud',
            schema: rutaEspecificacionCloud,
            sidebar: { label: 'Referencia de Open Factura Cloud', collapsed: false },
          },
        ]),
      ],
      sidebar: [...gruposAntesDeLaApi, ...openAPISidebarGroups, ...gruposDespuesDeLaApi],
    }),
  ],
})
