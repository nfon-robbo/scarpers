import { NavLink, Outlet } from "react-router-dom";
import scarpersLogo from "@/assets/scarpers-logo.png";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import AIChatbot from "@/components/AIChatbot";
import BackendHealthIndicator from "@/components/BackendHealthIndicator";
import { useTheme } from "@/hooks/useTheme";
import {
  Activity,
  LayoutDashboard,
  Upload,
  Brain,
  Calendar,
  ListChecks,
  Settings,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/training-plan", icon: Calendar, label: "Plan" },
  { to: "/activities", icon: ListChecks, label: "Activities" },
  { to: "/insights", icon: Brain, label: "Insights" },
  { to: "/upload", icon: Upload, label: "Import" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

const AppLayout = () => {
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const { theme, toggleTheme } = useTheme();
  

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-[260px] flex-col glass-strong fixed inset-y-0 left-0 z-40">
        {/* Brand */}
        <div className="flex items-center px-5 py-6 border-b border-border/50">
          <img src={scarpersLogo} alt="Scarpers" className="h-8 w-auto" />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 group ${
                  isActive
                    ? "bg-primary/10 text-primary glow-sm"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    isActive
                      ? "bg-primary/15"
                      : "bg-transparent group-hover:bg-muted"
                  }`}>
                    <Icon className="w-[18px] h-[18px]" />
                  </div>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border/50 p-3 space-y-0.5">
          {profile?.name && (
            <div className="px-3 py-2 mb-1">
              <p className="text-xs text-muted-foreground truncate">Signed in as</p>
              <p className="text-sm font-medium text-foreground truncate">{profile.name}</p>
            </div>
          )}
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 h-10"
            onClick={toggleTheme}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center">
              {theme === "dark" ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
            </div>
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-10"
            onClick={signOut}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center">
              <LogOut className="w-[18px] h-[18px]" />
            </div>
            Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 glass-strong">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center">
            <img src={scarpersLogo} alt="Scarpers" className="h-6 w-auto" />
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="rounded-xl text-muted-foreground"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              className="rounded-xl text-muted-foreground hover:text-destructive"
              aria-label="Sign out"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-border/50"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-6 h-16">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 transition-colors ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-none">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto md:ml-[260px] md:pt-0 pt-14 pb-20 md:pb-0 flex flex-col min-h-0">
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
