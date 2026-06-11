import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, type Category, type Currency, type DashboardData, type LoanAccount, type Merchant, type Transaction, type WalletType } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatAmount, todayIso as todayIsoStr } from "../lib/format";

const WALLET_TYPE_ORDER: WalletType[] = ["bank", "e_wallet", "cash", "credit_card", "virtual"];
const WALLET_TYPE_LABEL: Record<WalletType, string> = {
  bank: "银行账户",
  e_wallet: "电子钱包",
  cash: "现金",
  credit_card: "信用卡",
  virtual: "虚拟账户",
};

interface CrossTotal {
  base_currency: string;
  total: number;              // 净资产 (真实余额)
  total_spendable: number;    // 可支配 (实际物理余额)
  total_credit_debt: number;  // 信用卡待还
  breakdown: { currency_code: string; net: number; spendable: number; credit_debt: number; rate: number; converted: number }[];
}

function thisMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ───────────────────────── 板块 1: 余额 ─────────────────────────
// 资产总览 (真实余额为主) + Wallet 余额 (实际物理余额, 按账户类型分组)
export function BalanceModule() {
  const { user } = useAuth();
  const [baseCurrency, setBaseCurrency] = useState<string>(() => localStorage.getItem("tally.baseCurrency") || "JPY");
  useEffect(() => { if (user?.primary_currency_code) setBaseCurrency(user.primary_currency_code); }, [user?.primary_currency_code]);
  useEffect(() => { localStorage.setItem("tally.baseCurrency", baseCurrency); }, [baseCurrency]);

  // 余额是当前值, 与所选月份无关 —— 固定用本月查 dashboard 拿 wallet_balances
  const dash = useQuery({ queryKey: ["dashboard", thisMonthStr()], queryFn: async () => (await api.get<DashboardData>(`/dashboard?month=${thisMonthStr()}`)).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const loans = useQuery({ queryKey: ["loan-accounts"], queryFn: async () => (await api.get<LoanAccount[]>("/loans/accounts")).data });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: async () => (await api.get<{ base: string; quote: string; rate: number }[]>("/exchange-rates")).data });
  const cross = useQuery({ queryKey: ["cross-currency-total", baseCurrency], queryFn: async () => (await api.get<CrossTotal>(`/stats/cross-currency-total?base=${baseCurrency}`)).data });

  // 借贷净额折算到 baseCurrency. balance: 负=应收(对方未还), 正=应付(我未还)
  const loanNet = useMemo(() => {
    const digits = new Map((currencies.data ?? []).map((c) => [c.code, c.decimal_digits]));
    const rateMap = new Map<string, number>();
    for (const r of rates.data ?? []) if (!rateMap.has(`${r.base}->${r.quote}`)) rateMap.set(`${r.base}->${r.quote}`, r.rate);
    const fold = (amt: number, from: string): number => {
      if (from === baseCurrency) return amt;
      const fd = digits.get(from) ?? 2, td = digits.get(baseCurrency) ?? 2;
      let rate = rateMap.get(`${from}->${baseCurrency}`);
      if (rate == null) { const rev = rateMap.get(`${baseCurrency}->${from}`); rate = rev ? 1 / rev : 0; }
      return Math.round(amt * rate * Math.pow(10, td - fd));
    };
    let receivable = 0, payable = 0;
    for (const a of loans.data ?? []) {
      const v = fold(a.balance, a.currency_code);
      if (v < 0) receivable += -v;
      else payable += v;
    }
    return { receivable, payable };
  }, [loans.data, rates.data, currencies.data, baseCurrency]);

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
    <>
      {/* 资产总览: 真实余额主数字 + 右侧次要指标 */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-xs uppercase tracking-wider text-ink-500">真实余额 · 折算到</span>
            <select
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value)}
              className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-xs text-ink-600 outline-none dark:border-ink-700 dark:bg-ink-800"
            >
              {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </div>
          <div className="text-3xl font-semibold tracking-tight">
            {formatAmount(cross.data?.total ?? 0, baseCurrency, currencies.data)}
          </div>
        </div>
        <div className="shrink-0 space-y-1 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-400">实际物理余额</div>
            <div className="text-sm font-semibold tracking-tight">{formatAmount(cross.data?.total_spendable ?? 0, baseCurrency, currencies.data)}</div>
          </div>
          {!!cross.data?.total_credit_debt && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-400">信用卡待还</div>
              <div className="text-sm font-semibold tracking-tight text-rose-500 dark:text-rose-300">{formatAmount(cross.data.total_credit_debt, baseCurrency, currencies.data)}</div>
            </div>
          )}
          {loanNet.receivable > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-400">借贷 · 应收</div>
              <div className="text-sm font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">{formatAmount(loanNet.receivable, baseCurrency, currencies.data)}</div>
            </div>
          )}
          {loanNet.payable > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-400">借贷 · 应付</div>
              <div className="text-sm font-semibold tracking-tight text-rose-500 dark:text-rose-300">{formatAmount(loanNet.payable, baseCurrency, currencies.data)}</div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(cross.data?.breakdown ?? []).filter((b) => b.net !== 0 || b.spendable !== 0 || b.credit_debt !== 0).map((b) => (
          <div key={b.currency_code} className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800/40">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-400">
              <span>{b.currency_code}</span>
              {b.currency_code !== baseCurrency && <span>× {b.rate.toFixed(4)}</span>}
            </div>
            <div className={`mt-0.5 text-sm font-semibold ${b.net < 0 ? "text-rose-600 dark:text-rose-300" : ""}`}>
              {formatAmount(b.net, b.currency_code, currencies.data)}
            </div>
            {b.credit_debt !== 0 && (
              <div className="text-[10px] text-rose-500 dark:text-rose-300/80">待还 {formatAmount(b.credit_debt, b.currency_code, currencies.data)}</div>
            )}
            {b.currency_code !== baseCurrency && (
              <div className="text-[10px] text-ink-400">≈ {formatAmount(b.converted, baseCurrency, currencies.data)}</div>
            )}
          </div>
        ))}
        {(cross.data?.breakdown ?? []).filter((b) => b.net !== 0 || b.spendable !== 0 || b.credit_debt !== 0).length === 0 && (
          <div className="col-span-full text-xs text-ink-500">还没有任何余额</div>
        )}
      </div>

      {/* Wallet 余额: 与上方资产总览同处一个矩形, 用分隔线区隔 */}
      {groupedWallets.map(([code, list]) => {
        const spendTotal = list
          .filter((w) => w.type !== "credit_card")
          .reduce((s, w) => s + w.balance - w.loan_out_on_wallet + w.loan_repayment_on_wallet, 0);
        const byType = new Map<string, typeof list>();
        for (const w of list) {
          const arr = byType.get(w.type) ?? [];
          arr.push(w);
          byType.set(w.type, arr);
        }
        const typed = WALLET_TYPE_ORDER.filter((t) => byType.has(t));
        return (
          <div key={code} className="mt-4 border-t border-ink-100 pt-3 dark:border-ink-800">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-sm font-medium text-ink-700">{code} · 实际物理余额</span>
              <span className="text-base font-semibold">{formatAmount(spendTotal, code, currencies.data)}</span>
            </div>
            <div className="space-y-2">
              {typed.map((t) => (
                <div key={t}>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">{WALLET_TYPE_LABEL[t]}</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(byType.get(t) ?? []).map((w) => {
                      const isCredit = w.type === "credit_card";
                      const physical = w.balance - w.loan_out_on_wallet + w.loan_repayment_on_wallet;
                      const debt = -w.balance;
                      const hasLoanDiff = w.loan_out_on_wallet !== 0 || w.loan_repayment_on_wallet !== 0;
                      return (
                        <div key={w.wallet_id} className="rounded-md bg-ink-50 p-2 dark:bg-ink-800/40">
                          <div className="truncate text-xs text-ink-500">{w.wallet_name}</div>
                          {isCredit ? (
                            <div className={`text-sm font-medium ${debt > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                              {debt > 0 ? `待还 ${formatAmount(debt, code, currencies.data)}` : formatAmount(0, code, currencies.data)}
                            </div>
                          ) : (
                            <>
                              <div className={`text-sm font-medium ${physical < 0 ? "text-rose-600" : ""}`}>
                                {formatAmount(physical, code, currencies.data)}
                              </div>
                              {hasLoanDiff && (
                                <div className="text-[10px] text-ink-400">系统 {formatAmount(w.balance, code, currencies.data)}</div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {groupedWallets.length === 0 && <div className="mt-4 border-t border-ink-100 pt-3 text-sm text-ink-500 dark:border-ink-800">还没有 Wallet</div>}
    </>
  );
}

// ───────────────────────── 周期账单预测时间轴 (放到周期账单板块顶部) ─────────────────────────
// 过去 7 天 ~ 未来 14 天的预计扣款, 标出今天位置. 无外框, 由调用方包矩形.
export function RecurringForecast() {
  const dash = useQuery({ queryKey: ["dashboard", thisMonthStr()], queryFn: async () => (await api.get<DashboardData>(`/dashboard?month=${thisMonthStr()}`)).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data });
  const upcoming = useQuery({
    queryKey: ["recurring-upcoming", "window"],
    queryFn: async () => (await api.get<Transaction[]>("/recurring/upcoming?back=7&days=14")).data,
  });

  const catName = (id: number | null) => id == null ? "未分类" : categories.data?.find((c) => c.id === id)?.name ?? "?";
  const catEmoji = (id: number | null) => id == null ? "" : categories.data?.find((c) => c.id === id)?.emoji ?? "";
  const merchantName = (id: number | null) => id == null ? "" : merchants.data?.find((m) => m.id === id)?.name ?? "";
  const walletName = (id: number) => dash.data?.wallet_balances.find((w) => w.wallet_id === id)?.wallet_name ?? "?";

  const todayIso = todayIsoStr();
  const recurItems = useMemo(() => {
    return (upcoming.data ?? [])
      .map((tx) => {
        const due = addDaysIso(tx.occurred_on, tx.recurrence_period_days || 0);
        return { tx, due, isPast: due < todayIso };
      })
      .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  }, [upcoming.data, todayIso]);

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1 text-sm font-medium text-ink-600"><CalendarClock size={14} /> 预测 · 近 7 天 ~ 未来 14 天</h3>
      <div className="card divide-y divide-ink-100 p-0">
        {recurItems.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-ink-500">这段时间没有周期账单</div>
        )}
        {recurItems.map((it, i) => {
          const t = it.tx;
          const mname = merchantName(t.merchant_id);
          const cname = catName(t.category_id);
          const primary = mname || t.note || cname;
          const showCat = primary !== cname;
          const prev = recurItems[i - 1];
          const showTodayDivider = !it.isPast && (!prev || prev.isPast);
          return (
            <div key={t.id}>
              {showTodayDivider && (
                <div className="flex items-center gap-2 bg-emerald-50/60 px-4 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  今天 {todayIso}
                </div>
              )}
              <div className={`flex items-center justify-between px-4 py-2 text-sm ${it.isPast ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>{catEmoji(t.category_id)}</span>
                    <span className="truncate font-medium">{primary}</span>
                    {showCat && <span className="truncate text-xs text-ink-500">· {cname}</span>}
                    {it.isPast && (
                      <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">预估</span>
                    )}
                  </div>
                  <div className="text-xs text-ink-500">
                    {it.isPast ? "应已扣款 " : "下次约 "}{it.due} · 扣款账户 {walletName(t.wallet_id)}{mname && t.note ? ` · ${t.note}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-rose-600">~{formatAmount(t.amount, t.currency_code, currencies.data)}</div>
              </div>
            </div>
          );
        })}
        {recurItems.some((it) => it.isPast) && (
          <div className="px-4 py-2 text-[11px] text-ink-400">
            「预估」= 按上次金额推算的过去扣款，实际金额可能不同，记得手动记账。
          </div>
        )}
      </div>
    </div>
  );
}
