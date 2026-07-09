import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { api, type Currency } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatAmount } from "../lib/format";

type Fold = (amt: number, from: string) => number;

// 上一个自然月 "YYYY-MM"
function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${d.y}-${String(d.m).padStart(2, "0")}`;
}

// 去年同月 "YYYY-MM" (年度账单按年对照)
function prevYear(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y - 1}-${String(m).padStart(2, "0")}`;
}

// 同一周期项的匹配键: 商家+分类+币种.
// 不含钱包 —— 同一笔订阅/固定账单换张卡付, 仍是同一笔, 不该算成两笔(否则本月/上月对照会错配成"上月无").
function itemKey(it: Item): string {
  return `${it.merchant_id ?? "x"}-${it.category_id ?? "x"}-${it.currency_code}`;
}

interface Item {
  transaction_id: number;
  occurred_on: string;
  name: string;
  category_id: number | null;
  category_name: string;
  category_emoji: string;
  merchant_id: number | null;
  merchant_name: string;
  note: string;
  wallet_id: number;
  wallet_name: string;
  currency_code: string;
  amount: number;
  frequency: "monthly" | "yearly" | "other";
}

interface MonthlyResp {
  month: string;
  monthly_items: Item[];
  yearly_items: Item[];
  monthly_totals: Record<string, number>;
  yearly_totals: Record<string, number>;
}

type SortKey = "date_asc" | "date_desc" | "amount_desc" | "amount_asc";
// 顺序即 chip 渲染顺序; 第一个 (日期↑) 也是默认值
const SORT_LABEL: Record<SortKey, string> = {
  date_asc: "日期 ↑",
  date_desc: "日期 ↓",
  amount_desc: "金额 ↓",
  amount_asc: "金额 ↑",
};

function sortItems(items: Item[], sort: SortKey): Item[] {
  const copy = [...items];
  copy.sort((a, b) => {
    if (sort === "date_desc") return a.occurred_on < b.occurred_on ? 1 : -1;
    if (sort === "date_asc") return a.occurred_on < b.occurred_on ? -1 : 1;
    if (sort === "amount_desc") return b.amount - a.amount;
    return a.amount - b.amount;
  });
  return copy;
}

function renderRow(it: Item, prevAmount: number | undefined, fold: Fold, base: string, currencies?: Currency[], hideDelta = false, cmpLabel = "上月") {
  const primary = it.merchant_name || it.note || it.category_name;
  const showCategorySub = primary !== it.category_name && !!it.category_name;
  const foreign = it.currency_code !== base;
  const curBase = fold(it.amount, it.currency_code);
  const prevBase = prevAmount != null ? fold(prevAmount, it.currency_code) : null;
  const delta = prevBase != null ? curBase - prevBase : null;
  return (
    <div key={it.transaction_id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span>{it.category_emoji}</span>
          <span className="truncate font-medium">{primary}</span>
          {showCategorySub && <span className="truncate text-xs text-ink-500">· {it.category_name}</span>}
        </div>
        <div className="text-xs text-ink-500">{it.occurred_on} · {it.wallet_name}{it.merchant_name && it.note ? ` · ${it.note}` : ""}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-semibold text-rose-600">{formatAmount(curBase, base, currencies)}</div>
        {foreign && (
          <div className="text-[10px] text-ink-400">{it.currency_code} {formatAmount(it.amount, it.currency_code, currencies)}</div>
        )}
        {hideDelta ? null : prevAmount == null ? (
          <div className="text-[10px] text-amber-600 dark:text-amber-400">{cmpLabel}无</div>
        ) : delta !== 0 ? (
          <div className={`text-[10px] ${delta! > 0 ? "text-rose-500" : "text-emerald-600"}`}>
            {cmpLabel} {formatAmount(prevBase!, base, currencies)} · {delta! > 0 ? "+" : "−"}{formatAmount(Math.abs(delta!), base, currencies)}
          </div>
        ) : (
          <div className="text-[10px] text-ink-400">与{cmpLabel}持平</div>
        )}
      </div>
    </div>
  );
}

export default function RecurringPanel({ month }: { month: string }) {
  const [sort, setSort] = useState<SortKey>("date_asc");
  const data = useQuery({
    queryKey: ["recurring-by-month", month],
    queryFn: async () => (await api.get<MonthlyResp>(`/recurring/by-month?month=${month}`)).data,
  });
  const prev = prevMonth(month);
  const prevData = useQuery({
    queryKey: ["recurring-by-month", prev],
    queryFn: async () => (await api.get<MonthlyResp>(`/recurring/by-month?month=${prev}`)).data,
  });
  const lastYear = prevYear(month);
  const lastYearData = useQuery({
    queryKey: ["recurring-by-month", lastYear],
    queryFn: async () => (await api.get<MonthlyResp>(`/recurring/by-month?month=${lastYear}`)).data,
  });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: async () => (await api.get<{ base: string; quote: string; rate: number }[]>("/exchange-rates")).data });

  const { user } = useAuth();
  const base = user?.primary_currency_code || localStorage.getItem("tally.baseCurrency") || "JPY";
  // 周期账单一律折算到主币种展示 (JPY/CNY 符号都是 ¥, 分币种写会混)
  const foldToBase = useMemo<Fold>(() => {
    const digits = new Map((currencies.data ?? []).map((c) => [c.code, c.decimal_digits]));
    const rateMap = new Map<string, number>();
    for (const r of rates.data ?? []) if (!rateMap.has(`${r.base}->${r.quote}`)) rateMap.set(`${r.base}->${r.quote}`, r.rate);
    return (amt, from) => {
      if (from === base) return amt;
      const fd = digits.get(from) ?? 2, td = digits.get(base) ?? 2;
      let rate = rateMap.get(`${from}->${base}`);
      if (rate == null) { const rev = rateMap.get(`${base}->${from}`); rate = rev ? 1 / rev : 0; }
      return Math.round(amt * rate * Math.pow(10, td - fd));
    };
  }, [currencies.data, rates.data, base]);

  // 上月同项金额映射 (key -> amount), 给每条找上月对照
  const prevMonthlyMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of prevData.data?.monthly_items ?? []) map.set(itemKey(it), it.amount);
    return map;
  }, [prevData.data]);
  const prevYearlyMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of lastYearData.data?.yearly_items ?? []) map.set(itemKey(it), it.amount);
    return map;
  }, [lastYearData.data]);

  const m = data.data;
  const p = prevData.data;
  const prevLabel = `${Number(prev.split("-")[1])} 月`;
  const curLabel = `${Number(month.split("-")[1])} 月`;
  const ly = lastYearData.data;
  const curYearLabel = `${month.split("-")[0]} 年`;
  const lastYearLabel = `${Number(month.split("-")[0]) - 1} 年`;

  // 一列: 标题 + 合计卡 + 列表 (本月带上月对照 delta; 上月纯列表)
  function column(
    title: string,
    items: Item[] | undefined,
    totals: Record<string, number> | undefined,
    prevAmtMap: Map<string, number> | null,
    emptyText: string,
    cmpLabel = "上月",
  ) {
    return (
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <h4 className="text-xs font-semibold text-ink-600">{title}</h4>
          <span className="text-[11px] text-ink-400">{items ? `${items.length} 笔` : ""}</span>
        </div>
        {totals && Object.keys(totals).length > 0 && (() => {
          const baseTotal = Object.entries(totals).reduce((s, [code, total]) => s + foldToBase(total, code), 0);
          const foreign = Object.keys(totals).filter((c) => c !== base);
          return (
            <div className="mb-1.5 flex items-baseline justify-between rounded-md bg-ink-50 px-3 py-1.5 dark:bg-ink-800/40">
              <span className="text-xs text-ink-500">合计</span>
              <div className="text-right">
                <span className="text-sm font-semibold">{formatAmount(baseTotal, base, currencies.data)}</span>
                {foreign.length > 0 && (
                  <span className="ml-1.5 text-[10px] text-ink-400">
                    (含 {foreign.map((c) => `${c} ${formatAmount(totals[c], c, currencies.data)}`).join(" + ")})
                  </span>
                )}
              </div>
            </div>
          );
        })()}
        <div className="card divide-y divide-ink-100 p-0">
          {(!items || items.length === 0) && (
            <div className="px-4 py-6 text-center text-sm text-ink-500">{emptyText}</div>
          )}
          {items && sortItems(items, sort).map((it) =>
            renderRow(it, prevAmtMap ? prevAmtMap.get(itemKey(it)) : undefined, foldToBase, base, currencies.data, !prevAmtMap, cmpLabel),
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
        <span className="text-ink-500">排序</span>
        {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setSort(k)}
            className={`rounded-full border px-2.5 py-0.5 ${sort === k ? "border-ink-800 bg-ink-800 text-white dark:border-emerald-500 dark:bg-emerald-600" : "border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300"}`}
          >{SORT_LABEL[k]}</button>
        ))}
      </div>

      <div className="mb-4">
        <h3 className="mb-2 text-sm font-medium text-ink-600">月度账单 · 本月 vs 上月</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {column(`本月 (${curLabel})`, m?.monthly_items, m?.monthly_totals, prevMonthlyMap, "本月还没有月度账单")}
          {column(`上月 (${prevLabel})`, p?.monthly_items, p?.monthly_totals, null, "上月没有月度账单")}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-ink-600">年度账单 · 本年 vs 去年</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {column(`本年 (${curYearLabel})`, m?.yearly_items, m?.yearly_totals, prevYearlyMap, "今年没有年度账单", "去年")}
          {column(`去年 (${lastYearLabel})`, ly?.yearly_items, ly?.yearly_totals, null, "去年没有年度账单", "去年")}
        </div>
      </div>
    </div>
  );
}
