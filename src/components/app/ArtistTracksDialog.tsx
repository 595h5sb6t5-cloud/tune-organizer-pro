import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Music2, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artist: {
    spotify_artist_id: string;
    artist_name: string;
    image_url: string | null;
    genres: string[];
    top_tracks_count?: number | null;
    top_tracks_synced_at?: string | null;
  } | null;
}

interface ArtistTrack {
  source: string;
  spotify_track_id: string;
  name: string;
  album_name: string | null;
  preview_url: string | null;
  spotify_url: string | null;
  popularity: number | null;
}

export function ArtistTracksDialog({ open, onOpenChange, artist }: Props) {
  const { user } = useAuth();
  const [tracks, setTracks] = useState<ArtistTrack[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !artist || !user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: links } = await supabase
        .from("artist_tracks")
        .select("source, track_spotify_id")
        .eq("user_id", user.id)
        .eq("artist_spotify_id", artist.spotify_artist_id);

      const ids = (links ?? []).map((l) => l.track_spotify_id);
      if (!ids.length) {
        if (!cancelled) { setTracks([]); setLoading(false); }
        return;
      }
      const { data: trackRows } = await supabase
        .from("tracks")
        .select("spotify_track_id, name, album_name, preview_url, spotify_url, popularity")
        .in("spotify_track_id", ids);

      const sourceById = new Map((links ?? []).map((l) => [l.track_spotify_id, l.source]));
      const merged: ArtistTrack[] = (trackRows ?? []).map((t: any) => ({
        source: sourceById.get(t.spotify_track_id) ?? "top_tracks",
        spotify_track_id: t.spotify_track_id,
        name: t.name,
        album_name: t.album_name,
        preview_url: t.preview_url,
        spotify_url: t.spotify_url,
        popularity: t.popularity,
      })).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

      if (!cancelled) { setTracks(merged); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, artist, user]);

  if (!artist) return null;
  const pending = (artist.top_tracks_count ?? 0) === 0 && !artist.top_tracks_synced_at;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {artist.image_url ? (
              <img src={artist.image_url} alt={artist.artist_name} className="w-12 h-12 rounded-full object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                <Music2 className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <div className="font-serif text-xl">{artist.artist_name}</div>
              {artist.genres?.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {artist.genres.slice(0, 3).map((g) => (
                    <Badge key={g} variant="secondary" className="text-[10px]">{g}</Badge>
                  ))}
                </div>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-96 overflow-y-auto -mx-1 px-1">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading tracks…
            </div>
          ) : tracks.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {pending
                ? "Tracks pending import — sync your Spotify library to bring in this artist's top tracks."
                : "No tracks found yet for this artist. Try a full sync."}
            </div>
          ) : (
            <ul className="space-y-1">
              {tracks.map((t) => (
                <li key={t.spotify_track_id} className="flex items-center justify-between gap-2 px-2 py-2 rounded hover:bg-secondary/40">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{t.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {t.album_name ?? "—"} · <span className="capitalize">{t.source.replace("_", " ")}</span>
                    </p>
                  </div>
                  {t.spotify_url && (
                    <a
                      href={t.spotify_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent hover:underline shrink-0"
                    >
                      Open
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
