# Roadmap — Mensaje maestro (21 oct 2026)

Orden obligatorio: tagging/audio → confirmación de vibes → Rebuild (3 vueltas) → reporte PRUEBAS. Playlists que crecen solas: NO empezar hasta reportar todo.

## Hecho
- [x] Producción detallada: drum_sound / mix_character / vocal_space en track_audio_analysis, prompt de audio, merge doble escucha
- [x] compatibility(): ×0.6 si drum_sound y mix_character son ambos distintos
- [x] Prompt del oído (vibe-listen, vibe-select): regla de producción + un solo mundo sonoro para background
- [x] Primer lote del oído = mejores 8 con audio guardado (jobs ordenados por ranking)
- [x] Sin audio: se omiten (no se rechazan) y se encolan a audio-analyze al terminar el vibe
- [x] Pausa de análisis de fondo durante el vibe (background_control) + 1 reintento en funciones
- [x] Regla de artistas eliminada: no hay prohibición de Beatles; solo match por sonido/feeling

## En curso
- [ ] Tagging de momentos: 468/1677 (corriendo, self-chain)
- [ ] Backfill de producción en audio (corriendo, self-chain; cola incluye drum_sound NULL)

## Pendiente (en orden)
- [ ] Esperar a que terminen tagging + audio
- [ ] Corrida de confirmación de vibes: "late night drive", "chill platica buena", "carne asada con la familia", "full instrumental sunset" + semilla Forms Of Love (Dune/calvera/Working for It/Waves & Wavs/L.I.F.E fuera; Tell Me Are We dentro)
- [ ] Rebuild AI Playlists con 3 vueltas
- [ ] Verificar en resultado real: "All of My Life" (playlist y vecinas), "Can You Feel the Love Tonight" vs "My Destiny" separadas, Not placed ≤ 20%
- [ ] Reporte PRUEBAS completo con datos reales (canciones, tiempos, errores, créditos)
