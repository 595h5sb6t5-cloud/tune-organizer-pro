import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Music, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useSpotify, type SpotifyStatus } from "@/hooks/use-spotify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  readPendingSpotifyCallback,
  readPendingSpotifyConnect,
  clearPendingSpotifyCallback,
  clearPendingSpotifyConnect,
} from "@/lib/spotify-auth";

function getSpotifyStatusCopy(status: SpotifyStatus) {
  switch (status) {
    case "connecting":
      return { button: "Connecting…", helper: "Preparing secure Spotify authorization." };
    case "authorizing":
      return { button: "Authorizing…", helper: "Waiting for Spotify approval." };
    case "connected":
      return { button: "Connected", helper: "Spotify is linked. Starting your library import." };
    case "importing":
      return { button: "Importing songs…", helper: "Syncing your saved Spotify tracks." };
    case "complete":
      return { button: "Spotify Connected", helper: "Import complete. You can continue." };
    case "error":
      return { button: "Try again", helper: "Spotify connection failed. Review the message below and retry." };
    default:
      return { button: "Continue with Spotify", helper: "Authorize Spotify to import your library and create playlists." };
  }
}

const Auth = () => {
  const { user, profile, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<"auth" | "connect">("auth");

  const connectSpotify = searchParams.get("connect") === "spotify";
  const redirectAfterLogin = searchParams.get("redirect");

  // After login: resume pending Spotify callback (code saved before login)
  useEffect(() => {
    if (!user) return;

    const pendingCallback = readPendingSpotifyCallback();
    if (pendingCallback) {
      console.info("[Auth] Resuming pending Spotify callback", {
        ageMs: Date.now() - pendingCallback.savedAt,
        has_code: true,
      });
      clearPendingSpotifyCallback();
      const url = `/spotify-callback?code=${encodeURIComponent(pendingCallback.code)}${
        pendingCallback.state ? `&state=${encodeURIComponent(pendingCallback.state)}` : ""
      }`;
      navigate(url, { replace: true });
      return;
    }

    // Resume pending Spotify connect (user clicked Connect before being logged in)
    const pendingConnect = readPendingSpotifyConnect();
    if (pendingConnect || connectSpotify) {
      clearPendingSpotifyConnect();
      setStep("connect");
      return;
    }

    if (redirectAfterLogin) {
      navigate(redirectAfterLogin, { replace: true });
      return;
    }
  }, [user, navigate, redirectAfterLogin, connectSpotify]);

  // Already onboarded + no pending Spotify → go to dashboard
  useEffect(() => {
    if (!user || !profile?.onboarding_completed) return;

    const hasPendingCallback = readPendingSpotifyCallback();
    const hasPendingConnect = readPendingSpotifyConnect();
    if (hasPendingCallback || hasPendingConnect || connectSpotify) return;

    navigate("/dashboard", { replace: true });
  }, [user, profile?.onboarding_completed, navigate, connectSpotify]);

  // New user (onboarding not done) → show connect step
  useEffect(() => {
    if (user && profile && !profile.onboarding_completed) {
      setStep((current) => (current === "auth" ? "connect" : current));
    }
  }, [user, profile]);

  if (user && profile?.onboarding_completed && !connectSpotify) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Music className="h-8 w-8 text-accent" />
          <h1 className="font-instrument-serif text-4xl text-foreground">Tempo</h1>
        </div>
        <p className="text-muted-foreground text-sm max-w-xs mx-auto">
          Your AI music curator. Discover songs that truly fit your taste.
        </p>
      </div>

      {step === "auth" ? (
        <AuthCard onSuccess={() => setStep("connect")} />
      ) : (
        <ConnectCard
          onComplete={async () => {
            await updateProfile({ onboarding_completed: true });
            navigate("/dashboard");
          }}
        />
      )}

      <p className="text-xs text-muted-foreground mt-6 max-w-xs text-center">
        By continuing you agree to our Terms of Service and Privacy Policy.
      </p>
    </div>
  );
};

function AuthCard({ onSuccess }: { onSuccess: () => void }) {
  const [tab, setTab] = useState("login");

  return (
    <Card className="w-full max-w-md border-border/60 shadow-lg">
      <CardContent className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="login">Log In</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <LoginForm onSuccess={onSuccess} />
          </TabsContent>
          <TabsContent value="signup">
            <SignUpForm onSuccess={onSuccess} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { signIn } = useAuth();
  const [contact, setContact] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isEmail = contact.includes("@");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!contact.trim()) return setError("Email or phone number is required.");
    if (!password) return setError("Password is required.");

    setLoading(true);
    const params: { password: string; email?: string; phone?: string } = { password };
    if (isEmail) params.email = contact.trim();
    else params.phone = contact.trim();

    const { error: err } = await signIn(params);
    setLoading(false);

    if (err) {
      setError(err);
      return;
    }

    toast({ title: "Welcome back!" });
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="login-contact">Email or phone number</Label>
        <Input
          id="login-contact"
          placeholder="you@email.com or +1234567890"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          autoComplete="username"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <Button type="submit" className="w-full" variant="hero" disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log In"}
      </Button>
    </form>
  );
}

function SignUpForm({ onSuccess }: { onSuccess: () => void }) {
  const { signUp } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contact, setContact] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const isEmail = contact.includes("@");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!firstName.trim()) return setError("First name is required.");
    if (!lastName.trim()) return setError("Last name is required.");
    if (!contact.trim()) return setError("Email or phone number is required.");
    if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim())) {
      return setError("Please enter a valid email address.");
    }
    if (!isEmail && !/^\+?[1-9]\d{6,14}$/.test(contact.trim().replace(/[\s\-()]/g, ""))) {
      return setError("Please enter a valid phone number (e.g. +1234567890).");
    }
    if (password.length < 6) return setError("Password must be at least 6 characters.");

    setLoading(true);
    const params: { password: string; firstName: string; lastName: string; email?: string; phone?: string } = {
      password,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    };

    if (isEmail) params.email = contact.trim();
    else params.phone = contact.trim();

    const { error: err } = await signUp(params);
    setLoading(false);

    if (err) {
      setError(err);
      return;
    }

    if (isEmail) {
      setSuccess(true);
      return;
    }

    toast({ title: "Account created!" });
    onSuccess();
  };

  if (success) {
    return (
      <div className="text-center py-6 space-y-3">
        <CheckCircle2 className="h-12 w-12 text-accent mx-auto" />
        <h3 className="font-instrument-serif text-xl text-foreground">Check your email</h3>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          We sent a confirmation link to <strong>{contact}</strong>. Click it to activate your account, then log in.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="first-name">First name</Label>
          <Input id="first-name" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="last-name">Last name</Label>
          <Input id="last-name" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-contact">Email or phone number</Label>
        <Input id="signup-contact" placeholder="you@email.com or +1234567890" value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="username" />
        <p className="text-xs text-muted-foreground">
          {contact && !isEmail ? "Phone auth may require additional setup. Email is recommended." : "At least one is required."}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-password">Password</Label>
        <Input id="signup-password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </div>
      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <Button type="submit" className="w-full" variant="hero" disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Account"}
      </Button>
    </form>
  );
}

function ConnectCard({ onComplete }: { onComplete: () => void | Promise<void> }) {
  const { profile } = useAuth();
  const { startAuth: startSpotify, status: spotifyStatus, error: spotifyError } = useSpotify();

  const spotifyDone = profile?.spotify_connected || spotifyStatus === "connected" || spotifyStatus === "complete";
  const spotifyBusy = useMemo(
    () => ["connecting", "authorizing", "importing"].includes(spotifyStatus),
    [spotifyStatus],
  );
  const spotifyCopy = getSpotifyStatusCopy(spotifyStatus);

  const handleSpotify = async () => {
    await startSpotify("/dashboard");
  };

  return (
    <Card className="w-full max-w-md border-border/60 shadow-lg">
      <CardContent className="p-6 space-y-6">
        <div className="text-center space-y-2">
          <h2 className="font-instrument-serif text-2xl text-foreground">Connect Spotify</h2>
          <p className="text-sm text-muted-foreground">
            Link your Spotify account to get personalized AI recommendations.
          </p>
        </div>

        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-14"
            onClick={handleSpotify}
            disabled={spotifyBusy || spotifyDone}
          >
            {spotifyBusy ? (
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            ) : spotifyDone ? (
              <CheckCircle2 className="h-5 w-5 text-accent" />
            ) : (
              <div className="h-5 w-5 rounded-full bg-accent" />
            )}
            <span className="flex-1 text-left">{spotifyDone ? "Spotify Connected" : spotifyCopy.button}</span>
          </Button>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{spotifyDone ? "Spotify is ready. Your library will be imported." : spotifyCopy.helper}</p>
          {spotifyError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{spotifyError}</span>
            </p>
          )}
        </div>

        <Button variant="ghost" className="w-full text-muted-foreground" onClick={onComplete}>
          Skip for now
        </Button>

        {spotifyDone && (
          <Button variant="hero" className="w-full" onClick={onComplete}>
            Continue
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default Auth;
