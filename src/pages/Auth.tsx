import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Activity, Mountain, Bike, Zap } from "lucide-react";
import scarpersLogo from "@/assets/scarpers-logo.png";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
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
          title: "Check your email",
          description: "We've sent you a confirmation link to verify your account.",
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

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left: Premium Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-primary via-primary/90 to-accent">
        {/* Animated orbs */}
        <div className="absolute inset-0">
          <div className="absolute top-[15%] left-[10%] w-72 h-72 bg-accent/20 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-[20%] right-[5%] w-96 h-96 bg-primary-foreground/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
          <div className="absolute top-[50%] left-[50%] w-48 h-48 bg-accent/15 rounded-full blur-2xl animate-float" style={{ animationDelay: '4s' }} />
        </div>

        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }} />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center justify-center w-full p-12">
          <img
            src={scarpersLogo}
            alt="Scarpers — AI Running Plan Builder"
            className="w-full max-w-md rounded-2xl shadow-2xl mb-8"
          />
          <p className="text-primary-foreground/80 text-lg max-w-md leading-relaxed text-center">
            AI-powered training analysis and coaching for endurance athletes. Upload your data, get insights, and train smarter.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-3 mt-10 justify-center max-w-md">
            {["FIT File Analysis", "AI Coaching", "Training Plans", "Sleep Tracking", "Readiness Score"].map((f) => (
              <span
                key={f}
                className="px-4 py-1.5 rounded-full text-xs font-medium bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/20 backdrop-blur-sm"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Auth Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md animate-fade-in">
          {/* Mobile brand */}
          <div className="flex flex-col items-center gap-3 mb-8 lg:hidden">
            <img src={scarpersLogo} alt="Scarpers" className="w-full max-w-[260px]" />
          </div>

          <Card className="glass border-border/30">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl font-bold">{isLogin ? "Welcome back" : "Create account"}</CardTitle>
              <CardDescription className="text-sm">
                {isLogin
                  ? "Sign in to access your training dashboard"
                  : "Start your AI-powered coaching journey"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="athlete@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-11 rounded-xl bg-muted/50 border-border/50 focus:border-primary/50 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="h-11 rounded-xl bg-muted/50 border-border/50 focus:border-primary/50 transition-colors"
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
              <div className="mt-6 text-center text-sm text-muted-foreground">
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
    </div>
  );
};

export default Auth;
