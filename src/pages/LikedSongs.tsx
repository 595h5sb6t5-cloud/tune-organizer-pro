import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Heart, Music, Search, ChevronLeft } from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AudioPreviewButton } from "@/components/app/AudioPreviewButton";
import { useSpotifyLibrary } from "@/hooks/use-spotify-library";

const PAGE_SIZE = 50;

const LikedSongs = () => {
  const { likedSongs, likedCount } = useSpotifyLibrary();
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!search.trim()) return likedSongs;
    const q = search.toLowerCase();
    return likedSongs.filter(
      s => s.track_name.toLowerCase().includes(q) || s.artist_name.toLowerCase().includes(q) || s.album_name?.toLowerCase().includes(q)
    );
  }, [likedSongs, search]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  return (
    <AppLayout>
      <div className="max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" className="rounded-full" asChild>
            <Link to="/library"><ChevronLeft className="w-5 h-5" /></Link>
          </Button>
          <Heart className="w-6 h-6 text-accent" />
          <div>
            <h1 className="font-heading text-2xl">Liked Songs</h1>
            <p className="text-sm text-muted-foreground">{likedCount} songs</p>
          </div>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search songs, artists, albums…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
            className="pl-10"
          />
        </div>

        <div className="space-y-1">
          {visible.map((song, i) => (
            <div key={song.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-elevated transition-colors group">
              <span className="w-6 text-xs text-muted-foreground text-right shrink-0">{i + 1}</span>
              {song.image_url ? (
                <img src={song.image_url} alt="" className="w-10 h-10 rounded-lg object-cover" loading="lazy" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  <Music className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{song.track_name}</p>
                <p className="text-xs text-muted-foreground truncate">{song.artist_name}{song.album_name ? ` · ${song.album_name}` : ""}</p>
              </div>
              <AudioPreviewButton trackId={song.spotify_track_id} previewUrl={null} size="sm" />
            </div>
          ))}
        </div>

        {hasMore && (
          <div className="text-center mt-6">
            <Button variant="outline" onClick={() => setVisibleCount(v => v + PAGE_SIZE)}>
              Load more ({filtered.length - visibleCount} remaining)
            </Button>
          </div>
        )}

        {filtered.length === 0 && search && (
          <p className="text-center text-muted-foreground mt-10">No songs match "{search}"</p>
        )}
      </div>
    </AppLayout>
  );
};

export default LikedSongs;
