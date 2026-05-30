import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import MonthPicker from "../components/MonthPicker";
import TransactionForm from "../components/TransactionForm";
import { api, type Budget, type BudgetProgress, type Category, type Currency, type DashboardData, type Merchant, type Transaction } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatAmount, monthLabel } from "../lib/format";

interface CrossTotal {
  base_currency: string;
  total: number;
  breakdown: { currency_code: string; balance: number; rate: number; converted: number }[];
}


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
  const budgets = useQuery({ queryKey: ["budgets"], queryFn: async () => (await api.get<Budget[]>("/budgets")).data });

  const { user } = useAuth();
  // 优先级: 用户设置的主要币种 > localStorage 缓存 > JPY 默认
  const [baseCurrency, setBaseCurrency] = useState<string>(
    () => localStorage.getItem("tally.baseCurrency") || "JPY",
  );
  useEffect(() => {
    if (user?.primary_currency_code) setBaseCurrency(user.primary_currency_code);
  }, [user?.primary_currency_code]);
  useEffect(() => { localStorage.setItem("tally.baseCurrency", baseCurrency); }, [baseCurrency]);
  const cross = useQuery({
    queryKey: ["cross-currency-total", baseCurrency],
    queryFn: async () => (await api.get<CrossTotal>(`/stats/cross-currency-total?base=${baseCurrency}`)).data,
  });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: async () => (await api.get<{ base: string; quote: string; rate: number }[]>("/exchange-rates")).data });

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

  // 跨币种折算 helper (跟 Stats 页同套逻辑)
  const digitsMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of currencies.data ?? []) m.set(c.code, c.decimal_digits);
    return m;
  }, [currencies.data]);
  const rateMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rates.data ?? []) {
      const k = `${r.base}->${r.quote}`;
      if (!m.has(k)) m.set(k, r.rate);
    }
    return m;
  }, [rates.data]);
  const fxTo = (amount: number, from: string, to: string): number => {
    if (from === to) return amount;
    const fd = digitsMap.get(from) ?? 2;
    const td = digitsMap.get(to) ?? 2;
    let rate = rateMap.get(`${from}->${to}`);
    if (rate == null) {
      const rev = rateMap.get(`${to}->${from}`);
      if (rev == null || rev === 0) return 0;
      rate = 1 / rev;
    }
    return Math.round(amount * rate * Math.pow(10, td - fd));
  };

  const breakdownCurrencies = useMemo(() => breakdownByCurrency.map(([code]) => code), [breakdownByCurrency]);

  // 按 category 聚合, 每个 cat 一根柱子, 按币种分段叠加 (全部折算到 baseCurrency)
  // 数据形状: [{ name: "餐饮", total: 65000, JPY: 58000, CNY: 7000 }, ...]
  const breakdownStacked = useMemo(() => {
    const m = new Map<number | string, { name: string; total: number } & Record<string, number | string>>();
    for (const it of dash.data?.category_breakdown ?? []) {
      const key = it.category_id ?? `null-${it.category_name}`;
      const conv = fxTo(it.amount, it.currency_code, baseCurrency);
      const row = m.get(key);
      if (row) {
        row[it.currency_code] = ((row[it.currency_code] as number | undefined) ?? 0) + conv;
        row.total += conv;
      } else {
        m.set(key, {
          name: `${it.emoji ?? ""} ${it.category_name}`.trim(),
          total: conv,
          [it.currency_code]: conv,
        });
      }
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [dash.data, baseCurrency, fxTo]);

  // 币种 -> 颜色 (按出现顺序固定分配, 保证刷新后还是同一种色)
  const CURRENCY_COLORS = ["#e11d48", "#f59e0b", "#3b82f6", "#10b981", "#a855f7", "#0ea5e9", "#ec4899"];
  const currencyColor = (code: string): string => {
    const idx = breakdownCurrencies.indexOf(code);
    return CURRENCY_COLORS[idx >= 0 ? idx % CURRENCY_COLORS.length : 0];
  };

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
              // 物理余额口径: 跟卡片大数字一致, 借出未还的不计入
              const total = list.reduce((s, w) => s + w.balance - w.loan_out_on_wallet + w.loan_repayment_on_wallet, 0);
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
              const mname = merchantName(t.merchant_id);
              const cname = catName(t.category_id);
              const primary = mname || t.note || cname;
              const showCat = primary !== cname;
              return (
                <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span>{catEmoji(t.category_id)}</span>
                      <span className="truncate font-medium">{primary}</span>
                      {showCat && <span className="truncate text-xs text-ink-500">· {cname}</span>}
                    </div>
                    <div className="text-xs text-ink-500">上次 {t.occurred_on} · 下次约 {nextDue}{mname && t.note ? ` · ${t.note}` : ""}</div>
                  </div>
                  <div className="shrink-0 text-rose-600">~{formatAmount(t.amount, t.currency_code, currencies.data)}</div>
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
              const note = budgets.data?.find((b) => b.id === p.budget_id)?.note ?? "";
              return (
                <div key={p.budget_id}>
                  <div className="flex justify-between text-sm">
                    <span>
                      {p.category_name} <span className="text-xs text-ink-400">{p.currency_code}</span>
                      {note && <span className="ml-1 text-xs text-ink-500">· {note}</span>}
                    </span>
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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink-600">本月分类支出</h2>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-ink-500">折算到</span>
              <select
                value={baseCurrency}
                onChange={(e) => setBaseCurrency(e.target.value)}
                className="rounded-full border border-ink-200 bg-white px-2 py-0.5 text-xs text-ink-600 dark:border-ink-700 dark:bg-ink-800"
              >
                {breakdownCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="ml-2 flex flex-wrap items-center gap-2">
                {breakdownCurrencies.map((c) => (
                  <span key={c} className="flex items-center gap-1 text-ink-500">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: currencyColor(c) }} />
                    {c}
                  </span>
                ))}
              </span>
            </div>
          </div>
          <div className="card">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={breakdownStacked} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ececef" vertical={false} />
                <XAxis dataKey="name" fontSize={11} angle={-20} textAnchor="end" interval={0} height={50} />
                <YAxis fontSize={10} />
                <Tooltip
                  formatter={(v: number, code: string) => [formatAmount(v, baseCurrency, currencies.data), code]}
                />
                {breakdownCurrencies.map((code, i) => {
                  const isLast = i === breakdownCurrencies.length - 1;
                  return (
                    <Bar
                      key={code}
                      dataKey={code}
                      stackId="a"
                      fill={currencyColor(code)}
                      radius={isLast ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    />
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
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
