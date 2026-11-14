# Representación gráfica de los DTE: lista de verificación

> **Aviso.** Este documento es un resumen para desarrolladores, no asesoría legal ni tributaria. Fue elaborado a partir de la "Normativa de Cumplimiento de los Documentos Tributarios Electrónicos, Versión 2.0" y de los manuales oficiales del Ministerio de Hacienda. Las clases A/B/C/D de las tablas se leyeron directamente de las páginas del PDF del Anexo II; los campos que no se revisaron se indican expresamente. Ante cualquier diferencia prevalecen los documentos oficiales publicados en <https://factura.gob.sv>.

Convención de citas: `(Normativa 2.0, regla X)`, `(Normativa 2.0, Anexo I, regla X)`, `(Normativa 2.0, Anexo II, campo N)`, `(Manual Funcional, sección X)`, `(Manual Técnico, sección X)`.

## 1. Qué es y qué no es

- La representación gráfica es la **versión electrónica interpretada** del DTE o evento, fácilmente comprensible para el receptor (Normativa 2.0, regla 11.3).
- **No es el DTE.** Los documentos en formato portable (PDF), las imágenes y los impresos no tienen la estructura de datos ni el formato electrónico, por lo tanto no son Documentos Tributarios Electrónicos (regla 11.3).
- Solo respalda deducciones cuando se corresponde con su DTE transmitido y este no ha sido invalidado (reglas 11 y 11.3.1).
- Se entrega **siempre junto con el Archivo DTE** (JSON), nunca en su lugar (regla 11).
- El formato del archivo no está restringido a PDF: la Normativa da como ejemplos `.pdf` y `.png` (Anexo I, regla 1.2).

## 2. Reglas generales

| #   | Requisito                                                                                                                                                                                                                                                                   | Fuente                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| G1  | Generarla de forma simultánea al DTE o evento y entregarla junto con él, por cada operación                                                                                                                                                                                 | Normativa 2.0, regla 11.3                  |
| G2  | Usar un diseño **uniforme y único por cada tipo** de DTE y evento del mismo emisor                                                                                                                                                                                          | regla 11.3                                 |
| G3  | Conservar los **nombres de campo** de los Anexos II y III. Puede agregarse al lado la denominación propia del negocio, pero no sustituir el nombre oficial                                                                                                                  | regla 11.3                                 |
| G4  | Representar fielmente y con exactitud los datos transmitidos. La posición de los datos en la página es libre                                                                                                                                                                | regla 11.3.1                               |
| G5  | Exportar los valores de los campos JSON **directamente** a la representación gráfica (no recalcular ni reformatear de modo que cambie el dato)                                                                                                                              | Anexo I, regla 4                           |
| G6  | No modificar, suprimir ni sustituir datos de la representación gráfica de forma independiente al documento. Si el error está en el documento, se invalida y se sustituye. Si el error está solo en la representación gráfica, se corrige esta para que corresponda a su DTE | regla 11.3.1                               |
| G7  | Puede agregarse información comercial propia, logos, marcas y eslóganes                                                                                                                                                                                                     | regla 11.3.1; Manual Funcional, sección IV |
| G8  | Nombre del archivo digital: el código de generación más la extensión, por ejemplo `<UUID>.pdf`                                                                                                                                                                              | Anexo I, regla 1.2                         |
| G9  | Conservarla en el mismo formato y medio en que fue expedida                                                                                                                                                                                                                 | regla 12                                   |
| G10 | Las reproducciones deben mostrar la información íntegra y sin alteraciones                                                                                                                                                                                                  | Anexo I, regla 4                           |

Los diseños que publica el Manual Funcional (sección XXII) son **sugeridos**: puede usarse otro diseño respetando la categoría asignada a cada campo.

## 3. Clases de campo A, B, C y D

La columna "Representación Gráfica" de los Anexos II (DTE) y III (eventos) clasifica cada campo (Normativa 2.0, Anexo I, regla 8; Manual Funcional, sección IV):

| Clase | Qué exige                                                                                            | Cómo implementarlo                                            |
| ----- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **A** | Mostrar el campo con sus datos                                                                       | Siempre visible: etiqueta y valor                             |
| **B** | Mostrar el campo con sus datos cuando sea necesario de conformidad con la ley                        | Visible cuando el campo tiene dato o la operación lo requiere |
| **C** | No es obligatorio mostrarlo                                                                          | Opcional; el emisor decide                                    |
| **D** | Si se usa, mostrarlo; si no se usa, mostrar el **nombre de la sección o campo con un guion** al lado | Nunca se omite el rótulo: se imprime "Nombre: -"              |

Notas de lectura:

- Una celda puede traer varios valores: el general y las excepciones por tipo de documento, por ejemplo "A (FE=C)" (Anexo I, regla 8).
- "B/D" aparece en secciones completas (documentos relacionados, documentos asociados, ventas por cuenta de terceros): cuando la sección no se usa, se muestra su nombre con un guion.
- "A (Colocar descripción)" aparece en campos codificados: se muestra la **descripción** del código, no solo el número (Anexo II, campos 3 y 6).

## 4. Lista de verificación de elementos obligatorios

### Encabezado e identificación

- [ ] Tipo de documento, con su descripción, por ejemplo "FACTURA" o "COMPROBANTE DE CRÉDITO FISCAL" (Anexo II, campo 3, clase A con descripción).
- [ ] Versión del documento (Anexo II, campo 1, clase A). Los diseños sugeridos la muestran como "Ver.2", "Ver.4" (Manual Funcional, sección XXII).
- [ ] **Código de generación** (campo 4, clase A).
- [ ] **Número de control** (campo 5, clase A).
- [ ] **Sello de recepción** (campo 175, clase A). Ver la sección 6 para el caso de contingencia.
- [ ] Modelo de facturación, con descripción (campo 6, clase A con descripción).
- [ ] Tipo de transmisión (campo 7, clase A).
- [ ] Fecha de generación y hora de generación (campos 10 y 11, clase A).

### Código QR o enlace de consulta

- [ ] Integrar un **código QR** con el parámetro de consulta o, en su defecto, la **dirección web** que enlace al sitio de consulta de Hacienda (Normativa 2.0, regla 14).
- [ ] Contenido del QR (Manual Técnico, sección 5):

```
https://admin.factura.gob.sv/consultaPublica?ambiente={ambiente}&codGen={codigoGeneracion}&fechaEmi={fechaEmi}
```

| Parámetro  | Valor                                  |
| ---------- | -------------------------------------- |
| `ambiente` | `00` pruebas, `01` producción          |
| `codGen`   | Código de generación del DTE (UUID v4) |
| `fechaEmi` | Fecha de generación, `YYYY-MM-DD`      |

- [ ] El `ambiente` del QR coincide con `identificacion.ambiente` del documento.

> La URL se transcribe del texto OCR del Manual Técnico, corregida de errores evidentes de reconocimiento (`https:/fadmin…`, `&` leído como `8` o `$`). Verificar contra el PDF original antes de fijarla en código.

### Emisor

- [ ] Nombre, NIT, actividad económica (descripción), dirección completa (departamento, municipio, distrito y complemento), teléfono y correo electrónico (Anexo II, campos 18, 22, 24, 26 a 31, clase A).
- [ ] NRC: clase A para CCFE, CLE, DCLE y FEXE; clase B para los demás (campo 21).
- [ ] Nombre comercial cuando exista (campo 25, clase B).

### Receptor

- [ ] Nombre y documento de identificación (tipo y número), o NIT en CCFE y DCLE (campos 38 a 40 y 42, clase A).
- [ ] En FE, cuando el receptor no se identificó (operación bajo el monto legalmente establecido), los campos vienen en `null` en el JSON; la representación gráfica debe reflejar el mismo dato, sin inventar valores (regla 11.3.1). La Normativa no indica un texto específico para este caso.
- [ ] Dirección: clase A en general, **clase C en FE** (campos 47 a 50).
- [ ] Correo electrónico cuando exista (campo 57, clase B).

### Secciones condicionales (clase B/D)

- [ ] Documentos relacionados: tipo, número y fecha del documento. Si no hay, rótulo de la sección con guion (sección 2, clase B/D).
- [ ] Documentos asociados: ídem (sección 5, clase B/D).
- [ ] Ventas por cuenta de terceros: NIT y nombre del tercero. Si no aplica, rótulo con guion (sección 6, clase B/D).

### Cuerpo

- [ ] Por cada ítem: N° de ítem, cantidad, unidad de medida, descripción, precio unitario, descuento por ítem y las columnas de venta que correspondan al tipo de documento (no sujetas, exentas, gravadas) (campos 74, 82, 85 a 87, 89 a 92, clase A).
- [ ] Código del producto cuando exista (campo 83, clase B).
- [ ] Cargos o abonos que no afectan la base imponible cuando existan (campo 98, clase B).

### Resumen

- [ ] Totales de operaciones (no sujetas, exentas, gravadas), suma de operaciones, subtotal, monto total de la operación y total a pagar (campos 123 a 125, 129, 139, 150 y 153, clase A).
- [ ] Descuentos globales, tributos (nombre y valor), IVA percibido e IVA retenido cuando apliquen (campos 130 a 133, 137, 138, 141 y 142, clase B).
- [ ] **Condición de la operación** (campo 159, clase A).

### Paginación

- [ ] Los diseños sugeridos incluyen "Página 1 de 1" (Manual Funcional, sección XXII). No se encontró una regla que lo exija; se recomienda para documentos de varios ítems.

## 5. Leyendas y advertencias obligatorias

| Situación                   | Qué debe mostrarse                                                                                                                     | Fuente                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Ambiente para pruebas       | **Destacar** la advertencia de que el documento carece de valor legal por tratarse de documentación de ensayo con información aparente | Normativa 2.0, regla 11.3 |
| Emisión en contingencia     | El documento se entrega sin sello y debe expresar en su contenido el tipo de transmisión por contingencia, código 2 (CAT-004)          | regla 11.1                |
| Transmisión diferida normal | Se entrega en estado transitorio, sin sello                                                                                            | regla 11.2                |

La Normativa **no prescribe textos literales** para estas leyendas. Redacciones como "Documento sin valor legal - ambiente de pruebas" o "Emitido en contingencia" son decisión del implementador.

No se encontró en la Normativa ni en los manuales revisados una leyenda obligatoria adicional (por ejemplo sobre el régimen del contribuyente). No confirmado para leyendas exigidas por otras leyes.

## 6. El sello de recepción según la modalidad

| Modalidad                                                | Sello en la representación gráfica                                                | Fuente                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Transmisión previa normal                                | Obligatorio                                                                       | Normativa 2.0, regla 11.1; Anexo II, campo 175                                            |
| Diferida normal o contingencia, al momento de la entrega | No existe todavía; se entrega sin sello                                           | regla 11.2; Anexo II, campo 175 ("exceptuando las operaciones generadas en Contingencia") |
| Después de obtener el sello                              | El emisor lo integra en el Archivo DTE "que finalmente podrá remitir al receptor" | regla 11.2                                                                                |

- El Manual Funcional indica que el sello "deberá ser incluido en la Representación Gráfica de los DTE" (Manual Funcional, sección V).
- La Normativa no dice de forma expresa que deba regenerarse y reenviarse la representación gráfica cuando llega el sello de un documento entregado en contingencia. Dado que la representación debe corresponder a su DTE (regla 11.3.1), se recomienda regenerarla con el sello y ponerla a disposición del receptor. No confirmado como obligación expresa.
- Si lo transmitido difiere de lo entregado en estado transitorio, prevalece lo recibido por Hacienda (regla 11.2).
- Un documento invalidado deja sin valor la representación gráfica entregada (regla 10.1).

## 7. Clase por campo

Leído de las páginas 48 a 56, 59 a 68 y 70 a 80 del PDF de la Normativa. La columna "Documentos" indica a qué tipos aplica el campo. Los nombres de campo son los que deben conservarse en la representación (regla G3).

### Identificación

| N°  | Nombre del campo       | Clase                   | Documentos                               |
| --- | ---------------------- | ----------------------- | ---------------------------------------- |
| 1   | Versión                | A                       | Todos                                    |
| 2   | Ambiente de destino    | C                       | Todos                                    |
| 3   | Tipo de documento      | A (colocar descripción) | Todos                                    |
| 4   | Código de Generación   | A                       | Todos                                    |
| 5   | Número de Control      | A                       | Todos                                    |
| 6   | Modelo de Facturación  | A (colocar descripción) | Todos                                    |
| 7   | Tipo de Transmisión    | A                       | Todos                                    |
| 8   | Tipo de Contingencia   | C                       | FE, CCFE, NRE, NCE, NDE, CRE, FEXE, FSEE |
| 9   | Motivo de Contingencia | C                       | Ídem                                     |
| 10  | Fecha de Generación    | A                       | Todos                                    |
| 11  | Hora de Generación     | A                       | Todos                                    |
| 12  | Tipo de Moneda         | C                       | Todos                                    |
| 13  | Fusiones y otros       | C                       | NCE, NDE, CRE, CLE                       |

### Documentos relacionados (sección: B/D)

| N°  | Nombre del campo                              | Clase                                     | Documentos                    |
| --- | --------------------------------------------- | ----------------------------------------- | ----------------------------- |
| 14  | Tipo de documento relacionado                 | A en NCE y NDE; B en CCFE, NRE, FE y FEXE | FE, CCFE, NRE, NCE, NDE, FEXE |
| 15  | Tipo de generación del documento relacionado  | C                                         | Ídem                          |
| 16  | Número de documento relacionado               | A en NCE y NDE; B en los demás            | Ídem                          |
| 17  | Fecha de generación del documento relacionado | A en NCE y NDE; B en los demás            | Ídem                          |

### Emisor (sección: A)

| N°  | Nombre del campo                                                 | Clase                                       | Documentos             |
| --- | ---------------------------------------------------------------- | ------------------------------------------- | ---------------------- |
| 18  | NIT (Emisor)                                                     | A                                           | Todos excepto CDE      |
| 19  | Tipo de documento de identificación (Emisor)                     | B                                           | CDE                    |
| 20  | Número de documento de identificación (Emisor)                   | A                                           | CDE                    |
| 21  | NRC (Emisor)                                                     | A en CCFE, CLE, DCLE y FEXE; B en los demás | Todos                  |
| 22  | Nombre (Emisor)                                                  | A                                           | Todos                  |
| 23  | Código de actividad económica (Emisor)                           | C                                           | Todos                  |
| 24  | Actividad económica (Emisor)                                     | A                                           | Todos                  |
| 25  | Nombre comercial (Emisor)                                        | B                                           | Todos excepto FSEE     |
| 26  | Dirección Departamento (Emisor)                                  | A                                           | Todos                  |
| 27  | Dirección Municipio (Emisor)                                     | A                                           | Todos                  |
| 28  | Dirección Distrito (Emisor)                                      | A                                           | Todos                  |
| 29  | Dirección complemento (Emisor)                                   | A                                           | Todos                  |
| 30  | Teléfono (Emisor)                                                | A                                           | Todos                  |
| 31  | Correo electrónico (Emisor)                                      | A                                           | Todos                  |
| 32  | Código del establecimiento asignado por el contribuyente         | C                                           | Todos excepto NCE, NDE |
| 33  | Código del Punto de Venta (Emisor) asignado por el contribuyente | C                                           | Ídem                   |
| 34  | Tipo de exportación                                              | C                                           | FEXE                   |
| 35  | Recinto fiscal                                                   | B                                           | FEXE                   |
| 36  | Tipo de Régimen                                                  | B                                           | FEXE                   |
| 37  | Régimen de exportación                                           | B                                           | FEXE                   |

### Receptor (sección: A)

| N°  | Nombre del campo                                 | Clase                                     | Documentos                                   |
| --- | ------------------------------------------------ | ----------------------------------------- | -------------------------------------------- |
| 38  | Tipo de documento de identificación (Receptor)   | A; C en FEXE                              | FE, NRE, NCE, NDE, CRE, CLE, FEXE, FSEE, CDE |
| 39  | Número de documento de identificación (Receptor) | A                                         | Ídem                                         |
| 40  | NIT (Receptor)                                   | A                                         | CCFE, DCLE                                   |
| 41  | NRC (Receptor)                                   | A; B en NRE, NCE, NDE, CRE y FE; C en CDE | FE, CCFE, NCE, NDE, NRE, CRE, CLE, DCLE, CDE |
| 42  | Nombre (Receptor)                                | A                                         | Todos                                        |
| 43  | Código de Actividad Económica (Receptor)         | C                                         | Todos excepto FEXE                           |
| 44  | Actividad Económica (Receptor)                   | A; B en CDE; C en FE y FSEE               | Todos                                        |
| 45  | Nombre Comercial (Receptor)                      | C                                         | CCFE, NRE, NCE, NDE, CRE, CLE, DCLE, FEXE    |
| 46  | Tipo de establecimiento (Receptor)               | A                                         | DCLE                                         |
| 47  | Dirección Departamento (Receptor)                | A; C en FE                                | Todos excepto FEXE                           |
| 48  | Dirección Municipio (Receptor)                   | A; C en FE                                | Ídem                                         |
| 49  | Dirección Distrito (Receptor)                    | A; C en FE                                | Ídem                                         |
| 50  | Dirección complemento (Receptor)                 | A; C en FE                                | Todos                                        |
| 51  | Código de país (receptor)                        | C                                         | FEXE, CDE                                    |
| 52  | País destino de la exportación (receptor)        | A                                         | FEXE                                         |
| 53  | Domicilio Fiscal                                 | C                                         | CDE, CLE                                     |
| 54  | Bienes Remitidos a Título de                     | A                                         | NRE                                          |
| 55  | Tipo de Receptor                                 | C                                         | FEXE                                         |
| 56  | Teléfono (Receptor)                              | C                                         | Todos                                        |
| 57  | Correo electrónico (Receptor)                    | B                                         | Todos                                        |

### Documentos asociados (sección: B/D), ventas y compras por cuenta de terceros

| N°      | Nombre del campo                                    | Clase       | Documentos                    |
| ------- | --------------------------------------------------- | ----------- | ----------------------------- |
| 58 a 64 | (documento asociado, médico)                        | No revisado | —                             |
| 65      | Modo de transporte                                  | B           | FEXE                          |
| 66      | Número de identificación del transporte             | B           | FEXE                          |
| 67      | Número de documento de identificación del conductor | C           | FEXE                          |
| 68      | Nombre y apellidos del conductor                    | C           | FEXE                          |
| —       | Sección "Ventas por cuenta de terceros"             | B/D         | —                             |
| 69      | NIT por cuenta de Terceros                          | B           | FE, CCFE, NRE, NCE, NDE, FEXE |
| 70      | Nombre del Tercero                                  | B           | Ídem                          |
| 71      | Domicilio Fiscal                                    | C           | Ídem                          |
| —       | Sección "Compra por cuenta de terceros"             | B           | —                             |
| 72      | Número de documento de identificación del Tercero   | B           | FEXE                          |
| 73      | Nombre del Tercero                                  | B           | FEXE                          |

### Cuerpo (sección: A)

| N°        | Nombre del campo                                                                                                                                                                             | Clase                          | Documentos                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------- |
| 74        | N° de ítem                                                                                                                                                                                   | A                              | Todos excepto DCLE                            |
| 75        | Tipo de ítem                                                                                                                                                                                 | C                              | FE, CCFE, NRE, NCE, NDE, FEXE, FSEE           |
| 76        | Tipo de donación                                                                                                                                                                             | C                              | CDE                                           |
| 77        | Depreciación                                                                                                                                                                                 | A                              | CDE                                           |
| 78        | Tipo de Documento Relacionado                                                                                                                                                                | A                              | CRE, CLE                                      |
| 79        | Tipo de generación del documento relacionado                                                                                                                                                 | C                              | CRE, CLE                                      |
| 80        | Número de documento relacionado                                                                                                                                                              | A en CRE y CLE; C en los demás | FE, CCFE, NRE, NCE, NDE, CRE, CLE, FEXE       |
| 81        | Fecha de Generación del Documento relacionado                                                                                                                                                | A                              | CRE, CLE                                      |
| 82        | Cantidad                                                                                                                                                                                     | A                              | FE, CCFE, NRE, NCE, NDE, FEXE, FSEE, CDE      |
| 83        | Código                                                                                                                                                                                       | B                              | Ídem                                          |
| 84        | Tributo sujeto a cálculo de IVA                                                                                                                                                              | C                              | FE, CCFE, NRE, NCE, NDE, FEXE                 |
| 85        | Unidad de Medida                                                                                                                                                                             | A                              | FE, CCFE, NRE, NCE, NDE, FEXE, CDE, FSEE      |
| 86        | Descripción                                                                                                                                                                                  | A; C en CRE                    | FE, CCFE, NCE, NDE, NRE, CRE, FEXE, FSEE, CDE |
| 87        | Precio Unitario                                                                                                                                                                              | A                              | FE, CCFE, NRE, NCE, NDE, FEXE, FSEE           |
| 88        | Valor Unitario                                                                                                                                                                               | A                              | CDE                                           |
| 89        | Descuento por ítem                                                                                                                                                                           | A                              | FE, CCFE, NRE, NCE, NDE, FEXE, FSEE           |
| 90        | Ventas no sujetas                                                                                                                                                                            | A                              | FE, CCFE, NRE, NCE, NDE, CLE                  |
| 91        | Ventas exentas                                                                                                                                                                               | A                              | Ídem                                          |
| 92        | Ventas gravadas                                                                                                                                                                              | A                              | FE, CCFE, NRE, NCE, NDE, CLE, FEXE            |
| 93        | Exportaciones                                                                                                                                                                                | A                              | CLE                                           |
| 94        | Valor donado                                                                                                                                                                                 | A                              | CDE                                           |
| 95        | Compras                                                                                                                                                                                      | A                              | FSEE                                          |
| 96        | Código del tributo                                                                                                                                                                           | C                              | FE, CCFE, NRE, NCE, NDE, CLE, FEXE            |
| 97        | Precio sugerido de venta                                                                                                                                                                     | C                              | FE, CCFE                                      |
| 98        | Cargos/abonos que no afectan la base imponible                                                                                                                                               | B                              | FE, CCFE, NCE, NDE, FEXE                      |
| 99        | IVA percibido                                                                                                                                                                                | B                              | NCE, NDE                                      |
| 100       | IVA 13%                                                                                                                                                                                      | B                              | NCE, NDE                                      |
| 101       | IVA retenido                                                                                                                                                                                 | B                              | NCE, NDE                                      |
| 102       | IVA por ítem                                                                                                                                                                                 | C                              | FE, CLE                                       |
| 103 a 109 | (campos de CRE, CLE y DCLE)                                                                                                                                                                  | No revisado                    | —                                             |
| 110       | Valor de las operaciones a liquidar                                                                                                                                                          | A                              | DCLE                                          |
| 111       | Valores no sujetos a percepción                                                                                                                                                              | B                              | DCLE                                          |
| 112       | Descripción del valor no sujeto a percepción                                                                                                                                                 | B                              | DCLE                                          |
| 113       | Observaciones por ítem                                                                                                                                                                       | B                              | CLE, DCLE                                     |
| 114 a 121 | Sub total, Monto sujeto a percepción sin IVA, IVA de las operaciones a liquidar, IVA percibido (2%), Comisión, Porcentaje de comisión, IVA de la comisión, Valor líquido a pagar al afiliado | A                              | DCLE                                          |
| 122       | Valor en letras                                                                                                                                                                              | C                              | DCLE                                          |

### Resumen (sección: A)

| N°  | Nombre del campo                                       | Clase                     | Documentos                          |
| --- | ------------------------------------------------------ | ------------------------- | ----------------------------------- |
| 123 | Total de operaciones no sujetas                        | A                         | FE, CCFE, NRE, NCE, NDE, CLE        |
| 124 | Total de operaciones exentas                           | A                         | Ídem                                |
| 125 | Total de operaciones gravadas                          | A                         | FE, CCFE, NRE, NCE, NDE, CLE, FEXE  |
| 126 | Total de operaciones de exportación                    | A                         | CLE                                 |
| 127 | Total de operaciones                                   | A                         | FSEE                                |
| 128 | Total de la donación                                   | A                         | CDE                                 |
| 129 | Suma de operaciones                                    | A                         | FE, CCFE, NCE, NDE, NRE, CLE        |
| 130 | Descuento global a ventas no sujetas                   | B                         | FE, CCFE, NRE                       |
| 131 | Descuento global a ventas exentas                      | B                         | FE, CCFE, NRE                       |
| 132 | Descuento global a ventas gravadas                     | B                         | FE, CCFE, NRE, FEXE                 |
| 133 | Descuento global al total de operaciones               | B                         | FSEE                                |
| 134 | Porcentaje de descuento                                | C                         | FE, CCFE, NRE, FEXE                 |
| 135 | Total de descuentos                                    | C                         | FE, CCFE, NRE, NCE, NDE, FEXE, FSEE |
| 136 | Resumen código del tributo                             | C                         | FE, CCFE, NRE, NCE, NDE, CLE, FEXE  |
| 137 | Nombre del tributo                                     | A en FEXE; B en los demás | Ídem                                |
| 138 | Valor del tributo                                      | A en FEXE; B en los demás | Ídem                                |
| 139 | Sub total                                              | A                         | FE, CCFE, NRE, FSEE                 |
| 140 | Total monto sujeto a retención                         | A                         | CRE                                 |
| 141 | IVA Percibido                                          | B                         | CCFE, CLE                           |
| 142 | IVA Retenido                                           | B                         | FE, CCFE                            |
| 143 | Total IVA Percibido                                    | B                         | NCE, NDE                            |
| 144 | Código retención MH                                    | C                         | NCE, NDE                            |
| 145 | Total IVA Retenido                                     | B                         | NCE, NDE                            |
| 146 | Total IVA 13%                                          | B                         | NCE, NDE                            |
| 147 | Retención renta                                        | B                         | FSEE                                |
| 148 | Seguro                                                 | C                         | FEXE                                |
| 149 | Flete                                                  | C                         | FEXE                                |
| 150 | Monto total de la operación                            | A                         | FE, CCFE, NRE, NCE, NDE, CLE, FEXE  |
| 151 | Total cargos / abonos que no afectan la base imponible | B                         | FE, CCFE, NCE, NDE, FEXE            |
| 152 | Transferencias de bienes no onerosas                   | C                         | FEXE                                |
| 153 | Total a Pagar                                          | A                         | FE, CCFE, NCE, NDE, FEXE, FSEE      |
| 154 | Total                                                  | A                         | CLE                                 |
| 155 | Total IVA retenido                                     | A                         | CRE                                 |
| 156 | Valor en letras                                        | C                         | Todos excepto DCLE                  |
| 157 | IVA 13%                                                | A en CRE; C en FE         | FE, CRE                             |
| 158 | Saldo a favor                                          | C                         | FE, CCFE, FEXE                      |
| 159 | Condición de la operación                              | A                         | FE, CCFE, NCE, NDE, CLE, FEXE, FSEE |
| 160 | Código de forma de pago                                | C                         | FE, CCFE, FEXE, FSEE, CDE           |
| 161 | Monto por forma de pago                                | C                         | Ídem                                |
| 162 | Referencia de modalidad de pago                        | C                         | Ídem                                |
| 163 | Plazo                                                  | C                         | FE, CCFE, FEXE, FSEE                |
| 164 | Período de plazo                                       | C                         | FE, CCFE, FEXE, FSEE                |
| 165 | Número de pago electrónico                             | C                         | FE, CCFE, NDE, FEXE                 |
| 166 | INCOTERMS                                              | C                         | FEXE                                |
| 167 | Descripción INCOTERMS                                  | C                         | FEXE                                |
| 168 | Observaciones                                          | C                         | Todos excepto DCLE y CDE            |

### Extensión, apéndice y sello

| N°        | Nombre del campo                                    | Clase | Documentos |
| --------- | --------------------------------------------------- | ----- | ---------- |
| —         | Sección "Extensión"                                 | A/C   | DCLE       |
| 169       | Nombre del responsable de generar el DTE            | A     | DCLE       |
| 170       | Documento de identificación de quien genera el DTE  | A     | DCLE       |
| 171       | Código de empleado responsable de la liquidación    | C     | DCLE       |
| 172 a 174 | Apéndice: Nombre del campo, Descripción, Valor/dato | C     | Todos      |
| 175       | Sello de Recepción                                  | A     | Todos      |

Observaciones útiles sobre la tabla:

- "Valor en letras" es clase C, aunque aparece en los diseños sugeridos del Manual Funcional.
- Los campos de pago (160 a 165) son clase C: no es obligatorio mostrarlos, pero la condición de la operación (159) sí.
- "Ambiente de destino" es clase C; la advertencia de ambiente de pruebas es una obligación aparte (sección 5).

## 8. Representación gráfica de eventos

- Los eventos de **invalidación y retorno** se entregan al receptor con su representación gráfica (Normativa 2.0, reglas 6 y 13.3.1).
- Las clases A/B/C/D de cada campo están en la columna "Representación Gráfica" del Anexo III (regla 11.3).
- Clases confirmadas en la sección de identificación del evento (Anexo III, campos 1 a 7): Versión A; Ambiente de destino C; Modelo de facturación A con descripción; Tipo de transmisión A con descripción; Tipo de contingencia C; Motivo de contingencia C; Código de generación A.
- El sello de recepción del evento debe incluirse en su representación gráfica (Manual Funcional, sección VI).

Elementos del diseño sugerido para el evento de invalidación (Manual Funcional, sección XXII, numeral 12):

- [ ] Título "EVENTO DE INVALIDACIÓN" y versión.
- [ ] Código de generación, fecha y hora del evento, sello de recepción del evento.
- [ ] Identificación del emisor: nombre, NIT, teléfono, correo electrónico.
- [ ] Identificación del receptor: nombre, tipo y número de documento de identificación, correo electrónico.
- [ ] Motivo: tipo de invalidación, motivo, nombre y documento de quien solicita el evento, nombre y documento de quien realiza el evento.
- [ ] Documento o evento a invalidar: tipo, código de generación, sello de recepción, número de control, fecha de generación.
- [ ] Código de generación que reemplaza al invalidado.

El campo "Tipo de doc. de Identificación" es dinámico: se muestra el nombre del tipo de documento seleccionado, por ejemplo "Pasaporte", con su número al lado (Manual Funcional, sección XXII, nota del numeral 1).

Las clases por campo del resto del Anexo III (retorno, contingencia, operaciones especiales) no se revisaron una por una.

## 9. Entrega por sitio de descarga

Cuando el receptor no da datos de contacto y se le entrega un acceso a un sitio de descarga, el comprobante que se le facilita debe incluir como mínimo (Normativa 2.0, Anexo I, regla 4):

- [ ] Nombre, denominación o razón social y NIT del emisor.
- [ ] Modelo y tipo de transmisión.
- [ ] Hora y fecha de la transacción.
- [ ] Código de generación y sello de recepción.
- [ ] Código QR que enlace a la dirección del sitio o ruta de descarga del receptor.
- [ ] Una breve instrucción de acceso.

Este QR de descarga es distinto del QR de consulta pública de la sección 4. El sitio debe permitir acceso seguro y exclusivo tanto al Archivo DTE como a la representación gráfica (regla 11).

## 10. Pruebas recomendadas para un generador de PDF

Recomendaciones de este proyecto, derivadas de las reglas anteriores:

1. Cada valor mostrado se toma del JSON firmado, sin recalcular (G5).
2. Todo campo clase A del tipo de documento está presente; todo campo o sección clase D sin dato muestra su rótulo con guion.
3. Los rótulos coinciden con los nombres de campo de los Anexos (G3).
4. Con `ambiente = 00` se imprime la advertencia de ausencia de valor legal y el QR usa `ambiente=00`.
5. Con tipo de transmisión 2 se muestra "contingencia" y no se imprime un sello inexistente.
6. El archivo se nombra con el código de generación en mayúsculas.
7. Una FE sin receptor identificado se representa sin datos inventados.
8. Documentos con el máximo de ítems (2000) paginan correctamente.

## 11. Puntos no confirmados

- Clases de los campos 58 a 64 y 103 a 109 del Anexo II: no revisados.
- Clases por campo del Anexo III más allá de la identificación del evento: no revisadas.
- Texto literal de las leyendas de pruebas y contingencia: la Normativa no lo prescribe.
- Tamaño mínimo, posición o nivel de corrección del código QR: no se encontró ninguna especificación.
- Obligación expresa de reemitir la representación gráfica al obtener el sello tras una contingencia: no encontrada; ver sección 6.
- URL exacta del QR: transcrita de OCR con correcciones; verificar contra el PDF del Manual Técnico, sección 5.
