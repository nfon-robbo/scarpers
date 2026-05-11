import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { UnitsProvider } from "./hooks/useUnits";
import { ThemeProvider } from "./hooks/useTheme";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import UploadPage from "./pages/Upload";
import Activities from "./pages/Activities";
import InsightsPage from "./pages/Insights";
import TrainingPlanPage from "./pages/TrainingPlan";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";
import Privacy from "./pages/Privacy";
import Blog from "./pages/Blog";
import FiveKTrainingPlan from "./pages/FiveKTrainingPlan";
import TenKTrainingPlan from "./pages/TenKTrainingPlan";
import AIRunningCoach from "./pages/AIRunningCoach";
import NotFound from "./pages/NotFound";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import SupabaseErrorBanner from "./components/SupabaseErrorBanner";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <UnitsProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <SupabaseErrorBanner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/activities" element={<Activities />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/training-plan" element={<TrainingPlanPage />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/privacy" element={<Privacy />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </UnitsProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
