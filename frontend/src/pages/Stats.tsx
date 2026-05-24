import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { api, type Currency } from "../lib/api";
import { formatAmount } from "../lib/format";

interface CurrencySummary {
  currency_code: string;
  income: number;
  expense: number;
  net: number;
  income_prev: number;
  expense_prev: number;
  days_in_month: number;
  avg_daily_expense: number;
}
interface SummaryResp { month: string; per_currency: CurrencySummary[]; }

interface MonthlyPoint { month: string; currency_code: string; income: number; expense: number; }
interface DailyPoint { on_date: string; currency_code: string; amount: number; }
interface CatCompare {
  category_id: number | null; category_name: string; emoji: string;
  currency_code: string; current: number; previous: number; delta: number;
}
interface TopMerchant { merchant_id: number | null; merchant_name: string; currency_code: string; total: number; count: number; }
interface TopTx { id: number; occurred_on: string; amount: number; currency_code: string; category_name: string; note: string; }

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Stats() {
  const [month, setMonth] = useState(thisMonth());

  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const summary = useQuery({ queryKey: ["stats-summary", month], queryFn: async () => (await api.get<SummaryResp>(`/stats/summary?month=${month}`)).data });
  const monthly = useQuery({ queryKey: ["stats-monthly"], queryFn: async () => (await api.get<MonthlyPoint[]>("/stats/monthly-trend?months=12")).data });
  const compare = useQuery({ queryKey: ["stats-compare", month], queryFn: async () => (await api.get<CatCompare[]>(`/stats/category-compare?month=${month}`)).data });
  const daily = useQuery({ queryKey: ["stats-daily"], queryFn: async () => (await api.get<DailyPoint[]>("/stats/daily?kind=expense")).data });
  const topMerch = useQuery({ queryKey: ["stats-top-merchants", month], queryFn: async () => (await api.get<TopMerchant[]>(`/stats/top-merchants?month=${month}`)).data });
  const topTx = useQuery({ queryKey: ["stats-top-tx", month], queryFn: async () => {
    const d = new Date(`${month}-01`);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(new Date(next.getTime() - 86400000).getDate()).padStart(2, "0")}`;
    return (await api.get<TopTx[]>(`/stats/top?limit=10&start=${start}&end=${end}`)).data;
  } });

  const allCurrencies = useMemo(() => {
    const set = new Set<string>();
    (summary.data?.per_currency ?? []).forEach((s) => set.add(s.currency_code));
    (monthly.data ?? []).forEach((p) => set.add(p.currency_code));
    return Array.from(set).sort();
  }, [summary.data, monthly.data]);

  const [activeCurrency, setActiveCurrency] = useState<string>("");
  useEffect(() => {
    if (!activeCurrency && allCurrencies.length) setActiveCurrency(allCurrencies[0]);
  }, [allCurrencies, activeCurrency]);

  const cur = (summary.data?.per_currency ?? []).find((s) => s.currency_code === activeCurrency);
  const monthlyForCurrency = (monthly.data ?? []).filter((p) => p.currency_code === activeCurrency)
    .map((p) => ({ ...p, net: p.income - p.expense }));
  const compareForCurrency = (compare.data ?? []).filter((c) => c.currency_code === activeCurrency).slice(0, 15);
  const dailyForCurrency = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of daily.data ?? []) {
      if (d.currency_code !== activeCurrency) continue;
      m.set(d.on_date, (m.get(d.on_date) ?? 0) + d.amount);
    }
    return m;
  }, [daily.data, activeCurrency]);
  const topMerchForCurrency = (topMerch.data ?? []).filter((m) => m.currency_code === activeCurrency);
  const topTxForCurrency = (topTx.data ?? []).filter((t) => t.currency_code === activeCurrency);

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">统计</h1>
          <p className="text-sm text-ink-500">KPI · 月趋势 · 分类对比 · 热力 · Top 商家 / 交易</p>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input w-40" />
      </div>

      <div className="mb-4 flex flex-wrap gap-1">
        {allCurrencies.map((c) => (
          <button
            key={c}
            onClick={() => setActiveCurrency(c)}
            className={`rounded-full border px-3 py-1 text-xs ${activeCurrency === c ? "border-ink-800 bg-ink-800 text-white" : "border-ink-200 text-ink-600"}`}
          >{c}</button>
        ))}
        {allCurrencies.length === 0 && <div className="text-sm text-ink-500">还没有交易数据</div>}
      </div>

      {cur && (
        <section className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <KPI label="支出" current={cur.expense} previous={cur.expense_prev} currency={activeCurrency} currencies={currencies.data} negativeIsBad />
          <KPI label="收入" current={cur.income} previous={cur.income_prev} currency={activeCurrency} currencies={currencies.data} negativeIsBad={false} />
          <KPI label="净额" current={cur.net} previous={cur.income_prev - cur.expense_prev} currency={activeCurrency} currencies={currencies.data} negativeIsBad={false} />
          <div className="card">
            <div className="text-xs text-ink-500">日均支出</div>
            <div className="mt-1 text-lg font-semibold">{formatAmount(cur.avg_daily_expense, activeCurrency, currencies.data)}</div>
            <div className="text-[10px] text-ink-400">月内 {cur.days_in_month} 天</div>
          </div>
        </section>
      )}

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-ink-600">12 个月趋势（收入 / 支出 / 净）</h2>
        <div className="card">
          {monthlyForCurrency.length === 0 ? (
            <div className="py-6 text-center text-sm text-ink-500">没有数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={monthlyForCurrency} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ececef" />
                <XAxis dataKey="month" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip formatter={(v: number) => formatAmount(v, activeCurrency, currencies.data)} />
                <Line type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="收入" />
                <Line type="monotone" dataKey="expense" stroke="#e11d48" strokeWidth={2} dot={{ r: 3 }} name="支出" />
                <Line type="monotone" dataKey="net" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 2 }} name="净" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-ink-600">本月分类（含与上月对比）</h2>
        <div className="card divide-y divide-ink-100 p-0">
          {compareForCurrency.length === 0 && <div className="py-6 text-center text-sm text-ink-500">没有数据</div>}
          {compareForCurrency.map((c) => {
            const delta = c.delta;
            const max = Math.max(c.current, c.previous, 1);
            return (
              <div key={`${c.category_id}-${c.currency_code}`} className="px-4 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-1.5 truncate">
                    <span>{c.emoji}</span>
                    <span className="font-medium">{c.category_name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold">{formatAmount(c.current, c.currency_code, currencies.data)}</span>
                    <DeltaBadge delta={delta} currency={c.currency_code} currencies={currencies.data} />
                  </div>
                </div>
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                  <div className="absolute h-full bg-rose-500/60" style={{ width: `${(c.current / max) * 100}%` }} />
                </div>
                {c.previous > 0 && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-ink-400">
                    上月：{formatAmount(c.previous, c.currency_code, currencies.data)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-ink-600">每日热力图（近 90 天）</h2>
        <div className="card">
          <Heatmap heatmap={dailyForCurrency} />
        </div>
      </section>

      <section className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium text-ink-600">本月 Top 商家</h2>
          <div className="card divide-y divide-ink-100 p-0">
            {topMerchForCurrency.length === 0 && <div className="py-6 text-center text-sm text-ink-500">没有数据</div>}
            {topMerchForCurrency.map((m, i) => (
              <div key={m.merchant_id} className="flex items-center justify-between px-4 py-2 text-sm">
                <div>
                  <div className="font-medium">#{i + 1} {m.merchant_name}</div>
                  <div className="text-xs text-ink-500">{m.count} 笔</div>
                </div>
                <div className="text-rose-600">{formatAmount(m.total, m.currency_code, currencies.data)}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium text-ink-600">本月 Top 单笔</h2>
          <div className="card divide-y divide-ink-100 p-0">
            {topTxForCurrency.length === 0 && <div className="py-6 text-center text-sm text-ink-500">没有数据</div>}
            {topTxForCurrency.map((t, i) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <div>
                  <div className="font-medium">#{i + 1} {t.category_name}</div>
                  <div className="text-xs text-ink-500">{t.occurred_on}{t.note ? ` · ${t.note}` : ""}</div>
                </div>
                <div className="text-rose-600">{formatAmount(t.amount, t.currency_code, currencies.data)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function KPI({
  label, current, previous, currency, currencies, negativeIsBad,
}: {
  label: string;
  current: number;
  previous: number;
  currency: string;
  currencies?: Currency[];
  negativeIsBad: boolean;
}) {
  const delta = current - previous;
  const ratio = previous === 0 ? 0 : delta / previous;
  const Trend = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  const isBad = negativeIsBad ? delta > 0 : delta < 0;
  return (
    <div className="card">
      <div className="text-xs text-ink-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{formatAmount(current, currency, currencies)}</div>
      {previous !== 0 && (
        <div className={`mt-0.5 flex items-center gap-0.5 text-[11px] ${isBad ? "text-rose-600" : "text-emerald-600"}`}>
          <Trend size={11} />
          <span>{Math.abs(ratio * 100).toFixed(0)}%</span>
          <span className="text-ink-400">vs 上月</span>
        </div>
      )}
    </div>
  );
}

function DeltaBadge({ delta, currency, currencies }: { delta: number; currency: string; currencies?: Currency[] }) {
  if (delta === 0) return null;
  const Up = delta > 0;
  return (
    <span className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] ${Up ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
      {Up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
      {formatAmount(Math.abs(delta), currency, currencies)}
    </span>
  );
}

function Heatmap({ heatmap }: { heatmap: Map<string, number> }) {
  const max = Math.max(1, ...Array.from(heatmap.values()));
  const days: { date: string; amount: number }[] = [];
  const now = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ date: key, amount: heatmap.get(key) ?? 0 });
  }
  return (
    <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}>
      {days.map((d) => {
        const ratio = d.amount / max;
        const opacity = d.amount > 0 ? 0.15 + ratio * 0.85 : 0;
        return (
          <div
            key={d.date}
            title={`${d.date}: ${d.amount}`}
            className="aspect-square rounded-sm bg-ink-100"
            style={d.amount > 0 ? { background: `rgba(225, 29, 72, ${opacity})` } : undefined}
          />
        );
      })}
    </div>
  );
}
