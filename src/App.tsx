import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectionProvider } from "./hooks/use-connections";
import { AuthProvider } from "./hooks/use-auth";
import { FloatingPlayer } from "./components/app/FloatingPlayer";
import { JobsBanner } from "./components/app/JobsBanner";
import { JobsProvider } from "./hooks/use-jobs";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Index from "./pages/Index.tsx";
import Auth from "./pages/Auth.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Library from "./pages/Library.tsx";
import Playlists from "./pages/Playlists.tsx";
import PlaylistDetail from "./pages/PlaylistDetail.tsx";
import LikedSongs from "./pages/LikedSongs.tsx";
import MusicDNA from "./pages/MusicDNA.tsx";
import Discover from "./pages/Discover.tsx";
import Settings from "./pages/Settings.tsx";
import SpotifyCallback from "./pages/SpotifyCallback.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ConnectionProvider>
          <JobsProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/library" element={<Library />} />
                <Route path="/liked-songs" element={<LikedSongs />} />
                <Route path="/music-dna" element={<MusicDNA />} />
                <Route path="/ai-playlists" element={<Playlists />} />
                <Route path="/playlists" element={<Navigate to="/ai-playlists" replace />} />
                <Route path="/playlists/:id" element={<PlaylistDetail />} />
                <Route path="/discover" element={<Discover />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/spotify-callback" element={<SpotifyCallback />} />
                <Route path="/sync" element={<Navigate to="/dashboard" replace />} />
                <Route path="/history" element={<Navigate to="/discover" replace />} />
                <Route path="/liked-intelligence" element={<Navigate to="/liked-songs" replace />} />
                <Route path="/albums/:id" element={<Navigate to="/library" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              <FloatingPlayer />
              <JobsBanner />
            </BrowserRouter>
          </TooltipProvider>
          </JobsProvider>
        </ConnectionProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
