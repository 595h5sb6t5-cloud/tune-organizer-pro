export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_track_analysis: {
        Row: {
          aggressiveness: number | null
          analysis_confidence: number | null
          analysis_stage: string | null
          analysis_version: string | null
          artist_name: string | null
          avoid_pairing_with: string[]
          bass_level: number | null
          beat_style: string | null
          best_contexts: string[]
          best_contexts_v2: string[] | null
          compatibility_notes: string | null
          compatible_playlist_types: string[] | null
          confidence_score: number | null
          created_at: string
          dance_feel: number | null
          darkness: number | null
          drum_intensity: number | null
          emotional_intensity: number | null
          energy_level: string | null
          energy_score: number | null
          full_analysis: Json | null
          id: string
          instrumentation_summary: string | null
          language: string | null
          last_error: string | null
          liked_song_id: string | null
          main_genre: string | null
          main_mood: string | null
          melody_level: number | null
          model_used: string | null
          moods: string[]
          nostalgia: number | null
          playlist_fit: Json
          primary_genre: string | null
          prompt_version: string | null
          reasoning_mode: string | null
          retry_count: number
          rhythm_type: string | null
          schema_version: string | null
          secondary_genres: string[]
          secondary_genres_v2: string[] | null
          secondary_moods_v2: string[] | null
          softness: number | null
          song_variation: number | null
          sound_texture: string | null
          spotify_track_id: string | null
          tempo_feel: string | null
          track_id: string
          track_name: string | null
          transition_in: string | null
          transition_out: string | null
          updated_at: string
          user_id: string
          vibe_tags: string[]
          vocal_intensity: number | null
        }
        Insert: {
          aggressiveness?: number | null
          analysis_confidence?: number | null
          analysis_stage?: string | null
          analysis_version?: string | null
          artist_name?: string | null
          avoid_pairing_with?: string[]
          bass_level?: number | null
          beat_style?: string | null
          best_contexts?: string[]
          best_contexts_v2?: string[] | null
          compatibility_notes?: string | null
          compatible_playlist_types?: string[] | null
          confidence_score?: number | null
          created_at?: string
          dance_feel?: number | null
          darkness?: number | null
          drum_intensity?: number | null
          emotional_intensity?: number | null
          energy_level?: string | null
          energy_score?: number | null
          full_analysis?: Json | null
          id?: string
          instrumentation_summary?: string | null
          language?: string | null
          last_error?: string | null
          liked_song_id?: string | null
          main_genre?: string | null
          main_mood?: string | null
          melody_level?: number | null
          model_used?: string | null
          moods?: string[]
          nostalgia?: number | null
          playlist_fit?: Json
          primary_genre?: string | null
          prompt_version?: string | null
          reasoning_mode?: string | null
          retry_count?: number
          rhythm_type?: string | null
          schema_version?: string | null
          secondary_genres?: string[]
          secondary_genres_v2?: string[] | null
          secondary_moods_v2?: string[] | null
          softness?: number | null
          song_variation?: number | null
          sound_texture?: string | null
          spotify_track_id?: string | null
          tempo_feel?: string | null
          track_id: string
          track_name?: string | null
          transition_in?: string | null
          transition_out?: string | null
          updated_at?: string
          user_id: string
          vibe_tags?: string[]
          vocal_intensity?: number | null
        }
        Update: {
          aggressiveness?: number | null
          analysis_confidence?: number | null
          analysis_stage?: string | null
          analysis_version?: string | null
          artist_name?: string | null
          avoid_pairing_with?: string[]
          bass_level?: number | null
          beat_style?: string | null
          best_contexts?: string[]
          best_contexts_v2?: string[] | null
          compatibility_notes?: string | null
          compatible_playlist_types?: string[] | null
          confidence_score?: number | null
          created_at?: string
          dance_feel?: number | null
          darkness?: number | null
          drum_intensity?: number | null
          emotional_intensity?: number | null
          energy_level?: string | null
          energy_score?: number | null
          full_analysis?: Json | null
          id?: string
          instrumentation_summary?: string | null
          language?: string | null
          last_error?: string | null
          liked_song_id?: string | null
          main_genre?: string | null
          main_mood?: string | null
          melody_level?: number | null
          model_used?: string | null
          moods?: string[]
          nostalgia?: number | null
          playlist_fit?: Json
          primary_genre?: string | null
          prompt_version?: string | null
          reasoning_mode?: string | null
          retry_count?: number
          rhythm_type?: string | null
          schema_version?: string | null
          secondary_genres?: string[]
          secondary_genres_v2?: string[] | null
          secondary_moods_v2?: string[] | null
          softness?: number | null
          song_variation?: number | null
          sound_texture?: string | null
          spotify_track_id?: string | null
          tempo_feel?: string | null
          track_id?: string
          track_name?: string | null
          transition_in?: string | null
          transition_out?: string | null
          updated_at?: string
          user_id?: string
          vibe_tags?: string[]
          vocal_intensity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_track_analysis_liked_song_id_fkey"
            columns: ["liked_song_id"]
            isOneToOne: false
            referencedRelation: "liked_songs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_track_analysis_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      albums: {
        Row: {
          album_type: string | null
          artist_names: string[]
          created_at: string
          id: string
          image_url: string | null
          name: string
          release_date: string | null
          spotify_album_id: string
          spotify_url: string | null
          total_tracks: number | null
          updated_at: string
        }
        Insert: {
          album_type?: string | null
          artist_names?: string[]
          created_at?: string
          id?: string
          image_url?: string | null
          name: string
          release_date?: string | null
          spotify_album_id: string
          spotify_url?: string | null
          total_tracks?: number | null
          updated_at?: string
        }
        Update: {
          album_type?: string | null
          artist_names?: string[]
          created_at?: string
          id?: string
          image_url?: string | null
          name?: string
          release_date?: string | null
          spotify_album_id?: string
          spotify_url?: string | null
          total_tracks?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      analysis_benchmarks: {
        Row: {
          avg_ms_per_track: number | null
          cache_hit_pct: number | null
          cache_hits: number
          cached_prompt_tokens: number
          concurrency: number | null
          created_at: string
          id: string
          json_errors: number
          label: string
          model_used: string
          notes: string | null
          openai_calls: number
          per_stage_ms: Json | null
          per_track_ms: Json | null
          prompt_version: string | null
          retries: number
          sample_size: number
          schema_version: string | null
          total_completion_tokens: number
          total_ms: number
          total_prompt_tokens: number
          total_reasoning_tokens: number
          user_id: string
        }
        Insert: {
          avg_ms_per_track?: number | null
          cache_hit_pct?: number | null
          cache_hits?: number
          cached_prompt_tokens?: number
          concurrency?: number | null
          created_at?: string
          id?: string
          json_errors?: number
          label: string
          model_used: string
          notes?: string | null
          openai_calls?: number
          per_stage_ms?: Json | null
          per_track_ms?: Json | null
          prompt_version?: string | null
          retries?: number
          sample_size: number
          schema_version?: string | null
          total_completion_tokens?: number
          total_ms: number
          total_prompt_tokens?: number
          total_reasoning_tokens?: number
          user_id: string
        }
        Update: {
          avg_ms_per_track?: number | null
          cache_hit_pct?: number | null
          cache_hits?: number
          cached_prompt_tokens?: number
          concurrency?: number | null
          created_at?: string
          id?: string
          json_errors?: number
          label?: string
          model_used?: string
          notes?: string | null
          openai_calls?: number
          per_stage_ms?: Json | null
          per_track_ms?: Json | null
          prompt_version?: string | null
          retries?: number
          sample_size?: number
          schema_version?: string | null
          total_completion_tokens?: number
          total_ms?: number
          total_prompt_tokens?: number
          total_reasoning_tokens?: number
          user_id?: string
        }
        Relationships: []
      }
      app_users: {
        Row: {
          country: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          last_sync_at: string | null
          product_type: string | null
          profile_image_url: string | null
          spotify_access_token_encrypted: string | null
          spotify_refresh_token_encrypted: string | null
          spotify_user_id: string | null
          subscription_tier: string
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          last_sync_at?: string | null
          product_type?: string | null
          profile_image_url?: string | null
          spotify_access_token_encrypted?: string | null
          spotify_refresh_token_encrypted?: string | null
          spotify_user_id?: string | null
          subscription_tier?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          country?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          last_sync_at?: string | null
          product_type?: string | null
          profile_image_url?: string | null
          spotify_access_token_encrypted?: string | null
          spotify_refresh_token_encrypted?: string | null
          spotify_user_id?: string | null
          subscription_tier?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      artist_tracks: {
        Row: {
          artist_spotify_id: string
          created_at: string
          id: string
          source: string
          track_spotify_id: string
          user_id: string
        }
        Insert: {
          artist_spotify_id: string
          created_at?: string
          id?: string
          source?: string
          track_spotify_id: string
          user_id: string
        }
        Update: {
          artist_spotify_id?: string
          created_at?: string
          id?: string
          source?: string
          track_spotify_id?: string
          user_id?: string
        }
        Relationships: []
      }
      artists: {
        Row: {
          created_at: string
          followers_count: number | null
          genres: string[]
          id: string
          image_url: string | null
          name: string
          popularity: number | null
          spotify_artist_id: string
          spotify_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          followers_count?: number | null
          genres?: string[]
          id?: string
          image_url?: string | null
          name: string
          popularity?: number | null
          spotify_artist_id: string
          spotify_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          followers_count?: number | null
          genres?: string[]
          id?: string
          image_url?: string | null
          name?: string
          popularity?: number | null
          spotify_artist_id?: string
          spotify_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      generated_playlist_tracks: {
        Row: {
          added_by: string
          created_at: string
          fit_score: number | null
          generated_playlist_id: string
          id: string
          position: number
          reason_for_inclusion: string | null
          track_id: string
          user_id: string
        }
        Insert: {
          added_by?: string
          created_at?: string
          fit_score?: number | null
          generated_playlist_id: string
          id?: string
          position?: number
          reason_for_inclusion?: string | null
          track_id: string
          user_id: string
        }
        Update: {
          added_by?: string
          created_at?: string
          fit_score?: number | null
          generated_playlist_id?: string
          id?: string
          position?: number
          reason_for_inclusion?: string | null
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_playlist_tracks_generated_playlist_id_fkey"
            columns: ["generated_playlist_id"]
            isOneToOne: false
            referencedRelation: "generated_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_playlist_tracks_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_playlists: {
        Row: {
          concept: string | null
          context: string | null
          cover_image_url: string | null
          created_at: string
          created_by_ai: boolean
          description: string | null
          exported_at: string | null
          id: string
          intent_profile: Json | null
          is_exported_to_spotify: boolean
          is_public: boolean
          last_export_error: string | null
          last_export_step: string | null
          name: string
          snapshot_id: string | null
          spotify_playlist_id: string | null
          spotify_url: string | null
          status: string
          updated_at: string
          user_id: string
          vibe: string | null
        }
        Insert: {
          concept?: string | null
          context?: string | null
          cover_image_url?: string | null
          created_at?: string
          created_by_ai?: boolean
          description?: string | null
          exported_at?: string | null
          id?: string
          intent_profile?: Json | null
          is_exported_to_spotify?: boolean
          is_public?: boolean
          last_export_error?: string | null
          last_export_step?: string | null
          name: string
          snapshot_id?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
          vibe?: string | null
        }
        Update: {
          concept?: string | null
          context?: string | null
          cover_image_url?: string | null
          created_at?: string
          created_by_ai?: boolean
          description?: string | null
          exported_at?: string | null
          id?: string
          intent_profile?: Json | null
          is_exported_to_spotify?: boolean
          is_public?: boolean
          last_export_error?: string | null
          last_export_step?: string | null
          name?: string
          snapshot_id?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          vibe?: string | null
        }
        Relationships: []
      }
      imported_tracks: {
        Row: {
          added_at: string | null
          album_name: string | null
          artist_name: string
          created_at: string
          id: string
          image_url: string | null
          release_date: string | null
          spotify_track_id: string
          track_name: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          album_name?: string | null
          artist_name: string
          created_at?: string
          id?: string
          image_url?: string | null
          release_date?: string | null
          spotify_track_id: string
          track_name: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          album_name?: string | null
          artist_name?: string
          created_at?: string
          id?: string
          image_url?: string | null
          release_date?: string | null
          spotify_track_id?: string
          track_name?: string
          user_id?: string
        }
        Relationships: []
      }
      liked_song_cluster_tracks: {
        Row: {
          cluster_id: string
          confidence_score: number | null
          created_at: string
          id: string
          liked_song_id: string
          position: number
          spotify_track_id: string
          user_id: string
        }
        Insert: {
          cluster_id: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          liked_song_id: string
          position?: number
          spotify_track_id: string
          user_id: string
        }
        Update: {
          cluster_id?: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          liked_song_id?: string
          position?: number
          spotify_track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "liked_song_cluster_tracks_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "liked_song_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liked_song_cluster_tracks_liked_song_id_fkey"
            columns: ["liked_song_id"]
            isOneToOne: false
            referencedRelation: "liked_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      liked_song_clusters: {
        Row: {
          ai_explanation: string | null
          analysis_model: string | null
          color_hex: string | null
          cover_tracks: Json | null
          created_at: string
          description: string | null
          energy_level: string | null
          era_range: string | null
          id: string
          mood_tags: string[] | null
          name: string
          sort_order: number
          spotify_exported_at: string | null
          spotify_playlist_id: string | null
          spotify_playlist_url: string | null
          tempo_range: string | null
          track_count: number
          updated_at: string
          user_id: string
          vibe_description: string | null
        }
        Insert: {
          ai_explanation?: string | null
          analysis_model?: string | null
          color_hex?: string | null
          cover_tracks?: Json | null
          created_at?: string
          description?: string | null
          energy_level?: string | null
          era_range?: string | null
          id?: string
          mood_tags?: string[] | null
          name: string
          sort_order?: number
          spotify_exported_at?: string | null
          spotify_playlist_id?: string | null
          spotify_playlist_url?: string | null
          tempo_range?: string | null
          track_count?: number
          updated_at?: string
          user_id: string
          vibe_description?: string | null
        }
        Update: {
          ai_explanation?: string | null
          analysis_model?: string | null
          color_hex?: string | null
          cover_tracks?: Json | null
          created_at?: string
          description?: string | null
          energy_level?: string | null
          era_range?: string | null
          id?: string
          mood_tags?: string[] | null
          name?: string
          sort_order?: number
          spotify_exported_at?: string | null
          spotify_playlist_id?: string | null
          spotify_playlist_url?: string | null
          tempo_range?: string | null
          track_count?: number
          updated_at?: string
          user_id?: string
          vibe_description?: string | null
        }
        Relationships: []
      }
      liked_songs: {
        Row: {
          added_at: string | null
          album_name: string | null
          analyzed_at: string | null
          artist_name: string
          atmosphere: string | null
          audio_acousticness: number | null
          audio_danceability: number | null
          audio_energy: number | null
          audio_features_fetched_at: string | null
          audio_instrumentalness: number | null
          audio_key: number | null
          audio_liveness: number | null
          audio_loudness: number | null
          audio_mode: number | null
          audio_speechiness: number | null
          audio_tempo: number | null
          audio_time_signature: number | null
          audio_valence: number | null
          created_at: string
          energy: string | null
          era: string | null
          genre_tags: string[] | null
          groove_feel: string | null
          id: string
          image_url: string | null
          intimacy_scale: string | null
          listening_context: string | null
          mood: string | null
          production_style: string | null
          rhythmic_identity: string | null
          sonic_brightness: string | null
          sonic_texture: string | null
          spatial_quality: string | null
          spotify_track_id: string
          tempo_estimate: string | null
          tension_level: string | null
          track_name: string
          user_id: string
          vocal_style: string | null
        }
        Insert: {
          added_at?: string | null
          album_name?: string | null
          analyzed_at?: string | null
          artist_name: string
          atmosphere?: string | null
          audio_acousticness?: number | null
          audio_danceability?: number | null
          audio_energy?: number | null
          audio_features_fetched_at?: string | null
          audio_instrumentalness?: number | null
          audio_key?: number | null
          audio_liveness?: number | null
          audio_loudness?: number | null
          audio_mode?: number | null
          audio_speechiness?: number | null
          audio_tempo?: number | null
          audio_time_signature?: number | null
          audio_valence?: number | null
          created_at?: string
          energy?: string | null
          era?: string | null
          genre_tags?: string[] | null
          groove_feel?: string | null
          id?: string
          image_url?: string | null
          intimacy_scale?: string | null
          listening_context?: string | null
          mood?: string | null
          production_style?: string | null
          rhythmic_identity?: string | null
          sonic_brightness?: string | null
          sonic_texture?: string | null
          spatial_quality?: string | null
          spotify_track_id: string
          tempo_estimate?: string | null
          tension_level?: string | null
          track_name: string
          user_id: string
          vocal_style?: string | null
        }
        Update: {
          added_at?: string | null
          album_name?: string | null
          analyzed_at?: string | null
          artist_name?: string
          atmosphere?: string | null
          audio_acousticness?: number | null
          audio_danceability?: number | null
          audio_energy?: number | null
          audio_features_fetched_at?: string | null
          audio_instrumentalness?: number | null
          audio_key?: number | null
          audio_liveness?: number | null
          audio_loudness?: number | null
          audio_mode?: number | null
          audio_speechiness?: number | null
          audio_tempo?: number | null
          audio_time_signature?: number | null
          audio_valence?: number | null
          created_at?: string
          energy?: string | null
          era?: string | null
          genre_tags?: string[] | null
          groove_feel?: string | null
          id?: string
          image_url?: string | null
          intimacy_scale?: string | null
          listening_context?: string | null
          mood?: string | null
          production_style?: string | null
          rhythmic_identity?: string | null
          sonic_brightness?: string | null
          sonic_texture?: string | null
          spatial_quality?: string | null
          spotify_track_id?: string
          tempo_estimate?: string | null
          tension_level?: string | null
          track_name?: string
          user_id?: string
          vocal_style?: string | null
        }
        Relationships: []
      }
      playlist_generation_jobs: {
        Row: {
          assigned_count: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          force_retag: boolean
          id: string
          phase: string
          saved_worlds: number
          started_at: string | null
          status: string
          status_message: string | null
          total_analyzed: number
          total_songs: number
          total_worlds: number
          updated_at: string
          user_id: string
          world_definitions: Json
          worlds_count: number
        }
        Insert: {
          assigned_count?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          force_retag?: boolean
          id?: string
          phase?: string
          saved_worlds?: number
          started_at?: string | null
          status?: string
          status_message?: string | null
          total_analyzed?: number
          total_songs?: number
          total_worlds?: number
          updated_at?: string
          user_id: string
          world_definitions?: Json
          worlds_count?: number
        }
        Update: {
          assigned_count?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          force_retag?: boolean
          id?: string
          phase?: string
          saved_worlds?: number
          started_at?: string | null
          status?: string
          status_message?: string | null
          total_analyzed?: number
          total_songs?: number
          total_worlds?: number
          updated_at?: string
          user_id?: string
          world_definitions?: Json
          worlds_count?: number
        }
        Relationships: []
      }
      playlist_tracks: {
        Row: {
          added_at: string | null
          added_by: string | null
          created_at: string
          id: string
          playlist_id: string
          position: number
          track_id: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          created_at?: string
          id?: string
          playlist_id: string
          position?: number
          track_id: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          created_at?: string
          id?: string
          playlist_id?: string
          position?: number
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_tracks_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "spotify_playlists_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_tracks_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_vibe_analysis: {
        Row: {
          ai_explanation: string | null
          analysis_model: string | null
          cohesion_description: string | null
          created_at: string
          emotional_arc: Json | null
          emotional_keywords: string[] | null
          energy_curve: Json | null
          energy_summary: string | null
          era_summary: string | null
          genre_blend: Json | null
          id: string
          language_summary: string | null
          listening_context: string | null
          mood_summary: string | null
          playlist_id: string
          primary_vibe: string
          production_summary: string | null
          secondary_vibes: string[] | null
          sonic_dna: Json | null
          sonic_palette: string[] | null
          structural_flow: string | null
          tempo_summary: string | null
          track_highlights: Json | null
          updated_at: string
          user_id: string
          user_intent: string | null
          vibe_color_hex: string | null
          what_belongs: string | null
          what_breaks_it: string | null
        }
        Insert: {
          ai_explanation?: string | null
          analysis_model?: string | null
          cohesion_description?: string | null
          created_at?: string
          emotional_arc?: Json | null
          emotional_keywords?: string[] | null
          energy_curve?: Json | null
          energy_summary?: string | null
          era_summary?: string | null
          genre_blend?: Json | null
          id?: string
          language_summary?: string | null
          listening_context?: string | null
          mood_summary?: string | null
          playlist_id: string
          primary_vibe: string
          production_summary?: string | null
          secondary_vibes?: string[] | null
          sonic_dna?: Json | null
          sonic_palette?: string[] | null
          structural_flow?: string | null
          tempo_summary?: string | null
          track_highlights?: Json | null
          updated_at?: string
          user_id: string
          user_intent?: string | null
          vibe_color_hex?: string | null
          what_belongs?: string | null
          what_breaks_it?: string | null
        }
        Update: {
          ai_explanation?: string | null
          analysis_model?: string | null
          cohesion_description?: string | null
          created_at?: string
          emotional_arc?: Json | null
          emotional_keywords?: string[] | null
          energy_curve?: Json | null
          energy_summary?: string | null
          era_summary?: string | null
          genre_blend?: Json | null
          id?: string
          language_summary?: string | null
          listening_context?: string | null
          mood_summary?: string | null
          playlist_id?: string
          primary_vibe?: string
          production_summary?: string | null
          secondary_vibes?: string[] | null
          sonic_dna?: Json | null
          sonic_palette?: string[] | null
          structural_flow?: string | null
          tempo_summary?: string | null
          track_highlights?: Json | null
          updated_at?: string
          user_id?: string
          user_intent?: string | null
          vibe_color_hex?: string | null
          what_belongs?: string | null
          what_breaks_it?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playlist_vibe_analysis_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "spotify_playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          apple_music_connected: boolean
          created_at: string
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string
          last_name: string | null
          onboarding_completed: boolean
          phone: string | null
          spotify_connected: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          apple_music_connected?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          onboarding_completed?: boolean
          phone?: string | null
          spotify_connected?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          apple_music_connected?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          onboarding_completed?: boolean
          phone?: string | null
          spotify_connected?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recommendation_feedback: {
        Row: {
          action: string
          created_at: string
          id: string
          playlist_id: string | null
          recommendation_id: string | null
          track_artist: string
          track_genre: string | null
          track_mood: string | null
          track_title: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          playlist_id?: string | null
          recommendation_id?: string | null
          track_artist: string
          track_genre?: string | null
          track_mood?: string | null
          track_title: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          playlist_id?: string | null
          recommendation_id?: string | null
          track_artist?: string
          track_genre?: string | null
          track_mood?: string | null
          track_title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_feedback_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "recommendation_history"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_history: {
        Row: {
          compatibility_breakdown: Json | null
          compatibility_score: number | null
          created_at: string
          discovery_mode: string | null
          id: string
          mood_tags: string[] | null
          playlist_id: string | null
          playlist_name: string | null
          popularity_tier: string | null
          reason: string | null
          status: string
          track_album: string | null
          track_artist: string
          track_energy: number | null
          track_genre: string | null
          track_mood: string | null
          track_tempo: number | null
          track_title: string
          track_valence: number | null
          track_year: number | null
          user_id: string | null
        }
        Insert: {
          compatibility_breakdown?: Json | null
          compatibility_score?: number | null
          created_at?: string
          discovery_mode?: string | null
          id?: string
          mood_tags?: string[] | null
          playlist_id?: string | null
          playlist_name?: string | null
          popularity_tier?: string | null
          reason?: string | null
          status?: string
          track_album?: string | null
          track_artist: string
          track_energy?: number | null
          track_genre?: string | null
          track_mood?: string | null
          track_tempo?: number | null
          track_title: string
          track_valence?: number | null
          track_year?: number | null
          user_id?: string | null
        }
        Update: {
          compatibility_breakdown?: Json | null
          compatibility_score?: number | null
          created_at?: string
          discovery_mode?: string | null
          id?: string
          mood_tags?: string[] | null
          playlist_id?: string | null
          playlist_name?: string | null
          popularity_tier?: string | null
          reason?: string | null
          status?: string
          track_album?: string | null
          track_artist?: string
          track_energy?: number | null
          track_genre?: string | null
          track_mood?: string | null
          track_tempo?: number | null
          track_title?: string
          track_valence?: number | null
          track_year?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      recommendations: {
        Row: {
          album_name: string | null
          artist_name: string | null
          based_on_playlist_id: string | null
          created_at: string
          final_decision: string | null
          fit_score: number | null
          id: string
          image_url: string | null
          matched_audio_features: string[] | null
          matched_contexts: string[] | null
          matched_moods: string[] | null
          possible_issue: string | null
          preview_url: string | null
          recommendation_reason: string | null
          spotify_track_id: string | null
          status: string
          track_id: string | null
          track_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          album_name?: string | null
          artist_name?: string | null
          based_on_playlist_id?: string | null
          created_at?: string
          final_decision?: string | null
          fit_score?: number | null
          id?: string
          image_url?: string | null
          matched_audio_features?: string[] | null
          matched_contexts?: string[] | null
          matched_moods?: string[] | null
          possible_issue?: string | null
          preview_url?: string | null
          recommendation_reason?: string | null
          spotify_track_id?: string | null
          status?: string
          track_id?: string | null
          track_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          album_name?: string | null
          artist_name?: string | null
          based_on_playlist_id?: string | null
          created_at?: string
          final_decision?: string | null
          fit_score?: number | null
          id?: string
          image_url?: string | null
          matched_audio_features?: string[] | null
          matched_contexts?: string[] | null
          matched_moods?: string[] | null
          possible_issue?: string | null
          preview_url?: string | null
          recommendation_reason?: string | null
          spotify_track_id?: string | null
          status?: string
          track_id?: string | null
          track_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_based_on_playlist_id_fkey"
            columns: ["based_on_playlist_id"]
            isOneToOne: false
            referencedRelation: "spotify_playlists_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      spotify_album_tracks: {
        Row: {
          album_id: string
          artist_name: string
          created_at: string
          disc_number: number | null
          duration_ms: number | null
          id: string
          spotify_track_id: string
          track_name: string
          track_number: number | null
          user_id: string
        }
        Insert: {
          album_id: string
          artist_name: string
          created_at?: string
          disc_number?: number | null
          duration_ms?: number | null
          id?: string
          spotify_track_id: string
          track_name: string
          track_number?: number | null
          user_id: string
        }
        Update: {
          album_id?: string
          artist_name?: string
          created_at?: string
          disc_number?: number | null
          duration_ms?: number | null
          id?: string
          spotify_track_id?: string
          track_name?: string
          track_number?: number | null
          user_id?: string
        }
        Relationships: []
      }
      spotify_connections: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          last_album_sync_at: string | null
          last_artist_sync_at: string | null
          last_full_sync_at: string | null
          last_incremental_sync_at: string | null
          last_library_sync_at: string | null
          last_playlist_sync_at: string | null
          refresh_token: string
          spotify_user_id: string | null
          sync_error: string | null
          sync_status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
          last_album_sync_at?: string | null
          last_artist_sync_at?: string | null
          last_full_sync_at?: string | null
          last_incremental_sync_at?: string | null
          last_library_sync_at?: string | null
          last_playlist_sync_at?: string | null
          refresh_token: string
          spotify_user_id?: string | null
          sync_error?: string | null
          sync_status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_album_sync_at?: string | null
          last_artist_sync_at?: string | null
          last_full_sync_at?: string | null
          last_incremental_sync_at?: string | null
          last_library_sync_at?: string | null
          last_playlist_sync_at?: string | null
          refresh_token?: string
          spotify_user_id?: string | null
          sync_error?: string | null
          sync_status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      spotify_followed_artists: {
        Row: {
          artist_name: string
          created_at: string
          follower_count: number | null
          genres: string[] | null
          id: string
          image_url: string | null
          popularity: number | null
          spotify_artist_id: string
          top_tracks_count: number
          top_tracks_synced_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          artist_name: string
          created_at?: string
          follower_count?: number | null
          genres?: string[] | null
          id?: string
          image_url?: string | null
          popularity?: number | null
          spotify_artist_id: string
          top_tracks_count?: number
          top_tracks_synced_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          artist_name?: string
          created_at?: string
          follower_count?: number | null
          genres?: string[] | null
          id?: string
          image_url?: string | null
          popularity?: number | null
          spotify_artist_id?: string
          top_tracks_count?: number
          top_tracks_synced_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      spotify_playlist_tracks: {
        Row: {
          added_at: string | null
          album_name: string | null
          artist_name: string
          created_at: string
          duration_ms: number | null
          id: string
          image_url: string | null
          playlist_id: string
          position: number
          preview_url: string | null
          spotify_track_id: string
          track_name: string
          track_uri: string | null
          user_id: string
        }
        Insert: {
          added_at?: string | null
          album_name?: string | null
          artist_name: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          image_url?: string | null
          playlist_id: string
          position?: number
          preview_url?: string | null
          spotify_track_id: string
          track_name: string
          track_uri?: string | null
          user_id: string
        }
        Update: {
          added_at?: string | null
          album_name?: string | null
          artist_name?: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          image_url?: string | null
          playlist_id?: string
          position?: number
          preview_url?: string | null
          spotify_track_id?: string
          track_name?: string
          track_uri?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spotify_playlist_tracks_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "spotify_playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      spotify_playlists: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_collaborative: boolean
          is_owned_by_user: boolean
          is_public: boolean
          last_synced_at: string
          name: string
          owner_display_name: string | null
          snapshot_id: string | null
          source_type: string | null
          spotify_owner_id: string | null
          spotify_playlist_id: string
          spotify_total_tracks: number
          spotify_url: string | null
          track_count: number
          tracks_import_error: string | null
          tracks_import_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_collaborative?: boolean
          is_owned_by_user?: boolean
          is_public?: boolean
          last_synced_at?: string
          name: string
          owner_display_name?: string | null
          snapshot_id?: string | null
          source_type?: string | null
          spotify_owner_id?: string | null
          spotify_playlist_id: string
          spotify_total_tracks?: number
          spotify_url?: string | null
          track_count?: number
          tracks_import_error?: string | null
          tracks_import_status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_collaborative?: boolean
          is_owned_by_user?: boolean
          is_public?: boolean
          last_synced_at?: string
          name?: string
          owner_display_name?: string | null
          snapshot_id?: string | null
          source_type?: string | null
          spotify_owner_id?: string | null
          spotify_playlist_id?: string
          spotify_total_tracks?: number
          spotify_url?: string | null
          track_count?: number
          tracks_import_error?: string | null
          tracks_import_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      spotify_playlists_v2: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_collaborative: boolean
          is_owner: boolean
          is_public: boolean
          last_synced_at: string
          name: string
          owner_spotify_id: string | null
          snapshot_id: string | null
          spotify_playlist_id: string
          spotify_url: string | null
          total_tracks: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_collaborative?: boolean
          is_owner?: boolean
          is_public?: boolean
          last_synced_at?: string
          name: string
          owner_spotify_id?: string | null
          snapshot_id?: string | null
          spotify_playlist_id: string
          spotify_url?: string | null
          total_tracks?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_collaborative?: boolean
          is_owner?: boolean
          is_public?: boolean
          last_synced_at?: string
          name?: string
          owner_spotify_id?: string | null
          snapshot_id?: string | null
          spotify_playlist_id?: string
          spotify_url?: string | null
          total_tracks?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      spotify_saved_albums: {
        Row: {
          added_at: string | null
          album_name: string
          album_type: string | null
          artist_name: string
          created_at: string
          genres: string[] | null
          id: string
          image_url: string | null
          label: string | null
          popularity: number | null
          release_date: string | null
          spotify_album_id: string
          total_tracks: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          album_name: string
          album_type?: string | null
          artist_name: string
          created_at?: string
          genres?: string[] | null
          id?: string
          image_url?: string | null
          label?: string | null
          popularity?: number | null
          release_date?: string | null
          spotify_album_id: string
          total_tracks?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          album_name?: string
          album_type?: string | null
          artist_name?: string
          created_at?: string
          genres?: string[] | null
          id?: string
          image_url?: string | null
          label?: string | null
          popularity?: number | null
          release_date?: string | null
          spotify_album_id?: string
          total_tracks?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sync_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          items_processed: number
          job_type: string
          started_at: string | null
          status: string
          total_items: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          items_processed?: number
          job_type: string
          started_at?: string | null
          status?: string
          total_items?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          items_processed?: number
          job_type?: string
          started_at?: string | null
          status?: string
          total_items?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tracks: {
        Row: {
          album_id: string | null
          album_name: string | null
          artist_names: string[]
          created_at: string
          duration_ms: number | null
          explicit: boolean
          id: string
          name: string
          popularity: number | null
          preview_url: string | null
          release_date: string | null
          spotify_track_id: string
          spotify_url: string | null
          updated_at: string
        }
        Insert: {
          album_id?: string | null
          album_name?: string | null
          artist_names?: string[]
          created_at?: string
          duration_ms?: number | null
          explicit?: boolean
          id?: string
          name: string
          popularity?: number | null
          preview_url?: string | null
          release_date?: string | null
          spotify_track_id: string
          spotify_url?: string | null
          updated_at?: string
        }
        Update: {
          album_id?: string | null
          album_name?: string | null
          artist_names?: string[]
          created_at?: string
          duration_ms?: number | null
          explicit?: boolean
          id?: string
          name?: string
          popularity?: number | null
          preview_url?: string | null
          release_date?: string | null
          spotify_track_id?: string
          spotify_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracks_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
        ]
      }
      user_followed_artists: {
        Row: {
          artist_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          artist_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          artist_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_followed_artists_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      user_recent_plays: {
        Row: {
          context_uri: string | null
          created_at: string
          id: string
          played_at: string
          track_id: string
          user_id: string
        }
        Insert: {
          context_uri?: string | null
          created_at?: string
          id?: string
          played_at: string
          track_id: string
          user_id: string
        }
        Update: {
          context_uri?: string | null
          created_at?: string
          id?: string
          played_at?: string
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_recent_plays_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      user_saved_albums: {
        Row: {
          added_at: string | null
          album_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          album_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          album_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_saved_albums_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
        ]
      }
      user_saved_tracks: {
        Row: {
          added_at: string | null
          created_at: string
          id: string
          track_id: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          created_at?: string
          id?: string
          track_id: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          created_at?: string
          id?: string
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_saved_tracks_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      user_subscription: {
        Row: {
          created_at: string
          current_period_started_at: string
          export_limit: number
          id: string
          is_active: boolean
          plan: string
          playlists_limit: number
          recommendations_limit: number
          song_analysis_limit: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_started_at?: string
          export_limit?: number
          id?: string
          is_active?: boolean
          plan?: string
          playlists_limit?: number
          recommendations_limit?: number
          song_analysis_limit?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_started_at?: string
          export_limit?: number
          id?: string
          is_active?: boolean
          plan?: string
          playlists_limit?: number
          recommendations_limit?: number
          song_analysis_limit?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_taste_profile: {
        Row: {
          accepted_count: number | null
          created_at: string
          discovery_preference: string | null
          dismissed_count: number | null
          favorite_artists: string[] | null
          favorite_genres: string[] | null
          favorite_moods: string[] | null
          id: string
          preferred_energy_max: number | null
          preferred_energy_min: number | null
          preferred_eras: string[] | null
          preferred_tempo_max: number | null
          preferred_tempo_min: number | null
          taste_clusters: Json | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_count?: number | null
          created_at?: string
          discovery_preference?: string | null
          dismissed_count?: number | null
          favorite_artists?: string[] | null
          favorite_genres?: string[] | null
          favorite_moods?: string[] | null
          id?: string
          preferred_energy_max?: number | null
          preferred_energy_min?: number | null
          preferred_eras?: string[] | null
          preferred_tempo_max?: number | null
          preferred_tempo_min?: number | null
          taste_clusters?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_count?: number | null
          created_at?: string
          discovery_preference?: string | null
          dismissed_count?: number | null
          favorite_artists?: string[] | null
          favorite_genres?: string[] | null
          favorite_moods?: string[] | null
          id?: string
          preferred_energy_max?: number | null
          preferred_energy_min?: number | null
          preferred_eras?: string[] | null
          preferred_tempo_max?: number | null
          preferred_tempo_min?: number | null
          taste_clusters?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_top_artists: {
        Row: {
          artist_id: string
          fetched_at: string
          id: string
          rank: number
          time_range: string
          user_id: string
        }
        Insert: {
          artist_id: string
          fetched_at?: string
          id?: string
          rank: number
          time_range: string
          user_id: string
        }
        Update: {
          artist_id?: string
          fetched_at?: string
          id?: string
          rank?: number
          time_range?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_top_artists_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      user_top_tracks: {
        Row: {
          fetched_at: string
          id: string
          rank: number
          time_range: string
          track_id: string
          user_id: string
        }
        Insert: {
          fetched_at?: string
          id?: string
          rank: number
          time_range: string
          track_id: string
          user_id: string
        }
        Update: {
          fetched_at?: string
          id?: string
          rank?: number
          time_range?: string
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_top_tracks_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
