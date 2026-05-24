import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { api, type Currency } from "../lib/api";
import { formatAmount } from "../lib/format";

interface MonthlyPoint { month: string; currency_code: string; income: number; expense: number; }
interface DailyPoint { on_date: string; currency_code: string; amount: number; }
interface CategoryTrendPoint { month: string; category_id: number | null; category_name: string; currency_code: string; amount: number; }
interface TopTx { id: number; occurred_on: string; amount: number; currency_code: string; category_name: string; note: string; }
interface CrossTotal { base_currency: string; total: number; breakdown: { currency_code: string; balance: number; rate: number; converted: number }[]; }

const PIE_COLORS = ["#1e1f24", "#48494f", "#7f8089", "#abacb4", "#d3d3d8", "#ececef", "#33343a", "#5f6068", "#888", "#aaa"];

export default function Stats() {
  const [base, setBase] = useState("JPY");
  const monthly = useQuery({ queryKey: ["stats-monthly"], queryFn: async () => (await api.get<MonthlyPoint[]>("/stats/monthly-trend?months=12")).data });
  const daily = useQuery({ queryKey: ["stats-daily"], queryFn: async () => (await api.get<DailyPoint[]>("/stats/daily?kind=expense")).data });
  const catTrend = useQuery({ queryKey: ["stats-cat-trend"], queryFn: async () => (await api.get<CategoryTrendPoint[]>("/stats/category-trend?months=6")).data });
  const top = useQuery({ queryKey: ["stats-top"], queryFn: async () => (await api.get<TopTx[]>("/stats/top?limit=10")).data });
  const cross = useQuery({ queryKey: ["stats-cross", base], queryFn: async () => (await api.get<CrossTotal>(`/stats/cross-currency-total?base=${base}`)).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

  const monthlyByCurrency = useMemo(() => {
    const m = new Map<string, MonthlyPoint[]>();
    for (const p of monthly.data ?? []) {
      const arr = m.get(p.currency_code) ?? [];
      arr.push(p);
      m.set(p.currency_code, arr);
    }
    return Array.from(m.entries());
  }, [monthly.data]);

  const heatmap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of daily.data ?? []) {
      m.set(d.on_date, (m.get(d.on_date) ?? 0) + d.amount);
    }
    return m;
  }, [daily.data]);

  const maxHeat = Math.max(1, ...Array.from(heatmap.values()));

  const catTrendByCurrency = useMemo(() => {
    const m = new Map<string, Map<string, Map<string, number>>>();
    for (const p of catTrend.data ?? []) {
      if (!m.has(p.currency_code)) m.set(p.currency_code, new Map());
      const byCat = m.get(p.currency_code)!;
      if (!byCat.has(p.category_name)) byCat.set(p.category_name, new Map());
      byCat.get(p.category_name)!.set(p.month, (byCat.get(p.category_name)!.get(p.month) ?? 0) + p.amount);
    }
    return m;
  }, [catTrend.data]);

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">统计</h1>
        <p className="text-sm text-ink-500">月趋势 · 分类堆叠 · 热力 · Top 10 · 跨币种总览</p>
      </div>

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-ink-600">月度收支（近 12 个月）</h2>
        {monthlyByCurrency.map(([code, rows]) => (
          <div key={code} className="card mb-2">
            <div className="mb-1 text-xs text-ink-500">{code}</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ececef" />
                <XAxis dataKey="month" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip formatter={(v: number) => formatAmount(v, code, currencies.data)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="income" fill="#10b981" name="收入" />
                <Bar dataKey="expense" fill="#e11d48" name="支出" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ))}
        {monthlyByCurrency.length === 0 && <div className="card text-sm text-ink-500">没有数据</div>}
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-ink-600">分类趋势（近 6 个月）</h2>
        {Array.from(catTrendByCurrency.entries()).map(([code, byCat]) => {
          const months = Array.from(new Set(Array.from(byCat.values()).flatMap((m) => Array.from(m.keys())))).sort();
          const cats = Array.from(byCat.keys());
          const data = months.map((mo) => {
            const row: Record<string, number | string> = { month: mo };
            for (const cat of cats) {
              row[cat] = byCat.get(cat)?.get(mo) ?? 0;
            }
            return row;
          });
          return (
            <div key={code} className="card mb-2">
              <div className="mb-1 text-xs text-ink-500">{code}</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ececef" />
                  <XAxis dataKey="month" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip formatter={(v: number) => formatAmount(v, code, currencies.data)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {cats.map((cat, i) => (
                    <Bar key={cat} dataKey={cat} stackId="a" fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-ink-600">每日热力图（近 90 天 · 颜色深度 = 消费）</h2>
        <div className="card">
          <Heatmap heatmap={heatmap} maxHeat={maxHeat} />
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-medium text-ink-600">本月 Top 10 消费</h2>
        <div className="card divide-y divide-ink-100 p-0">
          {(top.data ?? []).length === 0 && <div className="px-4 py-6 text-center text-sm text-ink-500">没有数据</div>}
          {(top.data ?? []).map((t, i) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div>
                <div className="font-medium">#{i + 1} {t.category_name}</div>
                <div className="text-xs text-ink-500">{t.occurred_on}{t.note ? ` · ${t.note}` : ""}</div>
              </div>
              <div className="text-rose-600">-{formatAmount(t.amount, t.currency_code, currencies.data)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-600">跨币种总览</h2>
          <select className="input w-28 text-sm" value={base} onChange={(e) => setBase(e.target.value)}>
            {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
        </div>
        <div className="card">
          <div className="mb-2 text-xs text-ink-500">所有 Wallet 余额（不含贷款账户）折算为 {base}</div>
          <div className="mb-2 text-2xl font-semibold">{formatAmount(cross.data?.total ?? 0, base, currencies.data)}</div>
          <div className="divide-y divide-ink-100">
            {(cross.data?.breakdown ?? []).map((b) => (
              <div key={b.currency_code} className="flex items-center justify-between py-1.5 text-sm">
                <div>
                  <span className="font-medium">{b.currency_code}</span>
                  <span className="ml-2 text-ink-500">{formatAmount(b.balance, b.currency_code, currencies.data)}</span>
                  {b.currency_code !== base && <span className="ml-2 text-xs text-ink-400">× {b.rate.toFixed(4)}</span>}
                </div>
                <div className="text-ink-700">{formatAmount(b.converted, base, currencies.data)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Heatmap({ heatmap, maxHeat }: { heatmap: Map<string, number>; maxHeat: number }) {
  const days: { date: string; amount: number }[] = [];
  const now = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ date: key, amount: heatmap.get(key) ?? 0 });
  }
  return (
    <div className="grid grid-cols-15 gap-0.5" style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}>
      {days.map((d) => {
        const ratio = d.amount / maxHeat;
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
