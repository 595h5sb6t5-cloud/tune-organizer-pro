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
          spotify_track_id: string
          user_id: string
        }
        Insert: {
          cluster_id: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          liked_song_id: string
          spotify_track_id: string
          user_id: string
        }
        Update: {
          cluster_id?: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          liked_song_id?: string
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
          created_at: string
          energy: string | null
          era: string | null
          genre_tags: string[] | null
          id: string
          image_url: string | null
          mood: string | null
          production_style: string | null
          spotify_track_id: string
          tempo_estimate: string | null
          track_name: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          album_name?: string | null
          analyzed_at?: string | null
          artist_name: string
          atmosphere?: string | null
          created_at?: string
          energy?: string | null
          era?: string | null
          genre_tags?: string[] | null
          id?: string
          image_url?: string | null
          mood?: string | null
          production_style?: string | null
          spotify_track_id: string
          tempo_estimate?: string | null
          track_name: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          album_name?: string | null
          analyzed_at?: string | null
          artist_name?: string
          atmosphere?: string | null
          created_at?: string
          energy?: string | null
          era?: string | null
          genre_tags?: string[] | null
          id?: string
          image_url?: string | null
          mood?: string | null
          production_style?: string | null
          spotify_track_id?: string
          tempo_estimate?: string | null
          track_name?: string
          user_id?: string
        }
        Relationships: []
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
      spotify_connections: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          refresh_token: string
          spotify_user_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
          refresh_token: string
          spotify_user_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          spotify_user_id?: string | null
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
          id: string
          image_url: string | null
          playlist_id: string
          position: number
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
          playlist_id: string
          position?: number
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
          playlist_id?: string
          position?: number
          spotify_track_id?: string
          track_name?: string
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
          is_owned_by_user: boolean
          last_synced_at: string
          name: string
          snapshot_id: string | null
          spotify_owner_id: string | null
          spotify_playlist_id: string
          track_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_owned_by_user?: boolean
          last_synced_at?: string
          name: string
          snapshot_id?: string | null
          spotify_owner_id?: string | null
          spotify_playlist_id: string
          track_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_owned_by_user?: boolean
          last_synced_at?: string
          name?: string
          snapshot_id?: string | null
          spotify_owner_id?: string | null
          spotify_playlist_id?: string
          track_count?: number
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
