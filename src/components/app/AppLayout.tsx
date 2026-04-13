import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import AppSidebar from "./AppSidebar";
import { useAuth } from "@/hooks/use-auth";

const AppLayout = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="min-h-screen">
      <AppSidebar />
      <main className="ml-60 p-8">{children}</main>
    </div>
  );
};

export default AppLayout;
