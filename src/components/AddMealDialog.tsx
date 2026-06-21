import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Search, ArrowLeft } from "lucide-react";
import { searchFoods, scaleFood, type OffFood } from "@/lib/nutrition-api";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

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
  const [carbs, setCarbs] = useState(0);
  const [protein, setProtein] = useState(0);
  const [fat, setFat] = useState(0);
  const [kcal, setKcal] = useState(0);
  const [alcohol, setAlcohol] = useState(0);
  const [foodName, setFoodName] = useState("");
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setMeal(defaultMeal ?? defaultMealForNow());
      setQuery("");
      setResults([]);
      setSelected(null);
      setManual(false);
      setGrams(100);
      setCarbs(0); setProtein(0); setFat(0); setKcal(0);
      setFoodName("");
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

  // Recompute macros when grams or food changes
  useEffect(() => {
    if (!selected) return;
    const scaled = scaleFood(selected, grams);
    setCarbs(scaled.carbs_g);
    setProtein(scaled.protein_g);
    setFat(scaled.fat_g);
    setKcal(scaled.calories);
  }, [selected, grams]);

  function pickFood(f: OffFood) {
    setSelected(f);
    setFoodName(f.brand ? `${f.name} (${f.brand})` : f.name);
    setGrams(f.servingG && f.servingG > 0 ? f.servingG : 100);
  }

  function goBack() {
    setSelected(null);
    setManual(false);
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
        source: selected ? "open_food_facts" : "manual",
        off_product_id: selected?.id ?? null,
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

          {!showForm && (
            <>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  className="pl-9"
                  placeholder="Search e.g. banana, porridge, Tesco granola"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
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
                    <div className="text-sm font-medium line-clamp-1">{f.name}</div>
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
              <div>
                <Label>Quantity (grams): {grams}g</Label>
                <Slider
                  value={[grams]}
                  min={5}
                  max={500}
                  step={5}
                  onValueChange={([v]) => setGrams(v)}
                />
                {selected?.servingG ? (
                  <button
                    className="text-xs text-primary mt-1 underline"
                    onClick={() => setGrams(selected.servingG!)}
                  >
                    Set to 1 serving ({selected.servingG}g)
                  </button>
                ) : null}
              </div>
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
