
-- Add unique constraint for upserts on spotify_playlist_tracks
-- First check if it exists to avoid errors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'spotify_playlist_tracks_playlist_id_spotify_track_id_key'
  ) THEN
    ALTER TABLE public.spotify_playlist_tracks
      ADD CONSTRAINT spotify_playlist_tracks_playlist_id_spotify_track_id_key
      UNIQUE (playlist_id, spotify_track_id);
  END IF;
END $$;

-- Add unique constraint for liked_songs if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'liked_songs_user_id_spotify_track_id_key'
  ) THEN
    ALTER TABLE public.liked_songs
      ADD CONSTRAINT liked_songs_user_id_spotify_track_id_key
      UNIQUE (user_id, spotify_track_id);
  END IF;
END $$;

-- Add unique constraint for imported_tracks if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'imported_tracks_user_id_spotify_track_id_key'
  ) THEN
    ALTER TABLE public.imported_tracks
      ADD CONSTRAINT imported_tracks_user_id_spotify_track_id_key
      UNIQUE (user_id, spotify_track_id);
  END IF;
END $$;

-- Add unique constraint for spotify_playlists if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'spotify_playlists_user_id_spotify_playlist_id_key'
  ) THEN
    ALTER TABLE public.spotify_playlists
      ADD CONSTRAINT spotify_playlists_user_id_spotify_playlist_id_key
      UNIQUE (user_id, spotify_playlist_id);
  END IF;
END $$;

-- Add unique constraint for spotify_saved_albums if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'spotify_saved_albums_user_id_spotify_album_id_key'
  ) THEN
    ALTER TABLE public.spotify_saved_albums
      ADD CONSTRAINT spotify_saved_albums_user_id_spotify_album_id_key
      UNIQUE (user_id, spotify_album_id);
  END IF;
END $$;

-- Add unique constraint for spotify_followed_artists if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'spotify_followed_artists_user_id_spotify_artist_id_key'
  ) THEN
    ALTER TABLE public.spotify_followed_artists
      ADD CONSTRAINT spotify_followed_artists_user_id_spotify_artist_id_key
      UNIQUE (user_id, spotify_artist_id);
  END IF;
END $$;

-- Add unique constraint for spotify_album_tracks if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'spotify_album_tracks_album_id_spotify_track_id_key'
  ) THEN
    ALTER TABLE public.spotify_album_tracks
      ADD CONSTRAINT spotify_album_tracks_album_id_spotify_track_id_key
      UNIQUE (album_id, spotify_track_id);
  END IF;
END $$;

-- Add source_type column to spotify_playlists
ALTER TABLE public.spotify_playlists
  ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'saved';

-- Add track_uri column to spotify_playlist_tracks
ALTER TABLE public.spotify_playlist_tracks
  ADD COLUMN IF NOT EXISTS track_uri text;
