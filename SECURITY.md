# Seguridad

## Reportar una vulnerabilidad

No abras un issue público. Usa _Security → Report a vulnerability_ en el repositorio de GitHub (aviso
privado). Incluye los pasos para reproducir y el impacto. Recibirás respuesta en un plazo de 5 días
hábiles.

## Qué protege el sistema

| Dato                                                                                       | Protección                                                                                                                  |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Contraseña de API del MH, certificado `.crt`, contraseña de la llave privada, token del MH | AES-256-GCM con llave maestra en un secreto del Worker; AAD = organización, ambiente y campo; nunca se devuelven por la API |
| Contraseñas de usuarios                                                                    | PBKDF2-SHA256, 600 000 iteraciones (6 rondas encadenadas de 100 000), sal de 16 bytes                                       |
| Claves de API                                                                              | Sólo se guarda el SHA-256; se muestran una vez; permisos y modo (pruebas/producción) por clave; revocación inmediata        |
| Datos de cada organización                                                                 | Todo servicio filtra por la organización del actor autenticado; hay pruebas de aislamiento                                  |

## Responsabilidades de quien despliega

- Custodiar `CRED_KEK_V1` y `BETTER_AUTH_SECRET`, y guardar una copia de la llave maestra fuera de
  Cloudflare.
- No activar `WEBHOOKS_LOCAL` en producción. `MH_SIMULADO` sí puede activarse: sólo atiende las
  credenciales de prueba que genera el servidor, nunca el ambiente `01` ni las credenciales del usuario.
- Poner el Worker detrás de Cloudflare: el límite de peticiones por IP confía en `cf-connecting-ip`.
- Revisar la bitácora de auditoría (`/app/auditoria`) y revocar las claves que no se usen.

## Limitaciones conocidas

- El proyecto no ha pasado una auditoría de seguridad externa.
- Sin verificación de correo, un enlace de invitación equivale a una credencial: compártelo sólo con
  su destinatario.
- Eliminar una organización borra sus documentos y su bitácora. Conserva respaldos por el plazo legal.
- No hay proceso automático para recifrar con una llave maestra nueva (ver `docs/self-hosting.md`).
- No hay verificación de correo ni segundo factor todavía.
- El simulador del MH no reproduce todas las validaciones de Hacienda.
