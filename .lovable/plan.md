# AI Playlist Pipeline v3 — Cluster-first with strict quality gates

Detengo cualquier generación/exportación con el sistema actual y reescribo el pipeline con estas piezas.

## 1. Nueva Edge Function: `cluster-library`

Reemplaza el flujo "concepto → buscar canciones". Ahora es: **agrupar primero, nombrar después**.

Entrada: `{ sample_size?: number, dry_run?: boolean }`.

Pasos:
1. Cargar todas las canciones con `ai_track_analysis v2.1` del usuario (con las 16 dimensiones sonoras).
2. Construir vector de features **solo sonoros** con pesos:
   - Alto: `groove_feel`, `production_style`, `beat_style`, `instrumentation`, `energy_score`, `melody_level`, `bass_level`, `drum_intensity`, `vocal_intensity`, `darkness`, `softness`, `dance_feel`, `song_variation`, `emotional_intensity`, `sound_texture`
   - Contexto secundario (peso bajo): `main_genre`, `language`, década
   - Filtro duro: `language` respeta la regla (inglés aislado; romances entre sí; instrumental neutro)
3. Clustering por similitud coseno + umbral de distancia (no k-means fijo). Cada cluster se valida contra:
   - `min_size = 12` (o 8-11 solo si `avg_compat ≥ 0.88`, `min_compat ≥ 0.80`)
   - `avg_compat ≥ 0.82`
   - `max_energy_diff`, `max_groove_diff`, `max_darkness_diff`, `max_production_diff`, `max_instrumentation_diff`, `max_vocal_diff`, `max_variation_diff` dentro de tolerancia
4. Canciones que no entren en ningún cluster válido → `unassigned` (persistido).
5. Clusters con < 8 canciones → guardados como `candidate_cluster` (no visibles, esperan más data).

## 2. Nueva Edge Function: `name-cluster`

Solo se llama **después** de que un cluster pasó todos los filtros. Recibe el cluster ya validado + resumen numérico y pide al modelo:
- Nombre específico
- Descripción sonora concreta (percusión, bajo, textura, voz, estructura) — rechaza descripciones genéricas
- vibe, context
- fit_score por canción respecto al centro
- reason en lenguaje natural con **nombre de canción + artista**, nunca IDs

## 3. Revisor endurecido (`review-playlist`)

- Umbral de aprobación: `coherence_score ≥ 0.85`, `avg_compat ≥ 0.82`, ninguna canción con `fit_score < 0.72`
- **Nueva regla**: si `songs_to_remove.length / total > 0.25` → `rejected: true, action: "disband_cluster"`, devolver canciones a `unassigned`, no publicar playlist
- Si tras remover queda `< min_size` válido → mismo trato: disolver

## 4. Cambios de datos

Nueva tabla `cluster_candidates` (candidatos y unassigned tracking):

```text
id, user_id, status ('candidate'|'unassigned'|'promoted'|'rejected'),
centroid jsonb, avg_compat numeric, min_compat numeric,
size int, dimensions_summary jsonb, created_at, updated_at
```

Y `cluster_candidate_tracks(cluster_id, track_id, compat_to_centroid)`.

`generated_playlists` gana: `avg_compat`, `min_compat`, `dimensions_summary jsonb`, `source_cluster_id`.

## 5. UI

- Deshabilitar botón "Generate" del sistema viejo mientras exista pipeline v2.
- Nueva sección "Sample Test" en Playlists: corre `cluster-library` con muestra de 150 y muestra tabla con:
  - Cluster · size · avg_compat · min_compat · dimensiones dominantes · canción menos compatible · diferencia vs. los otros clusters
  - Lista de unassigned
- Solo cuando yo apruebe la muestra, se habilita "Run on full library".
- En playlists ya publicadas, mostrar **nombre + artista + razón**, nunca IDs. Auditar `PlaylistDetail`/`PlaylistEditor` para eliminar cualquier ID visible.

## 6. Orden de ejecución (esta iteración)

1. Migración: nuevas tablas + columnas.
2. Escribir `cluster-library` (matemática de clustering + validaciones, sin IA).
3. Escribir `name-cluster` (solo nombrar clusters aprobados).
4. Endurecer `review-playlist` con la regla del 25% y disolución.
5. UI: pantalla "Sample Test" en `/ai-playlists` + deshabilitar el generador viejo.
6. Correr la muestra de 150 canciones y **enseñarte el reporte**. No re-etiqueto ni proceso la biblioteca completa hasta tu aprobación.

## Detalles técnicos

- Clustering en Deno con álgebra vectorial simple (sin dependencias pesadas). Similitud coseno sobre vector normalizado 15-dim.
- Umbrales configurables en constantes al inicio del archivo para poder ajustar tras la muestra.
- Todo idempotente: correr `cluster-library` recomputa candidatos sin duplicar.
- Se preserva `generate-ai-playlist` en el código pero deshabilitado desde UI (por si quieres comparar).

¿Apruebas este plan para empezar por la migración + `cluster-library` + pantalla de muestra?
