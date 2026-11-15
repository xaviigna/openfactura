// Tema oscuro de los bloques de código, con los mismos colores que la portada de openfactura.co.
const color = (foreground, ...scope) => ({ scope, settings: { foreground } })

export const temaCodigo = {
  name: 'open-factura',
  type: 'dark',
  colors: {
    'editor.background': '#141414',
    'editor.foreground': '#EDEDED',
    'editor.selectionBackground': '#00C87E33',
  },
  tokenColors: [
    { settings: { foreground: '#EDEDED' } },
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#8B949E', fontStyle: 'italic' },
    },
    color('#33D698', 'string.quoted', 'punctuation.definition.string', 'string.template'),
    color('#F2A65A', 'constant.other.option', 'variable.parameter.option'),
    color(
      '#93C5FD',
      'support.type.property-name',
      'meta.object-literal.key',
      'variable.other.key',
      'entity.name.section',
      'entity.other.attribute-name',
      'entity.name.tag',
      'variable.other.property',
    ),
    color(
      '#C4B5FD',
      'keyword.control',
      'keyword.other',
      'keyword.operator.new',
      'keyword.operator.expression',
      'storage',
      'storage.type',
      'storage.modifier',
    ),
    color('#FCD34D', 'constant.numeric', 'constant.language'),
    color('#EDEDED', 'entity.name.command', 'entity.name.function', 'support.function'),
  ],
}
