import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { parseZipFile, parseFitBuffer, type ParseResult, type ParsedActivity } from "@/lib/fit-parser";
import { isGarminExportZip, importGarminExport } from "@/lib/garmin-export-import";
import { purgeStravaOverlaps } from "@/lib/activity-dedupe";
import { buildFitLapRows } from "@/lib/fit-lap-rows";
import { planCrossSourceMerge, applyEnrichmentPatches } from "@/lib/activity-cross-source-merge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload as UploadIcon, FileArchive, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import StravaConnect from "@/components/StravaConnect";

type UploadState = "idle" | "extracting" | "parsing" | "saving" | "done" | "error";

const UploadPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const processFiles = useCallback(async (files: File[]) => {
    if (!user || files.length === 0) return;

    const totalSize = files.reduce((s, f) => s + f.size, 0);
    if (totalSize > 500 * 1024 * 1024) {
      toast({ title: "Files too large", description: "Maximum total size is 500MB.", variant: "destructive" });
      return;
    }

    const fitFiles = files.filter(f => f.name.toLowerCase().endsWith(".fit"));
    const zipFiles = files.filter(f => f.name.toLowerCase().endsWith(".zip"));
    const invalid = files.filter(f => !f.name.toLowerCase().endsWith(".fit") && !f.name.toLowerCase().endsWith(".zip"));

    if (invalid.length > 0) {
      toast({ title: "Invalid files", description: "Please upload .fit or .zip files only.", variant: "destructive" });
      return;
    }

    setState("extracting");
    setProgress(10);
    setResult(null);
    setSavedCount(0);

    // Detect Garmin Connect data export ZIPs and route to dedicated importer
    const garminZips: File[] = [];
    const fitZips: File[] = [];
    for (const z of zipFiles) {
      if (await isGarminExportZip(z)) garminZips.push(z); else fitZips.push(z);
    }

    if (garminZips.length) {
      setState("parsing");
      try {
        let totalActs = 0, totalDaily = 0, totalSleep = 0;
        const errs: string[] = [];
        for (const gz of garminZips) {
          const res = await importGarminExport(gz, user.id, (p) => {
            if (p.total) setProgress(Math.min(95, 30 + Math.round((p.current || 0) / p.total * 60)));
          });
          totalActs += res.activities.inserted;
          totalDaily += res.dailyMetrics.inserted;
          totalSleep += res.sleepDays;
          errs.push(...res.errors);
        }
        setProgress(100);
        setSavedCount(totalActs);
        setResult({ activities: [], errors: errs, fileCount: garminZips.length } as any);
        setState(errs.length ? "error" : "done");
        toast({
          title: "Garmin import complete",
          description: `${totalActs} activities, ${totalDaily} wellness days, ${totalSleep} sleep nights imported.`,
        });
      } catch (e: any) {
        setState("error");
        toast({ title: "Garmin import failed", description: e.message, variant: "destructive" });
        return;
      }
      if (!fitZips.length && !fitFiles.length) return;
    }

    try {
      setState("parsing");
      setProgress(30);

      // Parse all sources and merge results
      const allActivities: ParsedActivity[] = [];
      const allErrors: string[] = [];
      let totalFileCount = 0;

      // Parse ZIP files (FIT-only zips)
      for (const zipFile of fitZips) {
        const r = await parseZipFile(zipFile);
        allActivities.push(...r.activities);
        allErrors.push(...r.errors);
        totalFileCount += r.fileCount;
      }

      // Parse standalone FIT files
      for (const fitFile of fitFiles) {
        try {
          const buffer = await fitFile.arrayBuffer();
          const parsed = await parseFitBuffer(buffer, fitFile.name);
          allActivities.push(...parsed);
          totalFileCount++;
        } catch (e: any) {
          allErrors.push(e.message || `Error parsing ${fitFile.name}`);
        }
      }

      const parseResult: ParseResult = { activities: allActivities, errors: allErrors, fileCount: totalFileCount };
      setResult(parseResult);

      if (parseResult.activities.length === 0) {
        setState("error");
        toast({ title: "No activities found", description: parseResult.errors.join(", ") || "No valid FIT data in this ZIP.", variant: "destructive" });
        return;
      }

      // Save upload record
      setState("saving");
      setProgress(60);

      const { data: uploadRecord, error: uploadError } = await supabase
        .from("uploads")
        .insert({
          user_id: user.id,
          file_name: files.map(f => f.name).join(", "),
          file_type: zipFiles.length > 0 ? "zip" : "fit",
          record_count: parseResult.activities.length,
          status: "completed",
        })
        .select("id")
        .single();

      if (uploadError) throw uploadError;

      // FIT always wins: remove any overlapping Strava activities (±15min) before insert
      try {
        const allFitTimes = parseResult.activities.map((a) => a.start_time);
        await purgeStravaOverlaps(user.id, allFitTimes, 15);
      } catch (e) {
        console.error("Strava overlap purge failed:", e);
      }

      // Skip files that have already been imported (unique on user_id + source_file)
      const allSourceFiles = Array.from(
        new Set(parseResult.activities.map((a) => a.source_file).filter(Boolean) as string[])
      );
      let existingSet = new Set<string>();
      if (allSourceFiles.length) {
        const { data: existingRows } = await supabase
          .from("activities")
          .select("source_file")
          .eq("user_id", user.id)
          .in("source_file", allSourceFiles);
        existingSet = new Set((existingRows || []).map((r: any) => r.source_file));
      }
      const toImport = parseResult.activities.filter(
        (a) => !a.source_file || !existingSet.has(a.source_file)
      );
      const skippedCount = parseResult.activities.length - toImport.length;

      // Cross-source fuzzy merge: enrich existing rows (e.g. from Strava)
      // instead of inserting duplicates. Attach laps to the existing id.
      const mergePlan = await planCrossSourceMerge(
        user.id,
        toImport.map((a) => ({
          start_time: a.start_time,
          activity_type: a.activity_type,
          duration_seconds: a.duration_seconds,
          distance_meters: a.distance_meters,
          avg_heart_rate: a.avg_heart_rate,
          max_heart_rate: a.max_heart_rate,
          avg_speed: a.avg_speed,
          max_speed: a.max_speed,
          avg_power: a.avg_power,
          max_power: a.max_power,
          avg_cadence: a.avg_cadence,
          total_ascent: a.total_ascent,
          total_descent: a.total_descent,
          calories: a.calories,
          avg_temperature: a.avg_temperature,
          training_effect: a.training_effect,
          training_load: a.training_load,
        })),
      );
      await applyEnrichmentPatches(mergePlan.enrichments);

      // Attach laps for fuzzy-matched activities to their existing id.
      const fuzzyLapRows: any[] = [];
      for (const e of mergePlan.enrichments) {
        const src = toImport[e.incomingIndex];
        fuzzyLapRows.push(
          ...buildFitLapRows(user.id, e.existingId, src.laps || []),
        );
      }
      if (fuzzyLapRows.length > 0) {
        const { error: lapErr } = await supabase
          .from("activity_laps")
          .insert(fuzzyLapRows);
        if (lapErr)
          console.warn(
            "activity_laps insert (fuzzy-merge) failed (non-fatal):",
            lapErr,
          );
      }
      const enrichedCount = mergePlan.enrichments.length;

      // Only insert rows that had no fuzzy match either.
      const remainingImport = mergePlan.remainingIndexes.map((i) => toImport[i]);


      // Insert activities in batches (fuzzy-matched rows already enriched above)
      const batchSize = 50;
      let saved = 0;
      for (let i = 0; i < remainingImport.length; i += batchSize) {
        const slice = remainingImport.slice(i, i + batchSize);
        const batch = slice.map((a) => ({
          user_id: user.id,
          upload_id: uploadRecord.id,
          activity_type: a.activity_type,
          start_time: a.start_time,
          duration_seconds: a.duration_seconds,
          distance_meters: a.distance_meters,
          avg_heart_rate: a.avg_heart_rate,
          max_heart_rate: a.max_heart_rate,
          avg_speed: a.avg_speed,
          max_speed: a.max_speed,
          avg_power: a.avg_power,
          max_power: a.max_power,
          avg_cadence: a.avg_cadence,
          total_ascent: a.total_ascent,
          total_descent: a.total_descent,
          calories: a.calories,
          avg_temperature: a.avg_temperature,
          training_effect: a.training_effect,
          training_load: a.training_load,
          source_file: a.source_file,
          raw_data: { ...a.raw_data as object, gps_track: a.gps_track },
        }));

        const { data: inserted, error } = await supabase
          .from("activities")
          .insert(batch as any)
          .select("id");
        if (error) throw error;

        // Additive: persist laps for each inserted activity. Failures here
        // must never affect the activity import result.
        if (inserted && inserted.length === slice.length) {
          const lapRows: any[] = [];
          for (let j = 0; j < slice.length; j++) {
            lapRows.push(
              ...buildFitLapRows(user.id, (inserted[j] as any).id, slice[j].laps || []),
            );
          }
          if (lapRows.length > 0) {
            const { error: lapErr } = await supabase.from("activity_laps").insert(lapRows);
            if (lapErr) console.warn("activity_laps insert failed (non-fatal):", lapErr);
          }
        }

        saved += batch.length;
        setSavedCount(saved);
        setProgress(60 + Math.round((saved / Math.max(1, remainingImport.length)) * 35));
      }

      setProgress(100);
      setState("done");
      const parts: string[] = [];
      parts.push(`${saved} imported`);
      if (enrichedCount) parts.push(`${enrichedCount} enriched existing`);
      if (skippedCount) parts.push(`${skippedCount} skipped (already imported)`);
      toast({ title: "Import complete", description: parts.join(", ") + "." });

    } catch (e: any) {
      console.error("Upload error:", e);
      setState("error");
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    }
  }, [user, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) processFiles(files);
  }, [processFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) processFiles(files);
    e.target.value = "";
  }, [processFiles]);

  const reset = () => {
    setState("idle");
    setProgress(0);
    setResult(null);
    setSavedCount(0);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import Data</h1>
        <p className="text-muted-foreground mt-1">Upload FIT files or a ZIP archive containing them</p>
      </div>

      {/* Drop zone */}
      <Card>
        <CardContent className="p-8">
          {state === "idle" ? (
            <label
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 cursor-pointer transition-colors ${
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <FileArchive className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium mb-1">Drop your files here</p>
              <p className="text-sm text-muted-foreground mb-4">.fit files, .zip archives, or a Garmin Connect data export</p>
              <Button variant="outline" asChild>
                <span>Select Files</span>
              </Button>
              <input
                type="file"
                accept=".zip,.fit"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </label>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                {state === "done" ? (
                  <CheckCircle2 className="w-6 h-6 text-primary" />
                ) : state === "error" ? (
                  <AlertCircle className="w-6 h-6 text-destructive" />
                ) : (
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                )}
                <div>
                  <p className="font-medium">
                    {state === "extracting" && "Extracting ZIP..."}
                    {state === "parsing" && "Parsing FIT files..."}
                    {state === "saving" && `Saving activities (${savedCount})...`}
                    {state === "done" && "Import complete!"}
                    {state === "error" && "Import failed"}
                  </p>
                  {result && (
                    <p className="text-sm text-muted-foreground">
                      {result.fileCount} FIT files → {result.activities.length} activities
                      {result.errors.length > 0 && ` (${result.errors.length} errors)`}
                    </p>
                  )}
                </div>
              </div>

              <Progress value={progress} className="h-2" />

              {result?.errors.length ? (
                <div className="rounded-lg bg-destructive/5 p-4 text-sm">
                  <p className="font-medium text-destructive mb-2">Parsing errors:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    {result.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {(state === "done" || state === "error") && (
                <Button onClick={reset} variant="outline">Upload another file</Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Strava Integration */}
      <StravaConnect />

      {/* Upload history */}
      <UploadHistory />
    </div>
  );
};

const UploadHistory = () => {
  const { user } = useAuth();
  const [uploads, setUploads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useState(() => {
    if (!user) return;
    supabase
      .from("uploads")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setUploads(data || []);
        setLoading(false);
      });
  });

  if (loading || uploads.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Upload History</CardTitle>
        <CardDescription>Previously imported files</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <FileArchive className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{u.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()} · {u.record_count} activities
                  </p>
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                u.status === "completed" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {u.status}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default UploadPage;
