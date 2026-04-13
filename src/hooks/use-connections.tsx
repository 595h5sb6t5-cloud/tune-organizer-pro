import { createContext, useContext, ReactNode } from "react";
import { useAuth } from "./use-auth";

interface ConnectionState {
  spotify: { connected: boolean; email: string };
}

interface ConnectionContextType {
  connections: ConnectionState;
}

const ConnectionContext = createContext<ConnectionContextType | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();

  const connections: ConnectionState = {
    spotify: {
      connected: profile?.spotify_connected ?? false,
      email: profile?.email ?? "",
    },
  };

  return (
    <ConnectionContext.Provider value={{ connections }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnections() {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error("useConnections must be used within ConnectionProvider");
  return ctx;
}
