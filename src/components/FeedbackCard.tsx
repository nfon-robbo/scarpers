import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Star, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const FeedbackCard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rating, setRating] = useState<number | null>(null);
  const [category, setCategory] = useState<string>("general");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!user) return;
    if (!message.trim()) {
      toast({ title: "Add a message first", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("user_feedback" as any)
        .insert({ user_id: user.id, rating, category, message: message.trim() });
      if (error) throw error;
      toast({ title: "Thanks for the feedback!", description: "We read every message." });
      setMessage("");
      setRating(null);
      setCategory("general");
    } catch (e: any) {
      toast({ title: "Couldn't send feedback", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="glass border-border/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          Send feedback
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">Spotted a bug, got an idea, or want to rate the app? Let us know.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-[11px] text-muted-foreground">Rating</Label>
          <div className="flex gap-1 mt-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(rating === n ? null : n)}
                className="p-1"
                aria-label={`${n} stars`}
              >
                <Star
                  className={cn(
                    "w-5 h-5 transition-colors",
                    rating && n <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40",
                  )}
                />
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="bug">Bug report</SelectItem>
              <SelectItem value="feature">Feature request</SelectItem>
              <SelectItem value="plan">Training plan</SelectItem>
              <SelectItem value="ai">AI coach</SelectItem>
              <SelectItem value="ux">UI / UX</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Message</Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell us what's on your mind…"
            rows={3}
            className="mt-1 text-sm"
          />
        </div>
        <Button onClick={submit} disabled={submitting || !message.trim()} className="w-full">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send feedback"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default FeedbackCard;
