# Cómo ser emisor de DTE: de cero a producción

> **Aviso.** Este documento es un resumen para desarrolladores, no asesoría legal ni tributaria. Fue elaborado a partir de los manuales oficiales del Ministerio de Hacienda de El Salvador (parte del material fuente es texto OCR). Los pasos se realizan en pantallas de Hacienda que pueden cambiar; ante cualquier diferencia prevalecen los documentos oficiales publicados en <https://factura.gob.sv>.

Esta guía cubre la plataforma **Sistema de Transmisión** (el contribuyente integra su propio software por API), que es la que usa este proyecto. La otra plataforma, el Sistema de Facturación, es el portal gratuito de Hacienda para quienes emiten en promedio 500 documentos mensuales o menos (Guía de Incorporación, sección II.2).

Fuentes citadas:

| Abreviatura              | Documento                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Guía de Incorporación    | Guía del Proceso de Incorporación para ser Emisor de DTE (v1.3, 12/2025)                  |
| Manual de Solicitud      | Manual de usuario para la Solicitud de Ingreso al Ambiente para Pruebas (v2.1, 09/2026)   |
| Manual de Acreditamiento | Manual de Acreditamiento y Obtención de Certificado de Firma Electrónica (v1.1)           |
| Manual Funcional         | Manual Funcional del Sistema de Transmisión (V2.0)                                        |
| Manual Técnico           | Manual Técnico para la Integración Tecnológica del Sistema de Transmisión (V2.0, 05/2026) |
| Manual de Autorización   | Manual para la obtención de la Autorización como Emisor de DTE (v1.0, 05/2026)            |
| Manual del Sitio         | Manual de Usuario del Sitio de Emisores DTE (1.4)                                         |
| Normativa 2.0            | Normativa de Cumplimiento de los DTE, Versión 2.0                                         |

## Resumen del recorrido

| Paso | Qué se obtiene                                                                  | Dónde                                            | Fuente                                |
| ---- | ------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------- |
| 0    | Software listo y usuario de servicios en línea de la DGII                       | Local / portal DGII                              | Guía de Incorporación, sección IV     |
| 1    | Acceso al ambiente para pruebas (2 meses)                                       | factura.gob.sv → Ingresar → Solicitud de Ingreso | Manual de Solicitud                   |
| 2    | Certificado de firma de pruebas (`.crt`), claves y contraseña de API de pruebas | Sitio Emisores DTE, ambiente para pruebas        | Manual de Acreditamiento, sección 2.1 |
| 3    | Pruebas mínimas cumplidas                                                       | API de pruebas                                   | Manual Funcional, sección XXIV        |
| 4    | Autorización como emisor                                                        | Sitio Emisores DTE → Solicitar Autorización      | Manual de Autorización                |
| 5    | Certificado y contraseña de API de producción                                   | Sitio Emisores DTE, ambiente productivo          | Manual de Acreditamiento, sección 2.2 |
| 6    | Emisión con valor legal                                                         | API de producción                                | Guía de Incorporación, sección IV     |

Los seis pasos numerados 1 a 6 son los que define la Guía de Incorporación (sección IV). El paso 0 es el requisito previo que la misma guía marca como importante.

## Paso 0. Antes de solicitar nada

1. **Tener el software desarrollado.** Los usuarios del Sistema de Transmisión deben desarrollar su solución de facturación **antes** de iniciar el paso 1 (Guía de Incorporación, sección IV). El plazo de pruebas empieza a correr al ingresar al ambiente y no se detiene.
2. **Tener usuario de los servicios en línea de la DGII** (NIT y contraseña). Si no existe, se registra en <https://portaldgii.mh.gob.sv/ssc/home> (Manual de Solicitud, sección 2).
3. **Decidir qué documentos se emitirán.** El contribuyente debe adoptar todos los DTE que su operación requiere, es decir, los mismos documentos que ya tiene autorizados (Guía de Incorporación, sección II.1).
4. **Eventos obligatorios.** En el Sistema de Transmisión deben implementarse los eventos de invalidación y de contingencia (Guía de Incorporación, sección II.1).
5. **Revisar la infraestructura.** TLS 1.2 o superior, y despliegue en jurisdicciones con tratados de extradición y asistencia legal mutua vigentes con El Salvador (Manual Técnico, sección 6.4).

Si la operación requiere Documento Contable de Liquidación, la única plataforma posible es el Sistema de Transmisión (Manual de Solicitud, sección 6).

## Paso 1. Solicitud de ingreso al ambiente para pruebas

Fuente: Manual de Solicitud, secciones 1 a 9.

1. En <https://factura.gob.sv> elegir "Ingresar" y luego "Solicitud de Ingreso".
2. Identificarse con el NIT (o DUI) y la contraseña de servicios en línea de la DGII.
3. Leer la pantalla de plazos.
4. Elegir el tipo de solicitud:
   - **Nueva solicitud**: primera vez, o plazo de pruebas vencido.
   - **Sistema de Transmisión Ajustes/Agregar DTE**: emisor ya autorizado en producción que necesita un nuevo DTE o evento.
   - **Cambio de plataforma**: migrar entre Sistema de Facturación y Sistema de Transmisión.
5. Marcar todos los documentos tributarios que se emiten actualmente e indicar si la suma supera 500 documentos mensuales.
6. Elegir la plataforma: **Sistema de Transmisión DTE**.
7. Registrar el contacto designado (todos los campos son obligatorios): NIT de la persona (14 dígitos, o 9 si está homologado, sin guiones), nombre, cargo, teléfono y correo.
8. Ingresar el código de verificación que llega al correo del contacto.
9. La aprobación se muestra en pantalla con la **fecha de vencimiento** del acceso y se envía por correo.

Plazos:

| Plataforma             | Plazo para completar las pruebas | Fuente                                                              |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------- |
| Sistema de Transmisión | **2 meses**                      | Manual de Solicitud, sección 3; Guía de Incorporación, sección II.1 |
| Sistema de Facturación | 15 días                          | Manual de Solicitud, sección 3                                      |

- El plazo corre desde que el contribuyente ingresa al ambiente para pruebas. Es un solo plazo para todos los documentos y eventos, no uno por tipo (Manual de Solicitud, sección 3).
- Si no se termina a tiempo, hay que reenviar la solicitud, con justificación (Manual de Solicitud, sección 3; Guía de Incorporación, sección II.1).
- La información que Hacienda envía es confidencial y va dirigida al contacto designado (Manual de Solicitud, sección a).

## Paso 2. Acreditamiento, certificado de firma y credenciales de API (pruebas)

Fuente: Manual de Acreditamiento, secciones 1 y 2.1.

Ingresar al Sitio Emisores DTE con NIT y contraseña de la DGII, eligiendo "Ambiente para Pruebas". La primera vez el sistema dirige al proceso de acreditamiento:

1. **Verificación de información.** Se muestran los datos del contribuyente según el RUC.
2. **Generación de certificado.** Se completa el correo electrónico (y la unidad responsable y el representante legal o apoderado, en personas jurídicas) y se personalizan dos claves:
   - Clave pública del certificado de firma simple.
   - **Clave privada del certificado de firma simple.** Es la contraseña que luego pide el firmador.
3. **Selección de DTE y eventos, y contraseña de API.** Se aceptan los términos y condiciones y se personaliza la contraseña de acceso API. Luego "Acreditar Contribuyente".
4. **Resumen y descarga.** "Descargar Información" genera un PDF. "Descargar Certificados" pide la clave pública y la clave privada (esta última dos veces) y descarga las llaves y el certificado.

### Reglas de las claves del certificado

Manual de Acreditamiento, sección 2.1, paso 2:

- De 8 a 30 caracteres alfanuméricos.
- Al menos una letra mayúscula.
- Al menos un carácter especial.
- Sin tres letras secuenciales, sin tres números secuenciales y sin tres letras de teclado secuenciales.
- Sin espacios en blanco.

Ambas claves deben guardarse: se usan en el resto del proceso y en la emisión.

### Credenciales de API

| Dato                         | Valor                                                                                                                        | Fuente                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Usuario                      | El NIT del contribuyente                                                                                                     | Manual de Acreditamiento, sección 2.1, paso 3            |
| Contraseña                   | La contraseña de acceso API personalizada en el acreditamiento                                                               | Manual de Acreditamiento, sección 2.1, paso 3            |
| Formato de la contraseña     | Letras, números y un carácter especial; **entre 13 y 25 caracteres**                                                         | Manual Técnico, sección 1.1                              |
| Vencimiento de la contraseña | No vence; puede cambiarse a demanda en el Sitio Emisores DTE, opción "Gestión de Usuario API"                                | Manual Técnico, sección 1.1; Manual del Sitio, sección 9 |
| Token                        | Se obtiene enviando usuario y contraseña al servicio de autenticación. Vigencia: 48 horas en pruebas, 24 horas en producción | Manual Técnico, secciones 1.1 y 3                        |

> **Diferencia entre manuales.** El Manual de Acreditamiento describe para la contraseña de API las mismas reglas que para las claves del certificado (8 a 30 caracteres, una mayúscula, un carácter especial, sin secuencias). El Manual Técnico indica 13 a 25 caracteres. Una contraseña de 13 a 25 caracteres con mayúscula, número y carácter especial, sin secuencias ni espacios, cumple ambas descripciones.

### Certificado y firmador

- El certificado descargado es un archivo `.crt` cuyo nombre incluye el NIT (el Manual Técnico muestra `NUMERO_NIT.crt`; el Manual de Acreditamiento muestra `Certificado_<NIT>.crt`) (Manual Técnico, sección 2.1; Manual de Acreditamiento, sección 3.3).
- Se instala en el firmador. Hacienda entrega un firmador de referencia en tres modalidades: proyecto Java Spring Boot, contenedor Docker (con y sin SSL) y servicio de Windows (Manual Técnico, sección 2).
- El firmador de referencia recibe por `POST` el NIT, un indicador `activo`, `passwordPri` (la contraseña de la llave privada) y `dteJson` (el documento a firmar), y devuelve el documento firmado (Manual Técnico, sección 2.2).
- El certificado solo puede usarse para firmar documentos y eventos destinados a la DGII (Manual de Acreditamiento, sección 3.3; Normativa 2.0, regla 8).
- Si se olvida o se compromete la clave privada, se cancela el certificado y se genera uno nuevo desde el menú "Certificado" del Sitio Emisores DTE (Manual de Acreditamiento, sección 3.4).
- Vigencia del certificado en años: no confirmada en los manuales revisados.

Custodia: las credenciales de API y las claves de firma son exclusivas del contribuyente, que asume el riesgo de compartirlas (Normativa 2.0, regla 9.2). No deben guardarse en el repositorio ni en texto plano.

### Establecimientos y puntos de venta

El número de control usa códigos de establecimiento y punto de venta asignados por Hacienda (Normativa 2.0, Anexo I, regla 1.3). Se consultan y configuran en el Sitio Emisores DTE, opción "Consultar Establecimientos", donde se codifican los puntos de venta de cada establecimiento (Manual del Sitio, sección 7.4).

## Paso 3. Pruebas mínimas

Fuente: Manual Funcional, sección XXIV.

| N°  | Documento                               | Pruebas satisfactorias mínimas |
| --- | --------------------------------------- | ------------------------------ |
| 1   | Factura (FE)                            | 90                             |
| 2   | Comprobante de Crédito Fiscal (CCF)     | 75                             |
| 3   | Nota de Remisión (NR)                   | 50                             |
| 4   | Nota de Crédito (NC)                    | 50                             |
| 5   | Nota de Débito (ND)                     | 25                             |
| 6   | Comprobante de Retención (CR)           | 50                             |
| 7   | Comprobante de Liquidación (CL)         | 75                             |
| 8   | Documento Contable de Liquidación (DCL) | 50                             |
| 9   | Factura de Exportación (FEX)            | 90                             |
| 10  | Factura de Sujeto Excluido (FSE)        | 25                             |
| 11  | Comprobante de Donación (CD)            | 25                             |

| Evento                 | Pruebas satisfactorias mínimas |
| ---------------------- | ------------------------------ |
| Invalidación           | 5                              |
| Contingencia           | 5                              |
| Retorno                | 5                              |
| Operaciones especiales | 5                              |

Reglas de conteo y alcance:

- Solo cuentan los DTE y eventos **transmitidos exitosamente**, es decir, los que obtuvieron sello de recepción (Manual de Solicitud, sección 3).
- Solo hay que probar los tipos de documento que se solicitarán; el Sitio Emisores DTE mide el avance (Manual de Acreditamiento, sección 2.2).
- Para la autorización son indispensables las pruebas del evento de **invalidación** y, en el Sistema de Transmisión, también las del evento de **contingencia** (Manual de Autorización, Procedimiento y paso 1).
- Los documentos del ambiente de pruebas carecen de valor legal y su representación gráfica debe advertirlo (Normativa 2.0, reglas 9.1 y 11.3).
- Las pruebas usan el ambiente `00`; nunca deben enviarse DTE de prueba a producción (Manual Técnico, sección 6.3).

Qué conviene ejercitar durante las pruebas (recomendación de este proyecto, no requisito oficial):

- Los casos que las fuentes describen de forma contradictoria: pagos con condición crédito, versión del evento de contingencia y plazos de invalidación (ver `normativa-2.0.md`, sección 20).
- El flujo completo de contingencia: documentos con modelo 2 y tipo de transmisión 2, evento de contingencia y envío por lote (Manual Técnico, sección 3.2).
- La política de reintentos: 8 segundos de espera, consulta de estado, máximo 2 reenvíos (Manual Técnico, sección 3.3).
- Invalidación tipo 1 o 3 (con documento de reemplazo) y tipo 2 (sin reemplazo) (Manual Funcional, sección VII).

Horario de recepción de lotes en pruebas: 08:00 a 17:00, con un máximo de 100 DTE por lote (Manual Técnico, sección 3.4).

## Paso 4. Solicitud de autorización como emisor

Fuente: Manual de Autorización, Procedimiento y pasos 1 a 7.

Requisito: haber finalizado las pruebas mínimas de los DTE, del evento de invalidación y, en el Sistema de Transmisión, del evento de contingencia.

1. Ingresar al Sitio Emisores DTE con NIT y contraseña de la DGII, en "Ambiente para Pruebas", y abrir "Solicitar Autorización".
2. Seleccionar los tipos de DTE y eventos a autorizar. Solo aparecen los que ya cumplieron las pruebas mínimas.
3. Completar los datos de notificación: persona que presenta la solicitud (contribuyente, representante legal o apoderado registrado en el RUC), correo y teléfono personal, y **correo electrónico para recibir DTE**. El sistema indica si es una solicitud por primera vez o una ampliación.
4. Marcar la casilla de aceptación.
5. Revisar la solicitud generada y presionar "Presentar Solicitud".
6. Abrir el correo de confirmación (verificando que provenga del dominio `mh.gob.sv`) y entrar al enlace de autenticación de identidad.
7. La autorización se notifica por correo, con copia adjunta, al correo indicado y al registrado en el RUC. También puede descargarse en "Detalle de Emisor de DTE" → "Autorizaciones".

- El mismo procedimiento sirve para agregar documentos o eventos a una autorización existente (Manual de Autorización, paso 7).
- Las direcciones de correo registradas se usarán para notificaciones de facturación electrónica (Manual de Autorización, paso 2).

## Paso 5. Acreditamiento en producción

Fuente: Manual de Acreditamiento, sección 2.2.

- La credencial de firma para producción solo se habilita a quienes concluyeron las pruebas mínimas.
- Ingresar al Sitio Emisores DTE eligiendo "Ambiente Productivo" y **repetir los mismos pasos del acreditamiento de pruebas**.
- El certificado de firma y la contraseña de API se personalizan **por separado en cada ambiente**: los de pruebas no sirven en producción (Manual de Acreditamiento, sección 2).
- Al terminar, actualizar en el software el certificado y la credencial de API de producción.

Lista de cambios al pasar a producción:

| Elemento                                               | Pruebas            | Producción                              | Fuente                                |
| ------------------------------------------------------ | ------------------ | --------------------------------------- | ------------------------------------- |
| `identificacion.ambiente`                              | `00`               | `01`                                    | Normativa 2.0, Anexo IV, campo 2      |
| Certificado `.crt` y clave privada                     | Los de pruebas     | Los generados en el ambiente productivo | Manual de Acreditamiento, sección 2.2 |
| Contraseña de API                                      | La de pruebas      | La de producción                        | Manual de Acreditamiento, sección 2.2 |
| URL de los servicios                                   | Dominio de pruebas | Dominio de producción                   | Manual Técnico, sección 4             |
| Parámetro `ambiente` del código QR                     | `00`               | `01`                                    | Manual Técnico, sección 5             |
| Vigencia del token                                     | 48 horas           | 24 horas                                | Manual Técnico, sección 3             |
| Horario de lotes                                       | 08:00 a 17:00      | 22:00 a 05:00 (contingencia: 24 horas)  | Manual Técnico, sección 3.4           |
| Leyenda "sin valor legal" en la representación gráfica | Obligatoria        | No aplica                               | Normativa 2.0, regla 11.3             |

## Paso 6. Inicio de operaciones

- El ambiente productivo queda disponible desde la fecha de inicio de obligatoriedad o, en la incorporación voluntaria, desde el día siguiente a la notificación de la autorización (Guía de Incorporación, glosario).
- El emisor tiene **hasta un mes**, contado desde el día siguiente a la autorización, para iniciar la emisión, sin exceder la fecha de inicio de su obligación (Normativa 2.0, regla 2.2).
- Una vez implementados los DTE **no puede usarse** documentación preimpresa por imprenta, formulario único ni sistemas de emisión mediante imprentas digitales (Guía de Incorporación, sección II.1).
- Deben informarse, en el formulario que establezca Hacienda, los documentos preimpresos autorizados, y presentar los que queden en inventario para su anulación y destrucción (Guía de Incorporación, sección II.1).
- Desde el 1 de enero de 2025 los emisores de DTE no pueden usar tiquetes (Normativa 2.0, regla 15).

## Agregar documentos después

Para emitir un tipo de documento o evento nuevo estando ya en producción: tipo de solicitud "Sistema de Transmisión Ajustes/Agregar DTE" (Manual de Solicitud, sección 4), completar sus pruebas mínimas y repetir la solicitud de autorización (Manual de Autorización, paso 7).

## Puntos no confirmados

- Vigencia en años del certificado de firma: no aparece en los manuales revisados.
- Regla exacta de la contraseña de API (13 a 25 frente a 8 a 30 caracteres): los manuales difieren; ver el paso 2.
- Las URL de los servicios no se transcriben aquí porque el texto OCR del Manual Técnico las reproduce con errores; deben tomarse del PDF original, sección 4.
- No se describe ningún costo del proceso en los manuales revisados.
