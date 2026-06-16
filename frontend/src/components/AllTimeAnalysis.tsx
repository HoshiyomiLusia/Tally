import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { api, type Currency } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatAmount } from "../lib/format";
import Modal from "./Modal";

interface MonthlyPoint { month: string; currency_code: string; income: number; expense: number; }
interface CatMonthly { month: string; category_name: string; emoji: string; parent_name: string; parent_emoji: string; is_leaf: boolean; currency_code: string; expense: number; }
interface MerchantTotal { merchant_name: string; currency_code: string; expense: number; count: number; }
interface Lifetime { monthly: MonthlyPoint[]; category_monthly: CatMonthly[]; merchants: MerchantTotal[]; }
interface MRow { income: number; expense: number }

type Metric = "expense" | "income" | "net";
const METRICS: { k: Metric; label: string; color: string }[] = [
  { k: "expense", label: "支出", color: "#e11d48" },
  { k: "income", label: "收入", color: "#10b981" },
  { k: "net", label: "净额", color: "#6366f1" },
];
const ALL = "__all__";

function shortNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(1) + "亿";
  if (a >= 1e4) return (v / 1e4).toFixed(0) + "万";
  if (a >= 1e3) return (v / 1e3).toFixed(0) + "k";
  return String(Math.round(v));
}

export default function AllTimeAnalysis({ onClose }: { onClose: () => void }) {
  const lt = useQuery({ queryKey: ["stats-lifetime"], queryFn: async () => (await api.get<Lifetime>("/stats/lifetime")).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: async () => (await api.get<{ base: string; quote: string; rate: number }[]>("/exchange-rates")).data });
  const { user } = useAuth();
  const baseCur = user?.primary_currency_code || localStorage.getItem("tally.baseCurrency") || "JPY";

  const fold = useMemo(() => {
    const digits = new Map((currencies.data ?? []).map((c) => [c.code, c.decimal_digits]));
    const rateMap = new Map<string, number>();
    for (const r of rates.data ?? []) if (!rateMap.has(`${r.base}->${r.quote}`)) rateMap.set(`${r.base}->${r.quote}`, r.rate);
    return (amt: number, from: string) => {
      if (from === baseCur) return amt;
      const fd = digits.get(from) ?? 2, td = digits.get(baseCur) ?? 2;
      let rate = rateMap.get(`${from}->${baseCur}`);
      if (rate == null) { const rev = rateMap.get(`${baseCur}->${from}`); rate = rev ? 1 / rev : 0; }
      return Math.round(amt * rate * Math.pow(10, td - fd));
    };
  }, [currencies.data, rates.data, baseCur]);

  const curs = useMemo(() => {
    const tot = new Map<string, number>();
    for (const p of lt.data?.monthly ?? []) tot.set(p.currency_code, (tot.get(p.currency_code) ?? 0) + p.expense);
    return [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [lt.data]);

  const [curState, setCur] = useState<string | null>(null);
  const cur = curState ?? ALL;
  const agg = cur === ALL;
  const dispCur = agg ? baseCur : cur;
  const digits = currencies.data?.find((c) => c.code === dispCur)?.decimal_digits ?? 2;
  const [metric, setMetric] = useState<Metric>("expense");
  const [range, setRange] = useState<string>("all");

  const years = useMemo(() => {
    const ys = new Set<string>();
    for (const p of lt.data?.monthly ?? []) if (agg || p.currency_code === cur) ys.add(p.month.slice(0, 4));
    return [...ys].sort().reverse();
  }, [lt.data, cur, agg]);

  const mc = METRICS.find((m) => m.k === metric)!;

  const view = useMemo(() => {
    const conv = (amt: number, from: string) => (agg ? fold(amt, from) : amt);
    const mMap = new Map<string, MRow>();
    for (const p of lt.data?.monthly ?? []) {
      if (!agg && p.currency_code !== cur) continue;
      const e = mMap.get(p.month) ?? { income: 0, expense: 0 };
      e.income += conv(p.income, p.currency_code);
      e.expense += conv(p.expense, p.currency_code);
      mMap.set(p.month, e);
    }
    const all = [...mMap.entries()].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));
    const allMonths = all.map((p) => p.month);
    const cutoff = allMonths.length > 12 ? allMonths[allMonths.length - 12] : (allMonths[0] ?? "");
    const inRange = (m: string) => (range === "all" ? true : range === "12m" ? m >= cutoff : m.startsWith(range + "-"));
    const months = all.filter((p) => inRange(p.month));
    const mv = (p: MRow) => (metric === "expense" ? p.expense : metric === "income" ? p.income : p.income - p.expense);

    const totExp = months.reduce((s, p) => s + p.expense, 0);
    const totInc = months.reduce((s, p) => s + p.income, 0);
    const withVal = months.filter((p) => mv(p) !== 0);
    const n = withVal.length || 1;
    const sumMetric = months.reduce((s, p) => s + mv(p), 0);
    const maxP = withVal.reduce<(MRow & { month: string }) | null>((a, b) => (a === null || mv(b) > mv(a) ? b : a), null);
    const minP = withVal.reduce<(MRow & { month: string }) | null>((a, b) => (a === null || mv(b) < mv(a) ? b : a), null);
    const chart = months.map((p) => ({ m: p.month.slice(2), v: mv(p) / Math.pow(10, digits) }));

    type CatGroup = { name: string; emoji: string; own: number; total: number; children: { name: string; emoji: string; amt: number }[] };
    const gmap = new Map<string, CatGroup>();
    let catTotal = 0;
    for (const c of lt.data?.category_monthly ?? []) {
      if ((!agg && c.currency_code !== cur) || !inRange(c.month)) continue;
      const amt = conv(c.expense, c.currency_code);
      catTotal += amt;
      let g = gmap.get(c.parent_name);
      if (!g) { g = { name: c.parent_name, emoji: c.parent_emoji, own: 0, total: 0, children: [] }; gmap.set(c.parent_name, g); }
      g.total += amt;
      if (c.is_leaf) {
        const ex = g.children.find((x) => x.name === c.category_name);
        if (ex) ex.amt += amt; else g.children.push({ name: c.category_name, emoji: c.emoji, amt });
      } else {
        g.own += amt;
      }
    }
    const cats = [...gmap.values()].map((g) => ({ ...g, children: g.children.sort((a, b) => b.amt - a.amt) })).sort((a, b) => b.total - a.total);
    const catTotalSafe = catTotal || 1;

    const merMap = new Map<string, { amt: number; count: number }>();
    for (const m of lt.data?.merchants ?? []) {
      if (!agg && m.currency_code !== cur) continue;
      const e = merMap.get(m.merchant_name) ?? { amt: 0, count: 0 };
      e.amt += conv(m.expense, m.currency_code); e.count += m.count; merMap.set(m.merchant_name, e);
    }
    const mers = [...merMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amt - a.amt).slice(0, 8);

    return { months, totExp, totInc, n, avg: Math.round(sumMetric / n), maxP, minP, mv, chart, cats, catTotal: catTotalSafe, mers };
  }, [lt.data, cur, agg, range, metric, digits, fold]);

  const fmt = (a: number) => formatAmount(a, dispCur, currencies.data);
  const curItems = [{ k: ALL, label: `汇总·${baseCur}` }, ...curs.map((c) => ({ k: c, label: c }))];

  return (
    <Modal onClose={onClose} title="总分析 · 至今" maxW="max-w-4xl">
      {lt.isLoading && <div className="py-12 text-center text-sm text-ink-500">加载中…</div>}
      {!lt.isLoading && curs.length === 0 && <div className="py-12 text-center text-sm text-ink-500">还没有数据</div>}

      {curs.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-ink-50 p-2.5 dark:bg-ink-800/40">
            <ChipRow label="币种" items={curItems} active={cur} onPick={(k) => { setCur(k); setRange("all"); }} />
            <ChipRow label="指标" items={METRICS.map((m) => ({ k: m.k, label: m.label }))} active={metric} onPick={(k) => setMetric(k as Metric)} />
            <ChipRow label="范围" items={[{ k: "all", label: "全部" }, { k: "12m", label: "近12月" }, ...years.map((y) => ({ k: y, label: y }))]} active={range} onPick={setRange} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="总支出" v={fmt(view.totExp)} big tone="rose" />
            <Kpi label="总收入" v={fmt(view.totInc)} tone="emerald" />
            <Kpi label="净额" v={fmt(view.totInc - view.totExp)} tone={view.totInc - view.totExp < 0 ? "rose" : "emerald"} />
            <Kpi label={`月均${mc.label}`} v={fmt(view.avg)} />
            <Kpi label="最高月" v={view.maxP ? `${view.maxP.month.slice(2)} ${fmt(view.mv(view.maxP))}` : "—"} small />
            <Kpi label="最低月" v={view.minP ? `${view.minP.month.slice(2)} ${fmt(view.mv(view.minP))}` : "—"} small />
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-ink-500">逐月{mc.label}趋势（{view.months.length} 个月{agg ? `· 折${baseCur}` : ""}）</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={view.chart} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ececef" className="dark:opacity-10" />
                <XAxis dataKey="m" fontSize={9} interval={Math.max(0, Math.floor(view.chart.length / 12))} tick={{ fill: "#9ca3af" }} />
                <YAxis fontSize={9} width={44} tickFormatter={shortNum} tick={{ fill: "#9ca3af" }} />
                <Tooltip
                  formatter={(v: number) => [fmt(Math.round(v * Math.pow(10, digits))), mc.label]}
                  labelFormatter={(l) => `20${l}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="v" radius={[2, 2, 0, 0]}>
                  {view.chart.map((d, i) => <Cell key={i} fill={d.v < 0 ? "#e11d48" : mc.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-500">支出分类 Top（区间内{agg ? `· 折${baseCur}` : ""}）</div>
              <div className="space-y-1.5">
                {view.cats.length === 0 && <div className="py-4 text-center text-xs text-ink-400">无</div>}
                {view.cats.map((g) => (
                  <div key={g.name}>
                    <div className="relative overflow-hidden rounded-md bg-ink-50 px-2 py-1.5 dark:bg-ink-800/40">
                      <div className="absolute inset-y-0 left-0 bg-rose-500/15" style={{ width: `${(g.total / view.catTotal) * 100}%` }} />
                      <div className="relative flex items-center justify-between gap-2 text-xs font-medium">
                        <span className="truncate">{g.emoji} {g.name}</span>
                        <span className="shrink-0 tabular-nums">{fmt(g.total)} <span className="text-ink-400">{((g.total / view.catTotal) * 100).toFixed(0)}%</span></span>
                      </div>
                    </div>
                    {(g.children.length > 0 || g.own > 0) && (
                      <div className="mt-0.5 space-y-0.5 pl-3">
                        {g.children.map((ch) => (
                          <div key={ch.name} className="flex items-center justify-between gap-2 text-[11px] text-ink-500">
                            <span className="truncate">{ch.emoji} {ch.name}</span>
                            <span className="shrink-0 tabular-nums">{fmt(ch.amt)}</span>
                          </div>
                        ))}
                        {g.own > 0 && (
                          <div className="flex items-center justify-between gap-2 text-[11px] text-ink-400">
                            <span>· 未细分</span><span className="tabular-nums">{fmt(g.own)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-500">Top 商家（全时段{agg ? `· 折${baseCur}` : ""}）</div>
              <div className="space-y-1">
                {view.mers.length === 0 && <div className="py-4 text-center text-xs text-ink-400">无</div>}
                {view.mers.map((m, i) => (
                  <div key={m.name} className="flex items-center justify-between gap-2 rounded-md bg-ink-50 px-2 py-1.5 text-xs dark:bg-ink-800/40">
                    <span className="truncate"><span className="text-ink-400">#{i + 1}</span> {m.name} <span className="text-ink-400">· {m.count}笔</span></span>
                    <span className="shrink-0 tabular-nums">{fmt(m.amt)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ChipRow({ label, items, active, onPick }: { label: string; items: { k: string; label: string }[]; active: string; onPick: (k: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((it) => (
          <button
            key={it.k}
            type="button"
            onClick={() => onPick(it.k)}
            className={active === it.k
              ? "rounded-md bg-ink-800 px-2 py-1 text-xs font-medium text-white dark:bg-emerald-600"
              : "rounded-md bg-white px-2 py-1 text-xs text-ink-600 hover:bg-ink-100 dark:bg-ink-700/40 dark:text-ink-300 dark:hover:bg-ink-700"}
          >{it.label}</button>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, v, big, small, tone }: { label: string; v: string; big?: boolean; small?: boolean; tone?: "rose" | "emerald" }) {
  const c = tone === "rose" ? "text-rose-600 dark:text-rose-400" : tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="rounded-lg bg-ink-50 p-2.5 dark:bg-ink-800/40">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`tabular-nums font-semibold ${big ? "text-lg" : small ? "text-xs" : "text-sm"} ${c}`}>{v}</div>
    </div>
  );
}
