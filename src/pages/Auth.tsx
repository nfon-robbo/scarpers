import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import scarpersIcon from "@/assets/scarpers-icon.png";
import scarpersWordmark from "@/assets/scarpers-wordmark.png";
import heroRunnerVideo from "@/assets/hero-runner.mp4.asset.json";
import heroFeetVideo from "@/assets/hero-feet-10s.mp4.asset.json";
import heroMarathonVideo from "@/assets/hero-marathon-10s.mp4.asset.json";

const HERO_VIDEOS = [heroRunnerVideo.url, heroFeetVideo.url, heroMarathonVideo.url];

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [videoIdx, setVideoIdx] = useState(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) navigate("/dashboard");
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/dashboard");
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return;
      if (i === videoIdx) {
        try { v.currentTime = 0; } catch {}
        void v.play().catch(() => undefined);
      } else {
        v.pause();
      }
    });
  }, [videoIdx]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast({
          title: "Account created",
          description: "Welcome — let's set up your profile.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/dashboard`,
      });
      if (result.redirected) return;
      if (result.error) throw result.error;
    } catch (err: any) {
      toast({ title: "Google sign-in failed", description: err.message, variant: "destructive" });
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Video background */}
      <div className="absolute inset-0 z-0">
        {HERO_VIDEOS.map((src, index) => (
          <video
            key={src}
            ref={(node) => { videoRefs.current[index] = node; }}
            src={src}
            autoPlay={index === 0}
            muted
            playsInline
            preload="auto"
            onEnded={() => setVideoIdx((i) => (i + 1) % HERO_VIDEOS.length)}
            aria-hidden="true"
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${index === videoIdx ? "opacity-100" : "opacity-0"}`}
          />
        ))}
      </div>

      {/* Overlays */}
      <div className="absolute inset-0 z-[1] bg-black/70 pointer-events-none" />
      <div className="absolute inset-0 z-[1] bg-gradient-to-t from-black via-black/50 to-black/20 pointer-events-none" />

      {/* Auth content */}
      <div className="relative z-10 w-full max-w-md px-6 py-10 animate-fade-in">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={scarpersIcon} alt="" className="h-14 w-14 object-contain" />
          <img src={scarpersWordmark} alt="Scarpers" className="h-7 w-auto object-contain" />
        </div>

        <Card className="bg-background/40 backdrop-blur-xl border-white/10 text-white">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl font-bold">{isLogin ? "Welcome back" : "Create account"}</CardTitle>
            <CardDescription className="text-sm text-white/70">
              {isLogin
                ? "Sign in to access your training dashboard"
                : "Start your AI-powered coaching journey"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              onClick={handleGoogle}
              disabled={loading}
              className="w-full h-11 rounded-xl bg-white text-gray-900 hover:bg-white/90 font-semibold flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A10.99 10.99 0 0 0 1 12c0 1.78.43 3.46 1.18 4.93l3.66-2.83z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
              </svg>
              Continue with Google
            </Button>
            <div className="flex items-center gap-3 my-5">
              <div className="h-px flex-1 bg-white/20" />
              <span className="text-xs text-white/60 uppercase tracking-wide">or</span>
              <div className="h-px flex-1 bg-white/20" />
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs font-semibold tracking-wide uppercase text-white/70">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="athlete@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11 rounded-xl bg-white/10 border-white/15 text-white placeholder:text-white/70 focus:border-primary/50 transition-colors"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs font-semibold tracking-wide uppercase text-white/70">Password</Label>
                  {isLogin && (
                    <Link to="/reset-password" className="text-xs text-primary hover:underline">
                      Forgot password?
                    </Link>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="h-11 rounded-xl bg-white/10 border-white/15 text-white placeholder:text-white/70 focus:border-primary/50 transition-colors"
                />
              </div>
              <Button
                type="submit"
                className="w-full h-11 rounded-xl bg-gradient-to-r from-primary to-accent text-primary-foreground hover:opacity-90 transition-opacity font-semibold glow-sm"
                disabled={loading}
              >
                {loading ? "Loading..." : isLogin ? "Sign in" : "Create account"}
              </Button>
            </form>
            <div className="mt-6 text-center text-sm text-white/70">
              {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="text-primary font-semibold hover:underline"
              >
                {isLogin ? "Sign up" : "Sign in"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Auth;
