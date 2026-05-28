import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { X, Mail } from "lucide-react";

const DISMISS_KEY = "scarpers:email-verify-dismissed";

const EmailVerifyBanner = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (dismissed) {
      try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
    }
  }, [dismissed]);

  if (!user || user.email_confirmed_at || dismissed || !user.email) return null;

  const resend = async () => {
    setSending(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: user.email! });
      if (error) throw error;
      toast({ title: "Verification email sent", description: "Check your inbox." });
    } catch (err: any) {
      toast({ title: "Couldn't resend", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm">
      <Mail className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1 text-foreground">Verify your email to secure your account.</span>
      <button
        onClick={resend}
        disabled={sending}
        className="font-medium text-primary hover:underline disabled:opacity-60"
      >
        {sending ? "Sending..." : "Resend"}
      </button>
      <button
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default EmailVerifyBanner;
