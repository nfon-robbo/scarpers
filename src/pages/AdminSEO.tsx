import { useEffect, useState, Fragment } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Search, ArrowLeft, ExternalLink, TrendingUp, Target, Globe, Link2, Lightbulb, ListChecks, Activity, RefreshCw, Sparkles, ChevronDown, ChevronUp, CheckCircle2, Clock, History, ArrowUpDown, AlertTriangle, Zap } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import snapshot from "@/data/seo-snapshot.json";

type Suggestion = {
  type: string;
  title: string;
  description: string;
  effort: string;
  impact: string;
  blogTitle?: string;
  blogSlug?: string;
  blogOutline?: string[];
};

type GscRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
type GscResponse = {
  site: string;
  range: { start: string; end: string; days?: number };
  totals: GscRow | null;
  byQuery: GscRow[];
  byPage: GscRow[];
  byDate: GscRow[];
  sitemaps: any[];
  fetchedAt: string;
};

const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`;
const fmtPos = (n: number) => n.toFixed(1);

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-GB"));
const fmtGBP = (usd: number | null | undefined) => (usd == null ? "—" : `£${(usd * 0.79).toFixed(2)}`);

const Stat = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div className="rounded-xl border border-border/50 p-4 bg-card/60">
    <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
    <p className="text-2xl font-semibold mt-1">{value}</p>
    {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
  </div>
);

const diffColor = (d: number | null) => {
  if (d == null) return "outline";
  if (d < 30) return "default";
  if (d < 60) return "secondary";
  return "destructive";
};

const AdminSEO = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [checked, setChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [gsc, setGsc] = useState<GscResponse | null>(null);
  const [gscLoading, setGscLoading] = useState(false);
  const [gscError, setGscError] = useState<string | null>(null);
  const [gscDays, setGscDays] = useState<7 | 28 | 90>(28);
  type GscSortKey = "query" | "clicks" | "impressions" | "ctr" | "position";
  const [gscSort, setGscSort] = useState<{ key: GscSortKey; dir: "asc" | "desc" }>({ key: "impressions", dir: "desc" });

  // GA4
  type Ga4Data = {
    range: { days: number };
    totals: { activeUsers: number; newUsers: number; sessions: number; pageViews: number; avgSessionDuration: number; engagementRate: number };
    pages: { path: string; pageViews: number; users: number; engagementRate: number }[];
    sources: { source: string; medium: string; sessions: number; users: number }[];
    countries: { country: string; users: number }[];
    fetchedAt: string;
  };
  const [ga4Connected, setGa4Connected] = useState<boolean | null>(null);
  const [ga4Data, setGa4Data] = useState<Ga4Data | null>(null);
  const [ga4Loading, setGa4Loading] = useState(false);
  const [ga4Error, setGa4Error] = useState<string | null>(null);
  const [ga4Days, setGa4Days] = useState<7 | 28 | 90>(28);

  const checkGa4 = async () => {
    const { data } = await supabase.functions.invoke("ga4-data", { body: { action: "status" } });
    setGa4Connected(!!(data as any)?.connected);
  };
  const loadGa4 = async (days: 7 | 28 | 90 = ga4Days) => {
    setGa4Loading(true); setGa4Error(null);
    try {
      const { data, error } = await supabase.functions.invoke("ga4-data", { body: { action: "report", days } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setGa4Data(data as Ga4Data);
    } catch (e: any) {
      setGa4Error(e?.message ?? "Failed to load GA4 data");
    } finally { setGa4Loading(false); }
  };
  const connectGa4 = async () => {
    const { data, error } = await supabase.functions.invoke("ga4-oauth-start", { body: {} });
    if (error || !(data as any)?.url) { toast.error("Failed to start GA4 connection"); return; }
    const popup = window.open((data as any).url, "ga4-oauth", "width=520,height=640");
    const onMsg = (ev: MessageEvent) => {
      if (ev.data === "ga4-connected") {
        window.removeEventListener("message", onMsg);
        toast.success("Google Analytics connected");
        setGa4Connected(true);
        loadGa4(ga4Days);
      }
    };
    window.addEventListener("message", onMsg);
    // Fallback: if popup closes, re-check status
    const timer = setInterval(() => {
      if (popup?.closed) { clearInterval(timer); checkGa4().then(() => ga4Connected && loadGa4(ga4Days)); }
    }, 1000);
  };
  const disconnectGa4 = async () => {
    await supabase.functions.invoke("ga4-data", { body: { action: "disconnect" } });
    setGa4Connected(false); setGa4Data(null);
    toast.success("Disconnected");
  };

  // Suggestions dialog
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsKeyword, setSuggestionsKeyword] = useState("");
  const [suggestionsPosition, setSuggestionsPosition] = useState<number | null>(null);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [expandedSuggestion, setExpandedSuggestion] = useState<number | null>(null);
  const [actionedIndices, setActionedIndices] = useState<Set<number>>(new Set());

  // Keyword action tracking
  type KeywordAction = { id: string; keyword: string; action_taken: string; notes: string | null; actioned_by: string; actioned_by_email: string | null; actioned_at: string; next_review_at: string };
  const [keywordActions, setKeywordActions] = useState<KeywordAction[]>([]);
  const [actionDialogKeyword, setActionDialogKeyword] = useState<string | null>(null);
  const [actionInput, setActionInput] = useState("");
  const [actionNotes, setActionNotes] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const [expandedHistoryRow, setExpandedHistoryRow] = useState<string | null>(null);

  const loadKeywordActions = async () => {
    const { data, error } = await supabase
      .from("keyword_actions" as any)
      .select("*")
      .order("actioned_at", { ascending: false });
    if (!error && data) setKeywordActions(data as any);
  };

  const latestActionByKeyword = (kw: string) =>
    keywordActions.find((a) => a.keyword.toLowerCase() === kw.toLowerCase());
  const historyForKeyword = (kw: string) =>
    keywordActions.filter((a) => a.keyword.toLowerCase() === kw.toLowerCase());
  const isReviewDue = (a: KeywordAction | undefined) =>
    !!a && new Date(a.next_review_at).getTime() <= Date.now();
  const fmtUkDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB");

  const openActionDialog = (kw: string) => {
    setActionDialogKeyword(kw);
    setActionInput("");
    setActionNotes("");
  };

  const submitAction = async (kw: string, actionText: string, notes: string | null) => {
    if (!user) return;
    setSavingAction(true);
    try {
      const { error } = await supabase.from("keyword_actions" as any).insert({
        keyword: kw,
        action_taken: actionText,
        notes,
        actioned_by: user.id,
        actioned_by_email: user.email ?? null,
      });
      if (error) throw error;
      toast.success("Action recorded");
      setActionDialogKeyword(null);
      await loadKeywordActions();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save action");
    } finally {
      setSavingAction(false);
    }
  };


  const loadGsc = async (days: 7 | 28 | 90 = gscDays) => {
    setGscLoading(true); setGscError(null);
    try {
      const { data, error } = await supabase.functions.invoke("search-console", { body: { days } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setGsc(data as GscResponse);
    } catch (e: any) {
      setGscError(e?.message ?? "Failed to load Search Console data");
    } finally {
      setGscLoading(false);
    }
  };

  useEffect(() => { if (isAdmin) loadGsc(gscDays); /* eslint-disable-line */ }, [isAdmin, gscDays]);
  useEffect(() => { if (isAdmin) loadKeywordActions(); }, [isAdmin]);

  const openSuggestions = async (keyword: string, position: number | null, volume?: number | null, difficulty?: number | null) => {
    setSuggestionsKeyword(keyword);
    setSuggestionsPosition(position);
    setSuggestions([]);
    setActionedIndices(new Set());
    setExpandedSuggestion(null);
    setSuggestionsOpen(true);
    setSuggestionsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("seo-suggestions", {
        body: { keyword, position, volume, difficulty },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setSuggestions(((data as any).suggestions ?? []) as Suggestion[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate suggestions");
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const applySuggestion = async (s: Suggestion, idx: number) => {
    if (actionedIndices.has(idx)) { toast.info("Already actioned."); return; }
    setApplyingIdx(idx);
    try {
      const { data, error } = await supabase.functions.invoke("seo-suggestions", {
        body: {
          keyword: suggestionsKeyword,
          action: "apply",
          suggestionTitle: s.title,
          suggestionDescription: s.description,
          suggestionType: s.type,
          blogTitle: s.blogTitle,
          blogSlug: s.blogSlug,
          blogOutline: s.blogOutline,
        },
      });
      if (error) throw error;
      if ((data as any)?.applied && (data as any)?.post) {
        setActionedIndices(prev => new Set(prev).add(idx));
        const post = (data as any).post;
        toast.success("Draft blog post created", {
          description: `"${post.slug}" saved as draft.`,
          action: { label: "Edit", onClick: () => navigate(`/admin/blog/${post.id}`) },
        });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to apply suggestion");
    } finally {
      setApplyingIdx(null);
    }
  };

  const effortColor = (e: string) => e === "low" ? "bg-primary/20 text-primary" : e === "medium" ? "bg-amber-500/20 text-amber-600" : "bg-destructive/20 text-destructive";
  const impactColor = (i: string) => i === "high" ? "bg-primary/20 text-primary" : i === "medium" ? "bg-amber-500/20 text-amber-600" : "bg-muted text-muted-foreground";


  useEffect(() => {
    if (authLoading) return;
    (async () => {
      if (!user) { setChecked(true); return; }
      const { data } = await supabase
        .from("user_roles" as any)
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin");
      setIsAdmin(Array.isArray(data) && data.length > 0);
      setChecked(true);
    })();
  }, [user, authLoading]);

  if (authLoading || !checked) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const s = snapshot as typeof snapshot;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin"><ArrowLeft className="w-4 h-4 mr-1" /> Admin</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Search className="w-5 h-5 text-primary" /> SEO Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Semrush snapshot for <span className="font-mono">{s.domain}</span> · {s.database.toUpperCase()} database · last refreshed {fmtDate(s.lastUpdated)}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={`https://www.semrush.com/analytics/overview/?q=${s.domain}&searchType=domain`} target="_blank" rel="noopener noreferrer">
            Open in Semrush <ExternalLink className="w-3 h-3 ml-1" />
          </a>
        </Button>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Data is pulled by the Lovable agent on demand — ask in chat to "refresh SEO snapshot" and I'll re-run all Semrush queries and rewrite this page's data file.
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Ranking keywords" value={fmtNum(s.overview.organicKeywords)} hint="Total terms ranked top 100" />
        <Stat label="Est. monthly traffic" value={`${fmtNum(s.overview.organicTrafficEst)}/mo`} hint="Semrush model — likely a lower bound" />
        <Stat label="Est. traffic value" value={fmtGBP(s.overview.organicCostUsdEst)} hint="What this traffic would cost as ads" />
        <Stat label="Paid ads" value={fmtNum(s.overview.adwordsKeywords)} hint="Adwords keywords" />
      </div>

      <Tabs defaultValue="live">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="live"><Activity className="w-3.5 h-3.5 mr-1.5" /> Live (Search Console)</TabsTrigger>
          <TabsTrigger value="keywords"><Target className="w-3.5 h-3.5 mr-1.5" /> Keywords</TabsTrigger>
          <TabsTrigger value="targets"><Lightbulb className="w-3.5 h-3.5 mr-1.5" /> Target opportunities</TabsTrigger>
          <TabsTrigger value="pages"><Globe className="w-3.5 h-3.5 mr-1.5" /> Top pages</TabsTrigger>
          <TabsTrigger value="trend"><TrendingUp className="w-3.5 h-3.5 mr-1.5" /> Trend</TabsTrigger>
          <TabsTrigger value="competitors"><Target className="w-3.5 h-3.5 mr-1.5" /> Competitors</TabsTrigger>
          <TabsTrigger value="backlinks"><Link2 className="w-3.5 h-3.5 mr-1.5" /> Backlinks</TabsTrigger>
          <TabsTrigger value="actions"><ListChecks className="w-3.5 h-3.5 mr-1.5" /> Insights & actions</TabsTrigger>
        </TabsList>

        {/* Live Search Console */}
        <TabsContent value="live" className="space-y-4">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-6 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm">
                <p className="font-medium">Real Google search data — last {gscDays} days</p>
                <p className="text-muted-foreground text-xs">
                  {gsc ? `${fmtDate(gsc.range.start)} → ${fmtDate(gsc.range.end)} · refreshed ${new Date(gsc.fetchedAt).toLocaleTimeString("en-GB")}` : "Pulled from Google Search Console via your connected account."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select value={String(gscDays)} onValueChange={(v) => setGscDays(Number(v) as 7 | 28 | 90)}>
                  <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="28">Last 28 days</SelectItem>
                    <SelectItem value="90">Last 3 months</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => loadGsc(gscDays)} disabled={gscLoading}>
                  {gscLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                  Refresh
                </Button>
              </div>
            </CardContent>
          </Card>

          {gscError && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="pt-6 text-sm text-destructive space-y-2">
                <p>{gscError}</p>
                <p className="text-xs text-muted-foreground">
                  If you haven't connected Google Search Console yet, go to <strong>Connectors → Google Search Console</strong> and authorise access to scarpers.co.uk. Once connected, this page automatically refreshes daily.
                </p>
              </CardContent>
            </Card>
          )}

          {gscLoading && !gsc && (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          )}

          {gsc && (() => {
            const queries = gsc.byQuery ?? [];
            const sortRows = (rows: GscRow[]) => {
              const dir = gscSort.dir === "asc" ? 1 : -1;
              return [...rows].sort((a, b) => {
                if (gscSort.key === "query") return ((a.keys?.[0] ?? "").localeCompare(b.keys?.[0] ?? "")) * dir;
                return ((a as any)[gscSort.key] - (b as any)[gscSort.key]) * dir;
              });
            };
            const toggleSort = (key: GscSortKey) =>
              setGscSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "query" ? "asc" : "desc" });
            const SortHead = ({ k, label, className }: { k: GscSortKey; label: string; className?: string }) => (
              <TableHead className={className}>
                <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground">
                  {label}
                  <ArrowUpDown className={`h-3 w-3 ${gscSort.key === k ? "text-primary" : "opacity-40"}`} />
                </button>
              </TableHead>
            );
            const sortedQueries = sortRows(queries).slice(0, 20);
            const quickWins = queries.filter((r) => r.position >= 8 && r.position <= 20).sort((a, b) => b.impressions - a.impressions);
            const lowCtr = queries.filter((r) => r.impressions > 100 && r.ctr < 0.02).sort((a, b) => b.impressions - a.impressions);
            const quickWinAction = (r: GscRow) => {
              if (r.position > 15) return "Add internal links + expand on-page content";
              if (r.ctr < 0.03) return "Rewrite page title & meta description for clicks";
              return "Strengthen H1 + add FAQ section to push to page 1";
            };
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Impressions" value={fmtNum(gsc.totals?.impressions ?? 0)} hint="Times we appeared in Google" />
                <Stat label="Clicks" value={fmtNum(gsc.totals?.clicks ?? 0)} hint="Actual visits from search" />
                <Stat label="CTR" value={gsc.totals ? fmtPct(gsc.totals.ctr) : "—"} hint="Clicks ÷ impressions" />
                <Stat label="Avg position" value={gsc.totals ? fmtPos(gsc.totals.position) : "—"} hint="Average rank when shown" />
              </div>

              {/* Quick Win Keywords (position 8-20) */}
              <Card className="border-amber-500/40 bg-amber-500/5">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4 text-amber-600" /> Quick win keywords</CardTitle>
                  <CardDescription>Queries ranking in positions 8–20 — closest to page one. Biggest ROI for small improvements.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Query</TableHead>
                        <TableHead>Clicks</TableHead>
                        <TableHead>Impressions</TableHead>
                        <TableHead>CTR</TableHead>
                        <TableHead>Avg position</TableHead>
                        <TableHead>Suggested action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quickWins.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No quick-win queries in this date range yet.</TableCell></TableRow>
                      )}
                      {quickWins.map((r) => (
                        <TableRow key={`qw-${r.keys?.[0]}`}>
                          <TableCell className="font-medium">{r.keys?.[0]}</TableCell>
                          <TableCell>{fmtNum(r.clicks)}</TableCell>
                          <TableCell>{fmtNum(r.impressions)}</TableCell>
                          <TableCell>{fmtPct(r.ctr)}</TableCell>
                          <TableCell><Badge className="bg-amber-500/20 text-amber-700 border-amber-500/40">{fmtPos(r.position)}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{quickWinAction(r)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* High Impression / Low CTR */}
              <Card className="border-destructive/40 bg-destructive/5">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-destructive" /> High impressions, low clicks</CardTitle>
                  <CardDescription>&gt;100 impressions but CTR below 2%. Google shows the site but users skip it — fix the page title and meta description.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Query</TableHead>
                        <TableHead>Clicks</TableHead>
                        <TableHead>Impressions</TableHead>
                        <TableHead>CTR</TableHead>
                        <TableHead>Avg position</TableHead>
                        <TableHead>Suggested action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lowCtr.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No queries match — every high-impression query is already getting clicks.</TableCell></TableRow>
                      )}
                      {lowCtr.map((r) => (
                        <TableRow key={`lc-${r.keys?.[0]}`}>
                          <TableCell className="font-medium">{r.keys?.[0]}</TableCell>
                          <TableCell>{fmtNum(r.clicks)}</TableCell>
                          <TableCell>{fmtNum(r.impressions)}</TableCell>
                          <TableCell><Badge variant="destructive">{fmtPct(r.ctr)}</Badge></TableCell>
                          <TableCell>{fmtPos(r.position)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">Rewrite the meta title &amp; description on the ranking page</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Top queries (sortable) */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top queries</CardTitle>
                  <CardDescription>Top 20 search queries by impressions — click any column header to sort.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortHead k="query" label="Query" />
                        <SortHead k="clicks" label="Clicks" />
                        <SortHead k="impressions" label="Impressions" />
                        <SortHead k="ctr" label="CTR" />
                        <SortHead k="position" label="Avg position" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedQueries.length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">No query data yet — Google needs a few days of impressions before reporting.</TableCell></TableRow>
                      )}
                      {sortedQueries.map((r) => (
                        <TableRow key={r.keys?.[0]}>
                          <TableCell className="font-medium">{r.keys?.[0]}</TableCell>
                          <TableCell>{fmtNum(r.clicks)}</TableCell>
                          <TableCell>{fmtNum(r.impressions)}</TableCell>
                          <TableCell>{fmtPct(r.ctr)}</TableCell>
                          <TableCell><Badge variant={r.position <= 3 ? "default" : r.position <= 10 ? "secondary" : "outline"}>{fmtPos(r.position)}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top pages</CardTitle>
                  <CardDescription>Which pages on your site Google is showing</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Page</TableHead>
                        <TableHead>Clicks</TableHead>
                        <TableHead>Impressions</TableHead>
                        <TableHead>CTR</TableHead>
                        <TableHead>Avg position</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {gsc.byPage.length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">No page data yet.</TableCell></TableRow>
                      )}
                      {gsc.byPage.map((r) => (
                        <TableRow key={r.keys?.[0]}>
                          <TableCell className="font-mono text-xs"><a href={r.keys?.[0]} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.keys?.[0]}</a></TableCell>
                          <TableCell>{fmtNum(r.clicks)}</TableCell>
                          <TableCell>{fmtNum(r.impressions)}</TableCell>
                          <TableCell>{fmtPct(r.ctr)}</TableCell>
                          <TableCell>{fmtPos(r.position)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {gsc.sitemaps.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Submitted sitemaps</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Path</TableHead>
                          <TableHead>Last submitted</TableHead>
                          <TableHead>Last downloaded</TableHead>
                          <TableHead>URLs</TableHead>
                          <TableHead>Errors</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gsc.sitemaps.map((sm: any) => (
                          <TableRow key={sm.path}>
                            <TableCell className="font-mono text-xs">{sm.path}</TableCell>
                            <TableCell className="text-xs">{sm.lastSubmitted ? fmtDate(sm.lastSubmitted) : "—"}</TableCell>
                            <TableCell className="text-xs">{sm.lastDownloaded ? fmtDate(sm.lastDownloaded) : "—"}</TableCell>
                            <TableCell>{sm.contents?.[0]?.submitted ?? "—"}</TableCell>
                            <TableCell>{sm.errors ?? 0}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </>
          );
          })()}
        </TabsContent>

        {/* Current ranking keywords */}
        <TabsContent value="keywords" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Currently ranking keywords</CardTitle>
              <CardDescription>What Google currently shows scarpers.co.uk for, in the top 100</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Keyword</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Volume / mo</TableHead>
                    <TableHead>Traffic share</TableHead>
                    <TableHead>URL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.topKeywords.map((k) => (
                    <TableRow key={k.keyword}>
                      <TableCell className="font-medium">{k.keyword}</TableCell>
                      <TableCell><Badge variant={k.position <= 3 ? "default" : k.position <= 10 ? "secondary" : "outline"}>#{k.position}</Badge></TableCell>
                      <TableCell>{fmtNum(k.volume)}</TableCell>
                      <TableCell>{k.trafficShare}%</TableCell>
                      <TableCell className="font-mono text-xs"><a href={k.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{k.url}</a></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Target keyword opportunities */}
        <TabsContent value="targets" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Target keyword opportunities</CardTitle>
              <CardDescription>Terms we want to win. KDI &lt; 30 = realistic for a new site.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Keyword</TableHead>
                    <TableHead>Volume / mo</TableHead>
                    <TableHead>Difficulty</TableHead>
                    <TableHead>Competition</TableHead>
                    <TableHead>CPC</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.targetKeywords.map((k) => {
                    const latest = latestActionByKeyword(k.keyword);
                    const history = historyForKeyword(k.keyword);
                    const due = isReviewDue(latest);
                    const expanded = expandedHistoryRow === k.keyword;
                    return (
                      <Fragment key={k.keyword}>
                        <TableRow>
                          <TableCell className="font-medium align-top">{k.keyword}</TableCell>
                          <TableCell className="align-top">{fmtNum(k.volume)}</TableCell>
                          <TableCell className="align-top">
                            <Badge variant={diffColor(k.difficulty) as any}>
                              {k.difficulty == null ? "—" : `${k.difficulty}/100`} · {k.difficultyLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="capitalize text-sm text-muted-foreground align-top">{k.competitionLabel}</TableCell>
                          <TableCell className="align-top">{fmtGBP(k.cpcUsd)}</TableCell>
                          <TableCell className="text-right align-top">
                            {!latest ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => openSuggestions(k.keyword, null, k.volume, k.difficulty)}
                                >
                                  <Sparkles className="h-3 w-3 mr-1" /> Improve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs text-muted-foreground"
                                  onClick={() => openActionDialog(k.keyword)}
                                  title="Log an action taken on this keyword"
                                >
                                  Log
                                </Button>
                              </div>
                            ) : (
                              <div className="flex flex-col items-end gap-1">
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => openSuggestions(k.keyword, null, k.volume, k.difficulty)}
                                  >
                                    <Sparkles className="h-3 w-3 mr-1" /> Improve
                                  </Button>
                                </div>
                                <button
                                  onClick={() => openActionDialog(k.keyword)}
                                  className="inline-flex items-center"
                                  title="View history & log new action"
                                >
                                  {due ? (
                                    <Badge className="bg-amber-500/20 text-amber-700 border-amber-500/40 hover:bg-amber-500/30 cursor-pointer">
                                      <Clock className="h-3 w-3 mr-1" /> Review due
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-emerald-500/20 text-emerald-700 border-emerald-500/40 hover:bg-emerald-500/30 cursor-pointer">
                                      <CheckCircle2 className="h-3 w-3 mr-1" /> Actioned
                                    </Badge>
                                  )}
                                </button>
                                <button
                                  onClick={() => setExpandedHistoryRow(expanded ? null : k.keyword)}
                                  className="text-[11px] text-muted-foreground hover:text-foreground max-w-[220px] truncate text-right"
                                  title={latest.action_taken}
                                >
                                  {fmtUkDate(latest.actioned_at)} · {latest.action_taken}
                                </button>
                                <span className="text-[10px] text-muted-foreground">
                                  Review due {fmtUkDate(latest.next_review_at)}
                                </span>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                        {expanded && history.length > 0 && (
                          <TableRow key={`${k.keyword}-hist`}>
                            <TableCell colSpan={6} className="bg-muted/30">
                              <div className="text-xs space-y-1.5">
                                <p className="font-medium flex items-center gap-1"><History className="h-3 w-3" /> Action history</p>
                                {history.map((h) => (
                                  <div key={h.id} className="flex gap-2 pl-4 border-l-2 border-primary/20">
                                    <span className="text-muted-foreground shrink-0">{fmtUkDate(h.actioned_at)}</span>
                                    <span className="flex-1">
                                      <span className="font-medium">{h.action_taken}</span>
                                      {h.notes && <span className="text-muted-foreground"> — {h.notes}</span>}
                                      {h.actioned_by_email && <span className="text-muted-foreground"> · {h.actioned_by_email}</span>}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Top pages */}
        <TabsContent value="pages" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top pages by traffic share</CardTitle>
              <CardDescription>Pages currently pulling organic traffic</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    <TableHead>Keywords</TableHead>
                    <TableHead>Best position</TableHead>
                    <TableHead>Top keyword</TableHead>
                    <TableHead>Traffic share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.topPages.map((p) => (
                    <TableRow key={p.url}>
                      <TableCell className="font-mono text-xs"><a href={p.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{p.url}</a></TableCell>
                      <TableCell>{p.keywordsRanking}</TableCell>
                      <TableCell>#{p.bestPosition}</TableCell>
                      <TableCell>{p.topKeyword}</TableCell>
                      <TableCell>{p.trafficShare}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trend */}
        <TabsContent value="trend" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SEO trend (last 6 months)</CardTitle>
              <CardDescription>Monthly snapshot of keyword count and estimated traffic</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Ranking keywords</TableHead>
                    <TableHead>Est. traffic</TableHead>
                    <TableHead>Est. value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.trend.map((t) => (
                    <TableRow key={t.date}>
                      <TableCell className="font-mono text-sm">{fmtDate(t.date)}</TableCell>
                      <TableCell>{fmtNum(t.keywords)}</TableCell>
                      <TableCell>{fmtNum(t.traffic)}</TableCell>
                      <TableCell>{fmtGBP(t.costUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Competitors */}
        <TabsContent value="competitors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organic competitors</CardTitle>
              <CardDescription>Domains overlapping with our ranking terms — most are noise until we rank for real terms.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Relevance</TableHead>
                    <TableHead>Their keywords</TableHead>
                    <TableHead>Their traffic</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.competitors.map((c) => (
                    <TableRow key={c.domain}>
                      <TableCell className="font-medium">{c.domain}</TableCell>
                      <TableCell>{c.relevance.toFixed(2)}</TableCell>
                      <TableCell>{fmtNum(c.organicKeywords)}</TableCell>
                      <TableCell>{fmtNum(c.organicTraffic)} /mo</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Backlinks */}
        <TabsContent value="backlinks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Backlinks</CardTitle>
              <CardDescription>Links from other sites pointing to scarpers.co.uk</CardDescription>
            </CardHeader>
            <CardContent>
              {s.backlinks ? (
                <pre className="text-xs">{JSON.stringify(s.backlinks, null, 2)}</pre>
              ) : (
                <div className="rounded-xl border border-dashed border-border/50 p-6 text-sm text-muted-foreground">
                  No backlinks detected by Semrush yet. This is the biggest compounding opportunity — every link from a running blog, parkrun forum, or Reddit thread will boost authority and lift rankings on our easy-difficulty target keywords.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Insights & actions */}
        <TabsContent value="actions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Lightbulb className="w-4 h-4" /> Insights</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {s.insights.map((i, idx) => (
                  <li key={idx} className="flex gap-2"><span className="text-primary">•</span><span>{i}</span></li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><ListChecks className="w-4 h-4" /> Recommended actions</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm list-decimal list-inside">
                {s.actions.map((a, idx) => (
                  <li key={idx}>{a}</li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Improve: "{suggestionsKeyword}"
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {suggestionsPosition ? `Currently ranking #${suggestionsPosition}` : "Not currently ranking"}
            </p>
          </DialogHeader>

          {suggestionsLoading ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Analysing keyword & generating suggestions…</p>
            </div>
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No suggestions available.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground font-medium">{suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""} (highest impact first)</p>
              {suggestions.map((sug, i) => (
                <Card key={i} className="overflow-hidden">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center shrink-0">{i + 1}</span>
                          <span className="font-medium text-sm">{sug.title}</span>
                          <Badge variant="outline" className={`text-[10px] h-5 ${effortColor(sug.effort)}`}>{sug.effort} effort</Badge>
                          <Badge variant="outline" className={`text-[10px] h-5 ${impactColor(sug.impact)}`}>{sug.impact} impact</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{sug.description}</p>
                      </div>
                      {sug.blogOutline && (
                        <button
                          onClick={() => setExpandedSuggestion(expandedSuggestion === i ? null : i)}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          {expandedSuggestion === i ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      )}
                    </div>

                    {expandedSuggestion === i && sug.blogOutline && (
                      <div className="mt-2 pl-2 border-l-2 border-primary/20">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Blog outline:</p>
                        <ul className="text-xs text-muted-foreground space-y-0.5">
                          {sug.blogOutline.map((point, j) => <li key={j}>• {point}</li>)}
                        </ul>
                      </div>
                    )}

                    <div className="flex gap-2 mt-2">
                      {actionedIndices.has(i) ? (
                        <Button size="sm" className="h-7 text-xs" variant="outline" disabled>✓ Done</Button>
                      ) : (
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => applySuggestion(sug, i)}
                          disabled={applyingIdx === i}
                        >
                          {applyingIdx === i ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                          {applyingIdx === i ? "Working…" : "Action this"}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionDialogKeyword} onOpenChange={(o) => !o && setActionDialogKeyword(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {actionDialogKeyword}
            </DialogTitle>
          </DialogHeader>

          {actionDialogKeyword && (() => {
            const history = historyForKeyword(actionDialogKeyword);
            const latest = latestActionByKeyword(actionDialogKeyword);
            const due = isReviewDue(latest);
            return (
              <div className="space-y-4">
                {history.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <History className="h-3 w-3" /> Action history ({history.length})
                    </p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-2">
                      {history.map((h) => (
                        <div key={h.id} className="text-xs border-l-2 border-primary/30 pl-2">
                          <div className="font-medium">{fmtUkDate(h.actioned_at)} — {h.action_taken}</div>
                          {h.notes && <div className="text-muted-foreground">{h.notes}</div>}
                          {h.actioned_by_email && <div className="text-[10px] text-muted-foreground">by {h.actioned_by_email}</div>}
                          <div className="text-[10px] text-muted-foreground">Review due {fmtUkDate(h.next_review_at)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-medium">What action was taken?</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="e.g. added blog post, updated meta description"
                    value={actionInput}
                    onChange={(e) => setActionInput(e.target.value)}
                    autoFocus
                  />
                  <Textarea
                    placeholder="Optional notes / details"
                    value={actionNotes}
                    onChange={(e) => setActionNotes(e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="flex flex-wrap gap-2 justify-end">
                  {due && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={savingAction}
                      onClick={() => submitAction(actionDialogKeyword, "No action needed", "Reset review by 30 days")}
                    >
                      No action needed · reset 30d
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={savingAction || !actionInput.trim()}
                    onClick={() => submitAction(actionDialogKeyword, actionInput.trim(), actionNotes.trim() || null)}
                  >
                    {savingAction ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                    Save action
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminSEO;
