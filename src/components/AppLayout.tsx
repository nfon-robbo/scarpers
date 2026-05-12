import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import scarpersIcon from "@/assets/scarpers-icon.png";
import scarpersWordmark from "@/assets/scarpers-wordmark.png";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import AIChatbot from "@/components/AIChatbot";
import BackendHealthIndicator from "@/components/BackendHealthIndicator";
import { useTheme } from "@/hooks/useTheme";
import {
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import iconDashboard from "@/assets/nav-dashboard.png";
import iconPlan from "@/assets/nav-plan.png";
import iconActivities from "@/assets/nav-activities.png";
import iconInsights from "@/assets/nav-insights.png";
import iconImport from "@/assets/nav-import.png";
import iconSettings from "@/assets/nav-settings.png";
import iconTheme from "@/assets/nav-theme.png";
import iconSignout from "@/assets/nav-signout.png";

const navItems = [
  { to: "/dashboard", img: iconDashboard, label: "Dashboard" },
  { to: "/training-plan", img: iconPlan, label: "Plan" },
  { to: "/activities", img: iconActivities, label: "Activities" },
  { to: "/insights", img: iconInsights, label: "Insights" },
  { to: "/upload", img: iconImport, label: "Import" },
  { to: "/settings", img: iconSettings, label: "Settings" },
];

const COLLAPSE_KEY = "scarpers_sidebar_collapsed";

const AppLayout = () => {
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { theme, toggleTheme } = useTheme();
  const [isAdmin, setIsAdmin] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    (async () => {
      const { data } = await supabase
        .from("user_roles" as any)
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!data);
    })();
  }, [user]);

  const sidebarWidth = collapsed ? "w-[72px]" : "w-[260px]";
  const mainMargin = collapsed ? "md:ml-[72px]" : "md:ml-[260px]";

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden md:flex flex-col glass-strong fixed inset-y-0 left-0 z-40 transition-[width] duration-300 ease-in-out",
        sidebarWidth
      )}>
        {/* Brand */}
        <div className={cn(
          "flex items-center gap-2 border-b border-border/50 relative",
          collapsed ? "px-3 py-5 justify-center" : "px-5 py-5"
        )}>
          <img src={scarpersIcon} alt="" className="h-11 w-11 object-contain shrink-0" />
          {!collapsed && (
            <img src={scarpersWordmark} alt="Scarpers" className="h-7 w-auto object-contain" />
          )}
        </div>

        {/* Collapse toggle */}
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((c) => !c)}
          className="absolute top-7 -right-3 z-50 h-6 w-6 rounded-full border border-border/70 bg-background shadow-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        {/* Nav */}
        <nav className={cn("flex-1 py-4 space-y-0.5 overflow-y-auto", collapsed ? "px-2" : "px-3")}>
          {navItems.map(({ to, img, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/dashboard"}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  "flex items-center rounded-xl text-sm font-medium transition-all duration-200 group",
                  collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-primary/10 text-primary glow-sm"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center transition-all shrink-0",
                    isActive ? "scale-105" : "opacity-80 group-hover:opacity-100"
                  )}>
                    <img src={img} alt="" loading="lazy" width={36} height={36} className="w-9 h-9 object-contain" />
                  </div>
                  {!collapsed && (
                    <span className="font-['Barlow_Condensed'] font-semibold tracking-wide text-base uppercase">{label}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className={cn("border-t border-border/50 space-y-0.5", collapsed ? "p-2" : "p-3")}>
          {!collapsed && profile?.name && (
            <div className="px-3 py-2 mb-1">
              <p className="text-xs text-muted-foreground truncate">Signed in as</p>
              <p className="text-sm font-medium text-foreground truncate">{profile.name}</p>
            </div>
          )}
          <Button
            variant="ghost"
            title={collapsed ? (theme === "dark" ? "Light Mode" : "Dark Mode") : undefined}
            className={cn(
              "w-full rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 h-10",
              collapsed ? "justify-center px-0" : "justify-start gap-3"
            )}
            onClick={toggleTheme}
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0">
              <img src={iconTheme} alt="" loading="lazy" width={36} height={36} className="w-9 h-9 object-contain" />
            </div>
            {!collapsed && (theme === "dark" ? "Light Mode" : "Dark Mode")}
          </Button>
          <Button
            variant="ghost"
            title={collapsed ? "Sign out" : undefined}
            className={cn(
              "w-full rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-10",
              collapsed ? "justify-center px-0" : "justify-start gap-3"
            )}
            onClick={signOut}
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0">
              <img src={iconSignout} alt="" loading="lazy" width={36} height={36} className="w-9 h-9 object-contain" />
            </div>
            {!collapsed && "Sign out"}
          </Button>
        </div>
      </aside>

      {/* Mobile Bottom Tab Bar */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-border/50"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-6 h-16">
          {navItems.map(({ to, img, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/dashboard"}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 transition-colors ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              <img src={img} alt="" loading="lazy" width={24} height={24} className="w-6 h-6 object-contain" />
              <span className="font-['Barlow_Condensed'] text-[11px] font-semibold uppercase tracking-wide leading-none">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className={cn(
        "flex-1 overflow-y-auto pt-0 pb-20 md:pb-0 flex flex-col min-h-0 transition-[margin] duration-300 ease-in-out",
        mainMargin
      )} style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-6xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex-1 w-full">
          <Outlet />
        </div>
        <footer className="max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4 border-t border-border/50">
          <p className="text-xs text-muted-foreground text-center">
            <NavLink to="/privacy" className="hover:text-foreground transition-colors underline underline-offset-2">
              Privacy Policy
            </NavLink>
          </p>
        </footer>
      </main>

      <AIChatbot />
      <BackendHealthIndicator />
    </div>
  );
};

export default AppLayout;
