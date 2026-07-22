## Objetivo

Reducir tiempo del deep analysis sin bajar la calidad ni recortar dimensiones. Entregar al final métricas antes/después con 100 canciones y solo aprobar si la coherencia se mantiene.

## Fase 0 — Diagnóstico y baseline

Antes de tocar nada, mido dónde se pierde el tiempo con un modo `profile_batch` nuevo en la edge function `analyze-liked-songs` que instrumenta una corrida real de 50 canciones con timers precisos por etapa:

- `t_db_read`: leer canciones + análisis previos
- `t_prompt_build`: armar prompt
- `t_openai`: llamada a OpenAI (con `usage.prompt_tokens`, `completion_tokens`, `reasoning_tokens`, y `x-request-id` para latencia real)
- `t_validate`: parseo + validación de JSON
- `t_db_write`: guardado
- Concurrencia efectiva y tokens I/O/razonamiento por canción

Se guarda una fila por corrida en una tabla `analysis_benchmarks` (con snapshot del modelo, versión de prompt, versión de esquema, muestra usada). Este es el baseline contra el que se compara todo lo demás.

## Fase 1 — Versionado y cache de resultados

Crear en `ai_track_analysis`:

- `prompt_version` (text)
- `schema_version` (text)  
- Índice único parcial `(user_id, spotify_track_id, analysis_version, prompt_version, schema_version)` para v2

Antes de mandar cada canción al modelo, buscar match exacto por `spotify_track_id + prompt_version + schema_version + model_used`. Si existe → se reutiliza, cero llamadas.

Además exponer `prompt_cache_key` en la llamada a OpenAI (chat completions) con un hash estable del sistema, para que la parte fija del prompt use el caching de OpenAI (descuenta tokens de entrada repetidos).

## Fase 2 — Prompt system fijo + user compacto

Hoy los ejemplos largos (Julio Iglesias, Mecano, Kanye, etc.) viajan en cada request. Reestructuro:

- **System prompt v2 (fijo, cacheado):** todas las reglas curatoriales, ejemplos, definiciones de dimensiones, esquema resumido. Un solo texto grande estable → aprovecha `prompt_cache_key`.
- **User prompt (mínimo):** solo `{ track_name, artist, album, features de Spotify, tags previos si existen }` de la canción actual + "Devuelve JSON según schema".

Mismo contenido de análisis, menos tokens de entrada por llamada.

## Fase 3 — Structured Outputs estricto

Migrar de tool-calling con reparación manual a `response_format: { type: "json_schema", strict: true, schema: {...} }` con todos los tipos, rangos numéricos, enums cerrados. Beneficios:

- Elimina reintentos por JSON malformado y la función `extractJson` de rescate
- Elimina segundos intentos por campos faltantes
- El modelo no gasta tokens en explicación/markdown

## Fase 4 — Paralelismo controlado por lotes

Reemplazar el chain "chunk → chunk → chunk" secuencial por un worker que dentro de cada invocación procesa **N canciones en paralelo** con `Promise.allSettled` y un semáforo. Empiezo con `concurrency = 5`, configurable vía `sync_jobs.metadata.concurrency`.

- Cada canción es una llamada individual (mejor structured output y cache per-track)
- Semáforo evita superar rate limits
- Al terminar el lote se guardan todos los resultados en un `upsert` masivo
- El pipeline sigue siendo resumible: si falla una, se marca `pending`, no rompe el resto

## Fase 5 — Triaje: análisis inicial rápido vs deep

Añadir columna `analysis_stage`:
- `quick`: derivado de Spotify audio features + tags v1 existentes (sin llamada al modelo)
- `deep`: análisis v2 completo

Reglas:
1. Toda canción entra a `quick` (instantáneo, solo cálculo local basado en tempo/energy/valence/danceability + reglas)
2. Solo se manda a `deep` si: nueva, sin análisis v2, `analysis_confidence < 0.7`, en frontera entre 2 clusters (distancia a segundo centroide < umbral), o marcada por el reviewer.

Así reducimos el volumen real que va a OpenAI.

## Fase 6 — Razonamiento adaptativo

Con GPT-5.5 (chat completions) uso `reasoning_effort`:
- `medium` por defecto
- `high` solo cuando:
  - features de Spotify contradictorias (ej. energy alto + valence bajo + acousticness alto)
  - tags previos con géneros muy dispares
  - segunda pasada tras reviewer marcó la canción como fuera de lugar
  - clusterer no encuentra posición clara

Se decide por reglas antes de llamar; el modo se guarda en `full_analysis.reasoning_mode` para auditoría.

## Fase 7 — Reintentos por canción, no del pipeline

- Cada canción tiene su propio try/catch con backoff exponencial (max 3 intentos: 500ms → 2s → 6s)
- Si falla el intento 3 → se marca `status='failed'` con `error_message`; el pipeline continúa
- El siguiente chunk hace pickup de las `failed` recientes automáticamente

## Fase 8 — Muestra representativa primero

Para que el usuario vea resultados rápido:

1. Al iniciar deep analysis, seleccionar una muestra de ~100 canciones que cubra bien el espacio (top artists + variedad de energy/tempo/valence usando stratified sampling sobre las features de Spotify)
2. Procesar esa muestra primero con concurrencia alta
3. Al terminar, la UI ya puede mostrar **preview de playlists provisionales** (marcadas "análisis parcial")
4. El resto corre en background y refina los clusters conforme llega

## Fase 9 — UI de progreso real

Extender `use-jobs` para exponer:
- Estado semántico: `preparing_library | analyzing_songs | clustering | building_playlists | reviewing | done`
- `done_count`, `total_count`, `pct`
- ETA calculado con velocidad promedio de los últimos 20 resultados
- Vista de preview de playlists parciales durante `analyzing_songs` (read-only, no export)

## Fase 10 — Benchmark de 100 canciones

Con el modo `profile_batch` corro dos veces sobre las mismas 100 canciones:
- **Antes**: código actual (checkout de referencia)
- **Después**: con todas las mejoras

Entrego una tabla con:
- Tiempo total y por canción
- Número de llamadas a OpenAI
- Tokens input / output / reasoning promedio y totales
- % resultados reutilizados de cache
- Errores de JSON
- Reintentos
- Coherencia de clusters comparada (score del reviewer sobre las playlists generadas post-análisis)

**La mejora se aprueba solamente si**: tiempo baja y coherencia promedio del reviewer ≥ baseline.

## Detalles técnicos

- Archivos a modificar: `supabase/functions/analyze-liked-songs/index.ts`, `supabase/functions/analyze-tracks-deep/index.ts`, `src/hooks/use-jobs.tsx`, `src/hooks/use-deep-track-analysis.ts`
- Nuevas migraciones: `analysis_benchmarks` table; columnas `prompt_version`, `schema_version`, `analysis_stage` en `ai_track_analysis`; índice único parcial
- Modelo objetivo: `gpt-5.5` (default de Lovable AI Gateway) con `reasoning_effort` adaptativo — se decide via benchmark si conviene contra `gpt-5.4` como coste/latencia
- Structured Outputs vía `response_format: json_schema` estricto
- Prompt caching vía `prompt_cache_key` estable derivado del hash del system prompt + versión

## Fuera de alcance de este cambio

- Batch API de OpenAI (no encaja porque el usuario está esperando en pantalla)
- Bajar dimensiones del schema
- Cambiar el modelo a uno "más rápido" antes del benchmark
- Tocar la calidad del reviewer final
