import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export type Plan = "free" | "premium";

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: Plan;
  song_analysis_limit: number;   // -1 = unlimited
  playlists_limit: number;
  recommendations_limit: number;
  export_limit: number;
  is_active: boolean;
  current_period_started_at: string;
}

export interface Usage {
  songs_analyzed: number;
  playlists_generated: number;
  recommendations_this_period: number;
  exports: number;
  liked_total: number;
}

export interface SubscriptionState {
  loading: boolean;
  plan: Plan;
  subscription: SubscriptionRow | null;
  usage: Usage;
  refresh: () => Promise<void>;
  // Helpers
  isUnlimited: (limit: number) => boolean;
  remaining: (used: number, limit: number) => number; // -1 = unlimited
  canAnalyzeMore: boolean;
  canGenerateMorePlaylists: boolean;
  canGetMoreRecommendations: boolean;
  canExportMore: boolean;
  upgradeIfNeeded: (kind: "analysis" | "playlist" | "recommendation" | "export") => boolean;
}

const DEFAULT_USAGE: Usage = {
  songs_analyzed: 0,
  playlists_generated: 0,
  recommendations_this_period: 0,
  exports: 0,
  liked_total: 0,
};

export function useSubscription(): SubscriptionState {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [usage, setUsage] = useState<Usage>(DEFAULT_USAGE);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);

    const { data: sub } = await supabase
      .from("user_subscription")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    let row = sub as SubscriptionRow | null;

    // Self-heal: ensure a Free subscription exists for older accounts
    if (!row) {
      const { data: created } = await supabase
        .from("user_subscription")
        .insert({
          user_id: user.id,
          plan: "free",
          song_analysis_limit: 100,
          playlists_limit: 3,
          recommendations_limit: 20,
          export_limit: 3,
          is_active: true,
        })
        .select()
        .single();
      row = created as SubscriptionRow | null;
    }

    const periodStart = row?.current_period_started_at ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

    const [{ count: analyzed }, { count: playlists }, { count: recs }, { count: exports }, { count: liked }] = await Promise.all([
      supabase.from("ai_track_analysis").select("id", { head: true, count: "exact" }).eq("user_id", user.id),
      supabase.from("generated_playlists").select("id", { head: true, count: "exact" }).eq("user_id", user.id),
      supabase.from("recommendations").select("id", { head: true, count: "exact" }).eq("user_id", user.id).gte("created_at", periodStart),
      supabase.from("generated_playlists").select("id", { head: true, count: "exact" }).eq("user_id", user.id).eq("is_exported_to_spotify", true),
      supabase.from("liked_songs").select("id", { head: true, count: "exact" }).eq("user_id", user.id),
    ]);

    setSubscription(row);
    setUsage({
      songs_analyzed: analyzed ?? 0,
      playlists_generated: playlists ?? 0,
      recommendations_this_period: recs ?? 0,
      exports: exports ?? 0,
      liked_total: liked ?? 0,
    });
    setLoading(false);
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  return useMemo<SubscriptionState>(() => {
    const plan: Plan = (subscription?.plan as Plan) ?? "free";
    const isUnlimited = (limit: number) => limit === -1 || limit === null || limit === undefined;
    const remaining = (used: number, limit: number) => (isUnlimited(limit) ? -1 : Math.max(0, limit - used));

    const canAnalyzeMore = !subscription ? false : isUnlimited(subscription.song_analysis_limit) || usage.songs_analyzed < subscription.song_analysis_limit;
    const canGenerateMorePlaylists = !subscription ? false : isUnlimited(subscription.playlists_limit) || usage.playlists_generated < subscription.playlists_limit;
    const canGetMoreRecommendations = !subscription ? false : isUnlimited(subscription.recommendations_limit) || usage.recommendations_this_period < subscription.recommendations_limit;
    const canExportMore = !subscription ? false : isUnlimited(subscription.export_limit) || usage.exports < subscription.export_limit;

    const upgradeIfNeeded = (kind: "analysis" | "playlist" | "recommendation" | "export") => {
      if (kind === "analysis") return !canAnalyzeMore;
      if (kind === "playlist") return !canGenerateMorePlaylists;
      if (kind === "recommendation") return !canGetMoreRecommendations;
      if (kind === "export") return !canExportMore;
      return false;
    };

    return {
      loading,
      plan,
      subscription,
      usage,
      refresh,
      isUnlimited,
      remaining,
      canAnalyzeMore,
      canGenerateMorePlaylists,
      canGetMoreRecommendations,
      canExportMore,
      upgradeIfNeeded,
    };
  }, [subscription, usage, loading, refresh]);
}
