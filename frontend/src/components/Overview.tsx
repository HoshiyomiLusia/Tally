import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, HandCoins, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, type Category, type Currency, type DashboardData, type LoanAccount, type Merchant, type Transaction, type WalletType } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatAmount, todayIso as todayIsoStr } from "../lib/format";
import TransactionForm, { type TransactionPrefill } from "./TransactionForm";

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
  total: number;              // 真实余额 (各钱包系统余额之和, 含借出债权)
  total_spendable: number;    // 物理余额 (非信用卡, 系统 - 借出 + 还款 - 投资 + 卖出)
  total_credit_debt: number;  // 信用卡待还
  total_invested: number;     // 投资中 (各持仓剩余成本)
  breakdown: { currency_code: string; net: number; spendable: number; credit_debt: number; invested: number; rate: number; converted: number }[];
}

function thisMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ───────────────────────── 板块 1: 余额 ─────────────────────────
// 资产总览 (真实余额为主) + Wallet 余额 (按账户类型分组)
export function BalanceModule() {
  const { user } = useAuth();
  const [baseCurrency, setBaseCurrency] = useState<string>(() => localStorage.getItem("tally.baseCurrency") || "JPY");
  useEffect(() => { if (user?.primary_currency_code) setBaseCurrency(user.primary_currency_code); }, [user?.primary_currency_code]);
  useEffect(() => { localStorage.setItem("tally.baseCurrency", baseCurrency); }, [baseCurrency]);
  const [showDetails, setShowDetails] = useState(false);  // 移动端: 折叠次要指标

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

  const fmtBase = (v: number) => formatAmount(v, baseCurrency, currencies.data);
  const metricItems: { label: string; text: string; color: string }[] = [
    { label: "物理余额", text: fmtBase(cross.data?.total_spendable ?? 0), color: "" },
  ];
  if (cross.data?.total_credit_debt) metricItems.push({ label: "信用卡待还", text: fmtBase(cross.data.total_credit_debt), color: "text-rose-500 dark:text-rose-300" });
  if (cross.data?.total_invested) metricItems.push({ label: "投资中", text: fmtBase(cross.data.total_invested), color: "text-sky-600 dark:text-sky-400" });
  if (loanNet.receivable > 0) metricItems.push({ label: "借贷 · 应收", text: fmtBase(loanNet.receivable), color: "text-emerald-600 dark:text-emerald-400" });
  if (loanNet.payable > 0) metricItems.push({ label: "借贷 · 应付", text: fmtBase(loanNet.payable), color: "text-rose-500 dark:text-rose-300" });

  return (
    <>
      {/* 资产总览: 左=标题+真实余额主数字, 右(桌面)=次要指标; 移动端次要指标折进"详情" */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="mb-1 text-base font-semibold tracking-tight">余额</h2>
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
          {/* 移动端: 折叠/展开次要指标 */}
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="mt-1.5 flex items-center gap-1 text-xs text-ink-500 hover:text-ink-700 dark:hover:text-ink-300 sm:hidden"
          >
            {showDetails ? "收起" : "详情"}
            <ChevronDown size={13} className={`transition-transform ${showDetails ? "rotate-180" : ""}`} />
          </button>
        </div>
        {/* 桌面: 右侧次要指标常驻 */}
        <div className="hidden shrink-0 space-y-1 text-right sm:block">
          {metricItems.map((m) => (
            <div key={m.label}>
              <div className="text-[10px] uppercase tracking-wider text-ink-400">{m.label}</div>
              <div className={`text-sm font-semibold tracking-tight ${m.color}`}>{m.text}</div>
            </div>
          ))}
        </div>
      </div>
      {/* 移动端: 折叠的次要指标 (2 列小格) */}
      <div className={`mt-3 grid-cols-2 gap-2 sm:hidden ${showDetails ? "grid" : "hidden"}`}>
        {metricItems.map((m) => (
          <div key={m.label} className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800/40">
            <div className="text-[10px] uppercase tracking-wider text-ink-400">{m.label}</div>
            <div className={`text-sm font-semibold tracking-tight ${m.color}`}>{m.text}</div>
          </div>
        ))}
      </div>
      {/* 各币种明细: 桌面常驻, 移动端并入"详情" */}
      <div className={`mt-2 gap-2 sm:grid sm:grid-cols-3 ${showDetails ? "grid grid-cols-2" : "hidden"}`}>
        {(cross.data?.breakdown ?? []).filter((b) => b.net !== 0 || b.spendable !== 0 || b.credit_debt !== 0 || b.invested !== 0).map((b) => (
          <div key={b.currency_code} className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800/40">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-400">
              <span>{b.currency_code}</span>
              {b.currency_code !== baseCurrency && <span>× {b.rate.toFixed(4)}</span>}
            </div>
            <div className={`mt-0.5 text-sm font-semibold ${b.net < 0 ? "text-rose-600 dark:text-rose-300" : ""}`}>
              真实 {formatAmount(b.net, b.currency_code, currencies.data)}
              {b.currency_code !== baseCurrency && (
                <span className="ml-1 text-[10px] font-normal text-ink-400">≈{formatAmount(b.converted, baseCurrency, currencies.data)}</span>
              )}
            </div>
            {b.spendable !== b.net && (
              <div className="text-[10px] text-ink-400">物理 {formatAmount(b.spendable, b.currency_code, currencies.data)}</div>
            )}
            {b.credit_debt !== 0 && (
              <div className="text-[10px] text-rose-500 dark:text-rose-300/80">待还 {formatAmount(b.credit_debt, b.currency_code, currencies.data)}</div>
            )}
            {b.invested !== 0 && (
              <div className="text-[10px] text-sky-600 dark:text-sky-400/80">投资中 {formatAmount(b.invested, b.currency_code, currencies.data)}</div>
            )}
          </div>
        ))}
        {(cross.data?.breakdown ?? []).filter((b) => b.net !== 0 || b.spendable !== 0 || b.credit_debt !== 0 || b.invested !== 0).length === 0 && (
          <div className="col-span-full text-xs text-ink-500">还没有任何余额</div>
        )}
      </div>

      {/* Wallet 余额: 与上方资产总览同处一个矩形, 用分隔线区隔 */}
      {groupedWallets.map(([code, list]) => {
        const nonCredit = list.filter((w) => w.type !== "credit_card");
        const phys = (w: DashboardData["wallet_balances"][number]) =>
          w.balance - w.loan_out_on_wallet + w.loan_repayment_on_wallet - w.invest_out_on_wallet + w.invest_in_on_wallet;
        const spendTotal = nonCredit.reduce((s, w) => s + phys(w), 0);
        // 借贷含信用卡上垫付的; 待还按实际刷卡额(= -物理, 含垫付)
        const loanTotal = list.reduce((s, w) => s + w.loan_out_on_wallet - w.loan_repayment_on_wallet, 0);
        const investTotal = list.reduce((s, w) => s + w.invest_out_on_wallet - w.invest_in_on_wallet, 0);
        const debtTotal = list.filter((w) => w.type === "credit_card").reduce((s, w) => s + Math.max(0, -phys(w)), 0);
        const realTotal = list.reduce((s, w) => s + w.balance, 0);
        const byType = new Map<string, typeof list>();
        for (const w of list) {
          const arr = byType.get(w.type) ?? [];
          arr.push(w);
          byType.set(w.type, arr);
        }
        const typed = WALLET_TYPE_ORDER.filter((t) => byType.has(t));
        return (
          <div key={code} className="mt-4 border-t border-ink-100 pt-3 dark:border-ink-800">
            {/* 一行汇总: 物理 / 借贷 / 待还 不同色, 真实高亮 */}
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-ink-700 dark:text-ink-200">{code} 账户</span>
              <div className="flex flex-wrap items-baseline gap-x-2.5 text-xs">
                <span className="text-ink-500">物理 <span className="font-medium text-ink-700 dark:text-ink-200">{formatAmount(spendTotal, code, currencies.data)}</span></span>
                {loanTotal !== 0 && <span className="hidden text-emerald-600 dark:text-emerald-400 sm:inline">借贷 {formatAmount(loanTotal, code, currencies.data)}</span>}
                {investTotal !== 0 && <span className="hidden text-sky-600 dark:text-sky-400 sm:inline">投资 {formatAmount(investTotal, code, currencies.data)}</span>}
                {debtTotal !== 0 && <span className="text-rose-500">待还 {formatAmount(debtTotal, code, currencies.data)}</span>}
                <span className="text-ink-500">真实 <span className="text-sm font-bold text-ink-900 dark:text-ink-50">{formatAmount(realTotal, code, currencies.data)}</span></span>
              </div>
            </div>
            <div className="space-y-2">
              {loanTotal !== 0 && (
                <div className="flex w-fit items-baseline gap-2 rounded-md bg-ink-50 px-2 py-1 dark:bg-ink-800/40">
                  <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-ink-400"><HandCoins size={11} /> 借贷账户</span>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatAmount(loanTotal, code, currencies.data)}</span>
                </div>
              )}
              {investTotal !== 0 && (
                <div className="flex w-fit items-baseline gap-2 rounded-md bg-ink-50 px-2 py-1 dark:bg-ink-800/40">
                  <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-ink-400"><TrendingUp size={11} /> 投资账户</span>
                  <span className="text-sm font-bold text-sky-600 dark:text-sky-400">{formatAmount(investTotal, code, currencies.data)}</span>
                </div>
              )}
              {typed.map((t) => (
                <div key={t}>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">{WALLET_TYPE_LABEL[t]}</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(byType.get(t) ?? []).map((w) => {
                      const isCredit = w.type === "credit_card";
                      const physical = phys(w);
                      const debt = -physical;
                      return (
                        <div key={w.wallet_id} className="rounded-md bg-ink-50 p-2 dark:bg-ink-800/40">
                          <div className="truncate text-xs text-ink-500">{w.wallet_name}</div>
                          {isCredit ? (
                            <div className={`text-sm font-medium ${debt > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                              {debt > 0 ? `待还 ${formatAmount(debt, code, currencies.data)}` : formatAmount(0, code, currencies.data)}
                            </div>
                          ) : (
                            <div className={`text-sm font-medium ${physical < 0 ? "text-rose-600" : ""}`}>
                              {formatAmount(physical, code, currencies.data)}
                            </div>
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
interface ForecastItem {
  transaction: Transaction;
  due: string;
  status: "confirmed" | "due" | "predicted";
}

// 前后 7 天: 已确认(绿)/过期待确认(琥珀)/未来预测. 标出今天位置. 无外框, 由调用方包矩形.
export function RecurringForecast() {
  const [confirm, setConfirm] = useState<{ prefill: TransactionPrefill; sourceId: number } | null>(null);
  const [back, setBack] = useState(7);  // 回看天数, 可点按钮往前扩
  const dash = useQuery({ queryKey: ["dashboard", thisMonthStr()], queryFn: async () => (await api.get<DashboardData>(`/dashboard?month=${thisMonthStr()}`)).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data });
  const upcoming = useQuery({
    queryKey: ["recurring-upcoming", "window", back],
    queryFn: async () => (await api.get<ForecastItem[]>(`/recurring/upcoming?back=${back}&days=7`)).data,
  });

  const catName = (id: number | null) => id == null ? "未分类" : categories.data?.find((c) => c.id === id)?.name ?? "?";
  const catEmoji = (id: number | null) => id == null ? "" : categories.data?.find((c) => c.id === id)?.emoji ?? "";
  const merchantName = (id: number | null) => id == null ? "" : merchants.data?.find((m) => m.id === id)?.name ?? "";
  const walletName = (id: number) => dash.data?.wallet_balances.find((w) => w.wallet_id === id)?.wallet_name ?? "?";

  const todayIso = todayIsoStr();
  const recurItems = useMemo(() => {
    return (upcoming.data ?? [])
      .slice()
      .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  }, [upcoming.data]);

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1 text-sm font-medium text-ink-600"><CalendarClock size={14} /> 预测 · 前 {back} 天 · 后 7 天</h3>
      <div className="card divide-y divide-ink-100 p-0">
        <div className="flex items-center justify-center gap-3 px-4 py-2 text-xs">
          <button onClick={() => setBack((b) => b + 7)} className="font-medium text-ink-500 hover:text-ink-700 dark:hover:text-ink-300">↑ 再往前 7 天</button>
          {back > 7 && <button onClick={() => setBack(7)} className="text-ink-400 hover:text-ink-600 dark:hover:text-ink-300">收起</button>}
        </div>
        {recurItems.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-ink-500">这段时间没有周期账单</div>
        )}
        {recurItems.map((it, i) => {
          const t = it.transaction;
          const mname = merchantName(t.merchant_id);
          const cname = catName(t.category_id);
          const primary = mname || t.note || cname;
          const showCat = primary !== cname;
          const prev = recurItems[i - 1];
          const isFuture = it.due > todayIso;
          const showTodayDivider = isFuture && (!prev || prev.due <= todayIso);
          const dim = it.status === "due";  // 待确认的淡一点, 已确认/未来不淡
          return (
            <div key={`${t.id}-${it.status}-${it.due}`}>
              {showTodayDivider && (
                <div className="flex items-center gap-2 bg-emerald-50/60 px-4 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  今天 {todayIso}
                </div>
              )}
              <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <div className={`min-w-0 flex-1 ${dim ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>{catEmoji(t.category_id)}</span>
                    <span className="truncate font-medium">{primary}</span>
                    {showCat && <span className="truncate text-xs text-ink-500">· {cname}</span>}
                    {it.status === "confirmed" && (
                      <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">已确认</span>
                    )}
                    {it.status === "due" && (
                      <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">待确认</span>
                    )}
                  </div>
                  <div className="text-xs text-ink-500">
                    {it.status === "confirmed" ? "已扣款 " : it.status === "due" ? "应已扣款 " : "下次约 "}{it.due} · {walletName(t.wallet_id)}{mname && t.note ? ` · ${t.note}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className={`${it.status === "confirmed" ? "font-medium text-ink-700 dark:text-ink-200" : "text-rose-600"} ${dim ? "opacity-60" : ""}`}>
                    {it.status === "confirmed" ? "" : "~"}{formatAmount(t.amount, t.currency_code, currencies.data)}
                  </div>
                  {it.status === "due" && (
                    <button
                      onClick={() => setConfirm({
                        sourceId: t.id,
                        prefill: {
                          kind: t.kind === "income" ? "income" : "expense",
                          wallet_id: t.wallet_id,
                          category_id: t.category_id,
                          merchant_id: t.merchant_id,
                          amount: t.amount,
                          currency_code: t.currency_code,
                          occurred_on: it.due,
                          note: t.note,
                          is_recurring: true,
                          recurrence_period_days: t.recurrence_period_days,
                        },
                      })}
                      className="rounded-full border border-emerald-500 px-2 py-0.5 text-[11px] font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    >确认扣款</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {recurItems.some((it) => it.status === "due") && (
          <div className="px-4 py-2 text-[11px] text-ink-400">
            「待确认」= 按上次金额推算的过去扣款，实际可能不同。点「确认扣款」记一笔后会变成绿色「已确认」（金额 / 账户 / 日期可改）。
          </div>
        )}
      </div>
      <TransactionForm
        open={confirm !== null}
        prefill={confirm?.prefill ?? null}
        recurrenceSourceId={confirm?.sourceId ?? null}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
