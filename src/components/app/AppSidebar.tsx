import { Music2, LayoutDashboard, Library, ListMusic, Settings, Upload, LogOut, Sparkles, History } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Library, label: "Library", path: "/library" },
  { icon: ListMusic, label: "Playlists", path: "/playlists" },
  { icon: Sparkles, label: "Discover", path: "/discover" },
  { icon: History, label: "History", path: "/history" },
  { icon: Upload, label: "Sync", path: "/sync" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

const AppSidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  const initials = profile
    ? `${(profile.first_name || "")[0] || ""}${(profile.last_name || "")[0] || ""}`.toUpperCase() || "?"
    : "?";
  const displayName = profile?.full_name || profile?.first_name || profile?.email || "User";

  const handleLogout = async () => {
    await signOut();
    toast.success("Logged out successfully");
    navigate("/auth", { replace: true });
  };

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 bg-surface-elevated border-r border-border flex flex-col z-40">
      <div className="p-5 border-b border-border">
        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Music2 className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-heading text-xl tracking-tight">Tempo</span>
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || (item.path === "/library" && location.pathname.startsWith("/library"));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                isActive
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-medium text-accent">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{displayName}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Log out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};

export default AppSidebar;
