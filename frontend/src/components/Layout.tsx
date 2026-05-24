import { LayoutDashboard, ListChecks, LogOut, Settings as SettingsIcon, Store, Tags, Wallet } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../lib/auth";

const nav = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard, end: true },
  { to: "/transactions", label: "交易", icon: ListChecks },
  { to: "/wallets", label: "Wallet", icon: Wallet },
  { to: "/categories", label: "分类", icon: Tags },
  { to: "/merchants", label: "商家", icon: Store },
  { to: "/settings", label: "设置", icon: SettingsIcon },
];

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-ink-100 bg-white p-4 md:flex md:flex-col">
        <div className="mb-6 px-2 text-xl font-semibold tracking-tight">Tally</div>
        <nav className="flex-1 space-y-0.5">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-2 py-2 text-sm ${
                  isActive ? "bg-ink-100 text-ink-900" : "text-ink-600 hover:bg-ink-50"
                }`
              }
            >
              <n.icon size={16} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 border-t border-ink-100 pt-3 text-xs">
          <div className="truncate px-2 text-ink-500" title={user?.username}>{user?.username}</div>
          <button onClick={logout} className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-ink-500 hover:bg-ink-50">
            <LogOut size={14} /> 登出
          </button>
        </div>
      </aside>
      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-ink-100 bg-white py-1 md:hidden">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-2 py-1 text-xs ${
                isActive ? "text-ink-900" : "text-ink-500"
              }`
            }
          >
            <n.icon size={18} /> <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="flex-1 overflow-x-hidden pb-20 md:pb-0">
        <Outlet />
      </main>
    </div>
  );
}
