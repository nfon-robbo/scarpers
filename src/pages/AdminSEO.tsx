import { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Search, ArrowLeft, ExternalLink, TrendingUp, Target, Globe, Link2, Lightbulb, ListChecks } from "lucide-react";
import snapshot from "@/data/seo-snapshot.json";

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
  const { user, loading: authLoading } = useAuth();
  const [checked, setChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

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

      <Tabs defaultValue="keywords">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="keywords"><Target className="w-3.5 h-3.5 mr-1.5" /> Keywords</TabsTrigger>
          <TabsTrigger value="targets"><Lightbulb className="w-3.5 h-3.5 mr-1.5" /> Target opportunities</TabsTrigger>
          <TabsTrigger value="pages"><Globe className="w-3.5 h-3.5 mr-1.5" /> Top pages</TabsTrigger>
          <TabsTrigger value="trend"><TrendingUp className="w-3.5 h-3.5 mr-1.5" /> Trend</TabsTrigger>
          <TabsTrigger value="competitors"><Target className="w-3.5 h-3.5 mr-1.5" /> Competitors</TabsTrigger>
          <TabsTrigger value="backlinks"><Link2 className="w-3.5 h-3.5 mr-1.5" /> Backlinks</TabsTrigger>
          <TabsTrigger value="actions"><ListChecks className="w-3.5 h-3.5 mr-1.5" /> Insights & actions</TabsTrigger>
        </TabsList>

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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.targetKeywords.map((k) => (
                    <TableRow key={k.keyword}>
                      <TableCell className="font-medium">{k.keyword}</TableCell>
                      <TableCell>{fmtNum(k.volume)}</TableCell>
                      <TableCell>
                        <Badge variant={diffColor(k.difficulty) as any}>
                          {k.difficulty == null ? "—" : `${k.difficulty}/100`} · {k.difficultyLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize text-sm text-muted-foreground">{k.competitionLabel}</TableCell>
                      <TableCell>{fmtGBP(k.cpcUsd)}</TableCell>
                    </TableRow>
                  ))}
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
    </div>
  );
};

export default AdminSEO;
