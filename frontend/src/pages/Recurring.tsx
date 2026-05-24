import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { api, type Currency } from "../lib/api";
import { formatAmount } from "../lib/format";

interface RecurringGroup {
  group_id: string | null;
  representative_id: number;
  name: string;
  category_id: number | null;
  category_name: string;
  category_emoji: string;
  wallet_id: number;
  wallet_name: string;
  currency_code: string;
  period_days: number | null;
  count: number;
  total_amount: number;
  avg_amount: number;
  last_amount: number;
  last_on: string;
  next_due: string | null;
}

function daysFromNow(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - today.getTime()) / 86400000);
}

export default function Recurring() {
  const groups = useQuery({ queryKey: ["recurring-groups"], queryFn: async () => (await api.get<RecurringGroup[]>("/recurring/groups")).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

  const list = groups.data ?? [];

  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of list) {
      if (g.period_days) {
        const monthly = Math.round(g.avg_amount * 30 / g.period_days);
        m.set(g.currency_code, (m.get(g.currency_code) ?? 0) + monthly);
      }
    }
    return Array.from(m.entries());
  }, [list]);

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">周期账单</h1>
        <p className="text-sm text-ink-500">所有被标记为周期的支出 · 没填周期的只是标记不提醒</p>
      </div>

      {totals.length > 0 && (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {totals.map(([code, monthly]) => (
            <div key={code} className="card">
              <div className="text-xs text-ink-500">预估月度支出 · {code}</div>
              <div className="mt-1 text-lg font-semibold">{formatAmount(monthly, code, currencies.data)}</div>
              <div className="text-[10px] text-ink-400">按各项均值与周期折算到 30 天</div>
            </div>
          ))}
        </div>
      )}

      <div className="card divide-y divide-ink-100 p-0">
        {list.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-ink-500">
            还没有标记为周期的账单。<br />
            添加交易时勾选"标记为周期账单"即可出现在这里。
          </div>
        )}
        {list.map((g) => {
          const dueIn = daysFromNow(g.next_due);
          const overdue = dueIn !== null && dueIn < 0;
          const soon = dueIn !== null && dueIn >= 0 && dueIn <= 7;
          return (
            <div key={`${g.group_id ?? g.representative_id}`} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span>{g.category_emoji}</span>
                    <span className="font-medium">{g.name}</span>
                    <span className="text-xs text-ink-500">· {g.category_name}</span>
                  </div>
                  <div className="text-xs text-ink-500">
                    {g.wallet_name} · 共 {g.count} 笔 · 均 {formatAmount(g.avg_amount, g.currency_code, currencies.data)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold">{formatAmount(g.last_amount, g.currency_code, currencies.data)}</div>
                  <div className="text-[10px] text-ink-400">上次 {g.last_on}</div>
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px]">
                {g.period_days ? (
                  <>
                    <span className="text-ink-500">周期 {g.period_days} 天</span>
                    {g.next_due ? (
                      <span className={overdue ? "text-rose-600" : soon ? "text-amber-600" : "text-ink-500"}>
                        下次约 {g.next_due}
                        {dueIn !== null && (
                          <span className="ml-1">
                            ({overdue ? `逾期 ${-dueIn} 天` : dueIn === 0 ? "今天" : `${dueIn} 天后`})
                          </span>
                        )}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-ink-400">仅标记 · 无周期提醒</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
