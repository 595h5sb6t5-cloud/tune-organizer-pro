# Fase 2 — Clustering Endurecido (Auto-disparo sobre muestra de 150)

## Objetivo
Cuando el análisis v3.0 termine sobre las 1,625 canciones, se dispara automáticamente el clustering endurecido, **pero solo sobre las 150 canciones de la muestra diagnóstica**. Ninguna playlist real se toca, nada se exporta a Spotify, y el proceso se detiene al terminar para que revises el reporte.

## Cómo se dispara solo

Tres piezas coordinadas:

1. **Watcher en `analyze-tracks-deep`**: cuando un batch termina y detecta `remaining === 0`, hace `EdgeRuntime.waitUntil(fetch('phase2-guard'))` (fire-and-forget).
2. **`phase2-guard` (nuevo)**: valida el estado global antes de arrancar Fase 2. Si algo falla, registra el motivo y no arranca.
3. **`cluster-hardened` (nuevo)**: el motor real. Solo corre si `phase2-guard` da luz verde.

## Guard de pre-requisitos (bloqueos duros)

`phase2-guard` chequea sobre las **150 canciones de la muestra activa**:
- 100% tiene fila en `ai_track_analysis` con `analysis_version = 'v2.2-2026-11-lang'` o superior
- 100% tiene `music_family`, `primary_subgenre`, `artist_context` no nulos
- Todas las canciones marcadas `is_house_related = true` tienen `house_profile` completo (kick, bassline, groove, subgenre)
- Cero filas con `error_message` reciente en `analyze-tracks-deep`
- No hay job Fase 2 previo en estado `running` para esta muestra

Si falla cualquiera → escribe a `diagnostic_samples.phase2_status = 'blocked'` con detalle y no arranca. Verás el motivo en la UI.

## Lógica del clustering endurecido

Sobre las 150 canciones que pasaron el guard:

**Bloque 1 — Segmentación previa**
- Separar por `music_family` (electronic, hip-hop, rock, pop, latin, etc.)
- Dentro de electronic, separar house de no-house
- Dentro de house, separar por `house_profile.subgenre` (deep, melodic, afro, tech, progressive, indie-dance)

**Bloque 2 — Hard gates por familia**
- House: `groove ≥ 0.78`, `kick_weight ≥ 0.74`, `bass_weight ≥ 0.74`, mismo `subgenre` o vecino permitido
- Hip-hop / rock / pop: gate estándar de sonido + `scene_distance ≤ 0.35`
- Si una canción no pasa el gate de su familia → `unassigned_tracks` con motivo

**Bloque 3 — Scores por par de canciones (dentro del mismo bucket)**
- `sonic_fit` (energy, groove, darkness, textures, tempo)
- `subgenre_fit` (mismo subgénero = 1.0, vecino = 0.7, lejano = 0.0)
- `artist_context_fit` (escena, era, coherencia de identidad de artista)
- `scene_distance` (0 = misma escena, 1 = escenas incompatibles)
- `skip_risk` (probabilidad de que el usuario skipee la transición)
- `transition_fit`

**Bloque 4 — Penalizaciones**
- `artist_context_penalty` cuando dos artistas rompen coherencia (Kanye + Elton John dispara penalty alto aunque `sonic_fit` sea bueno)
- Regla `artist_surprise`: solo se permite si `sonic_fit ≥ 0.90`, `transition_fit ≥ 0.88`, `artist_context_fit ≥ 0.75`

**Bloque 5 — Formación de clusters**
- Greedy por semilla + expansión con umbrales: `avg_final_fit ≥ 0.84`, `min_final_fit ≥ 0.74`
- Mínimo 10 canciones para promover, ideal 15-50
- Si un cluster no llega a 10 → todas las canciones vuelven a `unassigned_tracks`
- Nunca "playlist de relleno"

**Bloque 6 — Casos problemáticos etiquetados**
- Detectar y marcar explícitamente: Kanye + Elton, RÜFÜS mal ubicado, house genérico mezclado con subgéneros incompatibles
- Guardar en el reporte con score-by-score de qué hard gate falló

## Escritura de resultados (sin tocar producción)

Nada se escribe a `generated_playlists`. En su lugar:
- `cluster_candidates` con `sample_id` de la muestra y `phase = 'v3-hardened'`
- `cluster_candidate_tracks` con scores completos por canción
- `unassigned_tracks` con motivo
- `diagnostic_samples.phase2_report` (JSONB) con el reporte comparativo completo

## Reporte que verás cuando termine

Panel nuevo en `/ai-playlists` bajo "Fase 1 · Diagnóstico":
1. **Clusters creados** — nombre, tamaño, `avg_final_fit`, subgénero dominante
2. **Canciones por cluster** — nombre + artista + scores individuales
3. **Rechazadas / sin asignar** — con motivo (`failed_house_gate`, `artist_context_penalty`, `no_cluster_reached_min`)
4. **Movidas** vs. el resultado v2 anterior
5. **Casos problemáticos** — Kanye + Elton, RÜFÜS: qué hard gates pasaron / fallaron, con números
6. **Diff v2 vs v3** — cuántos clusters, tamaño promedio, dispersión de subgéneros

## Restricciones absolutas
- No corre sobre las 1,625 — solo sobre las 150 de la muestra
- No crea filas en `generated_playlists`
- No llama a `spotify-export-playlist`
- No borra ni modifica playlists actuales
- Al terminar, `diagnostic_samples.phase2_status = 'completed_awaiting_review'` y el watcher no vuelve a disparar hasta que apruebes rollout

## Detalles técnicos

**Archivos nuevos**
- `supabase/functions/phase2-guard/index.ts`
- `supabase/functions/cluster-hardened/index.ts`
- Migración: columnas `phase2_status`, `phase2_started_at`, `phase2_report` en `diagnostic_samples`; columna `phase` en `cluster_candidates`

**Archivos modificados**
- `supabase/functions/analyze-tracks-deep/index.ts`: al detectar `remaining === 0`, hace `EdgeRuntime.waitUntil(fetch(phase2-guard))` solo si existe una muestra activa con `phase2_status = 'pending_analysis'`
- `src/pages/Playlists.tsx`: nuevo panel "Fase 2 · Reporte" que lee `diagnostic_samples.phase2_report`

**Auto-chain resumible**
`cluster-hardened` procesa en chunks (segmentar → gates → scores → clusters). Persiste estado parcial en `diagnostic_samples.phase2_progress` y se auto-encadena con `waitUntil` si excede 100s, igual que hace el análisis deep hoy.

**Idempotencia**
Si `phase2-guard` corre dos veces (race con el watcher), la segunda ejecución ve `phase2_status = 'running'` y sale sin hacer nada.
