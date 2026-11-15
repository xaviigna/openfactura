/**
 * Límite de peticiones de ventana fija sobre D1.
 * Un único INSERT … ON CONFLICT … RETURNING incrementa y lee de forma atómica,
 * así el conteo es exacto aunque lleguen peticiones en paralelo.
 */
export interface ResultadoLimite {
  permitido: boolean
  limite: number
  restante: number
  /** Segundos hasta que se reinicia la ventana. */
  reinicioEn: number
  /** Peticiones contadas en la ventana, incluida esta. */
  cuenta: number
}

export async function consumir(
  d1: D1Database,
  bucket: string,
  limite: number,
  ventanaSegundos = 60,
): Promise<ResultadoLimite> {
  const ahora = Math.floor(Date.now() / 1000)
  const inicio = ahora - (ahora % ventanaSegundos)
  const fila = await d1
    .prepare(
      `INSERT INTO ventana_limite (bucket, ventana_inicio, cuenta) VALUES (?1, ?2, 1)
       ON CONFLICT (bucket, ventana_inicio) DO UPDATE SET cuenta = cuenta + 1
       RETURNING cuenta`,
    )
    .bind(bucket, inicio)
    .first<{ cuenta: number }>()
  const cuenta = fila?.cuenta ?? 1
  return {
    permitido: cuenta <= limite,
    limite,
    restante: Math.max(0, limite - cuenta),
    reinicioEn: inicio + ventanaSegundos - ahora,
    cuenta,
  }
}

/** Borra ventanas viejas e idempotencias caducadas. Lo llama el cron. */
export async function limpiar(d1: D1Database): Promise<void> {
  const ahora = Date.now()
  await d1.batch([
    d1
      .prepare('DELETE FROM ventana_limite WHERE ventana_inicio < ?1')
      .bind(Math.floor(ahora / 1000) - 3600),
    d1.prepare('DELETE FROM idempotencia WHERE creado < ?1').bind(ahora - 86_400_000),
  ])
}
