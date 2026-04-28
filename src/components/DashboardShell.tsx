import { Link, useLocation } from "@tanstack/react-router";
import {
  Store,
  TrendingUp,
  Repeat,
  FileText,
  Calculator,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Zap,
  Globe,
  CalendarDays,
  Scale,
  LineChart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };

const navItems: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/overview-dashboard", label: "Overview Dashboard", icon: LayoutDashboard },
  { to: "/store", label: "Store Dashboard", icon: Store },
];

const pillarItems: NavItem[] = [
  { to: "/pillars/daily-pnl", label: "Daily P&L", icon: Zap },
  { to: "/pillars/margin-per-market", label: "Margin per market", icon: Globe },
  { to: "/pillars/monthly-overview", label: "Monthly overview", icon: CalendarDays },
  { to: "/pillars/balance-sheet", label: "Balance sheet", icon: Scale },
  { to: "/pillars/forecast", label: "Forecast", icon: LineChart },
];

function AppSidebar({ user }: { user: { name: string; email: string; avatar: string | null } | null }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const isActive = (to: string, exact?: boolean) =>
    exact ? location.pathname === to : location.pathname === to || location.pathname.startsWith(to + "/");

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
            Z
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <div className="text-sm font-semibold leading-none">Zapply</div>
              <div className="text-xs text-muted-foreground mt-1">Finance Dashboard</div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Dashboards</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to, item.exact);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link to={item.to as any}>
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>The 5 Pillars</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {pillarItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to, item.exact);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link to={item.to as any}>
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t">
        {user && (
          <div className="flex items-center gap-2 p-2">
            {user.avatar ? (
              <img src={user.avatar} alt={user.name} className="h-8 w-8 rounded-full shrink-0" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                {(user.name || user.email).slice(0, 1).toUpperCase()}
              </div>
            )}
            {!collapsed && (
              <div className="flex-1 overflow-hidden">
                <div className="text-xs font-medium truncate">{user.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={handleSignOut}
                className="text-muted-foreground hover:text-foreground p-1 rounded"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

export function DashboardShell({
  user,
  children,
  title,
  actions,
}: {
  user: { name: string; email: string; avatar: string | null } | null;
  children: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar user={user} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b bg-card px-4 sticky top-0 z-10">
            <SidebarTrigger />
            {title && <h1 className="font-semibold text-base">{title}</h1>}
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </header>
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}

export function RefreshButton({ onRefresh, isLoading }: { onRefresh: () => void; isLoading?: boolean }) {
  return (
    <button
      onClick={onRefresh}
      disabled={isLoading}
      className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
    >
      <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
      Refresh
    </button>
  );
}
