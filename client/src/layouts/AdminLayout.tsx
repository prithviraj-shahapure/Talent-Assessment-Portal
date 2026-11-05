import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, ClipboardCheck, FileSpreadsheet, FileText, GanttChartSquare, LayoutDashboard, LibraryBig, LogOut, Menu, MonitorPlay, ScrollText, Settings, ShieldCheck, Trophy, Users, UsersRound, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Brand } from "@/components/Brand";
import { cn } from "@/lib/cn";

const NAV = [
  { group: "Overview", items: [{ to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true }] },
  {
    group: "Assessment",
    items: [
      { to: "/admin/exams", label: "Examinations", icon: FileText },
      { to: "/admin/sessions", label: "Session Codes", icon: ShieldCheck },
      { to: "/admin/questions", label: "Question Bank", icon: LibraryBig },
      { to: "/admin/live", label: "Live Proctoring", icon: MonitorPlay },
      { to: "/admin/evaluation", label: "Evaluation & Review", icon: ClipboardCheck },
    ],
  },
  {
    group: "Recruitment",
    items: [
      { to: "/admin/candidates", label: "Candidates", icon: UsersRound },
      { to: "/admin/results", label: "Results & Rankings", icon: Trophy },
      { to: "/admin/pipeline", label: "Recruitment Pipeline", icon: GanttChartSquare },
      { to: "/admin/reports", label: "Reports", icon: FileSpreadsheet },
    ],
  },
  {
    group: "Administration",
    items: [
      { to: "/admin/users", label: "Users & Roles", icon: Users, superOnly: true },
      { to: "/admin/settings", label: "System Settings", icon: Settings },
      { to: "/admin/audit", label: "Audit Logs", icon: ScrollText, superOnly: true },
    ],
  },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  const isSuper = user?.role === "SUPER_ADMIN";

  const sidebar = (
    <aside className="flex h-full w-[248px] flex-col bg-navy-900 text-white">
      <div className="flex h-16 items-center px-5 border-b border-white/10">
        <Brand inverse />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !("superOnly" in i && i.superOnly) || isSuper);
          if (!items.length) return null;
          return (
            <div key={g.group} className="mb-5">
              <div className="px-2 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/40">{g.group}</div>
              {items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={"end" in i ? i.end : false}
                  className={({ isActive }) =>
                    cn(
                      "group relative flex items-center gap-2.5 rounded px-2.5 py-[7px] text-[13px] font-medium transition-colors",
                      isActive ? "bg-white/[0.09] text-white" : "text-white/70 hover:bg-white/[0.05] hover:text-white",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-signal-500" />}
                      <i.icon className="h-[17px] w-[17px] opacity-80" />
                      {i.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-white/10 text-[12px] font-semibold">
            {user?.name
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{user?.name}</div>
            <div className="flex items-center gap-1 text-[11px] text-white/50">
              <ShieldCheck className="h-3 w-3" />
              {user?.role === "SUPER_ADMIN" ? "Super Admin" : "HR Admin"}
            </div>
          </div>
          <button
            onClick={async () => {
              await logout();
              nav("/login");
            }}
            className="rounded p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:block fixed inset-y-0 left-0 z-30">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="relative">{sidebar}</div>
          <button className="flex-1 bg-navy-950/50" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="absolute right-4 top-4 h-5 w-5 text-white" />
          </button>
        </div>
      )}
      <div className="flex-1 lg:pl-[248px] min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded p-1.5 hover:bg-canvas" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <Brand />
        </header>
        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export const AnalyticsIcon = BarChart3;
