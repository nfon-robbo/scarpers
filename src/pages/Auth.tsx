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
                <Label htmlFor="password" className="text-xs font-semibold tracking-wide uppercase text-white/70">Password</Label>
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
