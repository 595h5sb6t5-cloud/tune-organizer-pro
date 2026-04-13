import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectionProvider } from "./hooks/use-connections";
import { AuthProvider } from "./hooks/use-auth";
import Index from "./pages/Index.tsx";
import Auth from "./pages/Auth.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Playlists from "./pages/Playlists.tsx";
import PlaylistDetail from "./pages/PlaylistDetail.tsx";
import Discover from "./pages/Discover.tsx";
import RecommendationHistory from "./pages/RecommendationHistory.tsx";
import Sync from "./pages/Sync.tsx";
import Settings from "./pages/Settings.tsx";
import SpotifyCallback from "./pages/SpotifyCallback.tsx";
import LikedSongsIntelligence from "./pages/LikedSongsIntelligence.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
    <ConnectionProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/playlists" element={<Playlists />} />
          <Route path="/playlists/:id" element={<PlaylistDetail />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/history" element={<RecommendationHistory />} />
          <Route path="/sync" element={<Sync />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/liked-intelligence" element={<LikedSongsIntelligence />} />
          <Route path="/spotify-callback" element={<SpotifyCallback />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    </ConnectionProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
