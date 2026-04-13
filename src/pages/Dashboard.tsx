import { Link } from "react-router-dom";
import {
  Headphones,
  Loader2,
  Music,
  Sparkles,
  Heart,
  ListMusic,
  Users,
  BarChart3,
  Zap,
  TrendingUp,
  Disc3,
  Activity,
  Radio,
  Target,
  ThumbsUp,
  ThumbsDown,
  CalendarDays,
} from "lucide-react";
import AppLayout from "@/components/app/AppLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useSpotify } from "@/hooks/use-spotify";
import { useDashboardStats } from "@/hooks/use-dashboard-stats";
import { Progress } from "@/components/ui/progress";

/* ─── Stat Card ─── */
const StatCard = ({
  icon: Icon,
  value,
  label,
  accent = false,
}: {
  icon: React.ElementType;
  value: string | number;
  label: string;
  accent?: boolean;
}) => (
  <div className="p-5 rounded-2xl bg-surface-elevated border border-border/50 flex flex-col gap-2 hover:shadow-md transition-shadow">
    <Icon
      className={`w-5 h-5 ${accent ? "text-accent" : "text-muted-foreground"}`}
    />
    <p className="font-heading text-3xl">{value}</p>
    <p className="text-sm text-muted-foreground">{label}</p>
  </div>
);

/* ─── Section Heading ─── */
const SectionHeading = ({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) => (
  <div className="mb-4">
    <h2 className="font-heading text-2xl">{title}</h2>
    {subtitle && (
      <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
    )}
  </div>
);

/* ─── Bar Row (horizontal mini bar) ─── */
const BarRow = ({
  label,
  count,
  max,
  color,
}: {
  label: string;
  count: number;
  max: number;
  color?: string;
}) => (
  <div className="flex items-center gap-3">
    <span className="text-sm w-36 truncate text-foreground">{label}</span>
    <div className="flex-1 h-3 rounded-full bg-secondary overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{
          width: `${Math.max((count / max) * 100, 4)}%`,
          backgroundColor: color || "hsl(var(--accent))",
        }}
      />
    </div>
    <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
      {count}
    </span>
  </div>
);

/* ─── Mood Pill ─── */
const MoodPill = ({
  mood,
  count,
  max,
}: {
  mood: string;
  count: number;
  max: number;
}) => {
  const opacity = Math.max(0.3, count / max);
  return (
    <span
      className="inline-block px-3 py-1.5 rounded-full text-sm font-medium transition-all"
      style={{
        backgroundColor: `hsl(var(--accent) / ${opacity * 0.25})`,
        color: `hsl(var(--accent))`,
        border: `1px solid hsl(var(--accent) / ${opacity * 0.4})`,
      }}
    >
      {mood}
    </span>
  );
};

/* ─── Cluster Card ─── */
const ClusterCard = ({
  name,
  vibe,
  moodTags,
  trackCount,
  colorHex,
}: {
  name: string;
  vibe: string | null;
  moodTags: string[];
  trackCount: number;
  colorHex: string;
}) => (
  <div
    className="p-5 rounded-2xl border border-border/50 bg-surface-elevated relative overflow-hidden hover:shadow-md transition-shadow"
  >
    <div
      className="absolute top-0 left-0 w-1 h-full rounded-l-2xl"
      style={{ backgroundColor: colorHex }}
    />
    <h3 className="font-heading text-lg pl-3">{name}</h3>
    {vibe && (
      <p className="text-sm text-muted-foreground mt-1 pl-3 line-clamp-2">
        {vibe}
      </p>
    )}
    <div className="flex items-center gap-2 mt-3 pl-3 flex-wrap">
      {moodTags.slice(0, 4).map((tag) => (
        <span
          key={tag}
          className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground"
        >
          {tag}
        </span>
      ))}
      <span className="text-xs text-muted-foreground ml-auto">
        {trackCount} tracks
      </span>
    </div>
  </div>
);

/* ─── Insight Tile ─── */
const InsightTile = ({
  icon: Icon,
  text,
}: {
  icon: React.ElementType;
  text: string;
}) => (
  <div className="p-4 rounded-xl bg-secondary/50 border border-border/30 flex items-start gap-3">
    <Icon className="w-4 h-4 text-accent mt-0.5 shrink-0" />
    <p className="text-sm text-foreground">{text}</p>
  </div>
);

/* ─── Empty Section ─── */
const EmptySection = ({ message }: { message: string }) => (
  <div className="py-6 text-center text-sm text-muted-foreground italic">
    {message}
  </div>
);

/* ─── Main Dashboard ─── */
const Dashboard = () => {
  const { profile } = useAuth();
  const { startAuth } = useSpotify();
  const spotifyConnected = profile?.spotify_connected ?? false;
  const { stats, loading } = useDashboardStats();

  const firstName =
    profile?.first_name || profile?.full_name?.split(" ")[0] || null;

  // Not connected
  if (!spotifyConnected) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto text-center py-20">
          <Headphones className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="font-heading text-3xl mb-2">
            {firstName ? `Welcome, ${firstName}` : "Welcome to Tempo"}
          </h1>
          <p className="text-muted-foreground mb-6">
            Connect Spotify to unlock your personal music intelligence report.
          </p>
          <Button
            variant="hero"
            size="lg"
            onClick={() => void startAuth("/dashboard")}
          >
            Connect Spotify
          </Button>
          <p className="text-xs text-muted-foreground mt-4">
            Your music insights will appear after your library is imported and
            analyzed.
          </p>
        </div>
      </AppLayout>
    );
  }

  // Loading
  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto py-20 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto mb-3" />
          <h1 className="font-heading text-2xl mb-1">
            Building your music profile…
          </h1>
          <p className="text-sm text-muted-foreground">
            Crunching the numbers from your Spotify library.
          </p>
        </div>
      </AppLayout>
    );
  }

  const hasData = stats.totalLikedSongs > 0;
  const hasAnalysis = stats.totalAnalyzedSongs > 0;
  const hasClusters = stats.clusters.length > 0;
  const hasMoods = stats.moods.length > 0;
  const hasGenres = stats.topGenres.length > 0;
  const hasDiscovery = stats.totalRecommendations > 0;

  // Generate energy/tempo insights
  const energyInsights: string[] = [];
  if (stats.energyLevels.length > 0) {
    const top = stats.energyLevels[0];
    energyInsights.push(
      `Your library leans toward ${top.energy} energy tracks.`
    );
  }
  if (stats.tempos.length > 0) {
    const top = stats.tempos[0];
    energyInsights.push(
      `Most of your songs sit around ${top.tempo}.`
    );
  }
  if (stats.atmospheres.length > 0) {
    const top2 = stats.atmospheres.slice(0, 2).map((a) => a.atmosphere);
    energyInsights.push(
      `Your dominant atmospheres: ${top2.join(", ")}.`
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl">
        {/* Header */}
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl mb-1">
              {firstName
                ? `${firstName}'s Music Intelligence`
                : "Your Music Intelligence"}
            </h1>
            <p className="text-muted-foreground">
              Your personal Tempo report — powered by real Spotify data.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="hero-outline" size="sm" asChild>
              <Link to="/library">
                <ListMusic className="w-4 h-4 mr-2" />
                Library
              </Link>
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/discover">
                <Sparkles className="w-4 h-4 mr-2" />
                Discover
              </Link>
            </Button>
          </div>
        </div>

        {!hasData ? (
          <div className="rounded-2xl bg-surface-elevated border border-border/50 p-10 text-center">
            <Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h2 className="font-heading text-xl mb-1">
              Spotify connected — no data yet
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Sync your library from Settings to start building your music
              profile.
            </p>
            <Button variant="hero-outline" size="sm" asChild>
              <Link to="/settings">Go to Settings</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-10">
            {/* ─── Library Overview ─── */}
            <section>
              <SectionHeading
                title="Library Overview"
                subtitle="Your Spotify library at a glance"
              />
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                <StatCard
                  icon={Heart}
                  value={stats.totalLikedSongs.toLocaleString()}
                  label="Liked songs"
                  accent
                />
                <StatCard
                  icon={Users}
                  value={stats.uniqueArtists.toLocaleString()}
                  label="Artists"
                />
                <StatCard
                  icon={ListMusic}
                  value={stats.totalPlaylists}
                  label="Playlists"
                />
                <StatCard
                  icon={Disc3}
                  value={stats.totalSavedAlbums}
                  label="Saved albums"
                />
                <StatCard
                  icon={Sparkles}
                  value={stats.totalClusters}
                  label="Sonic clusters"
                />
                <StatCard
                  icon={BarChart3}
                  value={stats.totalAnalyzedSongs}
                  label="Songs analyzed"
                />
                <StatCard
                  icon={Radio}
                  value={stats.totalFollowedArtists}
                  label="Followed artists"
                />
              </div>
            </section>

            {/* ─── Top Artists ─── */}
            {stats.topArtists.length > 0 && (
              <section>
                <SectionHeading
                  title="Top Artists in Your Library"
                  subtitle="Artists that appear most across your liked songs"
                />
                <div className="space-y-2.5">
                  {stats.topArtists.slice(0, 10).map((artist, i) => (
                    <div key={artist.name} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-5 text-right tabular-nums">
                        {i + 1}
                      </span>
                      <BarRow
                        label={artist.name}
                        count={artist.count}
                        max={stats.topArtists[0].count}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ─── Sonic Worlds (Genres) ─── */}
            {hasGenres && (
              <section>
                <SectionHeading
                  title="Your Sonic Worlds"
                  subtitle="The musical environments you listen to most"
                />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {stats.topGenres.slice(0, 8).map((g) => (
                    <div
                      key={g.genre}
                      className="p-4 rounded-2xl bg-surface-elevated border border-border/50 hover:shadow-sm transition-shadow"
                    >
                      <p className="font-medium capitalize">{g.genre}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {g.count} tracks
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ─── Mood Distribution ─── */}
            {hasMoods && (
              <section>
                <SectionHeading
                  title="Mood Distribution"
                  subtitle="The emotional landscape of your music"
                />
                <div className="flex flex-wrap gap-2">
                  {stats.moods.map((m) => (
                    <MoodPill
                      key={m.mood}
                      mood={m.mood}
                      count={m.count}
                      max={stats.moods[0].count}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ─── Energy & Tempo Profile ─── */}
            {(stats.energyLevels.length > 0 || stats.tempos.length > 0) && (
              <section>
                <SectionHeading
                  title="Energy & Tempo Profile"
                  subtitle="How your music feels and moves"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Energy bars */}
                  {stats.energyLevels.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                        <Zap className="w-4 h-4" /> Energy levels
                      </p>
                      {stats.energyLevels.map((e) => (
                        <BarRow
                          key={e.energy}
                          label={e.energy}
                          count={e.count}
                          max={stats.energyLevels[0].count}
                          color="hsl(25 60% 55%)"
                        />
                      ))}
                    </div>
                  )}
                  {/* Tempo bars */}
                  {stats.tempos.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                        <Activity className="w-4 h-4" /> Tempo ranges
                      </p>
                      {stats.tempos.map((t) => (
                        <BarRow
                          key={t.tempo}
                          label={t.tempo}
                          count={t.count}
                          max={stats.tempos[0].count}
                          color="hsl(220 40% 35%)"
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Insight tiles */}
                {energyInsights.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
                    {energyInsights.map((text) => (
                      <InsightTile key={text} icon={TrendingUp} text={text} />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ─── Audio Feature Snapshot ─── */}
            {stats.hasAudioFeatures && (
              <section>
                <SectionHeading
                  title="Audio Feature Snapshot"
                  subtitle="Average audio characteristics from Spotify data"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  {[
                    { label: "Avg BPM", value: stats.avgTempo ? Math.round(stats.avgTempo).toString() : "—" },
                    { label: "Energy", value: stats.avgEnergy ? `${Math.round(stats.avgEnergy * 100)}%` : "—", pct: stats.avgEnergy },
                    { label: "Valence", value: stats.avgValence ? `${Math.round(stats.avgValence * 100)}%` : "—", pct: stats.avgValence },
                    { label: "Danceability", value: stats.avgDanceability ? `${Math.round(stats.avgDanceability * 100)}%` : "—", pct: stats.avgDanceability },
                    { label: "Acousticness", value: stats.avgAcousticness ? `${Math.round(stats.avgAcousticness * 100)}%` : "—", pct: stats.avgAcousticness },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="p-4 rounded-2xl bg-surface-elevated border border-border/50 text-center"
                    >
                      <p className="font-heading text-2xl">{item.value}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {item.label}
                      </p>
                      {item.pct != null && (
                        <Progress
                          value={item.pct * 100}
                          className="h-1.5 mt-2"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ─── Sonic Clusters ─── */}
            {hasClusters && (
              <section>
                <SectionHeading
                  title="Your Sonic Clusters"
                  subtitle="AI-detected listening patterns in your library"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {stats.clusters.map((c) => (
                    <ClusterCard
                      key={c.name}
                      name={c.name}
                      vibe={c.vibe_description}
                      moodTags={c.mood_tags}
                      trackCount={c.track_count}
                      colorHex={c.color_hex}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ─── Discovery Insights ─── */}
            {hasDiscovery && (
              <section>
                <SectionHeading
                  title="Discovery Insights"
                  subtitle="How Tempo is learning your taste"
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <StatCard
                    icon={Target}
                    value={stats.totalRecommendations}
                    label="Songs discovered"
                  />
                  <StatCard
                    icon={ThumbsUp}
                    value={stats.acceptedRecommendations}
                    label="Accepted"
                    accent
                  />
                  <StatCard
                    icon={ThumbsDown}
                    value={stats.dismissedRecommendations}
                    label="Dismissed"
                  />
                </div>
              </section>
            )}

            {/* ─── Library Activity ─── */}
            {(stats.songsThisMonth > 0 || stats.recentArtists.length > 0) && (
              <section>
                <SectionHeading
                  title="Library Activity"
                  subtitle="Recent changes to your collection"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {stats.songsThisMonth > 0 && (
                    <InsightTile
                      icon={CalendarDays}
                      text={`You added ${stats.songsThisMonth} songs this month.`}
                    />
                  )}
                  {stats.recentArtists.length > 0 && (
                    <InsightTile
                      icon={Users}
                      text={`Recent artists: ${stats.recentArtists.slice(0, 5).join(", ")}.`}
                    />
                  )}
                </div>
              </section>
            )}

            {/* ─── Not enough analysis nudge ─── */}
            {!hasAnalysis && (
              <div className="rounded-2xl bg-secondary/50 border border-border/30 p-6 text-center">
                <BarChart3 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Your music insights will become richer after Tempo analyzes
                  your library.{" "}
                  <Link
                    to="/liked-songs-intelligence"
                    className="text-accent underline underline-offset-2"
                  >
                    Run analysis →
                  </Link>
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
