import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useSpotify } from "@/hooks/use-spotify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Music, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const Auth = () => {
  const { user, profile, signUp, signIn, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"auth" | "connect">("auth");

  // If user is already logged in and onboarded, redirect
  if (user && profile?.onboarding_completed) {
    navigate("/dashboard", { replace: true });
    return null;
  }

  // If user just signed up, show connect step
  if (user && profile && !profile.onboarding_completed && step === "auth") {
    setStep("connect");
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      {/* Branding */}
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
          onComplete={() => {
            updateProfile({ onboarding_completed: true });
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

/* ─── Auth Card ─── */

function AuthCard({ onSuccess }: { onSuccess: () => void }) {
  const { signUp, signIn } = useAuth();
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

/* ─── Login Form ─── */

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
    const params: any = { password };
    if (isEmail) params.email = contact.trim();
    else params.phone = contact.trim();

    const { error: err } = await signIn(params);
    setLoading(false);

    if (err) {
      setError(err);
    } else {
      toast({ title: "Welcome back!" });
      onSuccess();
    }
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

/* ─── Sign Up Form ─── */

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
    const params: any = {
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
    } else if (isEmail) {
      setSuccess(true);
    } else {
      toast({ title: "Account created!" });
      onSuccess();
    }
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
          <Input
            id="first-name"
            placeholder="Jordan"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="last-name">Last name</Label>
          <Input
            id="last-name"
            placeholder="Doe"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-contact">Email or phone number</Label>
        <Input
          id="signup-contact"
          placeholder="you@email.com or +1234567890"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          autoComplete="username"
        />
        <p className="text-xs text-muted-foreground">
          {contact && !isEmail
            ? "Phone auth may require additional setup. Email is recommended."
            : "At least one is required."}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
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

/* ─── Connect Card (Onboarding Step 2) ─── */

function ConnectCard({ onComplete }: { onComplete: () => void }) {
  const { updateProfile } = useAuth();
  const [connectingSpotify, setConnectingSpotify] = useState(false);
  const [connectingApple, setConnectingApple] = useState(false);
  const [spotifyDone, setSpotifyDone] = useState(false);
  const [appleDone, setAppleDone] = useState(false);

  const handleSpotify = async () => {
    setConnectingSpotify(true);
    // Simulated OAuth — replace with real Spotify OAuth when ready
    await new Promise((r) => setTimeout(r, 1500));
    await updateProfile({ spotify_connected: true });
    setSpotifyDone(true);
    setConnectingSpotify(false);
    toast({ title: "Spotify connected!" });
  };

  const handleApple = async () => {
    setConnectingApple(true);
    await new Promise((r) => setTimeout(r, 1500));
    await updateProfile({ apple_music_connected: true });
    setAppleDone(true);
    setConnectingApple(false);
    toast({ title: "Apple Music connected!" });
  };

  return (
    <Card className="w-full max-w-md border-border/60 shadow-lg">
      <CardContent className="p-6 space-y-6">
        <div className="text-center space-y-2">
          <h2 className="font-instrument-serif text-2xl text-foreground">Connect your music</h2>
          <p className="text-sm text-muted-foreground">
            Link a streaming platform to get personalized recommendations.
          </p>
        </div>

        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-14"
            onClick={handleSpotify}
            disabled={connectingSpotify || spotifyDone}
          >
            {connectingSpotify ? (
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            ) : spotifyDone ? (
              <CheckCircle2 className="h-5 w-5 text-accent" />
            ) : (
              <div className="h-5 w-5 rounded-full bg-[hsl(141,73%,42%)]" />
            )}
            <span className="flex-1 text-left">
              {spotifyDone ? "Spotify Connected" : "Continue with Spotify"}
            </span>
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-14"
            onClick={handleApple}
            disabled={connectingApple || appleDone}
          >
            {connectingApple ? (
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            ) : appleDone ? (
              <CheckCircle2 className="h-5 w-5 text-accent" />
            ) : (
              <div className="h-5 w-5 rounded-full bg-foreground" />
            )}
            <span className="flex-1 text-left">
              {appleDone ? "Apple Music Connected" : "Continue with Apple Music"}
            </span>
          </Button>
        </div>

        <Button variant="ghost" className="w-full text-muted-foreground" onClick={onComplete}>
          Skip for now
        </Button>

        {(spotifyDone || appleDone) && (
          <Button variant="hero" className="w-full" onClick={onComplete}>
            Continue
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default Auth;
