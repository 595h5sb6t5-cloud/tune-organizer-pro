# Roadmap — Mensaje Maestro Tempo

## Orden vinculante actualizado
- [ ] Antes de confirmación/Rebuild: prueba del intruso con clips de 15 s, grupos de 20 traslapados, dos vueltas; 8+ contra dos de tres anclas; transiciones sin saltos; feedback X de Twenty Tears; deduplicación global por canción/versión. Reportar total de intrusos y tres razones reales.
- Implementado y con pruebas: gate compartido Gemini, 2/3 anclas ≥8, traslape de 20, segunda vuelta, deduplicación y feedback contextual. Falta confirmación end-to-end exitosa; no ejecutar Rebuild mientras falle.
- 22 oct 17:14 UTC: 1,677 registros activos; 0 pendientes de momentos, 0 de producción; 8 sin clip. Se repararon 53 falsos terminados y la última canción fuera de la cola. Audio MP3/M4A ahora se convierte en memoria a WAV válido de 15 s; prueba real de tres canciones recibió veredictos completos (0 intrusos), pero Twenty Tears sigue excluida por la corrección de la usuaria.
- Bloqueo actual: confirmación de chill platica buena no cumple el tiempo; hubo escucha tardía sin resultados y luego lectura de biblioteca >20 s. No hay Rebuild ni informe musical final. No atribuir estas corridas fallidas a rechazo musical.
- Verificado: 22 pruebas pasan; pausa real de audio/momentos devuelve foreground-priority con sesión autenticada; compilación limpia. No se ejecutó confirmación ni Rebuild.
- Pendiente de datos al 21 oct 02:08 UTC: 912/1,677 canciones con momentos; 1,536 pendientes de producción detallada. No declarar objetivos de velocidad/costo ni resultados musicales hasta las corridas reales.
- [ ] Completar producción oída (drum_sound, mix_character, vocal_space), compatibilidad ×0.6 si batería y mezcla distintas; sin reglas por artista.
- [ ] Prioridad del vibe: pausar/reanudar análisis, reintento una vez, mejores 8 con audio guardado primero, background con un mundo sonoro.
- [ ] Esperar tagging de momentos y audio pendiente; después confirmación de vibes; solo después Rebuild con 3 vueltas y reporte real.

## Parte 1 — URGENTE: Not Placed (1,293 / 77%)
- [ ] Revisar logs del último Rebuild: fallos/timeouts/límites de Gemini; error NUNCA = rechazo (queda en su lugar o "Analyzing…", reintento con menos concurrencia). Detener Rebuild si corre.
- [ ] Canciones sin análisis de audio → "Analyzing…" (no Not placed); reanudar análisis de fondo.
- [ ] Re-agrupar Not placed entre sí hasta 3 vueltas (mismas reglas + oído).
- [ ] Anclas: 3 por playlist (representativas y distintas); cada canción score ≥8 contra al menos 2 de 3.
- [ ] Meta: Not placed ≤ 20% sin bajar el 8 del oído; si no, reportar cuántas sacaron 7 y qué grupos hay.

## Parte 2 — Capa humana: Momentos
- [ ] Por canción (sin re-escuchar): `moments` (hasta 3 de la lista oficial, score 0–1) + `moment_story`; modelo rápido de texto; guardar en tabla global.
- [ ] AI Playlists: agrupar por MOMENTO → dentro, por MUNDO SONORO (idioma duro salvo instrumentales/elec. baile, era, scene, instrumentos, drive, texture, warmth, vocal_style, melodic_focus, feeling). Momento con 2 mundos = 2 playlists.
- [ ] Oído Gemini con 3 anclas: solo ≥8 ("¿mismo mundo y momento? ¿alguien daría skip?").
- [ ] Reglas: artista/colaboradores ≤20%, sin versiones duplicadas, sin artista repetido seguido, sin relleno, mínimo 8 o se deshace, máximo 40.
- [ ] sequence(): historia del momento, transiciones graduales, curva de energía natural del momento.

## Parte 3 — Vibe entiende momentos
- [ ] vibe-spec devuelve moments + moment_story; candidatas ordenadas por momento+sonido+feeling; oído recibe moment_story.
- [ ] "Lo que entendí": primero el momento en palabras humanas, debajo chips técnicos.
- [ ] Con semilla, su momento también cuenta.
- [ ] Instrumentales (vocals=none): sin filtro de idioma; Gemini escucha las 80 mejores.
- [ ] Vibe ≤20 s garantizado: sin audio → ordenar por texto, escuchar lo que quepa, el resto a cola de fondo (no es rechazo).

## Parte 4 — Nombres y descripciones
- [ ] Nombres 2–3 palabras del momento; prohibidos: géneros/escenas/años/artistas, Vibes/Flow/Grooves/Mix/Classics, puntos medios, relleno (Luminous, Timeless, Reflections, Moods, Echoes, Layers, Pulse, Bliss).
- [ ] Ninguna palabra repetida entre nombres (salvo artículos); aplica a playlists existentes y vibes.
- [ ] Descripción: frase humana del momento; mostrar en app + descripción en Spotify.

## Parte 5 — Velocidad y costo
- [ ] Vibe: primeras <10 s, total <20 s; AI Playlists instantáneo.
- [ ] Análisis una vez por canción (global); caché del oído; re-escuchar solo playlists modificadas.

## Pruebas (iterar hasta pasar, luego reportar)
- [ ] Rebuild: playlists con nombre+momento+descripción; Not placed ≤20%; Analyzing…; errores de escucha; créditos y tiempo.
- [ ] Reportar ubicación y vecinas de "All of My Life" (Beatles permitidos si el oído acepta); ubicación de "Can You Feel the Love Tonight" y "My Destiny". Forms Of Love: solo Dune/calvera y correcciones X son exclusiones decididas; reportar lista completa y razones del oído sin forzar otras canciones.
- [ ] 4 vibes: "late night drive", "chill platica buena", "carne asada con la familia", "full instrumental sunset" — embudo, entendido, canciones, tiempo.

## Después (bloqueado hasta reportar lo anterior)
- [ ] Playlists que crecen solas con likes nuevos (detección 6 h, análisis inmediato, inserción en posición, Auto-update, registro con Undo).
