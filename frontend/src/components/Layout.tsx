import {
  HandCoins, LayoutDashboard, ListChecks, Moon,
  Settings as SettingsIcon, Sun, TrendingUp, Wallet,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { useTheme } from "../lib/theme";

const nav = [
  { to: "/", label: "首页", icon: LayoutDashboard, end: true },
  { to: "/transactions", label: "账单", icon: ListChecks },
  { to: "/wallets", label: "Wallet", icon: Wallet },
  { to: "/loans", label: "借贷", icon: HandCoins },
  { to: "/investments", label: "投资", icon: TrendingUp },
  { to: "/settings", label: "设置", icon: SettingsIcon },
];

export default function Layout() {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-ink-100 bg-white p-4 md:flex md:flex-col">
        <div className="mb-6 flex items-center justify-between px-2">
          <span className="text-xl font-semibold tracking-tight">Tally</span>
          <button
            onClick={toggle}
            className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100"
            title={theme === "dark" ? "切换到浅色" : "切换到深色"}
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto">
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
      </aside>
      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around overflow-x-auto border-t border-ink-100 bg-white py-1 md:hidden">
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
        {/* 宽屏不要无脑横向拉伸: 内容居中 + 限宽, 避免"地广人稀" */}
        <div key={location.pathname} className="anim-page mx-auto max-w-[1400px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
