import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import MonthPicker from "../components/MonthPicker";
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

// 支出节奏对比月配色 (最多 12 个月各一色)
const PACE_COLORS = [
  "#3b82f6", "#f59e0b", "#10b981", "#a855f7", "#0ea5e9", "#ec4899",
  "#84cc16", "#f97316", "#14b8a6", "#8b5cf6", "#eab308", "#06b6d4",
];

interface FxRate { id: number; on_date: string; base: string; quote: string; rate: number; }

export default function Stats({
  embedded = false,
  hideHeader = false,
  month: monthProp,
  onMonthChange,
}: {
  embedded?: boolean;
  hideHeader?: boolean;       // 隐藏自己的标题+月份选择器 (由外层提供)
  month?: string;             // 受控月份 (外层共享时传入)
  onMonthChange?: (m: string) => void;
}) {
  const [monthState, setMonthState] = useState(thisMonth());
  const month = monthProp ?? monthState;
  const setMonth = onMonthChange ?? setMonthState;
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
  // 支出节奏: 本月线对照过去 N 个月的历史群线, 看本月花得比平时快/慢
  const [paceMonths, setPaceMonths] = useState<6 | 12>(6);
  // 拉近 ~13 个月日数据, 覆盖 12 个月历史对比
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

  // 支出节奏: 本月每日累计支出 (粗红线) 对照过去 paceMonths 个月同期累计 (各月不同颜色).
  // x = 月内第几天 (1..31), y = 截至该天累计. 历史月 dataKey = "h0".."hN", 下方图例标色=月.
  const pace = useMemo(() => {
    const src = daily.data ?? [];
    const [yr, mn] = month.split("-").map(Number);
    const shifted = (offset: number) => {
      let m = mn - offset, y = yr;
      while (m <= 0) { m += 12; y -= 1; }
      return { y, m, label: `${y}-${String(m).padStart(2, "0")}` };
    };
    const hist = Array.from({ length: paceMonths }, (_, i) => ({ key: `h${i}`, color: PACE_COLORS[i % PACE_COLORS.length], ...shifted(i + 1) }));
    const cur: number[] = new Array(31).fill(0);
    const buckets: Record<string, number[]> = {};
    for (const h of hist) buckets[h.key] = new Array(31).fill(0);
    for (const d of src) {
      if (!isAll && d.currency_code !== activeCurrency) continue;
      const v = isAll ? fxTo(d.amount, d.currency_code, baseCurrency) : d.amount;
      // 审计#55: 手动 split 按本地时区解析 YYYY-MM-DD (避免 new Date(str) 按 UTC 解析, 负时区每日桶前移一天)
      const [yd, md, dd] = d.on_date.split("-").map(Number);
      const dt = new Date(yd, md - 1, dd);
      const y = dt.getFullYear(), m = dt.getMonth() + 1, day = dt.getDate();
      if (y === yr && m === mn) { cur[day - 1] += v; continue; }
      for (const h of hist) if (y === h.y && m === h.m) { buckets[h.key][day - 1] += v; break; }
    }
    const today = new Date();
    const isCurMonth = today.getFullYear() === yr && today.getMonth() + 1 === mn;
    const todayDay = today.getDate();
    let curCum = 0;
    const cum: Record<string, number> = {};
    for (const h of hist) cum[h.key] = 0;
    const rows: Record<string, number | null>[] = [];
    for (let i = 0; i < 31; i++) {
      curCum += cur[i];
      const row: Record<string, number | null> = {
        day: i + 1,
        current: isCurMonth && i + 1 > todayDay ? null : curCum,
      };
      for (const h of hist) { cum[h.key] += buckets[h.key][i]; row[h.key] = cum[h.key]; }
      rows.push(row);
    }
    return { rows, hist };
  }, [daily.data, month, paceMonths, activeCurrency, isAll, baseCurrency, fxTo]);

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

  // 嵌入首页矩形内时, 子块用浅色 tile 而非整张 .card (避免卡片套卡片)
  const box = embedded ? "rounded-xl bg-ink-50 dark:bg-ink-800/40" : "card";

  return (
    <div className={embedded ? "" : "px-4 py-5 md:px-6"}>
      {!hideHeader && (
        <div className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-2">
          {embedded ? (
            <h2 className="text-sm font-medium text-ink-600">统计</h2>
          ) : (
            <div>
              <h1 className="text-xl font-semibold tracking-tight">统计</h1>
              <p className="text-sm text-ink-500">KPI · Top 商家 / 分类对比 · 支出节奏</p>
            </div>
          )}
          <MonthPicker value={month} onChange={setMonth} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {allCurrencies.length === 0 ? (
          <div className="text-sm text-ink-500">还没有交易数据</div>
        ) : (
          <>
            <span className="text-xs text-ink-500">币种</span>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setActiveCurrency("")}
                className={`rounded-full border px-3 py-1 text-xs ${isAll ? "border-ink-800 bg-ink-800 text-white dark:border-emerald-500 dark:bg-emerald-600" : "border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300"}`}
              >全部</button>
              {allCurrencies.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCurrency(c)}
                  className={`rounded-full border px-3 py-1 text-xs ${activeCurrency === c ? "border-ink-800 bg-ink-800 text-white dark:border-emerald-500 dark:bg-emerald-600" : "border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300"}`}
                >{c}</button>
              ))}
            </div>
            {isAll && (
              <span className="flex items-center gap-1 text-xs text-ink-500">
                折算到
                <select
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
                  className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
                >
                  {allCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </span>
            )}
          </>
        )}
      </div>

      {cur && (
        <section className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <KPI label="支出" current={cur.expense} previous={cur.expense_prev} currency={displayCode} currencies={currencies.data} negativeIsBad box={box} />
          <KPI label="收入" current={cur.income} previous={cur.income_prev} currency={displayCode} currencies={currencies.data} negativeIsBad={false} box={box} />
          <KPI label="净额" current={cur.net} previous={cur.income_prev - cur.expense_prev} currency={displayCode} currencies={currencies.data} negativeIsBad={false} box={box} />
          <div className={`${box} p-4`}>
            <div className="text-xs text-ink-500">日均支出</div>
            <div className="mt-1 text-lg font-semibold">{formatAmount(cur.avg_daily_expense, displayCode, currencies.data)}</div>
            <div className="text-[10px] text-ink-400">月内 {cur.days_in_month} 天</div>
          </div>
        </section>
      )}

      <section className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium text-ink-600">本月 Top 商家</h2>
          <div className={`${box} divide-y divide-ink-100 p-0`}>
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
          <div className={`${box} divide-y divide-ink-100 p-0`}>
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
          <div>
            <h2 className="text-sm font-medium text-ink-600">本月支出节奏</h2>
            <p className="text-[11px] text-ink-400">本月（粗红）对照过去 {paceMonths} 个月同期；红线在历史各月之上=花得比平时快</p>
          </div>
          <div className="flex gap-1 text-xs">
            {([6, 12] as const).map((n) => (
              <button
                key={n}
                onClick={() => setPaceMonths(n)}
                className={`rounded-full border px-2.5 py-0.5 ${paceMonths === n ? "border-ink-800 bg-ink-800 text-white dark:border-emerald-500 dark:bg-emerald-600" : "border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300"}`}
              >近 {n} 个月</button>
            ))}
          </div>
        </div>
        <div className={`${box} p-4`}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={pace.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ececef" />
              <XAxis dataKey="day" fontSize={10} tickFormatter={(d) => `${d} 号`} />
              <YAxis fontSize={10} />
              <Tooltip
                formatter={(v: number, key: string) => {
                  const h = pace.hist.find((x) => x.key === key);
                  return [formatAmount(v, displayCode, currencies.data), h ? h.label : "本月"];
                }}
                labelFormatter={(d) => `${d} 号`}
              />
              {/* 历史月: 每月一色 */}
              {pace.hist.map((h) => (
                <Line key={h.key} type="monotone" dataKey={h.key} stroke={h.color} strokeWidth={1.8} dot={false} />
              ))}
              {/* 本月: 粗红实线, 压在最上层 */}
              <Line type="monotone" dataKey="current" stroke="#e11d48" strokeWidth={3} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
          {/* 图例: 色块 = 月份 */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: "#e11d48" }} />
              <span className="font-medium">本月</span>
            </span>
            {pace.hist.map((h) => (
              <span key={h.key} className="flex items-center gap-1 text-ink-500">
                <span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: h.color }} />
                {h.label}
              </span>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}

function KPI({
  label, current, previous, currency, currencies, negativeIsBad, box = "card",
}: {
  label: string;
  current: number;
  previous: number;
  currency: string;
  currencies?: Currency[];
  negativeIsBad: boolean;
  box?: string;
}) {
  const delta = current - previous;
  const ratio = previous === 0 ? 0 : delta / previous;
  const Trend = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  const isBad = negativeIsBad ? delta > 0 : delta < 0;
  return (
    <div className={`${box} p-4`}>
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

