import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api, type Currency } from "../lib/api";
import { formatAmount, monthLabel } from "../lib/format";

interface Item {
  transaction_id: number;
  occurred_on: string;
  name: string;
  category_id: number | null;
  category_name: string;
  category_emoji: string;
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

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function Recurring() {
  const [month, setMonth] = useState(thisMonth());
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
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input w-40" />
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
          {m?.monthly_items.map((it) => (
            <div key={it.transaction_id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span>{it.category_emoji}</span>
                  <span className="font-medium">{it.name}</span>
                  <span className="text-xs text-ink-500">· {it.category_name}</span>
                </div>
                <div className="text-xs text-ink-500">{it.occurred_on} · {it.wallet_name}</div>
              </div>
              <div className="shrink-0 font-semibold text-rose-600">
                {formatAmount(it.amount, it.currency_code, currencies.data)}
              </div>
            </div>
          ))}
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
          {m?.yearly_items.map((it) => (
            <div key={it.transaction_id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span>{it.category_emoji}</span>
                  <span className="font-medium">{it.name}</span>
                  <span className="text-xs text-ink-500">· {it.category_name}</span>
                </div>
                <div className="text-xs text-ink-500">{it.occurred_on} · {it.wallet_name}</div>
              </div>
              <div className="shrink-0 font-semibold text-rose-600">
                {formatAmount(it.amount, it.currency_code, currencies.data)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
