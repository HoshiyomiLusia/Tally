import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import TransactionForm from "../components/TransactionForm";
import { api, type Currency, type DashboardData } from "../lib/api";
import { formatAmount, monthLabel } from "../lib/format";

const PIE_COLORS = ["#1e1f24", "#48494f", "#7f8089", "#abacb4", "#d3d3d8", "#ececef", "#33343a", "#5f6068"];

export default function Dashboard() {
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [addOpen, setAddOpen] = useState(false);

  const dash = useQuery({
    queryKey: ["dashboard", month],
    queryFn: async () => (await api.get<DashboardData>(`/dashboard?month=${month}`)).data,
  });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

  const groupedWallets = useMemo(() => {
    const m = new Map<string, { wallet_id: number; wallet_name: string; currency_code: string; balance: number; type: string; archived: boolean }[]>();
    for (const w of dash.data?.wallet_balances ?? []) {
      if (w.archived) continue;
      const arr = m.get(w.currency_code) ?? [];
      arr.push(w);
      m.set(w.currency_code, arr);
    }
    return Array.from(m.entries());
  }, [dash.data]);

  const breakdownByCurrency = useMemo(() => {
    const m = new Map<string, DashboardData["category_breakdown"]>();
    for (const item of dash.data?.category_breakdown ?? []) {
      const arr = m.get(item.currency_code) ?? [];
      arr.push(item);
      m.set(item.currency_code, arr);
    }
    return Array.from(m.entries());
  }, [dash.data]);

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{monthLabel(month)}</h1>
          <p className="text-sm text-ink-500">当月汇总 · Wallet 余额 · 最近交易</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="input w-40"
          />
          <button onClick={() => setAddOpen(true)} className="btn-primary"><Plus size={14} /> 添加</button>
        </div>
      </div>

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-ink-600">当月收支</h2>
        {dash.data?.month_totals.length ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {dash.data.month_totals.map((t) => (
              <div key={t.currency_code} className="card">
                <div className="text-xs text-ink-500">{t.currency_code}</div>
                <div className="mt-1 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-ink-400">收入</div>
                    <div className="text-emerald-600">{formatAmount(t.income, t.currency_code, currencies.data)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-400">支出</div>
                    <div className="text-rose-600">{formatAmount(t.expense, t.currency_code, currencies.data)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-400">净</div>
                    <div className={t.net >= 0 ? "text-emerald-600" : "text-rose-600"}>
                      {formatAmount(t.net, t.currency_code, currencies.data)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card text-sm text-ink-500">本月暂无数据</div>
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-ink-600">Wallet 余额</h2>
        {groupedWallets.length ? (
          <div className="space-y-2">
            {groupedWallets.map(([code, list]) => {
              const total = list.reduce((s, w) => s + w.balance, 0);
              return (
                <div key={code} className="card">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-medium text-ink-700">{code} 账户</div>
                    <div className="text-sm font-semibold">{formatAmount(total, code, currencies.data)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {list.map((w) => (
                      <div key={w.wallet_id} className="rounded-md bg-ink-50 p-2">
                        <div className="truncate text-xs text-ink-500">{w.wallet_name}</div>
                        <div className={`text-sm font-medium ${w.type === "credit_card" && w.balance < 0 ? "text-rose-600" : ""}`}>
                          {formatAmount(w.balance, code, currencies.data)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card text-sm text-ink-500">
            还没建任何 Wallet，去 <a href="/wallets" className="text-ink-800 underline">Wallet 页面</a> 添加。
          </div>
        )}
      </section>

      {breakdownByCurrency.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-medium text-ink-600">本月分类支出</h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {breakdownByCurrency.map(([code, items]) => (
              <div key={code} className="card">
                <div className="mb-2 text-sm text-ink-600">{code}</div>
                <div className="grid grid-cols-2 gap-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={items.slice(0, 8)} dataKey="amount" nameKey="category_name" innerRadius={40} outerRadius={80}>
                        {items.slice(0, 8).map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatAmount(v, code, currencies.data)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1 self-center text-sm">
                    {items.slice(0, 8).map((it, i) => (
                      <div key={it.category_id ?? -i} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          <span className="truncate">{it.emoji} {it.category_name}</span>
                        </div>
                        <span className="shrink-0 text-ink-700">{formatAmount(it.amount, code, currencies.data)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-600">最近交易</h2>
        <div className="card divide-y divide-ink-100 p-0">
          {(dash.data?.recent_transactions ?? []).length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-ink-500">还没有交易记录</div>
          )}
          {(dash.data?.recent_transactions ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">{t.note || "(无备注)"}</div>
                <div className="text-xs text-ink-500">{t.occurred_on}</div>
              </div>
              <div className={`shrink-0 font-medium ${t.kind === "income" ? "text-emerald-600" : "text-rose-600"}`}>
                {t.kind === "income" ? "+" : "-"}{formatAmount(t.amount, t.currency_code, currencies.data)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <TransactionForm open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
