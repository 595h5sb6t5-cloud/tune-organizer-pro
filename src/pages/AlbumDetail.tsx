import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft, Disc3, Music, Loader2 } from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { AudioPreviewButton } from "@/components/app/AudioPreviewButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

interface AlbumTrack {
  id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  track_number: number;
  disc_number: number;
  duration_ms: number | null;
}

interface AlbumInfo {
  album_name: string;
  artist_name: string;
  image_url: string | null;
  release_date: string | null;
  total_tracks: number;
  album_type: string | null;
}

const AlbumDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [album, setAlbum] = useState<AlbumInfo | null>(null);
  const [tracks, setTracks] = useState<AlbumTrack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      setLoading(true);
      const [albumRes, tracksRes] = await Promise.all([
        supabase.from("spotify_saved_albums").select("album_name, artist_name, image_url, release_date, total_tracks, album_type").eq("id", id).eq("user_id", user.id).single(),
        supabase.from("spotify_album_tracks").select("id, spotify_track_id, track_name, artist_name, track_number, disc_number, duration_ms").eq("album_id", id).eq("user_id", user.id).order("disc_number").order("track_number"),
      ]);
      setAlbum(albumRes.data as AlbumInfo | null);
      setTracks((tracksRes.data as AlbumTrack[]) ?? []);
      setLoading(false);
    })();
  }, [id, user]);

  const formatDuration = (ms: number | null) => {
    if (!ms) return "";
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <AppLayout>
      <div className="max-w-4xl">
        <Button variant="ghost" size="sm" className="mb-4 gap-1" asChild>
          <Link to="/playlists"><ChevronLeft className="w-4 h-4" /> Library</Link>
        </Button>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>
        ) : !album ? (
          <p className="text-muted-foreground text-center mt-10">Album not found.</p>
        ) : (
          <>
            <div className="flex gap-6 mb-8">
              {album.image_url ? (
                <img src={album.image_url} alt={album.album_name} className="w-48 h-48 rounded-2xl object-cover shadow-lg shrink-0" />
              ) : (
                <div className="w-48 h-48 rounded-2xl bg-secondary flex items-center justify-center shrink-0">
                  <Disc3 className="w-16 h-16 text-muted-foreground" />
                </div>
              )}
              <div className="flex flex-col justify-end">
                {album.album_type && <span className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{album.album_type}</span>}
                <h1 className="font-heading text-3xl mb-1">{album.album_name}</h1>
                <p className="text-muted-foreground">{album.artist_name}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {album.total_tracks} tracks{album.release_date ? ` · ${album.release_date.slice(0, 4)}` : ""}
                </p>
              </div>
            </div>

            <div className="space-y-1">
              {tracks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-elevated transition-colors group">
                  <span className="w-6 text-xs text-muted-foreground text-right shrink-0">{t.track_number}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{t.track_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{t.artist_name}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{formatDuration(t.duration_ms)}</span>
                  <AudioPreviewButton trackId={t.spotify_track_id} previewUrl={null} size="sm" />
                </div>
              ))}
              {tracks.length === 0 && (
                <p className="text-center text-muted-foreground py-10">No tracks imported for this album yet.</p>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default AlbumDetail;
