# Normativa 2.0 para desarrolladores

> **Aviso.** Este documento es un resumen para desarrolladores, no asesoría legal ni tributaria. Fue elaborado a partir de la "Normativa de Cumplimiento de los Documentos Tributarios Electrónicos, Versión 2.0" (Ministerio de Hacienda, 25 de mayo de 2026) y de los manuales oficiales que la acompañan. Parte del material fuente es texto OCR; lo que no pudo confirmarse contra el PDF original se marca como **no confirmado (OCR ilegible)**. Ante cualquier diferencia prevalecen los documentos oficiales publicados en <https://factura.gob.sv>.

Convención de citas:

- `(Normativa 2.0, regla X)` = cuerpo principal de la Normativa.
- `(Normativa 2.0, Anexo I, regla X)` = especificaciones tecnológicas.
- `(Normativa 2.0, Anexo IV, campo N)` / `(Anexo V, campo N)` = validaciones de DTE / de eventos.
- `(Manual Funcional, sección X)` = Manual Funcional del Sistema de Transmisión V2.0.
- `(Manual Técnico, sección X)` = Manual Técnico para la Integración Tecnológica del Sistema de Transmisión V2.0.

## Contenido

1. [Alcance y conceptos](#1-alcance-y-conceptos)
2. [Obligaciones del emisor](#2-obligaciones-del-emisor)
3. [Modalidades de emisión: previa y diferida](#3-modalidades-de-emisión-previa-y-diferida)
4. [Identificadores: código de generación y número de control](#4-identificadores-código-de-generación-y-número-de-control)
5. [Redondeo y holguras](#5-redondeo-y-holguras)
6. [Firma electrónica](#6-firma-electrónica)
7. [Transmisión, plazos y tolerancias de fecha](#7-transmisión-plazos-y-tolerancias-de-fecha)
8. [Sello de recepción, rechazos y estados](#8-sello-de-recepción-rechazos-y-estados)
9. [Límites de tamaño](#9-límites-de-tamaño)
10. [Receptor en la Factura y campos de pago](#10-receptor-en-la-factura-y-campos-de-pago)
11. [Contingencia](#11-contingencia)
12. [Invalidación](#12-invalidación)
13. [Retorno](#13-retorno)
14. [Operaciones especiales](#14-operaciones-especiales)
15. [Entrega al receptor](#15-entrega-al-receptor)
16. [Conservación y resguardo](#16-conservación-y-resguardo)
17. [Seguridad e infraestructura](#17-seguridad-e-infraestructura)
18. [Sanciones y consecuencias](#18-sanciones-y-consecuencias)
19. [Qué cambió respecto a versiones anteriores](#19-qué-cambió-respecto-a-versiones-anteriores)
20. [Discrepancias entre fuentes y puntos no confirmados](#20-discrepancias-entre-fuentes-y-puntos-no-confirmados)

---

## 1. Alcance y conceptos

- La Normativa es de **estricto cumplimiento** para los emisores de DTE y eventos; su incumplimiento habilita las facultades sancionatorias de la Administración Tributaria (Normativa 2.0, considerando IV y regla 2).
- Sujetos emisores: contribuyentes de IVA, agentes de retención designados y emisores de comprobantes de donación (Normativa 2.0, regla 2.1). Quien emite voluntariamente sin haber sido notificado queda igualmente obligado (regla 2.1.1.1).
- Tras la autorización, el usuario del Sistema de Transmisión tiene **hasta un mes** (contado desde el día siguiente) para iniciar la emisión, sin exceder la fecha de inicio de su obligación (regla 2.2).

Documentos (regla 4): CCFE, FE, FEXE, NRE, NCE, NDE, CLE, CRE, DCLE, FSEE y CDE.

Eventos (regla 4): invalidación, contingencia, retorno y operaciones especiales.

Definiciones útiles (regla 3):

| Término                                | Significado para el software                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Archivo DTE                            | Archivo `.json` con la estructura de datos, la firma y el sello de recepción; se identifica con el código de generación. |
| Fecha de generación / fecha del evento | Fecha en que se realiza la operación u ocurre el evento. No es la fecha de transmisión.                                  |
| Fecha de transmisión                   | Fecha en que se envía a Hacienda.                                                                                        |
| Gestor de Facturación Electrónica      | El sistema del contribuyente (lo que este proyecto ayuda a construir).                                                   |
| Sello de recepción                     | Código que acredita la transmisión y recepción correctas. No valida la operación.                                        |
| Estado transitorio                     | Documento firmado, aún sin sello, dentro del plazo de transmisión.                                                       |

Las versiones de esquema vigentes se listan en la sección [19](#19-qué-cambió-respecto-a-versiones-anteriores).

## 2. Obligaciones del emisor

1. **Obtener autorización y certificado antes de emitir** (Normativa 2.0, regla 6). Ver `ser-emisor.md`.
2. **Emitir todos los tipos de DTE que su operación requiere**, en todos sus establecimientos (regla 2.2).
3. **Ingresar datos correctos**; el emisor responde por datos inexactos o incompletos (regla 7.1).
4. **Usar los catálogos oficiales**; su uso es obligatorio (Anexo I, regla 1.8).
5. **Transmitir en orden lógico**: el documento afectado se transmite antes que el que lo ajusta, disminuye o invalida. Aplica uno a uno o por lote para DTE, retorno y operaciones especiales; invalidación y contingencia solo uno a uno (regla 9.2).
6. **Custodiar credenciales**: acceso al Sitio Emisores DTE, credenciales API y claves de firma son exclusivas del sujeto pasivo, que asume el riesgo de compartirlas (regla 9.2).
7. **Entregar al receptor** el Archivo DTE y su representación gráfica (regla 11). La entrega **no puede diferirse ni retenerse por falta de pago** (regla 11).
8. **Conservar** los documentos sin alteración (regla 12).
9. **No abusar de las plataformas**: Hacienda puede pausar preventivamente el acceso a los servicios de recepción (regla 2.1.2).
10. **No emitir tiquetes**: desde el 1 de enero de 2025 los emisores de DTE no pueden usar documentos equivalentes (tiquetes) y deben emitir Factura Electrónica a consumidores finales (regla 15).

La responsabilidad es siempre del contribuyente emisor aunque el software sea de terceros (Anexo I, regla 1.1).

Módulos que el sistema debe tener (Anexo I, regla 5): generación, firmado, transmisión y entrega.

## 3. Modalidades de emisión: previa y diferida

| Modalidad                                 | Orden de pasos                                                                          | Autorización                                                      | Envío             | Fuente                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------- | ------------------------ |
| Transmisión previa normal (regla general) | generar → firmar → transmitir → sello → entregar                                        | No requiere                                                       | Uno a uno o lote  | Normativa 2.0, regla 6.1 |
| Transmisión diferida normal (excepción)   | generar → firmar → entregar en estado transitorio → transmitir                          | **Resolución previa** de Hacienda, con prueba de la imposibilidad | **Solo por lote** | regla 6.2                |
| Transmisión diferida por contingencia     | generar → firmar → entregar en estado transitorio → evento de contingencia → transmitir | No requiere resolución                                            | Uno a uno o lote  | regla 6.3                |

Valores de identificación:

- Operación normal: modelo de facturación `1` (previo) con tipo de transmisión `1` (normal); `tipoContingencia` y `motivoContin` en `null` (Normativa 2.0, Anexo IV, campos 6 a 9).
- Contingencia: modelo `2` y tipo de transmisión `2`; `tipoContingencia` del 1 al 5 (CAT-005); `motivoContin` obligatorio si el tipo es 5 (Anexo IV, campos 6 a 9).

Un DTE se tiene por **emitido** cuando fue generado, firmado, transmitido, tiene sello y fue entregado al receptor. Un evento se tiene por transmitido cuando tiene sello; los de invalidación y retorno además deben entregarse al receptor con su representación gráfica (regla 6).

Estado transitorio (regla 9.3): debe registrarse contablemente; si Hacienda lo rechaza, la operación debe corregirse con un nuevo documento que sí obtenga sello.

## 4. Identificadores: código de generación y número de control

### Código de generación

- UUID versión 4, 36 caracteres (32 hexadecimales + 4 guiones, grupos 8-4-4-4-12), **en mayúsculas** (Normativa 2.0, Anexo I, regla 1.2; Anexo IV, campo 4).
- Aleatorio, no correlativo ni predecible (regla 7.1.1).
- El nombre del archivo JSON, del archivo del evento y de la representación gráfica digital **es el código de generación** más la extensión: `<UUID>.json`, `<UUID>.pdf`, `<UUID>.png` (Anexo I, regla 1.2).

### Número de control

Formato `DTE-00-00000000-000000000000000`, 31 caracteres (Anexo I, regla 1.3; Anexo IV, campo 5):

| Sección | Contenido                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1       | Literal `DTE`                                                                                                                                                                              |
| 2       | Código de tipo de documento (CAT-002), 2 dígitos                                                                                                                                           |
| 3       | 4 caracteres de establecimiento + 4 de punto de venta, asignados por Hacienda. Establecimiento: letra `M`, `B`, `S` o `P` + 3 números. Punto de venta: `P` + 3 números (Anexo IV, campo 5) |
| 4       | Consecutivo de 15 dígitos, de 1 a 999999999999999                                                                                                                                          |

Reglas del consecutivo (regla 7.1.2):

- **Centralizado** (una sola secuencia) o **por establecimiento** (una secuencia por cada uno).
- **No** puede llevarse por punto de venta ni por tipo de documento, salvo resolución expresa de Hacienda.
- Se **reinicia en 000000000000001** con el primer DTE de cada ejercicio impositivo; no puede repetirse entre el 1 de enero y el 31 de diciembre (Anexo IV, campo 5).

> Nota: la prohibición de numerar "por tipo de documento" convive con que el tipo de documento forma parte del número de control. No se encontró aclaración adicional en los textos revisados; conviene confirmarlo con Hacienda antes de fijar el diseño de secuencias.

## 5. Redondeo y holguras

| Sección           | Decimales máximos | Regla                                    | Fuente                      |
| ----------------- | ----------------- | ---------------------------------------- | --------------------------- |
| Cuerpo (por ítem) | 8                 | Si el 9.º decimal es ≥ 5, el 8.º sube 1  | Normativa 2.0, regla 7.2 a) |
| Resumen           | 2                 | Si el 3.er decimal es ≥ 5, el 2.º sube 1 | regla 7.2 b)                |

- Redondeo "half up": 1.124 → 1.12; 1.125 → 1.13; 1.126 → 1.13 (regla 7.2).
- **Holgura: ± 0.01** en los campos numéricos (regla 7.3). Las validaciones de totales repiten esa holgura campo a campo (por ejemplo Anexo IV, campos 150, 151, 153, 157).
- Los campos del resumen se calculan **a partir de los valores por ítem ya redondeados a 8 decimales**, no de los valores internos del sistema (regla 7.3).
- Los campos por ítem tienen formato 11.8 (11 enteros, 8 decimales) y los del resumen 11.2 (Manual Funcional, sección XXI; Anexo II, columna Longitud).

## 6. Firma electrónica

- Estándar **JWS** (JSON Web Signature) (Normativa 2.0, regla 8; Anexo I, regla 2.1). El Cuadro 10 del Anexo I describe el estándar de firmado como "CAdES - PKCS8EncodedKeySpec" con algoritmo "RSA512"; en la práctica el resultado es un JWS compacto con cabecera `RS512`.
- Firma electrónica simple, con certificado emitido por Hacienda, que **solo** puede usarse para DTE y eventos (regla 8; Anexo I, regla 2.1).
- El emisor administra su propia infraestructura y software de firma (Anexo I, regla 2.1). Hacienda distribuye un firmador de referencia en Java (Manual Técnico, sección 2).
- Un documento firmado y no transmitido se presume generador de ingresos gravados (regla 8.1, citando art. 199 del Código Tributario).

## 7. Transmisión, plazos y tolerancias de fecha

### Plazos de transmisión de DTE (Normativa 2.0, regla 9, Cuadro 4)

| Modalidad             | Plazo                                                        | Documentos                               |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Normal previa         | Antes de la entrega al receptor                              | Todos                                    |
| Normal diferida       | Hasta **un día posterior** a la generación y entrega         | CCFE, NCE, NDE, NRE, CRE, FE, FEXE, FSEE |
| Contingencia diferida | Hasta **72 horas** desde el sello del evento de contingencia | CCFE, NCE, NDE, NRE, CRE, FE, FEXE, FSEE |

CLE, DCLE y CDE **no** pueden emitirse en diferido ni en contingencia.

### Plazos de transmisión de eventos (regla 9, Cuadro 5)

| Modalidad             | Plazo                                                             | Eventos      |
| --------------------- | ----------------------------------------------------------------- | ------------ |
| Normal previa         | Antes de la entrega al receptor                                   | Todos        |
| Normal diferida       | Hasta un día posterior                                            | Solo retorno |
| Contingencia diferida | Retorno: hasta 72 horas desde el sello del evento de contingencia | Solo retorno |

> El Cuadro 5, fila 3, dice además: "Respecto del Evento de Invalidación, hasta 24 horas contadas a partir del cese de la situación…". Se confirmó contra el PDF que el texto dice "Invalidación", pero el plazo de 24 horas desde el cese corresponde al **evento de contingencia** según el Cuadro 7 y el Anexo V, campo 10. Se documenta tal cual; ver sección [20](#20-discrepancias-entre-fuentes-y-puntos-no-confirmados).

### Tolerancias sobre fecha y hora de generación (Normativa 2.0, Anexo IV, campos 10 y 11)

| Regla                            | Detalle                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Formato                          | Fecha `YYYY-MM-DD`; hora `HH:MM:SS` (24 horas)                                                                                                                                                                                       |
| Fecha anterior a la transmisión  | Se admite cualquier fecha que anteceda a la transmisión "en casos especiales" (FE, CCFE, NRE, NCE, NDE, CRE, CLE, DCLE, FEXE, CDE). Para FSEE, fecha que anteceda "a un período" respecto de la transmisión                          |
| Fecha posterior a la transmisión | Hasta **5 días posteriores** a la fecha de transmisión "en casos excepcionales", **sin pasar al siguiente período tributario**. Ejemplo oficial: transmitiendo el 27 de junio se acepta 28, 29 o 30 de junio, pero no 1 o 2 de julio |
| Último día del mes               | Holgura de **30 minutos** posteriores, por diferencia entre el reloj del contribuyente y el de Hacienda                                                                                                                              |

El Manual Técnico describe esta holgura de forma distinta: "se recibirán documentos con **un día posterior** a la fecha de transmisión, exceptuando el último día del período tributario, donde solo se permitirá 30 min" (Manual Técnico, sección 3.1). Ver sección [20](#20-discrepancias-entre-fuentes-y-puntos-no-confirmados). Recomendación práctica: generar con la fecha y hora reales de El Salvador y sincronizar el reloj (NTP); no depender de la holgura.

El servicio de recepción devuelve códigos específicos para esto: `17 FECHA NO ES CORRECTA`, `18 FECHA FUERA DE PLAZO PERMITIDO`, `32 DIFIERE DE LA FECHA DE ENVIO`, `34 EXCEDE HOLGURA DE 30 MINUTOS` (Manual Técnico, sección 4.2).

Moneda: siempre `USD` (Anexo IV, campo 12).

### Plazos legales entre documentos relacionados (Anexo IV, campo 17)

- FE, CCFE o FEXE que relacionan una NR: en el mismo período tributario de la NR, o a más tardar dentro de los **3 días siguientes** a ese período.
- FE o CCFE que relacionan un DCL: en el mismo período tributario del DCL.
- NCE o NDE que relacionan un CCF o CR: a más tardar dentro de **3 meses** desde la fecha de generación del CCF o CR, salvo excepciones legales.

### Política de reintentos y lotes (Manual Técnico, secciones 3.3 y 3.4)

- Umbral de espera: 8 segundos. Sin respuesta: consultar el estado; si no fue recibido, reenviar, **máximo 2 veces**; si sigue fallando, operar en contingencia.
- Lotes: máximo **100 DTE por lote**, hasta 400 lotes. Horario de recepción de lotes: pruebas 08:00 a 17:00; producción 22:00 a 05:00. Los lotes de contingencia se reciben las 24 horas.
- Token de autenticación: vigencia de 48 horas en pruebas y 24 horas en producción (Manual Técnico, sección 3).

## 8. Sello de recepción, rechazos y estados

- El sello es un código de **40 caracteres alfanuméricos, sin guiones, en mayúsculas** (Normativa 2.0, Anexo I, regla 3.4).
- Hacienda verifica cinco cosas antes de otorgarlo: estructura (Anexos II y III), formato JSON, firma, plazos de transmisión y validaciones (Anexos IV y V) (regla 10).
- **Rechazo**: debe corregirse dentro de **24 horas** desde la comunicación del motivo (regla 10).
- El documento corregido se retransmite con el **mismo código de generación**, salvo que el rechazo se deba precisamente a ese código (regla 10).
- Debe evitarse la retransmisión redundante una vez obtenida respuesta de recepción o rechazo (regla 10).
- Alterar el contenido después del sello se considera lesión al interés fiscal (regla 10).
- El sello no valida ni autoriza la operación documentada (regla 10).

Estados (regla 10.1):

| Estado                         | Significado                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Transmitido satisfactoriamente | Tiene sello. Condiciones: **ajustado** (afectado por otro documento o evento) u **observado** (con observaciones que no afectan su validez) |
| Rechazado                      | No obtuvo sello; se presume generado para documentar ingresos gravados                                                                      |
| Invalidado                     | Tuvo sello y luego se le aplicó un evento de invalidación; la representación gráfica entregada queda sin valor                              |
| Transitorio                    | Firmado, dentro del plazo de transmisión, sin sello todavía                                                                                 |

Declaración: los DTE y eventos se incorporan en la declaración de IVA según su **fecha de generación o fecha del evento**, no según la fecha del sello (regla 10.2).

## 9. Límites de tamaño

| Elemento                                                    | Límite                                                          | Fuente                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| Ítems del cuerpo (FE, CCFE, NRE, NCE, NDE, FEXE, FSEE, CDE) | 2000                                                            | Normativa 2.0, Anexo IV, campo 74         |
| Ítems del cuerpo (CRE, CLE)                                 | 500                                                             | Anexo IV, campo 74                        |
| Documentos relacionados                                     | 50, todos del mismo tipo, que en conjunto no superen 2000 ítems | Anexo I, regla 1.4 B; Anexo IV, sección 2 |
| Documentos asociados                                        | 10 (FEXE: 20)                                                   | Anexo IV, sección 5                       |
| Apéndice                                                    | 10 entradas                                                     | Anexo IV, sección 11                      |
| Documentos por evento de contingencia                       | 1000 códigos de generación                                      | Anexo V, campos 34 y 36                   |
| Ítems de evento de retorno u operaciones especiales         | 2000                                                            | Anexo V, campo 61                         |
| Documentos relacionados en evento de retorno                | 50, del mismo tipo                                              | Anexo V, campo 15                         |
| DTE por lote                                                | 100                                                             | Manual Técnico, sección 3.4               |
| Descripción del ítem                                        | 1500 caracteres                                                 | Anexo II, campo 86                        |
| Observaciones del resumen                                   | 3000 caracteres                                                 | Anexo II, campo 168                       |

## 10. Receptor en la Factura y campos de pago

### Identificación del receptor en FE

- En FE, `tipoDocumento`, `numDocumento` y `nombre` del receptor **pueden ir en `null` cuando el monto total de la operación es menor al "monto legalmente establecido"**, y son obligatorios cuando es mayor (Normativa 2.0, Anexo IV, campos 38, 39 y 42).
- La Normativa **no escribe la cifra**; remite al art. 119-G inciso primero literal b) número VII del Código Tributario (regla 13.1.1.1).
- La cifra aparece en el aviso de la DGII del 5 de septiembre de 2024: los emisores **no deben solicitar** documento de identificación (ni correo electrónico) a consumidores finales en operaciones **menores a $25,000.00**; hacerlo es de carácter prohibitivo y no puede impedir la venta (Aviso mandatario referente a ventas con factura).
- El caso de un monto exactamente igual al umbral no está resuelto por el texto ("menor" / "mayor"). No confirmado.
- Consecuencia de diseño: el SDK no debe exigir datos del receptor en FE por debajo del umbral, y la interfaz no debe obligar a capturarlos.
- Para personas naturales sin NRC se usa el código `13` (DUI), con 9 dígitos sin guiones (Anexo IV, campos 38 y 39).
- En FE son opcionales además: actividad económica, dirección (si el departamento es `null`, el complemento también) y correo (Anexo IV, campos 43 a 50 y 57).
- Al invalidar una FE sin receptor, esos campos van en `null` en el evento, pero siempre se identifican quien **solicita** y quien **realiza** el evento (regla 13.1.1.1; Manual Funcional, sección VII).

### Condición de la operación y pagos (FE, CCFE, FEXE, FSEE)

Catálogo CAT-016: `1` contado, `2` a crédito, `3` otro (mixto: parte contado, parte crédito) (Manual Funcional, sección XIX).

| Campo                                                 | Condición 1 (contado)                      | Condición 2 (crédito)                        | Condición 3 (mixto)         | Fuente                                           |
| ----------------------------------------------------- | ------------------------------------------ | -------------------------------------------- | --------------------------- | ------------------------------------------------ |
| `pagos[].codigo` (CAT-017)                            | Requerido                                  | **`null`**                                   | Requerido                   | Normativa 2.0, Anexo IV, campo 160, reglas 4 y 5 |
| `pagos[].montoPago`                                   | Valor de cada forma de pago                | **`0.00`**                                   | Valor de cada forma de pago | Anexo IV, campo 161, regla 6                     |
| `pagos[].referencia`                                  | Opcional (`null` si es billetes y monedas) | **`null`**                                   | Opcional                    | Anexo IV, campo 162, reglas 4 y 5                |
| `pagos[].plazo` (CAT-018: 01 días, 02 meses, 03 años) | Puede ser `null`                           | **Requerido**                                | Puede ser `null`            | Anexo IV, campo 163                              |
| `pagos[].periodo`                                     | Puede ser `null`                           | **Requerido** (número de días, meses o años) | Puede ser `null`            | Anexo IV, campo 164                              |

Otras reglas:

- La suma de `montoPago` debe ser igual a `totalPagar` (Anexo IV, campo 161, regla 4). Con condición 2 esta regla no puede cumplirse si el total es mayor que cero, ya que el monto debe ser 0.00; el texto no lo aclara.
- Si el total a pagar es $0.00 o hay saldo a favor, la condición debe ser `1` (Anexo IV, campo 159). Con saldo a favor, la forma de pago es `99` (Anexo IV, campo 160, regla 3).
- Se admiten "n" formas de pago, cada una con sus cinco campos (Anexo IV, campo 160, regla 2).

> **Contradicción entre fuentes.** El ejemplo de crédito del Manual Funcional (sección XIX) usa `codigo: 01`, `montoPago: 500.00`, `plazo: 02`, `periodo: 6`, y su texto dice que con crédito "se deberá detallar la forma de pago, el plazo y periodo". El Anexo IV de la Normativa exige en cambio `codigo: null` y `montoPago: 0.00`. El JSON Schema publicado de FE v2 admite ambas formas (`codigo` acepta `null`, `montoPago` mínimo 0). Este punto debe verificarse en el ambiente de pruebas antes de fijar el comportamiento del SDK. Ver sección [20](#20-discrepancias-entre-fuentes-y-puntos-no-confirmados).

## 11. Contingencia

Cuándo procede (Normativa 2.0, regla 13.2, Cuadro 7): caso fortuito o fuerza mayor que imposibilite la transmisión, por ejemplo falla del proveedor de internet o indisponibilidad de la plataforma de Hacienda.

Documentos admitidos: FE, CCFE, NRE, NCE, NDE, CRE, FEXE, FSEE y el evento de retorno (Anexo V, campo 35).

Flujo y plazos:

1. Agotar la **política de reintentos** antes de declararse en contingencia (regla 13.2.1).
2. Seguir generando y firmando con modelo `2` y tipo de transmisión `2`, y entregar al receptor en estado transitorio (Manual Funcional, sección VIII).
3. Reintentar la conexión con Hacienda **como mínimo cada 15 minutos** (regla 13.2.1).
4. Al cesar la causa, transmitir el **evento de contingencia dentro de 24 horas** (regla 13.2, Cuadro 7; Anexo V, campo 10).
5. Con el sello del evento, transmitir los documentos dentro de **72 horas** (regla 13.2.2).
6. Si la contingencia dura **más de 3 días consecutivos**, antes de transmitir el evento se presenta un **Informe Técnico de Contingencia** (causas, plan de acción, controles) por los medios que disponga Hacienda (regla 13.2.1.1).

Reglas del evento:

- Hasta 1000 códigos de generación por evento, uno por ítem; pueden mezclarse tipos de documento (Anexo V, campo 36).
- No se informan documentos que ya tengan sello o estén invalidados (Anexo V, campo 36).
- Fecha fin ≥ fecha inicio; hora fin > hora inicio (Anexo V, campos 38 y 40).
- Son obligatorios nombre, tipo y número de documento del responsable del establecimiento (Anexo V, campos 20 a 22).
- Al transmitir después los documentos, **no** se modifican `tipoModelo`, `tipoOperacion`, `tipoContingencia` ni `motivoContin` con que se generaron (Manual Funcional, sección VIII).
- Si no se cumplen los plazos, debe justificarse por escrito ante la DGII y pedir prórroga (Manual Funcional, sección VIII).

En contingencia, el Archivo DTE se entrega sin sello (Anexo IV, campo 175); el receptor lo reconoce por el tipo de transmisión código 2 (regla 11.1). Una vez obtenido el sello, el emisor lo integra en el Archivo DTE "que finalmente podrá remitir al receptor" (regla 11.2).

## 12. Invalidación

### Plazos (Normativa 2.0, regla 13.1, Cuadro 6)

| Documento                                                           | Caso                                                                                        | Plazo para transmitir el evento                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| CCFE, NRE, NCE, NDE, CLE, CRE, DCLE, CDE                            | Error del emisor que no implica ajuste a la operación, o rescisión total                    | Dentro de los **10 primeros días hábiles del mes siguiente** al período tributario en que el documento obtuvo sello                            |
| FE, FEXE, FSEE                                                      | Rescisión o modificación de la operación (por ejemplo reducción de precio o cambio de bien) | **3 meses** desde el sello                                                                                                                     |
| FE, FEXE de medicamentos y especialidades farmacéuticas perecederos | Ídem                                                                                        | **2 años** desde el sello. Se valida por actividad económica del emisor: 21001, 21008, 46482, 46484, 46491 o 47721 (Anexo V, campo 9, regla 7) |
| Evento de retorno, evento de operaciones especiales                 | Errores en su contenido                                                                     | 10 primeros días hábiles del mes siguiente al período en que obtuvo sello                                                                      |

> El Anexo V, campo 47, da plazos **distintos** para varios documentos (1 día para CCFE, CRE, NCE y NDE; 4 días calendario para NRE, CDE, retorno y operaciones especiales). Es una contradicción interna de la Normativa; ver sección [20](#20-discrepancias-entre-fuentes-y-puntos-no-confirmados).

### Fecha del evento

- Documentos distintos de FE, FEXE y FSEE, y eventos: la fecha del evento es **la misma** fecha de generación (o fecha del evento) del documento a invalidar (Anexo V, campo 9, regla 4; Manual Funcional, sección VII).
- FE, FEXE, FSEE: la fecha del evento puede ser hasta **3 meses posterior** a la fecha de generación del DTE (Anexo V, campo 9, regla 5).
- El cuerpo de la Normativa dice que la fecha del evento debe estar "desde el mismo día hasta el día posterior" respecto de la fecha de generación del documento (regla 13.1.1); el Anexo V y el Manual Funcional exigen la misma fecha.
- La invalidación se declara en el período tributario de la fecha del evento, no del sello (regla 13.1.2).

### Reglas de proceso

- Solo se invalidan documentos que ya tengan sello (regla 13.1.1).
- Un evento por cada documento a invalidar (Manual Funcional, sección VII).
- Tipo de invalidación (CAT-024): `1` error en la información, `2` rescindir la operación, `3` otro (Manual Funcional, sección VII).
- Tipos 1 y 3: **primero** se emite el documento que reemplaza (nuevo código de generación y número de control, con sello) y luego se invalida el anterior, informando ambos códigos (regla 13.1.1; Anexo V, campo 48).
- Tipo 2: el código del documento que reemplaza va en `null` (Anexo V, campo 48, regla 4).
- Excepción: para NCE (05), CLE (08) y eventos (16, 17, 18) el código de reemplazo siempre es `null`; se invalida primero y luego se emite el nuevo (Anexo V, campo 48, regla 3; Manual Funcional, sección VII).
- Un CCFE o CRE ajustado con NCE o NDE no puede invalidarse sin invalidar antes esas notas (Anexo V, campo 44, regla 3).
- Una FE, FEXE o FSEE con evento de retorno aplicado no puede invalidarse sin invalidar antes el retorno (Anexo V, campo 44, regla 4).
- El evento lleva el sello de recepción y el número de control del documento a invalidar; el número de control va en `null` cuando se invalida un evento (Anexo V, campos 45 y 46).
- Son obligatorios nombre, tipo y número de documento de quien realiza y de quien solicita el evento (Manual Funcional, sección VII).
- Un evento de invalidación fuera de plazo no obtiene sello y el DTE conserva su validez (Manual Funcional, sección VII).

Error frente a afectación (regla 13.1.1.2): si no es un simple error de datos, los CCF y CR con sello se modifican con **nota de crédito o débito**, no con invalidación. La invalidación extingue el débito o crédito fiscal, no lo ajusta (regla 13.1.2).

## 13. Retorno

Evento nuevo en la versión 2.0 (tipo de evento `18`, versión 1).

- Aplica solo a **FE, FEXE y FSEE** con sello (códigos 01, 11 y 14) (Normativa 2.0, regla 13.3, Cuadro 8; Anexo V, campo 15).
- Casos: devolución de bienes por el receptor o un tercero, reembolsos por defectos ocultos, recuperación de depósitos de envases o empaques, reimportación de bienes exportados, disminución del valor exportado por pérdida, merma o daño (Cuadro 8).
- Plazo: **3 meses** desde el sello del documento relacionado (Cuadro 8).
- El retorno no es un descuento ni puede exceder el valor vendido o comprado (regla 13.3.1).
- Cada evento se relaciona con **un solo tipo** de documento; hasta 50 documentos y 2000 ítems (regla 13.3.1; Anexo V, sección 2).
- Un mismo código de generación aparece una sola vez por evento, pero pueden emitirse varios eventos sobre el mismo documento (Anexo V, campo 16, regla 5).
- Se entrega al receptor con Archivo DTE y representación gráfica (regla 13.3.1).
- Puede transmitirse en diferido normal y en contingencia (regla 9, Cuadro 5).
- No genera crédito fiscal para el receptor y **no es ajustable** por otro evento o documento, pero sí puede invalidarse (reglas 13.3.2.1 y 13.3.2.2).
- No invalida el documento de origen, aunque el retorno cubra el valor total (regla 13.3.2.2).
- Tolerancia de fecha: hasta 5 días posteriores a la transmisión sin pasar de período; el último día del mes solo 30 minutos (Anexo V, campo 9, regla 2).

Efectos (regla 13.3.2): en FE disminuye la venta y el débito fiscal; en FEXE la exportación y el remanente de crédito fiscal; en FSEE la compra.

## 14. Operaciones especiales

Evento nuevo en la versión 2.0 (tipo de evento `17`, versión 1).

- Sirve para informar operaciones documentadas con **Factura de Venta Simplificada** (con autorización de numeración correlativa) o con **Comprobantes de Control Interno** autorizados por resolución (art. 113 del Código Tributario) (Normativa 2.0, regla 13.4, Cuadro 9).
- Plazo: hasta los **10 primeros días hábiles del mes siguiente** (Cuadro 9).
- Solo modelo previo y transmisión normal (Anexo V, campos 3 y 4).
- Lo emiten únicamente los contribuyentes designados por Hacienda (Anexo V, campo 18, regla 3).
- Hasta 2000 ítems; un mismo tipo de documento de origen por evento (Anexo V, campos 61 y 63). Las facturas simplificadas pueden informarse por rango de correlativos (Manual Funcional, sección IX).
- Permite la coexistencia de esos sistemas con los DTE; los sistemas de control autorizados **antes** de la vigencia de la Normativa no pueden coexistir (regla 15).

> La regla 4 remite a "la regla 13.5" para la Factura de Venta Simplificada; esa regla no existe y el evento está regulado en la 13.4. Se trata de una referencia cruzada errónea del texto oficial.

## 15. Entrega al receptor

Qué se entrega (Normativa 2.0, regla 11; Anexo I, regla 4.1): **el Archivo DTE (JSON) y su representación gráfica**, siempre ambos. Los eventos de invalidación y retorno también se entregan.

### Archivo DTE

Estructura obligatoria (Anexo I, regla 4.1, Cuadro 11; Manual Técnico, sección 6.5):

| Parte               | Atributo base                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estructura de datos | `identificacion`, `emisor`, `receptor`, `otrosDocumentos`, `documentoRelacionado`, `ventaTercero`, `compraTercero`, `cuerpoDocumento`, `resumen`, `apendice` (según el tipo de documento) |
| Firma electrónica   | `firmaElectronica` (el JWS compacto)                                                                                                                                                      |
| Sello de recepción  | `selloRecibido`                                                                                                                                                                           |

- La estructura de datos que se firmó debe incorporarse **íntegra** (Anexo I, regla 4).
- Los archivos que no cumplan esta forma "no podrán ser confirmados por la Administración Tributaria" (Anexo I, regla 4.1).
- Codificación UTF-8; JSON según ECMA-404 (Manual Técnico, sección 6.1; Anexo I, regla 6).

### Medios de entrega

- Se acuerdan entre emisor y receptor. A falta de acuerdo, por medios tecnológicos que dejen rastro perceptible (regla 11).
- Medios admitidos: correo electrónico, mensajería instantánea, transferencia de archivos cliente-servidor, descarga en sitio web del emisor, carga en sitio del receptor, dispositivos portátiles de almacenamiento (regla 11).
- Se consideran entregados cuando existe **evidencia de envío o de disponibilidad** en el repositorio acordado (regla 11). Conviene registrar esa evidencia.
- **Correo electrónico**: el mensaje solo debe contener información de la entrega, sin publicidad, promociones ni encuestas (Anexo I, regla 4).
- **Sitio de descarga** (cuando el receptor no da datos de contacto): disponible en todo momento, con acceso seguro y exclusivo, mediante URL o código QR. Debe informarse como mínimo: nombre y NIT del emisor, modelo y tipo de transmisión, fecha y hora, código de generación, sello de recepción, QR o ruta de descarga y una breve instrucción (regla 11; Anexo I, regla 4).
- Si el emisor cesa actividades (fusión, liquidación, desinscripción), el sitio de descarga debe seguir disponible **60 días hábiles** (regla 11).
- **Formato físico**: solo por excepción, a solicitud del receptor que no dispone de medios tecnológicos (regla 11).

La representación gráfica se detalla en `representacion-grafica.md`.

## 16. Conservación y resguardo

- Conservar DTE y eventos de forma **segura e inalterable** durante el plazo del art. 147 del Código Tributario, con la misma información, estructura y formato con que se generaron, firmaron y transmitieron (Normativa 2.0, regla 12). La Normativa no expresa el plazo en años; remite al artículo.
- También se conservan los documentos firmados y entregados que **no** llegaron a transmitirse (regla 12).
- Las representaciones gráficas se conservan en el mismo formato y medio en que se expidieron (regla 12).
- Deben estar disponibles **ordenados cronológicamente por período tributario** (regla 12.1).
- Hacienda **no** repone ni almacena los DTE por cuenta del contribuyente (regla 12.1).
- Usuarios del Sistema de Transmisión: mantener una **copia de respaldo** de la base de datos de los JSON transmitidos con su sello (Anexo I, regla 6.1).
- Si se usa un proveedor de almacenamiento, debe garantizar disponibilidad y consulta en cualquier momento (Anexo I, regla 6.1).
- Datos personales: garantizar seguridad, integridad, disponibilidad y confidencialidad; no usarlos para fines distintos del cumplimiento tributario o legal. El emisor responde por filtraciones e incidentes de su gestor de facturación (regla 12.2).

## 17. Seguridad e infraestructura

Arquitectura, "de acuerdo al volumen de transacciones" (Normativa 2.0, Anexo I, regla 5): alta disponibilidad, plan de recuperación ante desastres, balanceadores de carga, componentes de seguridad, infraestructura autoescalable, respaldo de datos, trazabilidad de operaciones, monitoreo de transacciones y reportes de sistema.

Seguridad del gestor de facturación (Anexo I, regla 6): protección contra ataques externos, control de accesos no autorizados, registro de accesos de usuarios y administradores, privacidad de la información, administración de logs, cifrado de información sensible, plan de continuidad por contingencia y gestión de incidentes.

Lineamientos del Manual Técnico (sección 6):

- TLS 1.2 o superior y gestión cifrada de tokens y credenciales (6.4).
- **Jurisdicción de la infraestructura**: servidores y bases de datos usados para la facturación electrónica deben desplegarse en jurisdicciones con tratados de extradición y convenios de asistencia legal mutua por delitos informáticos vigentes con El Salvador (6.4). El manual no lista países.
- No enviar DTE de prueba a producción (6.3).
- URL exactas, sin barra final (6.2).
- El JSON Schema es una guía estructural; cumplirlo no exime de las reglas lógicas y de cálculo (6.1).

## 18. Sanciones y consecuencias

La Normativa **no fija montos de multa**; remite al Código Tributario. Menciones encontradas:

| Situación                                                   | Consecuencia                                  | Fuente                                       |
| ----------------------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| Incumplir la Normativa                                      | Ejercicio de facultades sancionatorias        | Normativa 2.0, considerando IV               |
| Abuso de las plataformas                                    | Pausa temporal y preventiva de accesos        | regla 2.1.2                                  |
| Compartir o exponer credenciales con abuso resultante       | Responsabilidad legal y "sanción respectiva"  | regla 9.2                                    |
| Omitir la entrega al receptor                               | Sanciones del Código Tributario               | regla 11                                     |
| Seguir usando tiquetes                                      | "Sanción respectiva"                          | regla 15                                     |
| No conservar documentos en estado transitorio               | Sanciones por incumplimiento                  | regla 9.3                                    |
| Documento firmado no transmitido, o rechazado               | Presunción de ingresos gravados (art. 199 CT) | reglas 8.1 y 10.1                            |
| Alterar el contenido después del sello                      | Lesión al interés fiscal                      | regla 10                                     |
| Representación gráfica que no corresponde a su DTE          | Indicio de lesión al interés fiscal           | regla 11.3.1                                 |
| Exigir identificación a consumidores finales bajo el umbral | Sanciones del art. 239-A CT                   | Aviso mandatario del 5 de septiembre de 2024 |
| No resguardar seguridad, cumplimiento y exactitud           | Posible revocación de la autorización         | Manual Funcional, sección VIII               |

## 19. Qué cambió respecto a versiones anteriores

Historial (Normativa 2.0, Anexo VI):

| Versión | Cambio                                                                          |
| ------- | ------------------------------------------------------------------------------- |
| 1.0     | Versión inicial (13 de enero de 2023)                                           |
| 1.1     | Se modificó la fecha de coexistencia (regla 15) y el máximo de ítems (campo 21) |
| 1.2     | Se adicionó la sección 7 con los campos 72 y 73 para FEXE                       |
| 2.0     | Reescritura general (25 de mayo de 2026)                                        |

### Cambios de la versión 2.0 en el cuerpo normativo

| Regla | Cambio                                                                                                                                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | Se definen sujetos obligados, voluntarios y sus responsabilidades                                                                                                                                                             |
| 3     | Nuevas definiciones: campo, establecimiento, evento de retorno, evento de operaciones especiales, fecha de generación / fecha del evento, fecha de transmisión, punto de venta, gestor de facturación electrónica, validación |
| 4     | Efectos de los DTE y de los nuevos eventos                                                                                                                                                                                    |
| 6     | Se introduce la emisión con transmisión diferida normal                                                                                                                                                                       |
| 7     | Reglas de contenido y especificación del número de control                                                                                                                                                                    |
| 8     | Responsabilidad sobre el certificado de firma y efectos de la firma                                                                                                                                                           |
| 9     | Cuadro de transmisión con la diferida normal; lineamientos de plataformas; condiciones de transmisión; estado transitorio                                                                                                     |
| 11    | Entrega según modalidad de emisión; correspondencia de la representación gráfica con su DTE                                                                                                                                   |
| 12    | Orden y conservación; protección de datos personales; certificación                                                                                                                                                           |
| 13    | Nuevos plazos de invalidación; eventos de retorno y de operaciones especiales; reglas de transmisión de eventos; Informe Técnico de Contingencia                                                                              |
| 18    | Lineamientos para actualizaciones y versiones                                                                                                                                                                                 |

### Cambios de la versión 2.0 en el Anexo I

- Principios de transparencia tecnológica y responsabilidad (regla 1).
- Lineamientos para el uso de claves; consulta del estado del servicio de recepción (regla 3).
- Especificaciones de entrega y **esquema uniforme del Archivo DTE** (regla 4).
- Módulo de entrega (regla 5).
- Lineamientos de seguridad (regla 6).
- Flujo de proceso actualizado (regla 7).

### Cambios de la versión 2.0 en estructuras y validaciones de DTE (Anexos II y IV)

- Campo 1 "Versión" actualizado para todos los DTE.
- Campos adicionados: 13 "Fusiones y otros"; sección 2 "Documentos relacionados" y sección 7 "Compra por cuenta de terceros" para FEXE; 28 "Dirección Distrito (Emisor)"; 36 "Tipo de Régimen"; 38 y 39 (tipo y número de documento de identificación del receptor); 49 "Dirección Distrito (Receptor)"; 53 y 71 "Domicilio Fiscal"; 75 "Tipo de ítem", 80 "Número de documento relacionado", 84 "Tributo sujeto a cálculo de IVA" y 96 "Código del tributo" para FEXE; 83 "Código"; 98 a 101, 143 a 146, 151 y 153 en NCE y NDE; 136 a 138 y 152 para FEXE; 157 "IVA 13%" para CRE; 168 "Observaciones".
- Campos eliminados: tipo de establecimiento y códigos de establecimiento y punto de venta asignados por el MH (emisor y receptor) para DCLE; NIT (receptor) para NCE, NDE y CLE; "IVA retenido" para FSEE; montos globales de descuento, porcentaje de descuento, subtotal, IVA percibido e IVA retenido para NCE y NDE; "Retención renta" para FE, CCFE, NCE y NDE.
- **Se elimina la sección Extensión** para FE, CCFE, NRE, NCE, NDE, CRE, CLE, FEXE, FSEE y CDE (queda solo en DCLE).
- Se amplía la longitud del campo "Descripción".

> La lista anterior proviene de texto OCR con errores evidentes de puntuación; los números de campo se transcriben como aparecen. La enumeración exacta de los campos eliminados para NCE y NDE no está confirmada (OCR ilegible en parte).

### Cambios de la versión 2.0 en estructuras y validaciones de eventos (Anexos III y V)

- Validaciones actualizadas: campo 1 "Versión" para todos los eventos; fecha del evento, tipo de DTE y fecha de generación para invalidación; tipo de documento en contingencia; tipo de invalidación.
- Campos adicionados (mayormente por los nuevos eventos): modelo de facturación, tipo de transmisión, tipo y motivo de contingencia, tipo de evento, fusiones y otros, documentos relacionados, recinto fiscal, tipo de régimen, régimen y tipo de exportación, país del receptor, ventas y compras por cuenta de terceros, y las secciones completas de cuerpo, resumen y apéndice.
- Campos eliminados del evento de invalidación: tipo de establecimiento (emisor), nombre de casa matriz / sucursal y monto total de la operación del DTE a invalidar.

### Versiones de esquema vigentes

| Documento | Versión | Evento                           | Versión                                                                |
| --------- | ------- | -------------------------------- | ---------------------------------------------------------------------- |
| FE        | 2       | Invalidación                     | 3                                                                      |
| CCFE      | 4       | Contingencia                     | 4 según el JSON Schema publicado; **3 según el texto de la Normativa** |
| NRE       | 4       | Retorno (tipo 18)                | 1                                                                      |
| NCE       | 4       | Operaciones especiales (tipo 17) | 1                                                                      |
| NDE       | 4       |                                  |                                                                        |
| CRE       | 2       |                                  |                                                                        |
| CLE       | 2       |                                  |                                                                        |
| DCLE      | 2       |                                  |                                                                        |
| FEXE      | 3       |                                  |                                                                        |
| FSEE      | 2       |                                  |                                                                        |
| CDE       | 2       |                                  |                                                                        |

Fuente de las versiones de DTE: Normativa 2.0, Anexo IV, campo 1. Fuente de las versiones de eventos: Anexo III, campo 1 y Anexo V, campo 1.

Otros cambios de datos relevantes: nuevo campo `distrito` en toda dirección, con el catálogo CAT-008, que debe corresponder al departamento y municipio (Anexo IV, campos 28 y 49); nuevo catálogo CAT-033 "Tipo de Régimen" (Anexo IV, campo 36); el catálogo CAT-023 pasa a ser "Operaciones especiales" (Anexo V, campo 63).

### Vigencia de los cambios

- Los cambios que afectan estructura, formato o atributos de campos rigen desde su publicación, salvo plazo de adaptación distinto (regla 18).
- Los usuarios del Sistema de Transmisión deben concluir las adaptaciones dentro del plazo que les fije Hacienda (regla 18). Ese plazo no está en la Normativa.

## 20. Discrepancias entre fuentes y puntos no confirmados

| Tema                                                               | Fuente A                                                                                                                                  | Fuente B                                                                                 | Estado                                                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Versión del evento de contingencia                                 | "Evento de Contingencia y de Invalidación deberá ingresar 3" (Normativa 2.0, Anexo III, campo 1 y Anexo V, campo 1; confirmado en el PDF) | El JSON Schema publicado (`contingencia-schema-v4.json`) fija `version` en 4             | Contradicción. El esquema es más reciente; confirmar en ambiente de pruebas           |
| Pagos con condición crédito                                        | `codigo` en `null` y `montoPago` en 0.00 (Anexo IV, campos 160 y 161)                                                                     | Ejemplo con código 01 y monto $500.00 (Manual Funcional, sección XIX)                    | Contradicción; confirmar en ambiente de pruebas                                       |
| Plazo de invalidación de CCFE, CRE, NCE, NDE                       | 10 primeros días hábiles del mes siguiente (regla 13.1, Cuadro 6; Anexo V, campo 9, regla 8; Manual Funcional, sección VII)               | 1 día posterior al sello (Anexo V, campo 47, regla 2; confirmado en el PDF)              | Contradicción interna                                                                 |
| Plazo de invalidación de NRE, CDE, retorno, operaciones especiales | 10 primeros días hábiles del mes siguiente (ídem)                                                                                         | 4 días calendario siguientes al sello (Anexo V, campo 47, regla 4; confirmado en el PDF) | Contradicción interna                                                                 |
| Fecha del evento de invalidación                                   | "Desde el mismo día hasta el día posterior" (regla 13.1.1)                                                                                | La misma fecha de generación (Anexo V, campo 9, regla 4)                                 | Diferencia de redacción; usar la misma fecha es compatible con ambas                  |
| Fecha de generación posterior a la transmisión                     | Hasta 5 días, sin pasar de período (Anexo IV, campo 10)                                                                                   | Un día posterior (Manual Técnico, sección 3.1)                                           | Diferencia; no depender de la holgura                                                 |
| Evento con plazo de 24 horas en contingencia                       | "Evento de Invalidación" (regla 9, Cuadro 5, fila 3; confirmado en el PDF)                                                                | Evento de contingencia (regla 13.2, Cuadro 7)                                            | Probable errata del Cuadro 5                                                          |
| Regla de la Factura de Venta Simplificada                          | Remisión a "regla 13.5" (regla 4)                                                                                                         | El evento está en la regla 13.4                                                          | Errata del texto oficial                                                              |
| Umbral de identificación del receptor en FE                        | "Monto legalmente establecido", sin cifra (Anexo IV, campos 38, 39, 42)                                                                   | $25,000.00 (Aviso mandatario, 5 de septiembre de 2024)                                   | La cifra no está en la Normativa; verificar el artículo vigente del Código Tributario |
| Plazo de conservación en años                                      | Remite al art. 147 del Código Tributario (regla 12)                                                                                       | —                                                                                        | No expresado en la Normativa                                                          |
| Montos de sanciones                                                | Remite al Código Tributario                                                                                                               | —                                                                                        | No expresados en la Normativa                                                         |
