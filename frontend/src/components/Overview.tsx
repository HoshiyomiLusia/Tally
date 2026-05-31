import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import MonthPicker from "./MonthPicker";
import { api, type Category, type Currency, type DashboardData, type Merchant, type Transaction } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatAmount } from "../lib/format";

interface CrossTotal {
  base_currency: string;
  total: number;        // 物理总资产
  total_real: number;   // 真实总资产 (含借出未还的债权)
  breakdown: { currency_code: string; balance: number; balance_real: number; rate: number; converted: number; converted_real: number }[];
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Overview() {
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const dash = useQuery({ queryKey: ["dashboard", month], queryFn: async () => (await api.get<DashboardData>(`/dashboard?month=${month}`)).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data });
  const upcoming = useQuery({ queryKey: ["recurring-upcoming"], queryFn: async () => (await api.get<Transaction[]>("/recurring/upcoming?days=14")).data });

  const { user } = useAuth();
  const [baseCurrency, setBaseCurrency] = useState<string>(() => localStorage.getItem("tally.baseCurrency") || "JPY");
  useEffect(() => { if (user?.primary_currency_code) setBaseCurrency(user.primary_currency_code); }, [user?.primary_currency_code]);
  useEffect(() => { localStorage.setItem("tally.baseCurrency", baseCurrency); }, [baseCurrency]);

  const cross = useQuery({ queryKey: ["cross-currency-total", baseCurrency], queryFn: async () => (await api.get<CrossTotal>(`/stats/cross-currency-total?base=${baseCurrency}`)).data });

  const catName = (id: number | null) => id == null ? "未分类" : categories.data?.find((c) => c.id === id)?.name ?? "?";
  const catEmoji = (id: number | null) => id == null ? "" : categories.data?.find((c) => c.id === id)?.emoji ?? "";
  const merchantName = (id: number | null) => id == null ? "" : merchants.data?.find((m) => m.id === id)?.name ?? "";

  const groupedWallets = useMemo(() => {
    const m = new Map<string, DashboardData["wallet_balances"]>();
    for (const w of dash.data?.wallet_balances ?? []) {
      if (w.archived) continue;
      const arr = m.get(w.currency_code) ?? [];
      arr.push(w);
      m.set(w.currency_code, arr);
    }
    return Array.from(m.entries());
  }, [dash.data]);

  return (
    <div className="space-y-5">
      {/* 总资产 (统计口径: 真实为主, 物理为辅) */}
      <section>
        <div className="overview-card rounded-2xl p-5 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider opacity-60">总资产（折算到）</span>
            <select
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value)}
              className="overview-select rounded px-2 py-0.5 text-xs outline-none"
            >
              {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-1">
            <div>
              <div className="text-[11px] opacity-60">真实总资产 · 含借出债权</div>
              <div className="text-3xl font-semibold tracking-tight">
                {formatAmount(cross.data?.total_real ?? cross.data?.total ?? 0, baseCurrency, currencies.data)}
              </div>
            </div>
            {cross.data && cross.data.total_real !== cross.data.total && (
              <div>
                <div className="text-[11px] opacity-60">物理总资产 · 手头实有</div>
                <div className="text-2xl font-semibold tracking-tight opacity-70">
                  {formatAmount(cross.data.total, baseCurrency, currencies.data)}
                </div>
              </div>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(cross.data?.breakdown ?? []).filter((b) => b.balance !== 0 || b.balance_real !== 0).map((b) => (
              <div key={b.currency_code} className="overview-chip rounded-lg p-2">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider opacity-60">
                  <span>{b.currency_code}</span>
                  {b.currency_code !== baseCurrency && <span>× {b.rate.toFixed(4)}</span>}
                </div>
                <div className={`mt-0.5 text-sm font-semibold ${b.balance_real < 0 ? "text-rose-600 dark:text-rose-300" : ""}`}>
                  {formatAmount(b.balance_real, b.currency_code, currencies.data)}
                </div>
                {b.balance_real !== b.balance && (
                  <div className="text-[10px] opacity-60">手头 {formatAmount(b.balance, b.currency_code, currencies.data)}</div>
                )}
                {b.currency_code !== baseCurrency && (
                  <div className="text-[10px] opacity-60">≈ {formatAmount(b.converted_real, baseCurrency, currencies.data)}</div>
                )}
              </div>
            ))}
            {(cross.data?.breakdown ?? []).filter((b) => b.balance !== 0 || b.balance_real !== 0).length === 0 && (
              <div className="col-span-full text-xs opacity-60">还没有任何余额</div>
            )}
          </div>
        </div>
      </section>

      {/* 当月收支 */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-600">当月收支</h2>
          <MonthPicker value={month} onChange={setMonth} />
        </div>
        {dash.data?.month_totals.length ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {dash.data.month_totals.map((t) => (
              <div key={t.currency_code} className="card">
                <div className="text-xs text-ink-500">{t.currency_code}</div>
                <div className="mt-1 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-ink-400">收入</div>
                    <div className="text-emerald-600">{formatAmount(t.income, t.currency_code, currencies.data)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-400">支出</div>
                    <div className="text-rose-600">{formatAmount(t.expense, t.currency_code, currencies.data)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-400">净</div>
                    <div className={t.net >= 0 ? "text-emerald-600" : "text-rose-600"}>{formatAmount(t.net, t.currency_code, currencies.data)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card text-sm text-ink-500">本月还没有收支记录</div>
        )}
      </section>

      {/* Wallet 余额 (物理为主) */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-600">Wallet 余额</h2>
        <div className="space-y-2">
          {groupedWallets.map(([code, list]) => {
            const total = list.reduce((s, w) => s + w.balance - w.loan_out_on_wallet + w.loan_repayment_on_wallet, 0);
            return (
              <div key={code} className="card">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-medium text-ink-700">{code} 账户</div>
                  <div className="text-sm font-semibold">{formatAmount(total, code, currencies.data)}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {list.map((w) => {
                    const physical = w.balance - w.loan_out_on_wallet + w.loan_repayment_on_wallet;
                    const hasLoanDiff = w.loan_out_on_wallet !== 0 || w.loan_repayment_on_wallet !== 0;
                    return (
                      <div key={w.wallet_id} className="rounded-md bg-ink-50 p-2">
                        <div className="truncate text-xs text-ink-500">{w.wallet_name}</div>
                        <div className={`text-sm font-medium ${physical < 0 ? "text-rose-600" : ""}`}>
                          {formatAmount(physical, code, currencies.data)}
                        </div>
                        {hasLoanDiff && (
                          <div className="text-[10px] text-ink-400">实际 {formatAmount(w.balance, code, currencies.data)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {groupedWallets.length === 0 && <div className="card text-sm text-ink-500">还没有 Wallet</div>}
        </div>
      </section>

      {/* 即将到期的周期账单 */}
      {(upcoming.data ?? []).length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1 text-sm font-medium text-ink-600"><CalendarClock size={14} /> 即将到期的周期账单</h2>
          <div className="card divide-y divide-ink-100 p-0">
            {(upcoming.data ?? []).map((t) => {
              const nextDue = addDaysIso(t.occurred_on, t.recurrence_period_days || 0);
              const mname = merchantName(t.merchant_id);
              const cname = catName(t.category_id);
              const primary = mname || t.note || cname;
              const showCat = primary !== cname;
              return (
                <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span>{catEmoji(t.category_id)}</span>
                      <span className="truncate font-medium">{primary}</span>
                      {showCat && <span className="truncate text-xs text-ink-500">· {cname}</span>}
                    </div>
                    <div className="text-xs text-ink-500">上次 {t.occurred_on} · 下次约 {nextDue}{mname && t.note ? ` · ${t.note}` : ""}</div>
                  </div>
                  <div className="shrink-0 text-rose-600">~{formatAmount(t.amount, t.currency_code, currencies.data)}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
