import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import {
  Activity,
  LayoutDashboard,
  Upload,
  Brain,
  Calendar,
  History,
  Settings,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/upload", icon: Upload, label: "Import Data" },
  { to: "/analysis", icon: Brain, label: "AI Analysis" },
  { to: "/training-plan", icon: Calendar, label: "Training Plan" },
  { to: "/history", icon: History, label: "History" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

const AppLayout = () => {
  const { signOut } = useAuth();
  const { profile } = useProfile();

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-sidebar p-4">
        <div className="flex items-center gap-2.5 px-2 mb-8">
          <Activity className="w-7 h-7 text-primary" />
          <span className="text-lg font-bold text-sidebar-foreground">Garmin AI Coach</span>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border pt-4 mt-4">
          {profile?.name && (
            <p className="px-3 mb-2 text-sm text-sidebar-foreground/70 truncate">{profile.name}</p>
          )}
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-sidebar-foreground/70 hover:text-sidebar-foreground"
            onClick={signOut}
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container max-w-6xl py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AppLayout;
