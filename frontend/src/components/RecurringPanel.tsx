import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { api, type Currency } from "../lib/api";
import { formatAmount } from "../lib/format";

// 上一个自然月 "YYYY-MM"
function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${d.y}-${String(d.m).padStart(2, "0")}`;
}

// 同一周期项的匹配键: 商家+分类+钱包+币种
function itemKey(it: Item): string {
  return `${it.merchant_id ?? "x"}-${it.category_id ?? "x"}-${it.wallet_id}-${it.currency_code}`;
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

type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
const SORT_LABEL: Record<SortKey, string> = {
  date_desc: "日期 ↓",
  date_asc: "日期 ↑",
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

function renderRow(it: Item, prevAmount: number | undefined, currencies?: Currency[]) {
  const primary = it.merchant_name || it.note || it.category_name;
  const showCategorySub = primary !== it.category_name && !!it.category_name;
  const delta = prevAmount != null ? it.amount - prevAmount : null;
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
        <div className="font-semibold text-rose-600">{formatAmount(it.amount, it.currency_code, currencies)}</div>
        {prevAmount == null ? (
          <div className="text-[10px] text-amber-600 dark:text-amber-400">上月无</div>
        ) : delta !== 0 ? (
          <div className={`text-[10px] ${delta! > 0 ? "text-rose-500" : "text-emerald-600"}`}>
            上月 {formatAmount(prevAmount, it.currency_code, currencies)} · {delta! > 0 ? "+" : "−"}{formatAmount(Math.abs(delta!), it.currency_code, currencies)}
          </div>
        ) : (
          <div className="text-[10px] text-ink-400">与上月持平</div>
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
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

  // 上月同项金额映射 (key -> amount), 给每条找上月对照
  const prevMonthlyMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of prevData.data?.monthly_items ?? []) map.set(itemKey(it), it.amount);
    return map;
  }, [prevData.data]);
  const prevYearlyMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of prevData.data?.yearly_items ?? []) map.set(itemKey(it), it.amount);
    return map;
  }, [prevData.data]);

  const m = data.data;
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
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-medium text-ink-600">月度账单</h3>
          <span className="text-xs text-ink-500">{m ? `${m.monthly_items.length} 笔` : ""}</span>
        </div>
        {m && Object.keys(m.monthly_totals).length > 0 && (
          <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {Object.entries(m.monthly_totals).map(([code, total]) => {
              const ptotal = prevData.data?.monthly_totals[code] ?? 0;
              const d = total - ptotal;
              return (
                <div key={code} className="card">
                  <div className="text-xs text-ink-500">{code} 本月月度合计</div>
                  <div className="mt-1 text-lg font-semibold">{formatAmount(total, code, currencies.data)}</div>
                  <div className={`text-[11px] ${d > 0 ? "text-rose-500" : d < 0 ? "text-emerald-600" : "text-ink-400"}`}>
                    上月 {formatAmount(ptotal, code, currencies.data)}{d !== 0 && ` · ${d > 0 ? "+" : "−"}${formatAmount(Math.abs(d), code, currencies.data)}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="card divide-y divide-ink-100 p-0">
          {(!m || m.monthly_items.length === 0) && (
            <div className="px-4 py-6 text-center text-sm text-ink-500">本月还没有月度账单</div>
          )}
          {m && sortItems(m.monthly_items, sort).map((it) => renderRow(it, prevMonthlyMap.get(itemKey(it)), currencies.data))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-medium text-ink-600">年度账单</h3>
          <span className="text-xs text-ink-500">{m ? `${m.yearly_items.length} 笔` : ""}</span>
        </div>
        {m && Object.keys(m.yearly_totals).length > 0 && (
          <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {Object.entries(m.yearly_totals).map(([code, total]) => (
              <div key={code} className="card">
                <div className="text-xs text-ink-500">{code} 本年年度合计</div>
                <div className="mt-1 text-lg font-semibold">{formatAmount(total, code, currencies.data)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="card divide-y divide-ink-100 p-0">
          {(!m || m.yearly_items.length === 0) && (
            <div className="px-4 py-6 text-center text-sm text-ink-500">本年还没有年度账单</div>
          )}
          {m && sortItems(m.yearly_items, sort).map((it) => renderRow(it, prevYearlyMap.get(itemKey(it)), currencies.data))}
        </div>
      </div>
    </div>
  );
}
