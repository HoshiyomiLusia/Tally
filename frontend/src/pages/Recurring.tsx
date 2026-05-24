import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import MonthPicker from "../components/MonthPicker";
import { api, type Currency } from "../lib/api";
import { formatAmount, monthLabel } from "../lib/format";

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

function renderRow(it: Item, currencies?: Currency[]) {
  // 主标题用商家名 (或备注), 副标 = 分类. 没商家也没备注就只显示分类
  const primary = it.merchant_name || it.note || it.category_name;
  const showCategorySub = primary !== it.category_name && !!it.category_name;
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
      <div className="shrink-0 font-semibold text-rose-600">
        {formatAmount(it.amount, it.currency_code, currencies)}
      </div>
    </div>
  );
}

interface MonthlyResp {
  month: string;
  monthly_items: Item[];
  yearly_items: Item[];
  monthly_totals: Record<string, number>;
  yearly_totals: Record<string, number>;
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

export default function Recurring() {
  const [month, setMonth] = useState(thisMonth());
  const [sort, setSort] = useState<SortKey>("date_asc");
  const data = useQuery({
    queryKey: ["recurring-by-month", month],
    queryFn: async () => (await api.get<MonthlyResp>(`/recurring/by-month?month=${month}`)).data,
  });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

  const m = data.data;
  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">周期账单</h1>
          <p className="text-sm text-ink-500">把房租 / 订阅 / 水电 这类有规律的支出标记为月度或年度，这里集中看</p>
        </div>
        <MonthPicker value={month} onChange={setMonth} />
      </div>

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

      <section className="mb-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-ink-600">{monthLabel(month)} · 月度账单</h2>
          <span className="text-xs text-ink-500">{m ? `${m.monthly_items.length} 笔` : ""}</span>
        </div>
        {m && Object.keys(m.monthly_totals).length > 0 && (
          <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {Object.entries(m.monthly_totals).map(([code, total]) => (
              <div key={code} className="card">
                <div className="text-xs text-ink-500">{code} 本月月度合计</div>
                <div className="mt-1 text-lg font-semibold">{formatAmount(total, code, currencies.data)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="card divide-y divide-ink-100 p-0">
          {(!m || m.monthly_items.length === 0) && (
            <div className="px-4 py-6 text-center text-sm text-ink-500">本月还没有月度账单</div>
          )}
          {m && sortItems(m.monthly_items, sort).map((it) => renderRow(it, currencies.data))}
        </div>
      </section>

      <section className="mb-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-ink-600">{month.slice(0, 4)} 年 · 年度账单</h2>
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
          {m && sortItems(m.yearly_items, sort).map((it) => renderRow(it, currencies.data))}
        </div>
      </section>
    </div>
  );
}
