import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import MonthPicker from "../components/MonthPicker";
import TransactionForm from "../components/TransactionForm";
import { api, type BudgetProgress, type Category, type Currency, type DashboardData, type Merchant, type Transaction } from "../lib/api";
import { formatAmount, monthLabel } from "../lib/format";

interface CrossTotal {
  base_currency: string;
  total: number;
  breakdown: { currency_code: string; balance: number; rate: number; converted: number }[];
}

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
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data });
  const upcoming = useQuery({ queryKey: ["recurring-upcoming"], queryFn: async () => (await api.get<Transaction[]>("/recurring/upcoming?days=14")).data });
  const budgetProgress = useQuery({ queryKey: ["budgets-progress", month], queryFn: async () => (await api.get<BudgetProgress[]>(`/budgets/progress?on_date=${month}-15`)).data });

  const [baseCurrency, setBaseCurrency] = useState<string>(() => localStorage.getItem("tally.baseCurrency") || "JPY");
  useEffect(() => { localStorage.setItem("tally.baseCurrency", baseCurrency); }, [baseCurrency]);
  const cross = useQuery({
    queryKey: ["cross-currency-total", baseCurrency],
    queryFn: async () => (await api.get<CrossTotal>(`/stats/cross-currency-total?base=${baseCurrency}`)).data,
  });

  const catName = (id: number | null) => id == null ? "未分类" : categories.data?.find((c) => c.id === id)?.name ?? "?";
  const catEmoji = (id: number | null) => id == null ? "" : categories.data?.find((c) => c.id === id)?.emoji ?? "";
  const merchantName = (id: number | null) => id == null ? "" : merchants.data?.find((m) => m.id === id)?.name ?? "";

  const groupedWallets = useMemo(() => {
    const m = new Map<string, { wallet_id: number; wallet_name: string; currency_code: string; balance: number; type: string; archived: boolean; loan_out_on_wallet: number; loan_repayment_on_wallet: number }[]>();
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
          <p className="text-sm text-ink-500">当月汇总 · Wallet 余额 · 周期提醒 · 预算进度</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthPicker value={month} onChange={setMonth} />
          <button onClick={() => setAddOpen(true)} className="btn-primary"><Plus size={14} /> 添加</button>
        </div>
      </div>

      <section className="mb-5">
        <div className="overview-card rounded-2xl p-5 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider opacity-60">总资产（折算到）</span>
            <select
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value)}
              className="overview-select rounded px-2 py-0.5 text-xs outline-none"
            >
              {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </div>
          <div className="text-3xl font-semibold tracking-tight">
            {formatAmount(cross.data?.total ?? 0, baseCurrency, currencies.data)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(cross.data?.breakdown ?? []).filter((b) => b.balance !== 0).map((b) => (
              <div key={b.currency_code} className="overview-chip rounded-lg p-2">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider opacity-60">
                  <span>{b.currency_code}</span>
                  {b.currency_code !== baseCurrency && <span>× {b.rate.toFixed(4)}</span>}
                </div>
                <div className={`mt-0.5 text-sm font-semibold ${b.balance < 0 ? "text-rose-600 dark:text-rose-300" : ""}`}>
                  {formatAmount(b.balance, b.currency_code, currencies.data)}
                </div>
                {b.currency_code !== baseCurrency && (
                  <div className="text-[10px] opacity-60">≈ {formatAmount(b.converted, baseCurrency, currencies.data)}</div>
                )}
              </div>
            ))}
            {(cross.data?.breakdown ?? []).filter((b) => b.balance !== 0).length === 0 && (
              <div className="col-span-full text-xs opacity-60">还没有任何余额</div>
            )}
          </div>
        </div>
      </section>

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
                    {list.map((w) => {
                      const physical = w.balance - w.loan_out_on_wallet + w.loan_repayment_on_wallet;
                      const hasLoanDiff = w.loan_out_on_wallet !== 0 || w.loan_repayment_on_wallet !== 0;
                      return (
                        <div key={w.wallet_id} className="rounded-md bg-ink-50 p-2">
                          <div className="truncate text-xs text-ink-500">{w.wallet_name}</div>
                          <div className={`text-sm font-medium ${physical < 0 ? "text-rose-600" : ""}`}>
                            {formatAmount(physical, code, currencies.data)}
                          </div>
                          {hasLoanDiff && (
                            <div className="text-[10px] text-ink-400">实际 {formatAmount(w.balance, code, currencies.data)}</div>
                          )}
                        </div>
                      );
                    })}
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

      {(upcoming.data ?? []).length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 flex items-center gap-1 text-sm font-medium text-ink-600"><CalendarClock size={14} /> 即将到期的周期账单</h2>
          <div className="card divide-y divide-ink-100 p-0">
            {(upcoming.data ?? []).map((t) => {
              const nextDue = addDaysIso(t.occurred_on, t.recurrence_period_days || 0);
              return (
                <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span>{catEmoji(t.category_id)}</span>
                      <span className="font-medium">{catName(t.category_id)}</span>
                      {t.note && <span className="text-xs text-ink-500">· {t.note}</span>}
                    </div>
                    <div className="text-xs text-ink-500">上次 {t.occurred_on} · 下次约 {nextDue}</div>
                  </div>
                  <div className="text-rose-600">~{formatAmount(t.amount, t.currency_code, currencies.data)}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(budgetProgress.data ?? []).length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-medium text-ink-600">预算进度</h2>
          <div className="card space-y-2">
            {(budgetProgress.data ?? []).map((p) => {
              const over = p.percent > 1;
              const warn = p.percent > 0.8 && !over;
              const barColor = over ? "bg-rose-500" : warn ? "bg-amber-500" : "bg-emerald-500";
              return (
                <div key={p.budget_id}>
                  <div className="flex justify-between text-sm">
                    <span>{p.category_name} <span className="text-xs text-ink-400">{p.currency_code}</span></span>
                    <span className={over ? "text-rose-600" : ""}>
                      {formatAmount(p.spent, p.currency_code, currencies.data)} / {formatAmount(p.budget_amount, p.currency_code, currencies.data)}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                    <div className={`h-full ${barColor}`} style={{ width: `${Math.min(p.percent * 100, 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
          {(dash.data?.recent_transactions ?? []).map((t) => {
            const mname = merchantName(t.merchant_id);
            const sub = [mname, t.note].filter(Boolean).join(" · ");
            const isTransfer = t.kind === "transfer_in" || t.kind === "transfer_out";
            const titleEmoji = isTransfer ? "🔁" : catEmoji(t.category_id);
            const titleName = isTransfer ? (t.kind === "transfer_in" ? "转移 · 转入" : "转移 · 转出") : catName(t.category_id);
            const isPositive = t.kind === "income" || t.kind === "loan_repayment" || t.kind === "transfer_in";
            const amtColor =
              t.kind === "income" || t.kind === "loan_repayment" ? "text-emerald-600"
              : t.kind === "loan_out" ? "text-amber-600"
              : isTransfer ? "text-sky-600"
              : "text-rose-600";
            return (
              <div key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {t.split_group_id && <span className="rounded bg-ink-100 px-1 text-[10px] text-ink-600">分摊</span>}
                    {t.is_recurring && <span className="rounded bg-ink-100 px-1 text-[10px] text-ink-600">周期</span>}
                    <span className="truncate">{titleEmoji} {titleName}</span>
                    {sub && <span className="truncate text-xs text-ink-500">· {sub}</span>}
                  </div>
                  <div className="text-xs text-ink-500">{t.occurred_on}</div>
                </div>
                <div className={`shrink-0 font-medium ${amtColor}`}>
                  {isPositive ? "+" : "-"}{formatAmount(t.amount, t.currency_code, currencies.data)}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <TransactionForm open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
