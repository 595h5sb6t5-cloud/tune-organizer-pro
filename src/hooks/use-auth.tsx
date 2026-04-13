import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface Profile {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  spotify_connected: boolean;
  apple_music_connected: boolean;
  onboarding_completed: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (params: {
    email?: string;
    phone?: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => Promise<{ error: string | null }>;
  signIn: (params: {
    email?: string;
    phone?: string;
    password: string;
  }) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .single();
    if (data) setProfile(data as Profile);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          // Use setTimeout to avoid deadlock with Supabase auth
          setTimeout(() => fetchProfile(session.user.id), 0);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signUp = useCallback(async ({
    email, phone, password, firstName, lastName,
  }: {
    email?: string;
    phone?: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => {
    const credentials: any = {
      password,
      options: {
        data: { first_name: firstName, last_name: lastName },
      },
    };
    if (email) credentials.email = email;
    if (phone) credentials.phone = phone;

    const { error } = await supabase.auth.signUp(credentials);
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signIn = useCallback(async ({
    email, phone, password,
  }: {
    email?: string;
    phone?: string;
    password: string;
  }) => {
    const credentials: any = { password };
    if (email) credentials.email = email;
    if (phone) credentials.phone = phone;

    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  }, []);

  const updateProfile = useCallback(async (updates: Partial<Profile>) => {
    if (!user) return { error: "Not authenticated" };
    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("user_id", user.id);
    if (error) return { error: error.message };
    await fetchProfile(user.id);
    return { error: null };
  }, [user, fetchProfile]);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  return (
    <AuthContext.Provider
      value={{ user, session, profile, loading, signUp, signIn, signOut, updateProfile, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
