# Roadmap — Mensaje Maestro Tempo

## Parte 1 — URGENTE: Not Placed (1,293 / 77%)
- [ ] Revisar logs del último Rebuild: fallos/timeouts/límites de Gemini; error NUNCA = rechazo (queda en su lugar o "Analyzing…", reintento con menos concurrencia). Detener Rebuild si corre.
- [ ] Canciones sin análisis de audio → "Analyzing…" (no Not placed); reanudar análisis de fondo.
- [ ] Re-agrupar Not placed entre sí hasta 3 vueltas (mismas reglas + oído).
- [ ] Anclas: 3 por playlist (representativas y distintas); comparar con la más parecida; score ≥8.
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
- [ ] Beatles ≠ Phil Collins "All of My Life"; "Can You Feel the Love Tonight" ≠ "My Destiny"; Forms Of Love: fuera Dune/calvera/Working for It/Waves & Wavs/L.I.F.E, entra Tell Me Are We.
- [ ] 4 vibes: "late night drive", "chill platica buena", "carne asada con la familia", "full instrumental sunset" — embudo, entendido, canciones, tiempo.

## Después (bloqueado hasta reportar lo anterior)
- [ ] Playlists que crecen solas con likes nuevos (detección 6 h, análisis inmediato, inserción en posición, Auto-update, registro con Undo).
