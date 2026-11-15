// Orden del menú lateral. Lo usan astro.config.mjs y /llms.txt, para que ambos coincidan.
// `translations.en` es la etiqueta en la versión en inglés (/en/); las páginas usan su propio título.
export const gruposAntesDeLaApi = [
  {
    label: 'Empezar',
    translations: { en: 'Get started' },
    items: [
      { label: 'Introducción', translations: { en: 'Introduction' }, link: '/' },
      'inicio-rapido',
      'autenticacion',
      'ambientes',
    ],
  },
  {
    label: 'Guías',
    translations: { en: 'Guides' },
    items: [
      'guias/emitir',
      'guias/idempotencia',
      'guias/contingencia',
      'guias/invalidacion',
      'guias/retorno',
      'guias/operaciones-especiales',
      'guias/webhooks',
      'guias/limites',
    ],
  },
  {
    label: 'Herramientas',
    translations: { en: 'Tools' },
    items: [
      'herramientas/agentes',
      'herramientas/mcp',
      'herramientas/cli',
      'herramientas/habilidades',
      'herramientas/sdk-node',
      'herramientas/sdk',
    ],
  },
  {
    label: 'Hacienda y despliegue',
    translations: { en: 'Hacienda and deployment' },
    items: ['hacienda/ser-emisor', 'guias/certificacion', 'autoalojamiento'],
  },
  { label: 'Referencia', translations: { en: 'Reference' }, items: ['errores'] },
]

export const gruposDespuesDeLaApi = [
  { label: 'Open Factura Cloud', items: ['cloud/plataforma', 'cloud/marca', 'cloud/whatsapp'] },
]
