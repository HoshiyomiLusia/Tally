import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import CategoryIcon from "../components/CategoryIcon";
import Modal from "../components/Modal";
import MonthPicker from "../components/MonthPicker";
import { api, type Category, type Currency, type Merchant, type Transaction } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatAmount, todayIso } from "../lib/format";

interface CurrencySummary {
  currency_code: string;
  income: number;
  expense: number;
  net: number;
  income_prev: number;
  expense_prev: number;
  days_in_month: number;
  days_elapsed: number;
  avg_daily_expense: number;
}
interface SummaryResp { month: string; per_currency: CurrencySummary[]; }

interface DailyPoint { on_date: string; currency_code: string; amount: number; }
interface CatCompare {
  category_id: number | null; category_name: string; emoji: string;
  currency_code: string; current: number; previous: number; delta: number;
}
interface TotalBudget {
  amount: number; currency_code: string; spent: number; remaining: number; percent: number;
  days_in_month: number; days_elapsed: number; typical_spent: number; projected: number;
  history_months: number; missing_rate_currencies: string[];
}
interface TopMerchant { merchant_id: number | null; merchant_name: string; currency_code: string; total: number; count: number; }

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// base 之前的 n 个月, 近→远, 形如 ["2026-08", "2026-07", ...]
function monthsBefore(base: string, n: number): string[] {
  const [y, m] = base.split("-").map(Number);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    let mm = m - i, yy = y;
    while (mm <= 0) { mm += 12; yy -= 1; }
    out.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return out;
}

// 支出节奏对比月配色 (最多 12 个月各一色)
const PACE_COLORS = [
  "#3b82f6", "#f59e0b", "#10b981", "#a855f7", "#0ea5e9", "#ec4899",
  "#84cc16", "#f97316", "#14b8a6", "#8b5cf6", "#eab308", "#06b6d4",
];

// 轴刻度缩写(与总分析同款): 千/万位区间保留 1 位小数并去尾零, 避免相邻刻度重复
function shortNum(v: number): string {
  const a = Math.abs(v);
  const f = (x: number, d: number) => String(parseFloat(x.toFixed(d)));
  if (a >= 1e8) return f(v / 1e8, 1) + "亿";
  if (a >= 1e4) return f(v / 1e4, a >= 1e5 ? 0 : 1) + "万";
  if (a >= 1e3) return f(v / 1e3, 1) + "k";
  return String(Math.round(v));
}

interface FxRate { id: number; on_date: string; base: string; quote: string; rate: number; }

export default function Stats({
  embedded = false,
  hideHeader = false,
  month: monthProp,
  onMonthChange,
  collapsed = false,
}: {
  embedded?: boolean;
  collapsed?: boolean;        // 首页折叠态: 只留币种切换 + KPI 卡
  hideHeader?: boolean;       // 隐藏自己的标题+月份选择器 (由外层提供)
  month?: string;             // 受控月份 (外层共享时传入)
  onMonthChange?: (m: string) => void;
}) {
  const [monthState, setMonthState] = useState(thisMonth());
  const month = monthProp ?? monthState;
  useEffect(() => { setPaceSel(monthsBefore(month, 6)); setPaceHidden([]); }, [month]);
  const setMonth = onMonthChange ?? setMonthState;
  const { user } = useAuth();
  // 审计 #98: 与 Overview.BalanceModule 同一守卫 —— 只在本地没保存过折算币种时才用主币种初始化,
  // 否则每次挂载都把用户手选的折算币种覆写回主币种(第二次刷新就被顶回)。
  const hadSavedBase = useRef(localStorage.getItem("tally.baseCurrency") != null);
  const [baseCurrency, setBaseCurrency] = useState<string>(() => localStorage.getItem("tally.baseCurrency") || "JPY");
  useEffect(() => {
    if (!hadSavedBase.current && user?.primary_currency_code) setBaseCurrency(user.primary_currency_code);
  }, [user?.primary_currency_code]);
  useEffect(() => { localStorage.setItem("tally.baseCurrency", baseCurrency); }, [baseCurrency]);

  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: async () => (await api.get<FxRate[]>("/exchange-rates")).data });
  const summary = useQuery({ queryKey: ["stats-summary", month], queryFn: async () => (await api.get<SummaryResp>(`/stats/summary?month=${month}`)).data });
  const compare = useQuery({ queryKey: ["stats-compare", month], queryFn: async () => (await api.get<CatCompare[]>(`/stats/category-compare?month=${month}`)).data });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  // 支出节奏: 本月线对照过去 N 个月的历史群线, 看本月花得比平时快/慢
  // 对比月份可自选: paceSel = 参与对照的历史月(近→远), paceHidden = 图例点掉的(仍在图例里, 可点回来)
  const [paceSel, setPaceSel] = useState<string[]>(() => monthsBefore(thisMonth(), 6));
  const [paceHidden, setPaceHidden] = useState<string[]>([]);
  const [pacePick, setPacePick] = useState(false);
  const [paceHl, setPaceHl] = useState<string | null>(null);  // 图例 hover 高亮某个历史月
  // 审计 #108: 按所选月份 + 对比月数拉"整月"数据(此前固定今天往前 400 天, 最老的历史月只拉到半截却仍计入均值/区间带)
  const paceFrom = useMemo(() => [...paceSel, month].sort()[0], [paceSel, month]);
  const daily = useQuery({ queryKey: ["stats-daily", month, paceFrom], queryFn: async () => {
    const [yr, mn] = month.split("-").map(Number);
    const [fy, fm] = paceFrom.split("-").map(Number);
    const start = new Date(fy, fm - 1, 1);
    const end = new Date(yr, mn, 0);  // 所选月最后一天
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
    let days = 0, elapsed = 0;
    for (const r of rows) {
      income += fxTo(r.income, r.currency_code, baseCurrency);
      expense += fxTo(r.expense, r.currency_code, baseCurrency);
      income_prev += fxTo(r.income_prev, r.currency_code, baseCurrency);
      expense_prev += fxTo(r.expense_prev, r.currency_code, baseCurrency);
      avg_daily_expense += fxTo(r.avg_daily_expense, r.currency_code, baseCurrency);
      days = Math.max(days, r.days_in_month);
      elapsed = Math.max(elapsed, r.days_elapsed);
    }
    return {
      currency_code: baseCurrency, income, expense, net: income - expense,
      income_prev, expense_prev, days_in_month: days, days_elapsed: elapsed, avg_daily_expense,
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

  // 看的是不是当前月: 决定同比口径文案(当月比上月同期, 历史月比上月整月, 与后端 category_compare 一致)
  const isCurMonthView = month === thisMonth();

  // 本月分类: 用 categories 树把子类归到父类下. 父类总额 = 自身直接消费 + 各子类之和.
  const categoryGroups = useMemo(() => {
    const catById = new Map<number, Category>();
    for (const c of categories.data ?? []) catById.set(c.id, c);
    type Child = { id: number | null; name: string; emoji: string; amount: number; prev: number };
    const groups = new Map<number | string, { id: number | null; name: string; emoji: string; own: number; children: Child[]; total: number; prev: number }>();
    const ensure = (id: number | null, name: string, emoji: string) => {
      const key = id ?? `null-${name}`;
      let g = groups.get(key);
      if (!g) { g = { id, name, emoji, own: 0, children: [], total: 0, prev: 0 }; groups.set(key, g); }
      return g;
    };
    for (const row of compareForCurrency) {
      // 同比上月: 本月 0 但上月有的分类不单独展示, 但要计入父级 prev, 否则父级环比会偏高
      if (row.current <= 0 && row.previous <= 0) continue;
      const cat = row.category_id != null ? catById.get(row.category_id) : undefined;
      if (cat && cat.parent_id != null) {
        const parent = catById.get(cat.parent_id);
        const g = ensure(cat.parent_id, parent?.name ?? "?", parent?.emoji ?? "");
        if (row.current > 0) g.children.push({ id: row.category_id, name: row.category_name, emoji: row.emoji, amount: row.current, prev: row.previous });
        g.total += row.current;
        g.prev += row.previous;
      } else {
        const g = ensure(row.category_id, row.category_name, row.emoji);
        g.own += row.current;
        g.total += row.current;
        g.prev += row.previous;
      }
    }
    return Array.from(groups.values())
      .filter((g) => g.total > 0)
      .map((g) => ({ ...g, children: g.children.sort((a, b) => b.amount - a.amount) }))
      .sort((a, b) => b.total - a.total);
  }, [compareForCurrency, categories.data]);

  // 支出节奏: 本月每日累计支出 (粗红线) 对照选中的历史月同期累计 (各月不同颜色).
  // x = 月内第几天 (1..31), y = 截至该天累计. 历史月 dataKey = "h0".."hN", 下方图例标色=月.
  const pace = useMemo(() => {
    const src = daily.data ?? [];
    const [yr, mn] = month.split("-").map(Number);
    const histAll = paceSel.map((label, i) => {
      const [y, m] = label.split("-").map(Number);
      return { key: `h${i}`, color: PACE_COLORS[i % PACE_COLORS.length], y, m, label };
    });
    const hist = histAll.filter((h) => !paceHidden.includes(h.label));  // 图例点掉的既不画线也不进均值/区间
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
    // 均值/区间只用有数据的历史月, 否则没记账的空月会把均值拉低
    const active = hist.filter((h) => buckets[h.key].some((v) => v > 0));
    const rows: Record<string, number | number[] | null>[] = [];
    const avgArr: number[] = [];
    for (let i = 0; i < 31; i++) {
      curCum += cur[i];
      const row: Record<string, number | number[] | null> = {
        day: i + 1,
        current: isCurMonth && i + 1 > todayDay ? null : curCum,
      };
      for (const h of hist) { cum[h.key] += buckets[h.key][i]; row[h.key] = cum[h.key]; }
      if (active.length) {
        const vals = active.map((h) => cum[h.key]);
        const avg = Math.round(vals.reduce((a, v) => a + v, 0) / vals.length);
        row.avg = avg; avgArr.push(avg);
        row.band = [Math.min(...vals), Math.max(...vals)];
      }
      rows.push(row);
    }
    // 小结: 截至参考日(本月=今天, 历史月=月末) 本月累计 vs 历史均值同期; 本月还按平均后续节奏推算月末
    const daysInMonth = new Date(yr, mn, 0).getDate();
    const refIdx = (isCurMonth ? Math.min(todayDay, daysInMonth) : daysInMonth) - 1;
    let summary: { refDay: number; cur: number; avg: number; pct: number | null; projected: number | null } | null = null;
    if (active.length && refIdx >= 0) {
      const curRef = rows[refIdx].current as number | null;
      const avgRef = avgArr[refIdx], avgEnd = avgArr[daysInMonth - 1];
      if (curRef != null) summary = {
        refDay: refIdx + 1, cur: curRef, avg: avgRef,
        pct: avgRef > 0 ? (curRef - avgRef) / avgRef : null,
        projected: isCurMonth && avgRef > 0 ? Math.round(curRef + (avgEnd - avgRef)) : null,
      };
    }
    return { rows, hist, histAll, activeCount: active.length, summary };
  }, [daily.data, month, paceSel, paceHidden, activeCurrency, isAll, baseCurrency, fxTo]);

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
  // 分类 / 商家下钻: 点一行弹窗列出这个月该分类(含子类)或该商家的每一笔
  const [drill, setDrill] = useState<{ kind: "category" | "merchant"; id: number; name: string; emoji: string } | null>(null);
  const monthRange = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
  }, [month]);
  // 总预算(一条, 本位币, 所有币种支出折算后合计) —— 折叠态也显示, 所以放在 KPI 区
  const budget = useQuery({
    queryKey: ["budget-total", month],
    queryFn: async () => {
      const anchor = month === thisMonth() ? todayIso() : monthRange.end;
      return (await api.get<TotalBudget>(`/budgets/total?on_date=${anchor}`)).data;
    },
  });

  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data, enabled: drill !== null });
  const drillRows = useQuery({
    queryKey: ["stats-drill", drill?.kind, drill?.id, month, activeCurrency],
    enabled: drill !== null,
    queryFn: async () => {
      const p = new URLSearchParams({ start: monthRange.start, end: monthRange.end, kind: "expense", limit: "500" });
      p.set(drill!.kind === "category" ? "category_id" : "merchant_id", String(drill!.id));
      if (activeCurrency) p.set("currency_code", activeCurrency);
      return (await api.get<Transaction[]>(`/transactions?${p}`)).data;
    },
  });
  const drillSorted = useMemo(() => (drillRows.data ?? []).slice().sort((a, b) => b.amount - a.amount), [drillRows.data]);
  const drillTotals = useMemo(() => {
    const per = new Map<string, number>();
    for (const t of drillSorted) per.set(t.currency_code, (per.get(t.currency_code) ?? 0) + t.amount);
    return Array.from(per.entries());
  }, [drillSorted]);

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
            <div className="text-[10px] text-ink-400">{cur.days_elapsed > 0 && cur.days_elapsed < cur.days_in_month ? `按已过 ${cur.days_elapsed} 天` : `月内 ${cur.days_in_month} 天`}</div>
          </div>
        </section>
      )}

      {budget.data && budget.data.amount > 0 && (() => {
        const b = budget.data;
        const pct = Math.round(b.percent * 100);
        const over = b.spent > b.amount;
        // 参照线 = 按你过去几个月的同期, 今天通常已经花到哪 (支出压在月末, 按天数线性会误导)
        const refPct = Math.min(Math.round((b.typical_spent / b.amount) * 100), 100);
        const aheadOfUsual = b.history_months > 0 && b.spent > b.typical_spent;
        const fmt = (v: number) => formatAmount(v, b.currency_code, currencies.data);
        return (
          <section className="mb-5">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-xs text-ink-500">本月预算</span>
              <span className="text-xs text-ink-500">
                <b className="text-sm font-semibold text-ink-900 dark:text-ink-50">{fmt(b.spent)}</b>
                <span className="text-ink-400"> / {fmt(b.amount)}</span>
                <span className={`ml-2 font-semibold ${over ? "text-rose-600" : "text-emerald-600"}`}>{pct}%</span>
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-ink-200 dark:bg-ink-700">
              <div
                className={`absolute left-0 top-0 h-full rounded-full ${over ? "bg-rose-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
              />
              {/* 细竖线 = 按天数走到今天应有的位置, 用来判断花得比时间快还是慢 */}
              <span
                className="absolute -top-1 h-4 w-0.5 rounded bg-ink-400 dark:bg-ink-500"
                style={{ left: `${refPct}%` }}
                title={b.history_months > 0
                  ? `按你过去 ${b.history_months} 个月的同期，到今天通常已花 ${fmt(b.typical_spent)}`
                  : `月内已过 ${b.days_elapsed}/${b.days_in_month} 天（还没有历史可参照）`}
              />
            </div>
            <div className={`mt-1.5 text-[11px] ${over ? "text-rose-600" : "text-ink-400"}`}>
              {over && <>已超 {fmt(b.spent - b.amount)} · </>}
              {b.history_months > 0
                ? <>比往常同期{aheadOfUsual ? "多" : "少"} {fmt(Math.abs(b.spent - b.typical_spent))}，按历史节奏月末约 {fmt(b.projected)}</>
                : <>按当前节奏，月末约 {fmt(b.projected)}</>}
              {b.missing_rate_currencies.length > 0 && (
                <span className="ml-1 text-amber-600">（缺 {b.missing_rate_currencies.join("/")} 汇率，未计入）</span>
              )}
            </div>
          </section>
        );
      })()}

      {!collapsed && (<>
      <section className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium text-ink-600">本月 Top 商家</h2>
          <div className={`${box} divide-y divide-ink-100 p-0`}>
            {topMerchForCurrency.length === 0 && <div className="py-6 text-center text-sm text-ink-500">没有数据</div>}
            {topMerchForCurrency.map((m, i) => (
              <button
                key={m.merchant_id}
                type="button"
                disabled={m.merchant_id == null}
                onClick={() => m.merchant_id != null && setDrill({ kind: "merchant", id: m.merchant_id, name: m.merchant_name, emoji: "" })}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-sm enabled:hover:bg-ink-50 enabled:dark:hover:bg-ink-800/60"
                title={m.merchant_id != null ? "点开看这个月在这家的每一笔" : undefined}
              >
                <div>
                  <div className="font-medium">#{i + 1} {m.merchant_name}</div>
                  <div className="text-xs text-ink-500">{m.count} 笔</div>
                </div>
                <div className="text-rose-600">{formatAmount(m.total, m.currency_code, currencies.data)}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-2 flex flex-wrap items-baseline gap-x-1.5 text-sm font-medium text-ink-600">
            本月分类
            <span className="text-[11px] font-normal text-ink-400">
              {isCurMonthView ? `↑↓ 对比上月 1~${new Date().getDate()} 日同期` : "↑↓ 对比上月整月"}
            </span>
          </h2>
          <div className={`${box} divide-y divide-ink-100 p-0`}>
            {categoryGroups.length === 0 && <div className="py-6 text-center text-sm text-ink-500">没有数据</div>}
            {categoryGroups.map((g) => (
              <div key={g.id ?? `null-${g.name}`} className="px-4 py-2">
                <div
                  role={g.id != null ? "button" : undefined}
                  tabIndex={g.id != null ? 0 : undefined}
                  onClick={() => g.id != null && setDrill({ kind: "category", id: g.id, name: g.name, emoji: g.emoji })}
                  onKeyDown={(e) => { if (g.id != null && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setDrill({ kind: "category", id: g.id, name: g.name, emoji: g.emoji }); } }}
                  className={`flex items-center justify-between rounded text-sm ${g.id != null ? "cursor-pointer hover:bg-ink-100 dark:hover:bg-ink-700/50" : ""}`}
                  title={g.id != null ? "点开看这个月这个大类(含子类)的每一笔" : undefined}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <CategoryIcon name={g.name} emoji={g.emoji} size={15} />
                    <span className="font-medium">{g.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <DeltaTag current={g.total} previous={g.prev} />
                    <span className="font-semibold text-rose-600">{formatAmount(g.total, displayCode, currencies.data)}</span>
                  </div>
                </div>
                {g.children.length > 0 && (
                  <div className="mt-1 space-y-0.5 pl-5">
                    {g.children.map((c) => (
                      <div
                        key={c.id ?? `null-${c.name}`}
                        role={c.id != null ? "button" : undefined}
                        tabIndex={c.id != null ? 0 : undefined}
                        onClick={() => c.id != null && setDrill({ kind: "category", id: c.id, name: c.name, emoji: c.emoji })}
                        onKeyDown={(e) => { if (c.id != null && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setDrill({ kind: "category", id: c.id, name: c.name, emoji: c.emoji }); } }}
                        className={`flex items-center justify-between rounded text-xs text-ink-500 ${c.id != null ? "cursor-pointer hover:bg-ink-100 dark:hover:bg-ink-700/50" : ""}`}
                        title={c.id != null ? "点开看这个月这个小类的每一笔" : undefined}
                      >
                        <span className="flex min-w-0 items-center gap-1.5"><CategoryIcon name={c.name} emoji={c.emoji} size={13} /><span className="truncate">{c.name}</span></span>
                        <span className="flex shrink-0 items-center gap-1">
                          <DeltaTag current={c.amount} previous={c.prev} small />
                          <span>{formatAmount(c.amount, displayCode, currencies.data)}</span>
                        </span>
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
            <p className="text-[11px] text-ink-400">本月（粗红）对照选中的 {pace.hist.length} 个月同期（有数据 {pace.activeCount} 个月）；灰虚线=历史均值，灰带=历史最低~最高</p>
            {pace.summary && (
              <p className="mt-0.5 text-[11px] text-ink-500">
                截至 {pace.summary.refDay} 号：本月 <b className="text-ink-800 dark:text-ink-100">{formatAmount(pace.summary.cur, displayCode, currencies.data)}</b>
                {" · "}均值同期 {formatAmount(pace.summary.avg, displayCode, currencies.data)}
                {pace.summary.pct != null && (
                  <span className={pace.summary.pct > 0 ? "text-rose-600" : "text-emerald-600"}>
                    {" · "}比平均{pace.summary.pct > 0 ? "快" : "慢"} {Math.abs(pace.summary.pct * 100).toFixed(0)}%
                  </span>
                )}
                {pace.summary.projected != null && <>{" · "}按平均节奏月末约 {formatAmount(pace.summary.projected, displayCode, currencies.data)}</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs">
            {([3, 6, 12] as const).map((n) => {
              const on = paceSel.length === n && paceSel.every((x, i) => x === monthsBefore(month, n)[i]);
              return (
                <button
                  key={n}
                  onClick={() => { setPaceSel(monthsBefore(month, n)); setPaceHidden([]); }}
                  className={`rounded-full border px-2.5 py-0.5 ${on ? "border-ink-800 bg-ink-800 text-white dark:border-emerald-500 dark:bg-emerald-600" : "border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300"}`}
                >近 {n} 个月</button>
              );
            })}
            <div className="relative">
              <button
                onClick={() => setPacePick((v) => !v)}
                className="rounded-full border border-ink-200 px-2.5 py-0.5 text-ink-600 hover:border-ink-400 dark:border-ink-700 dark:text-ink-300"
              >选月份 ({paceSel.length})</button>
              {pacePick && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPacePick(false)} />
                  <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-ink-200 bg-white p-2 shadow-lg dark:border-ink-700 dark:bg-ink-800">
                    <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-500">
                      <span>勾选要对照的月份</span>
                      <button onClick={() => { setPaceSel([]); setPaceHidden([]); }} className="hover:text-rose-600">清空</button>
                    </div>
                    <div className="max-h-56 space-y-0.5 overflow-y-auto">
                      {monthsBefore(month, 24).map((lab) => {
                        const on = paceSel.includes(lab);
                        return (
                          <label key={lab} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-ink-50 dark:hover:bg-ink-700/50">
                            <input type="checkbox" checked={on} onChange={() => setPaceSel((prev) => (on ? prev.filter((x) => x !== lab) : [...prev, lab].sort().reverse()))} />
                            {lab}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className={`${box} p-4`}>
          {pace.activeCount === 0 && !pace.rows.some((r) => ((r.current as number | null) ?? 0) > 0) ? (
            <div className="py-10 text-center text-sm text-ink-500">还没有支出数据，记几笔之后这里会画出本月节奏和历史同期对照</div>
          ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={pace.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ececef" />
              <XAxis dataKey="day" fontSize={10} tickFormatter={(d) => `${d} 号`} />
              <YAxis fontSize={10} width={48} tickFormatter={shortNum} />
              <Tooltip
                formatter={(v: number | number[], key: string) => {
                  const f = (x: number) => formatAmount(x, displayCode, currencies.data);
                  if (key === "band") return [Array.isArray(v) ? `${f(v[0])} ~ ${f(v[1])}` : "", "历史区间"];
                  if (key === "avg") return [f(v as number), "历史均值"];
                  const h = pace.hist.find((x) => x.key === key);
                  return [f(v as number), h ? h.label : "本月"];
                }}
                labelFormatter={(d) => `${d} 号`}
              />
              {/* 历史区间带: 各月最低~最高 */}
              <Area type="monotone" dataKey="band" stroke="none" fill="#94a3b8" fillOpacity={0.12} isAnimationActive={false} />
              {/* 历史月: 每月一色但淡化; 图例 hover 只高亮那一个月 */}
              {pace.hist.map((h) => (
                <Line key={h.key} type="monotone" dataKey={h.key} stroke={h.color} strokeWidth={paceHl === h.key ? 2.5 : 1.2}
                  strokeOpacity={paceHl ? (paceHl === h.key ? 1 : 0.12) : 0.4} dot={false} isAnimationActive={false} />
              ))}
              {/* 历史均值: 灰虚线 */}
              <Line type="monotone" dataKey="avg" stroke="#64748b" strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
              {/* 本月: 粗红实线, 压在最上层 */}
              <Line type="monotone" dataKey="current" stroke="#e11d48" strokeWidth={3} dot={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
          )}
          {/* 图例: 色块 = 月份 */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: "#e11d48" }} />
              <span className="font-medium">本月</span>
            </span>
            <span className="flex items-center gap-1 text-ink-500">
              <span className="inline-block h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: "#64748b" }} />
              历史均值
            </span>
            <span className="flex items-center gap-1 text-ink-500">
              <span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: "rgba(148,163,184,0.3)" }} />
              历史区间
            </span>
            {pace.histAll.map((h) => {
              const off = paceHidden.includes(h.label);
              return (
                <button
                  key={h.key}
                  type="button"
                  onMouseEnter={() => setPaceHl(h.key)}
                  onMouseLeave={() => setPaceHl(null)}
                  onClick={() => setPaceHidden((prev) => (off ? prev.filter((x) => x !== h.label) : [...prev, h.label]))}
                  title={off ? "点一下加回对照" : "点一下从对照里去掉(均值/区间同步重算)"}
                  className={`flex items-center gap-1 rounded px-0.5 hover:bg-ink-100 dark:hover:bg-ink-700/50 ${off ? "text-ink-400 line-through" : paceHl === h.key ? "text-ink-800 dark:text-ink-100" : "text-ink-500"}`}
                >
                  <span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: h.color, opacity: off ? 0.25 : paceHl && paceHl !== h.key ? 0.3 : 1 }} />
                  {h.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      </>)}

      {drill && (
        <Modal onClose={() => setDrill(null)} maxW="max-w-2xl" title={
          <span className="flex flex-wrap items-baseline gap-1.5">
            <span className="flex items-center gap-1.5"><CategoryIcon name={drill.kind === "category" ? drill.name : undefined} emoji={drill.emoji} size={16} />{drill.name}</span>
            <span className="text-xs font-normal text-ink-500">
              {month} · {drill.kind === "category" ? "该分类(含子类)" : "该商家"}的支出
              {activeCurrency ? ` · 仅 ${activeCurrency}` : ""}
            </span>
          </span>
        }>
          {drillRows.isPending && <div className="py-8 text-center text-sm text-ink-500">加载中…</div>}
          {!drillRows.isPending && drillSorted.length === 0 && (
            <div className="py-8 text-center text-sm text-ink-500">这个月没有记录</div>
          )}
          {drillSorted.length > 0 && (
            <>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-ink-500">{drillSorted.length} 笔 · 按金额从大到小</span>
                <span className="flex flex-wrap gap-2 font-semibold text-rose-600">
                  {drillTotals.map(([code, amt]) => <span key={code}>{formatAmount(amt, code, currencies.data)}</span>)}
                </span>
              </div>
              <div className="max-h-[60vh] divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
                {drillSorted.map((t) => {
                  const mName = t.merchant_id != null ? merchants.data?.find((x) => x.id === t.merchant_id)?.name : "";
                  const cName = t.category_id != null ? categories.data?.find((x) => x.id === t.category_id)?.name : "未分类";
                  const side = drill.kind === "category" ? (mName || "") : (cName || "");
                  return (
                    <div key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{side || t.note || "(无商家)"}</div>
                        <div className="truncate text-xs text-ink-500">
                          {t.occurred_on}{side && t.note ? ` · ${t.note}` : ""}
                        </div>
                      </div>
                      <span className="shrink-0 text-rose-600">{formatAmount(t.amount, t.currency_code, currencies.data)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

// 分类同比上月小标: 支出涨=红 / 降=绿; 上月为 0 显示"新"; 倍率过大截到 999%+
function DeltaTag({ current, previous, small }: { current: number; previous: number; small?: boolean }) {
  const size = small ? "text-[10px]" : "text-[11px]";
  if (previous <= 0) return current > 0 ? <span className={`${size} text-ink-400`}>新</span> : null;
  const delta = current - previous;
  if (delta === 0) return <span className={`${size} text-ink-400`}>持平</span>;
  const pct = Math.abs(delta / previous) * 100;
  const Trend = delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`flex items-center gap-0.5 tabular-nums ${size} ${delta > 0 ? "text-rose-600" : "text-emerald-600"}`}>
      <Trend size={small ? 9 : 10} />{pct > 999 ? "999%+" : `${pct.toFixed(0)}%`}
    </span>
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
          <span className="text-ink-400">vs 上月同期</span>
        </div>
      )}
    </div>
  );
}

