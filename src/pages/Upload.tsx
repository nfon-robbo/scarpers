import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { parseZipFile, type ParseResult } from "@/lib/fit-parser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload as UploadIcon, FileArchive, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

type UploadState = "idle" | "extracting" | "parsing" | "saving" | "done" | "error";

const UploadPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const processFile = useCallback(async (file: File) => {
    if (!user) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast({ title: "Invalid file", description: "Please upload a ZIP file containing FIT files.", variant: "destructive" });
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 100MB.", variant: "destructive" });
      return;
    }

    setState("extracting");
    setProgress(10);
    setResult(null);
    setSavedCount(0);

    try {
      // Parse ZIP + FIT files
      setState("parsing");
      setProgress(30);
      const parseResult = await parseZipFile(file);
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
          file_name: file.name,
          file_type: "zip",
          record_count: parseResult.activities.length,
          status: "completed",
        })
        .select("id")
        .single();

      if (uploadError) throw uploadError;

      // Insert activities in batches
      const batchSize = 50;
      let saved = 0;
      for (let i = 0; i < parseResult.activities.length; i += batchSize) {
        const batch = parseResult.activities.slice(i, i + batchSize).map((a) => ({
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
          raw_data: a.raw_data,
        }));

        const { error } = await supabase.from("activities").insert(batch as any);
        if (error) throw error;
        saved += batch.length;
        setSavedCount(saved);
        setProgress(60 + Math.round((saved / parseResult.activities.length) * 35));
      }

      setProgress(100);
      setState("done");
      toast({ title: "Import complete", description: `${saved} activities imported from ${parseResult.fileCount} FIT files.` });
    } catch (e: any) {
      console.error("Upload error:", e);
      setState("error");
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    }
  }, [user, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }, [processFile]);

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
        <p className="text-muted-foreground mt-1">Upload a ZIP file containing your Garmin FIT files</p>
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
              <p className="text-lg font-medium mb-1">Drop your ZIP file here</p>
              <p className="text-sm text-muted-foreground mb-4">or click to browse</p>
              <Button variant="outline" asChild>
                <span>Select ZIP File</span>
              </Button>
              <input
                type="file"
                accept=".zip"
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
