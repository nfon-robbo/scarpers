import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Apple, Plus, Trash2, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { format, parseISO, addDays } from "date-fns";
import AddMealDialog from "@/components/AddMealDialog";
import { useToast } from "@/hooks/use-toast";

type MealType = "breakfast" | "lunch" | "dinner" | "snack";

interface NutritionLog {
  id: string;
  log_date: string;
  meal_type: MealType;
  food_name: string;
  brand: string | null;
  quantity_g: number;
  carbs_g: number;
  protein_g: number;
  fat_g: number;
  calories: number;
  alcohol_units: number;
  source: string;
}

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

type QuickAdd = { name: string; meal: MealType; grams: number; carbs: number; protein: number; fat: number; kcal: number; alcohol?: number };

const QUICK_ADDS: QuickAdd[] = [
  { name: "Banana", meal: "snack", grams: 120, carbs: 27, protein: 1.3, fat: 0.4, kcal: 107 },
  { name: "Slice of toast", meal: "breakfast", grams: 35, carbs: 17, protein: 3, fat: 1, kcal: 90 },
  { name: "SIS energy gel", meal: "snack", grams: 60, carbs: 22, protein: 0, fat: 0, kcal: 87 },
  { name: "Porridge (dry)", meal: "breakfast", grams: 50, carbs: 30, protein: 6, fat: 4, kcal: 184 },
  { name: "Whey scoop", meal: "snack", grams: 30, carbs: 2, protein: 24, fat: 1.5, kcal: 120 },
];

const DRINK_ADDS: QuickAdd[] = [
  { name: "Pint of lager (4%)", meal: "snack", grams: 568, carbs: 15, protein: 1.5, fat: 0, kcal: 180, alcohol: 2.3 },
  { name: "Pint of beer (5%)", meal: "snack", grams: 568, carbs: 18, protein: 1.5, fat: 0, kcal: 215, alcohol: 2.8 },
  { name: "Bottle of beer 330ml (5%)", meal: "snack", grams: 330, carbs: 11, protein: 1, fat: 0, kcal: 140, alcohol: 1.7 },
  { name: "Glass of wine 175ml (12%)", meal: "snack", grams: 175, carbs: 3, protein: 0, fat: 0, kcal: 160, alcohol: 2.1 },
  { name: "Single spirit 25ml (40%)", meal: "snack", grams: 25, carbs: 0, protein: 0, fat: 0, kcal: 55, alcohol: 1 },
  { name: "G&T (single)", meal: "snack", grams: 200, carbs: 16, protein: 0, fat: 0, kcal: 120, alcohol: 1 },
];

function todayStr() { return format(new Date(), "yyyy-MM-dd"); }

export default function NutritionPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [date, setDate] = useState(todayStr());
  const [logs, setLogs] = useState<NutritionLog[]>([]);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultMeal, setDefaultMeal] = useState<MealType | undefined>();

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("nutrition_logs")
      .select("id, log_date, meal_type, food_name, brand, quantity_g, carbs_g, protein_g, fat_g, calories, alcohol_units, source")
      .eq("user_id", user.id)
      .eq("log_date", date)
      .order("created_at", { ascending: true });
    setLogs((data as NutritionLog[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("weight_kg").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setWeightKg((data as any)?.weight_kg ?? null));
  }, [user]);

  useEffect(() => { load(); /* eslint-disable-line */ }, [user, date]);

  const totals = useMemo(() => {
    return logs.reduce(
      (acc, l) => ({
        carbs: acc.carbs + (l.carbs_g || 0),
        protein: acc.protein + (l.protein_g || 0),
        fat: acc.fat + (l.fat_g || 0),
        kcal: acc.kcal + (l.calories || 0),
        alcohol: acc.alcohol + (l.alcohol_units || 0),
      }),
      { carbs: 0, protein: 0, fat: 0, kcal: 0, alcohol: 0 },
    );
  }, [logs]);

  const carbsTarget = weightKg ? Math.round(weightKg * 5) : 250;
  const proteinTarget = weightKg ? Math.round(weightKg * 1.6) : 110;


  async function deleteLog(id: string) {
    const { error } = await supabase.from("nutrition_logs").delete().eq("id", id);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    load();
  }

  function openAdd(meal?: MealType) {
    setDefaultMeal(meal);
    setDialogOpen(true);
  }

  function shiftDate(days: number) {
    setDate(format(addDays(parseISO(date), days), "yyyy-MM-dd"));
  }

  const meals: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Apple className="w-6 h-6 sm:w-8 sm:h-8 text-primary shrink-0" />
            Nutrition
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Track fuelling and recovery — informs Claire's advice.</p>
        </div>
        <Button onClick={() => openAdd()}>
          <Plus className="w-4 h-4 mr-2" /> Add meal
        </Button>
      </div>

      {/* Day picker */}
      <Card>
        <CardContent className="p-3 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => shiftDate(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="text-sm font-medium">
            {format(parseISO(date), "EEEE dd/MM/yyyy")}
            {date !== todayStr() && (
              <button className="ml-2 text-xs text-primary underline" onClick={() => setDate(todayStr())}>
                today
              </button>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => shiftDate(1)} disabled={date >= todayStr()}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MacroCard label="Carbs" value={`${Math.round(totals.carbs)}g`} target={`${carbsTarget}g`} pct={totals.carbs / carbsTarget} color="bg-primary" />
        <MacroCard label="Protein" value={`${Math.round(totals.protein)}g`} target={`${proteinTarget}g`} pct={totals.protein / proteinTarget} color="bg-emerald-500" />
        <MacroCard label="Fat" value={`${Math.round(totals.fat)}g`} pct={null} color="bg-amber-500" />
        <MacroCard label="Calories" value={`${Math.round(totals.kcal)}`} pct={null} color="bg-rose-500" />
        <MacroCard
          label="Alcohol"
          value={`${totals.alcohol.toFixed(1)} units`}
          target="≤ 2/day"
          pct={totals.alcohol / 2}
          color={totals.alcohol > 4 ? "bg-destructive" : "bg-purple-500"}
        />
      </div>

      {/* Quick adds are now user-managed inside the Add meal dialog */}

      {/* Meals */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {meals.map((m) => {
            const items = logs.filter((l) => l.meal_type === m);
            const mealKcal = items.reduce((s, l) => s + (l.calories || 0), 0);
            return (
              <Card key={m}>
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">{MEAL_LABELS[m]} <span className="text-xs text-muted-foreground font-normal ml-2">{Math.round(mealKcal)} kcal</span></CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => openAdd(m)}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </CardHeader>
                <CardContent>
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing logged.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {items.map((l) => (
                        <li key={l.id} className="py-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{l.food_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {Math.round(l.quantity_g)}g · {Math.round(l.carbs_g)}g C · {Math.round(l.protein_g)}g P · {Math.round(l.calories)} kcal
                              {l.alcohol_units > 0 ? ` · ${l.alcohol_units} u alcohol` : ""}
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => deleteLog(l.id)} aria-label="Delete">
                            <Trash2 className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AddMealDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        logDate={date}
        defaultMeal={defaultMeal}
        onSaved={load}
      />
    </div>
  );
}

function MacroCard({ label, value, target, pct, color }: { label: string; value: string; target?: string; pct: number | null; color: string }) {
  const p = pct == null ? null : Math.max(0, Math.min(1, pct));
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold">{value}</div>
        {target && <div className="text-xs text-muted-foreground">of {target}</div>}
        {p != null && (
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full ${color}`} style={{ width: `${p * 100}%` }} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
