import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Search, ArrowLeft, ScanLine } from "lucide-react";
import { searchFoods, scaleFood, lookupByBarcode, type OffFood } from "@/lib/nutrition-api";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import BarcodeScanner from "@/components/BarcodeScanner";

type MealType = "breakfast" | "lunch" | "dinner" | "snack";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logDate: string; // yyyy-mm-dd
  defaultMeal?: MealType;
  onSaved?: () => void;
}

function defaultMealForNow(): MealType {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

export default function AddMealDialog({ open, onOpenChange, logDate, defaultMeal, onSaved }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [meal, setMeal] = useState<MealType>(defaultMeal ?? defaultMealForNow());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OffFood[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<OffFood | null>(null);
  const [manual, setManual] = useState(false);
  const [grams, setGrams] = useState(100);
  const [qty, setQty] = useState<number>(1);
  const [unit, setUnit] = useState<"g" | "serving" | "pack">("g");
  const [carbs, setCarbs] = useState(0);
  const [protein, setProtein] = useState(0);
  const [fat, setFat] = useState(0);
  const [kcal, setKcal] = useState(0);
  const [alcohol, setAlcohol] = useState(0);
  const [foodName, setFoodName] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanLookup, setScanLookup] = useState(false);
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setMeal(defaultMeal ?? defaultMealForNow());
      setQuery("");
      setResults([]);
      setSelected(null);
      setManual(false);
      setGrams(100);
      setQty(1);
      setUnit("g");
      setCarbs(0); setProtein(0); setFat(0); setKcal(0); setAlcohol(0);
      setFoodName("");
      setScanning(false);
      setScanLookup(false);
      setScanMiss(null);
    }
  }, [open, defaultMeal]);

  // Debounced search
  useEffect(() => {
    if (manual || selected) return;
    if (query.trim().length < 2) { setResults([]); return; }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchFoods(query, ctl.signal);
        if (!ctl.signal.aborted) setResults(r);
      } catch (e) {
        if (!ctl.signal.aborted) setResults([]);
      } finally {
        if (!ctl.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query, manual, selected]);

  // Derive grams from qty + unit, then macros
  useEffect(() => {
    if (!selected) return;
    const sG = selected.servingG && selected.servingG > 0 ? selected.servingG : null;
    const pG = selected.productG && selected.productG > 0 ? selected.productG : null;
    const unitG = unit === "g" ? 1 : unit === "serving" ? (sG ?? 1) : (pG ?? sG ?? 1);
    const g = Math.max(1, Math.round((qty || 0) * unitG));
    setGrams(g);
    const scaled = scaleFood(selected, g);
    setCarbs(scaled.carbs_g);
    setProtein(scaled.protein_g);
    setFat(scaled.fat_g);
    setKcal(scaled.calories);
  }, [selected, qty, unit]);

  function pickFood(f: OffFood) {
    setSelected(f);
    setFoodName(f.brand ? `${f.name} (${f.brand})` : f.name);
    const sG = f.servingG && f.servingG > 0 ? f.servingG : null;
    const pG = f.productG && f.productG > 0 ? f.productG : null;
    if (sG) {
      setUnit("serving");
      setQty(1);
    } else if (pG) {
      setUnit("pack");
      setQty(1);
    } else {
      setUnit("g");
      setQty(30);
    }
  }

  function goBack() {
    setSelected(null);
    setManual(false);
    setScanMiss(null);
  }

  async function handleScanResult(code: string) {
    setScanning(false);
    setScanLookup(true);
    try {
      const f = await lookupByBarcode(code);
      if (f) {
        pickFood(f);
        setScanMiss(null);
      } else {
        setScanMiss(code);
      }
    } catch {
      setScanMiss(code);
    } finally {
      setScanLookup(false);
    }
  }

  function handleScanError(reason: "camera_unavailable" | "scanner_unavailable") {
    setScanning(false);
    toast({
      title: reason === "camera_unavailable" ? "Camera unavailable" : "Scanner unavailable",
      description: "Use search instead.",
      variant: "destructive",
    });
  }

  function buildPortionLabel(): string {
    if (!selected) return `${grams}g`;
    if (unit === "g") return `${grams}g`;
    if (unit === "serving") return `${qty} ${qty === 1 ? "bag/serving" : "bags/servings"} (~${grams}g)`;
    return `${qty} ${qty === 1 ? "pack" : "packs"} (~${grams}g)`;
  }

  async function save() {
    if (!user) return;
    if (!foodName.trim()) {
      toast({ title: "Food name required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("nutrition_logs").insert({
        user_id: user.id,
        log_date: logDate,
        meal_type: meal,
        food_name: foodName.trim(),
        brand: selected?.brand ?? null,
        barcode: selected?.id ?? null,
        quantity_g: grams,
        carbs_g: carbs,
        protein_g: protein,
        fat_g: fat,
        calories: kcal,
        alcohol_units: alcohol,
        source: selected ? "open_food_facts" : "manual",
        off_product_id: selected?.id ?? null,
        portion_label: buildPortionLabel(),
      });
      if (error) throw error;
      toast({ title: "Logged", description: `${foodName} added to ${meal}` });
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const showForm = selected || manual;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {showForm && (
              <button onClick={goBack} className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            Add meal
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={meal} onValueChange={(v) => setMeal(v as MealType)}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="breakfast">Breakfast</TabsTrigger>
              <TabsTrigger value="lunch">Lunch</TabsTrigger>
              <TabsTrigger value="dinner">Dinner</TabsTrigger>
              <TabsTrigger value="snack">Snack</TabsTrigger>
            </TabsList>
          </Tabs>

          {!showForm && scanning && (
            <BarcodeScanner
              onDetected={handleScanResult}
              onCancel={() => setScanning(false)}
              onError={handleScanError}
            />
          )}

          {!showForm && scanLookup && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Looking up barcode…
            </div>
          )}

          {!showForm && scanMiss && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-sm">Product not found for barcode <span className="font-mono">{scanMiss}</span>.</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setQuery(""); setScanMiss(null); }}
                >
                  Search by name instead
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setScanMiss(null); setManual(true); setFoodName(""); }}
                >
                  Enter manually
                </Button>
              </div>
            </div>
          )}

          {!showForm && !scanning && (
            <>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    className="pl-9"
                    placeholder="Search e.g. banana, porridge, Tesco granola"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Scan barcode"
                  onClick={() => { setScanMiss(null); setScanning(true); }}
                >
                  <ScanLine className="w-4 h-4" />
                </Button>
              </div>
              {searching && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Searching Open Food Facts…
                </div>
              )}
              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <p className="text-sm text-muted-foreground">No results. Try a different term or use manual entry.</p>
              )}
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {results.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => pickFood(f)}
                    className="w-full text-left p-2 rounded hover:bg-muted/60 border border-border"
                  >
                    <div className="text-sm font-medium line-clamp-1">
                      {f.name}
                      {f.entriesMerged && f.entriesMerged > 1 ? (
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">({f.entriesMerged} entries)</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {f.brand ? `${f.brand} · ` : ""}
                      {Math.round(f.per100g.kcal)} kcal · {f.per100g.carbs}g C · {f.per100g.protein}g P / 100g
                    </div>
                  </button>
                ))}
              </div>
              <Button variant="outline" className="w-full" onClick={() => { setManual(true); setFoodName(query); }}>
                Can't find it? Enter manually
              </Button>
            </>
          )}

          {showForm && (
            <div className="space-y-3">
              <div>
                <Label>Food</Label>
                <Input value={foodName} onChange={(e) => setFoodName(e.target.value)} />
              </div>
              {selected && (() => {
                const sG = selected.servingG && selected.servingG > 0 ? selected.servingG : null;
                const pG = selected.productG && selected.productG > 0 ? selected.productG : null;
                const showServing = !!sG;
                const showPack = !!pG && (!sG || pG > sG * 1.5);
                return (
                  <div className="space-y-2 rounded-md border border-border p-3 bg-muted/30">
                    <Label className="text-xs">Portion</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={unit === "g" ? 1 : 0.5}
                        step={unit === "g" ? 1 : 0.5}
                        value={qty}
                        onChange={(e) => setQty(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-24"
                      />
                      <select
                        value={unit}
                        onChange={(e) => {
                          const u = e.target.value as "g" | "serving" | "pack";
                          setUnit(u);
                          setQty(u === "g" ? (sG || 30) : 1);
                        }}
                        className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="g">grams</option>
                        {showServing && (
                          <option value="serving">
                            bag / serving{selected.servingSize ? ` (${selected.servingSize})` : ` (${sG}g)`}
                          </option>
                        )}
                        {showPack && <option value="pack">whole pack ({pG}g)</option>}
                      </select>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      = {grams}g · {kcal} kcal · {carbs}g C · {protein}g P · {fat}g F
                    </div>
                  </div>
                );
              })()}
              {!selected && (
                <div className="space-y-2">
                  <Label>Quantity (g)</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={grams}
                    onChange={(e) => setGrams(Math.max(1, parseInt(e.target.value) || 0))}
                    className="w-24"
                  />
                </div>
              )}
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <Label className="text-xs">Carbs (g)</Label>
                  <Input type="number" value={carbs} onChange={(e) => setCarbs(parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <Label className="text-xs">Protein (g)</Label>
                  <Input type="number" value={protein} onChange={(e) => setProtein(parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <Label className="text-xs">Fat (g)</Label>
                  <Input type="number" value={fat} onChange={(e) => setFat(parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <Label className="text-xs">kcal</Label>
                  <Input type="number" value={kcal} onChange={(e) => setKcal(parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <Label className="text-xs">Alcohol (UK units)</Label>
                <Input type="number" step="0.1" value={alcohol} onChange={(e) => setAlcohol(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {showForm && (
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
