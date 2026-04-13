import { createContext, useContext, useState, ReactNode, useCallback } from "react";

interface ConnectionState {
  spotify: { connected: boolean; email: string };
  apple: { connected: boolean; email: string };
}

interface ConnectionContextType {
  connections: ConnectionState;
  connectSpotify: () => Promise<void>;
  disconnectSpotify: () => void;
  connectApple: () => Promise<void>;
  disconnectApple: () => void;
  connectingSpotify: boolean;
  connectingApple: boolean;
}

const ConnectionContext = createContext<ConnectionContextType | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [connections, setConnections] = useState<ConnectionState>({
    spotify: { connected: true, email: "jordan.d@email.com" },
    apple: { connected: false, email: "jordan@icloud.com" },
  });
  const [connectingSpotify, setConnectingSpotify] = useState(false);
  const [connectingApple, setConnectingApple] = useState(false);

  const connectSpotify = useCallback(async () => {
    setConnectingSpotify(true);
    await new Promise((r) => setTimeout(r, 1500));
    setConnections((prev) => ({ ...prev, spotify: { ...prev.spotify, connected: true } }));
    setConnectingSpotify(false);
  }, []);

  const disconnectSpotify = useCallback(() => {
    setConnections((prev) => ({ ...prev, spotify: { ...prev.spotify, connected: false } }));
  }, []);

  const connectApple = useCallback(async () => {
    setConnectingApple(true);
    await new Promise((r) => setTimeout(r, 1500));
    setConnections((prev) => ({ ...prev, apple: { ...prev.apple, connected: true } }));
    setConnectingApple(false);
  }, []);

  const disconnectApple = useCallback(() => {
    setConnections((prev) => ({ ...prev, apple: { ...prev.apple, connected: false } }));
  }, []);

  return (
    <ConnectionContext.Provider value={{ connections, connectSpotify, disconnectSpotify, connectApple, disconnectApple, connectingSpotify, connectingApple }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnections() {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error("useConnections must be used within ConnectionProvider");
  return ctx;
}
