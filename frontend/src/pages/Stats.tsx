import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import MonthPicker from "../components/MonthPicker";
import RecurringPanel from "../components/RecurringPanel";
import { api, type Category, type Currency } from "../lib/api";
import { useAuth } from "../lib/auth";
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

interface DailyPoint { on_date: string; currency_code: string; amount: number; }
interface CatCompare {
  category_id: number | null; category_name: string; emoji: string;
  currency_code: string; current: number; previous: number; delta: number;
}
interface TopMerchant { merchant_id: number | null; merchant_name: string; currency_code: string; total: number; count: number; }

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface FxRate { id: number; on_date: string; base: string; quote: string; rate: number; }

export default function Stats({ embedded = false }: { embedded?: boolean }) {
  const [month, setMonth] = useState(thisMonth());
  const { user } = useAuth();
  const [baseCurrency, setBaseCurrency] = useState<string>(() => localStorage.getItem("tally.baseCurrency") || "JPY");
  useEffect(() => {
    if (user?.primary_currency_code) setBaseCurrency(user.primary_currency_code);
  }, [user?.primary_currency_code]);
  useEffect(() => { localStorage.setItem("tally.baseCurrency", baseCurrency); }, [baseCurrency]);

  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: async () => (await api.get<FxRate[]>("/exchange-rates")).data });
  const summary = useQuery({ queryKey: ["stats-summary", month], queryFn: async () => (await api.get<SummaryResp>(`/stats/summary?month=${month}`)).data });
  const compare = useQuery({ queryKey: ["stats-compare", month], queryFn: async () => (await api.get<CatCompare[]>(`/stats/category-compare?month=${month}`)).data });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  // 支出节奏对比基准: 上月 / 上上月 / 去年同月
  const [paceBase, setPaceBase] = useState<"prev" | "prev2" | "yoy">("prev");
  // 拉近 400 天日数据, 覆盖去年同月对比
  const daily = useQuery({ queryKey: ["stats-daily"], queryFn: async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 400 * 86400000);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return (await api.get<DailyPoint[]>(`/stats/daily?kind=expense&start=${iso(start)}&end=${iso(end)}`)).data;
  } });
  const topMerch = useQuery({ queryKey: ["stats-top-merchants", month], queryFn: async () => (await api.get<TopMerchant[]>(`/stats/top-merchants?month=${month}`)).data });

  const allCurrencies = useMemo(() => {
    const set = new Set<string>();
    (summary.data?.per_currency ?? []).forEach((s) => set.add(s.currency_code));
    (topMerch.data ?? []).forEach((m) => set.add(m.currency_code));
    return Array.from(set).sort();
  }, [summary.data, topMerch.data]);

  // "" = 全部 (合并); 其他值 = 单币种
  const [activeCurrency, setActiveCurrency] = useState<string>("");

  // FX: 把 amount 从 fromCode 换成 toCode (单位都是 smallest, 自动处理 digit 差)
  const digitsMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of currencies.data ?? []) m.set(c.code, c.decimal_digits);
    return m;
  }, [currencies.data]);
  const rateMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rates.data ?? []) {
      const k = `${r.base}->${r.quote}`;
      if (!m.has(k)) m.set(k, r.rate);  // 第一条 (按 date desc 排序)
    }
    return m;
  }, [rates.data]);
  const fxTo = (amount: number, fromCode: string, toCode: string): number => {
    if (fromCode === toCode) return amount;
    const fd = digitsMap.get(fromCode) ?? 2;
    const td = digitsMap.get(toCode) ?? 2;
    let rate = rateMap.get(`${fromCode}->${toCode}`);
    if (rate == null) {
      const rev = rateMap.get(`${toCode}->${fromCode}`);
      if (rev == null || rev === 0) return 0;
      rate = 1 / rev;
    }
    return Math.round(amount * rate * Math.pow(10, td - fd));
  };

  // === 单币种模式: 直接 filter (原行为) ===
  // === 全部模式: 跨币种聚合, 全部换算到 baseCurrency ===
  const isAll = activeCurrency === "";
  const displayCode = isAll ? baseCurrency : activeCurrency;

  // KPI 汇总
  const cur = useMemo(() => {
    const rows = summary.data?.per_currency ?? [];
    if (!isAll) return rows.find((s) => s.currency_code === activeCurrency);
    if (rows.length === 0) return undefined;
    let income = 0, expense = 0, income_prev = 0, expense_prev = 0, avg_daily_expense = 0;
    let days = 0;
    for (const r of rows) {
      income += fxTo(r.income, r.currency_code, baseCurrency);
      expense += fxTo(r.expense, r.currency_code, baseCurrency);
      income_prev += fxTo(r.income_prev, r.currency_code, baseCurrency);
      expense_prev += fxTo(r.expense_prev, r.currency_code, baseCurrency);
      avg_daily_expense += fxTo(r.avg_daily_expense, r.currency_code, baseCurrency);
      days = Math.max(days, r.days_in_month);
    }
    return {
      currency_code: baseCurrency, income, expense, net: income - expense,
      income_prev, expense_prev, days_in_month: days, avg_daily_expense,
    } as CurrencySummary;
  }, [summary.data, activeCurrency, isAll, baseCurrency, fxTo]);

  // 分类对比 (扁平, 按 category_id 聚合; 不切片, 留给分组用)
  const compareForCurrency = useMemo(() => {
    const src = compare.data ?? [];
    if (!isAll) return src.filter((c) => c.currency_code === activeCurrency);
    const m = new Map<number | string, CatCompare>();
    for (const c of src) {
      const key = c.category_id ?? `null-${c.category_name}`;
      const row = m.get(key) ?? { ...c, currency_code: baseCurrency, current: 0, previous: 0, delta: 0 };
      row.current += fxTo(c.current, c.currency_code, baseCurrency);
      row.previous += fxTo(c.previous, c.currency_code, baseCurrency);
      row.delta = row.current - row.previous;
      m.set(key, row);
    }
    return Array.from(m.values()).sort((a, b) => b.current - a.current);
  }, [compare.data, activeCurrency, isAll, baseCurrency, fxTo]);

  // 本月分类: 用 categories 树把子类归到父类下. 父类总额 = 自身直接消费 + 各子类之和.
  const categoryGroups = useMemo(() => {
    const catById = new Map<number, Category>();
    for (const c of categories.data ?? []) catById.set(c.id, c);
    type Child = { id: number | null; name: string; emoji: string; amount: number };
    const groups = new Map<number | string, { id: number | null; name: string; emoji: string; own: number; children: Child[]; total: number }>();
    const ensure = (id: number | null, name: string, emoji: string) => {
      const key = id ?? `null-${name}`;
      let g = groups.get(key);
      if (!g) { g = { id, name, emoji, own: 0, children: [], total: 0 }; groups.set(key, g); }
      return g;
    };
    for (const row of compareForCurrency) {
      if (row.current <= 0) continue;
      const cat = row.category_id != null ? catById.get(row.category_id) : undefined;
      if (cat && cat.parent_id != null) {
        const parent = catById.get(cat.parent_id);
        const g = ensure(cat.parent_id, parent?.name ?? "?", parent?.emoji ?? "");
        g.children.push({ id: row.category_id, name: row.category_name, emoji: row.emoji, amount: row.current });
        g.total += row.current;
      } else {
        const g = ensure(row.category_id, row.category_name, row.emoji);
        g.own += row.current;
        g.total += row.current;
      }
    }
    return Array.from(groups.values())
      .map((g) => ({ ...g, children: g.children.sort((a, b) => b.amount - a.amount) }))
      .sort((a, b) => b.total - a.total);
  }, [compareForCurrency, categories.data]);

  // 本月 vs 对比月 每日累计支出 ("支出节奏")
  // x = 月内第几天 (1..31), y = 截至该天的累计支出
  // 两条线: 本月 (实线) / 对比月 (虚线)
  const pace = useMemo(() => {
    const src = daily.data ?? [];
    const [yr, mn] = month.split("-").map(Number);
    // 对比月: 上月 / 上上月 / 去年同月
    let cYr = yr, cMn = mn;
    if (paceBase === "prev") { cMn = mn === 1 ? 12 : mn - 1; cYr = mn === 1 ? yr - 1 : yr; }
    else if (paceBase === "prev2") { cMn = mn <= 2 ? mn + 10 : mn - 2; cYr = mn <= 2 ? yr - 1 : yr; }
    else { cMn = mn; cYr = yr - 1; }
    // 按 day-of-month 聚合两个月
    const cur: number[] = new Array(31).fill(0);
    const prev: number[] = new Array(31).fill(0);
    for (const d of src) {
      if (!isAll && d.currency_code !== activeCurrency) continue;
      const v = isAll ? fxTo(d.amount, d.currency_code, baseCurrency) : d.amount;
      const dt = new Date(d.on_date);
      const y = dt.getFullYear();
      const m = dt.getMonth() + 1;
      const day = dt.getDate();
      if (y === yr && m === mn) cur[day - 1] += v;
      else if (y === cYr && m === cMn) prev[day - 1] += v;
    }
    // 累计
    const today = new Date();
    const isCurMonth = today.getFullYear() === yr && today.getMonth() + 1 === mn;
    const todayDay = today.getDate();
    let curCum = 0, prevCum = 0;
    const rows: { day: number; current: number | null; previous: number | null }[] = [];
    for (let i = 0; i < 31; i++) {
      curCum += cur[i];
      prevCum += prev[i];
      rows.push({
        day: i + 1,
        // 当前月只画到今天为止
        current: isCurMonth && i + 1 > todayDay ? null : curCum,
        previous: prevCum,
      });
    }
    return rows;
  }, [daily.data, month, paceBase, activeCurrency, isAll, baseCurrency, fxTo]);

  // Top 商家
  const topMerchForCurrency = useMemo(() => {
    const src = topMerch.data ?? [];
    if (!isAll) return src.filter((m) => m.currency_code === activeCurrency);
    const m = new Map<number | string, TopMerchant>();
    for (const t of src) {
      const key = t.merchant_id ?? `null-${t.merchant_name}`;
      const row = m.get(key) ?? { ...t, currency_code: baseCurrency, total: 0, count: 0 };
      row.total += fxTo(t.total, t.currency_code, baseCurrency);
      row.count += t.count;
      m.set(key, row);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [topMerch.data, activeCurrency, isAll, baseCurrency, fxTo]);

  return (
    <div className={embedded ? "px-4 pb-5 md:px-6" : "px-4 py-5 md:px-6"}>
      <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">统计</h1>
          <p className="text-sm text-ink-500">KPI · Top 商家 / 分类对比 · 支出节奏</p>
        </div>
        <MonthPicker value={month} onChange={setMonth} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1">
        <button
          onClick={() => setActiveCurrency("")}
          className={`rounded-full border px-3 py-1 text-xs ${isAll ? "border-ink-800 bg-ink-800 text-white" : "border-ink-200 text-ink-600"}`}
        >全部 · 折算到 {baseCurrency}</button>
        {allCurrencies.map((c) => (
          <button
            key={c}
            onClick={() => setActiveCurrency(c)}
            className={`rounded-full border px-3 py-1 text-xs ${activeCurrency === c ? "border-ink-800 bg-ink-800 text-white" : "border-ink-200 text-ink-600"}`}
          >{c}</button>
        ))}
        {isAll && allCurrencies.length > 0 && (
          <select
            value={baseCurrency}
            onChange={(e) => setBaseCurrency(e.target.value)}
            className="ml-1 rounded-full border border-ink-200 bg-white px-2 py-0.5 text-xs text-ink-600 dark:border-ink-700 dark:bg-ink-800"
            title="选择折算基准币种"
          >
            {allCurrencies.map((c) => <option key={c} value={c}>基准 {c}</option>)}
          </select>
        )}
        {allCurrencies.length === 0 && <div className="text-sm text-ink-500">还没有交易数据</div>}
      </div>

      {cur && (
        <section className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <KPI label="支出" current={cur.expense} previous={cur.expense_prev} currency={displayCode} currencies={currencies.data} negativeIsBad />
          <KPI label="收入" current={cur.income} previous={cur.income_prev} currency={displayCode} currencies={currencies.data} negativeIsBad={false} />
          <KPI label="净额" current={cur.net} previous={cur.income_prev - cur.expense_prev} currency={displayCode} currencies={currencies.data} negativeIsBad={false} />
          <div className="card">
            <div className="text-xs text-ink-500">日均支出</div>
            <div className="mt-1 text-lg font-semibold">{formatAmount(cur.avg_daily_expense, displayCode, currencies.data)}</div>
            <div className="text-[10px] text-ink-400">月内 {cur.days_in_month} 天</div>
          </div>
        </section>
      )}

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
          <h2 className="mb-2 text-sm font-medium text-ink-600">本月分类</h2>
          <div className="card divide-y divide-ink-100 p-0">
            {categoryGroups.length === 0 && <div className="py-6 text-center text-sm text-ink-500">没有数据</div>}
            {categoryGroups.map((g) => (
              <div key={g.id ?? `null-${g.name}`} className="px-4 py-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1.5 truncate">
                    <span>{g.emoji}</span>
                    <span className="font-medium">{g.name}</span>
                  </div>
                  <div className="shrink-0 font-semibold text-rose-600">{formatAmount(g.total, displayCode, currencies.data)}</div>
                </div>
                {g.children.length > 0 && (
                  <div className="mt-1 space-y-0.5 pl-5">
                    {g.children.map((c) => (
                      <div key={c.id ?? `null-${c.name}`} className="flex items-center justify-between text-xs text-ink-500">
                        <span className="truncate">{c.emoji} {c.name}</span>
                        <span className="shrink-0">{formatAmount(c.amount, displayCode, currencies.data)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-ink-600">本月支出节奏</h2>
          <div className="flex gap-1 text-xs">
            {([["prev", "对比上月"], ["prev2", "对比上上月"], ["yoy", "对比去年同月"]] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setPaceBase(k)}
                className={`rounded-full border px-2.5 py-0.5 ${paceBase === k ? "border-ink-800 bg-ink-800 text-white dark:border-emerald-500 dark:bg-emerald-600" : "border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300"}`}
              >{label}</button>
            ))}
          </div>
        </div>
        <div className="card">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={pace} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ececef" />
              <XAxis dataKey="day" fontSize={10} tickFormatter={(d) => `${d} 号`} />
              <YAxis fontSize={10} />
              <Tooltip
                formatter={(v: number) => formatAmount(v, displayCode, currencies.data)}
                labelFormatter={(d) => `${d} 号`}
              />
              <Line type="monotone" dataKey="current" stroke="#e11d48" strokeWidth={2.5} dot={false} name="本月" connectNulls={false} />
              <Line type="monotone" dataKey="previous" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 3" dot={false} name={paceBase === "prev" ? "上月" : paceBase === "prev2" ? "上上月" : "去年同月"} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-1 text-sm font-medium text-ink-600">周期账单</h2>
        <p className="mb-2 text-xs text-ink-500">把房租 / 订阅 / 水电 这类有规律的支出标记为月度或年度，这里集中看</p>
        <RecurringPanel month={month} />
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

