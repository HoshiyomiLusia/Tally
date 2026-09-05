import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, HandCoins, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, type Category, type Currency, type DashboardData, type LoanAccount, type Merchant, type PlannedExpense, type Transaction, type WalletType } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatAmount, parseAmount, todayIso as todayIsoStr } from "../lib/format";
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
  breakdown: { currency_code: string; net: number; spendable: number; credit_debt: number; invested: number; rate: number; converted: number; has_rate?: boolean }[];
  missing_rate_currencies?: string[];  // 有余额但缺到主币种汇率的货币, 未计入 total
}

function thisMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ───────────────────────── 板块 1: 余额 ─────────────────────────
// 资产总览 (真实余额为主) + Wallet 余额 (按账户类型分组)
export function BalanceModule() {
  const { user } = useAuth();
  const hadSavedBase = useRef(localStorage.getItem("tally.baseCurrency") != null);
  const [baseCurrency, setBaseCurrency] = useState<string>(() => localStorage.getItem("tally.baseCurrency") || "JPY");
  // 只在用户从没手选过折算币种(挂载时 localStorage 无值)才用账户默认币种做初值;
  // 手选过就别用 primary_currency_code 覆盖, 否则下拉选择每次刷新被顶回、永不生效(审计发现)。
  useEffect(() => { if (!hadSavedBase.current && user?.primary_currency_code) setBaseCurrency(user.primary_currency_code); }, [user?.primary_currency_code]);
  useEffect(() => { localStorage.setItem("tally.baseCurrency", baseCurrency); }, [baseCurrency]);
  const [showDetails, setShowDetails] = useState(false);  // 移动端: 折叠次要指标

  // 余额是当前值, 与所选月份无关 —— 固定用本月查 dashboard 拿 wallet_balances
  const dash = useQuery({ queryKey: ["dashboard", thisMonthStr()], queryFn: async () => (await api.get<DashboardData>(`/dashboard?month=${thisMonthStr()}`)).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const loans = useQuery({ queryKey: ["loan-accounts"], queryFn: async () => (await api.get<LoanAccount[]>("/loans/accounts")).data });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: async () => (await api.get<{ base: string; quote: string; rate: number }[]>("/exchange-rates")).data });
  const qc = useQueryClient();
  const planned = useQuery({ queryKey: ["planned-expenses"], queryFn: async () => (await api.get<PlannedExpense[]>("/planned-expenses")).data });
  const [excludePlanned, setExcludePlanned] = useState(false);
  const [peName, setPeName] = useState("");
  const [peAmt, setPeAmt] = useState("");
  const [peCcy, setPeCcy] = useState("");
  const [peDate, setPeDate] = useState("");
  const addPlanned = useMutation({
    mutationFn: async () => {
      const ccy = peCcy || baseCurrency;
      const digits = currencies.data?.find((c) => c.code === ccy)?.decimal_digits ?? 2;
      if (!peName.trim() || parseAmount(peAmt || "0", digits) <= 0) throw new Error("填名称和金额");
      await api.post("/planned-expenses", { name: peName.trim(), amount: parseAmount(peAmt, digits), currency_code: ccy, due_date: peDate || null });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["planned-expenses"] }); setPeName(""); setPeAmt(""); setPeDate(""); },
    onError: (e: any) => alert(e?.response?.data?.detail ?? (e instanceof Error ? e.message : "添加失败")),
  });
  const delPlanned = useMutation({
    mutationFn: async (id: number) => api.delete(`/planned-expenses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planned-expenses"] }),
  });
  const cross = useQuery({ queryKey: ["cross-currency-total", baseCurrency], queryFn: async () => (await api.get<CrossTotal>(`/stats/cross-currency-total?base=${baseCurrency}`)).data });

  // 借贷净额折算到 baseCurrency. balance: 负=应收(对方未还), 正=应付(我未还)
  const loanNet = useMemo(() => {
    const digits = new Map((currencies.data ?? []).map((c) => [c.code, c.decimal_digits]));
    const rateMap = new Map<string, number>();
    for (const r of rates.data ?? []) if (!rateMap.has(`${r.base}->${r.quote}`)) rateMap.set(`${r.base}->${r.quote}`, r.rate);
    const missing = new Set<string>();
    const fold = (amt: number, from: string): number => {
      if (from === baseCurrency) return amt;
      const fd = digits.get(from) ?? 2, td = digits.get(baseCurrency) ?? 2;
      let rate = rateMap.get(`${from}->${baseCurrency}`);
      if (rate == null) { const rev = rateMap.get(`${baseCurrency}->${from}`); rate = rev ? 1 / rev : 0; }
      if (rate === 0 && amt !== 0) missing.add(from);  // 借贷折算缺汇率: 记下该币种, 让上方黄条提示(否则静默折 0 漏算)
      return Math.round(amt * rate * Math.pow(10, td - fd));
    };
    let receivable = 0, payable = 0;
    for (const a of loans.data ?? []) {
      const v = fold(a.balance, a.currency_code);
      if (v < 0) receivable += -v;
      else payable += v;
    }
    return { receivable, payable, missing: [...missing] };
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
  // 一键"抹除投资": 把投资额从真实余额里剔除, 看不含投资的净资产(= 物理 - 待还 + 借贷)
  const [investCutPct, setInvestCutPct] = useState(0);   // 抹除投资的比例 0~100
  const [investPopover, setInvestPopover] = useState(false);
  const plannedInfo = useMemo(() => {
    const digits = new Map((currencies.data ?? []).map((c) => [c.code, c.decimal_digits]));
    const rateMap = new Map<string, number>();
    for (const r of rates.data ?? []) if (!rateMap.has(`${r.base}->${r.quote}`)) rateMap.set(`${r.base}->${r.quote}`, r.rate);
    const missing = new Set<string>();
    const fold = (amt: number, from: string): number => {
      if (from === baseCurrency) return amt;
      const fd = digits.get(from) ?? 2, td = digits.get(baseCurrency) ?? 2;
      let rate = rateMap.get(`${from}->${baseCurrency}`);
      if (rate == null) { const rev = rateMap.get(`${baseCurrency}->${from}`); rate = rev ? 1 / rev : 0; }
      if (rate === 0 && amt !== 0) missing.add(from);  // 审计 #119: 缺汇率不静默折 0, 记下来提示
      return Math.round(amt * rate * Math.pow(10, td - fd));
    };
    const list = planned.data ?? [];
    return { sum: list.reduce((s, p) => s + fold(p.amount, p.currency_code), 0), count: list.length, missing: [...missing] };
  }, [planned.data, rates.data, currencies.data, baseCurrency]);
  const plannedTotal = plannedInfo.sum;
  const mainTotal = (cross.data?.total ?? 0) - Math.round((cross.data?.total_invested ?? 0) * investCutPct / 100) - (excludePlanned ? plannedTotal : 0);
  const metricItems: { label: string; text: string; color: string }[] = [
    { label: "物理余额", text: fmtBase(cross.data?.total_spendable ?? 0), color: "" },
  ];
  if (cross.data?.total_credit_debt) metricItems.push({ label: "信用卡待还", text: fmtBase(cross.data.total_credit_debt), color: "text-rose-500 dark:text-rose-300" });
  if (cross.data?.total_invested) metricItems.push({ label: investCutPct > 0 ? `投资中 (抹${investCutPct}%)` : "投资中", text: fmtBase(cross.data.total_invested), color: investCutPct >= 100 ? "text-sky-600/40 line-through dark:text-sky-400/40" : "text-sky-600 dark:text-sky-400" });
  if (loanNet.receivable > 0) metricItems.push({ label: "借贷 · 应收", text: fmtBase(loanNet.receivable), color: "text-emerald-600 dark:text-emerald-400" });
  if (loanNet.payable > 0) metricItems.push({ label: "借贷 · 应付", text: fmtBase(loanNet.payable), color: "text-rose-500 dark:text-rose-300" });

  return (
    <>
      {/* 资产总览: 左=标题+真实余额主数字, 右(桌面)=次要指标; 移动端次要指标折进"详情" */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="mb-1 text-base font-semibold tracking-tight">余额</h2>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-xs uppercase tracking-wider text-ink-500">{investCutPct > 0 ? `不含投资${investCutPct < 100 ? ` ${investCutPct}%` : ""} · 折算到` : "真实余额 · 折算到"}</span>
            <select
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value)}
              className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-xs text-ink-600 outline-none dark:border-ink-700 dark:bg-ink-800"
            >
              {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
            <div className="relative">
              <button
                type="button"
                onClick={() => setInvestPopover((v) => !v)}
                title="点开选择抹除多少投资额"
                className={`rounded border px-1.5 py-0.5 text-xs ${investCutPct > 0 ? "border-sky-500 bg-sky-500/15 text-sky-600 dark:text-sky-300" : "border-ink-200 text-ink-500 dark:border-ink-700"}`}
              >{investCutPct > 0 ? `抹除投资 ${investCutPct}%` : "抹除投资"}</button>
              {investPopover && (
                <div className="absolute right-0 top-full z-20 mt-1 w-60 rounded-lg sm:left-0 sm:right-auto border border-ink-200 bg-white p-2.5 shadow-lg dark:border-ink-700 dark:bg-ink-800">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-500">抹除投资比例</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number" min={0} max={100} step={1} value={investCutPct}
                        onChange={(e) => setInvestCutPct(Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))))}
                        className="w-14 rounded border border-ink-200 bg-transparent px-1 py-0.5 text-right text-xs tabular-nums dark:border-ink-700"
                      />
                      <span className="text-xs text-ink-500">%</span>
                    </div>
                  </div>
                  <input
                    type="range" min={0} max={100} step={1} value={investCutPct}
                    onChange={(e) => setInvestCutPct(Number(e.target.value))}
                    className="w-full accent-sky-500"
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {[0, 10, 25, 33, 50, 66, 75, 90, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setInvestCutPct(pct)}
                        className={`rounded px-1.5 py-0.5 text-xs ${investCutPct === pct ? "bg-sky-500 text-white" : "text-ink-500 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-700"}`}
                      >{pct}%</button>
                    ))}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between border-t border-ink-100 pt-1.5 text-[11px] dark:border-ink-700">
                    <span className="text-ink-400">抹除 {fmtBase(Math.round((cross.data?.total_invested ?? 0) * investCutPct / 100))}</span>
                    <button type="button" onClick={() => setInvestPopover(false)} className="text-ink-500 hover:text-ink-700 dark:hover:text-ink-300">完成</button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="text-3xl font-semibold tracking-tight">
            {formatAmount(mainTotal, baseCurrency, currencies.data)}
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
      {(() => {
        // 合并"钱包口径缺汇率"(后端 cross)与"借贷折算缺汇率"(前端 loanNet) —— 后者含借贷-only/归档钱包币种,
        // 后端 cross 看不到, 不并进来就会静默漏算借贷应收/应付(审计 #90)。
        const missingAll = [...new Set([...(cross.data?.missing_rate_currencies ?? []), ...loanNet.missing])];
        return missingAll.length > 0 ? (
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300">
            ⚠ 缺 {missingAll.join(" / ")} → {baseCurrency} 的汇率,这些货币的余额/借贷<b>未计入</b>上方总额。去「设置」录入汇率。
          </div>
        ) : null;
      })()}
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
              {b.currency_code !== baseCurrency && (b.has_rate === false
                ? <span className="text-amber-600 dark:text-amber-400">缺汇率</span>
                : <span>× {b.rate.toFixed(4)}</span>)}
            </div>
            <div className={`mt-0.5 text-sm font-semibold ${b.net < 0 ? "text-rose-600 dark:text-rose-300" : ""}`}>
              真实 {formatAmount(b.net, b.currency_code, currencies.data)}
              {b.currency_code !== baseCurrency && b.has_rate !== false && (
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

      {/* 预定支出便签: 未来大额支出(如学费), 一键从余额扣除看真实可用额度 */}
      <div className="mt-3 rounded-lg border border-dashed border-ink-300/60 p-2.5 dark:border-ink-700/70">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-ink-600 dark:text-ink-300">📌 预定支出</span>
            {plannedInfo.count > 0 && <span className="text-xs text-ink-400">合计 ≈{fmtBase(plannedTotal)}</span>}
            {plannedInfo.missing.length > 0 && <span className="text-xs text-amber-600">缺 {plannedInfo.missing.join("/")} 汇率, 未计入</span>}
          </div>
          {plannedInfo.count > 0 && plannedTotal > 0 && (
            <button
              type="button"
              onClick={() => setExcludePlanned((v) => !v)}
              className={`rounded border px-1.5 py-0.5 text-xs ${excludePlanned ? "border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-300" : "border-ink-200 text-ink-500 dark:border-ink-700"}`}
            >{excludePlanned ? "已从余额扣除" : "从余额扣除"}</button>
          )}
        </div>
        {(planned.data ?? []).length > 0 && (
          <div className="mt-1.5 space-y-1">
            {(planned.data ?? []).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs">
                <span className="min-w-0 truncate text-ink-600 dark:text-ink-300">{p.name}{p.due_date && <span className={`ml-1.5 ${p.due_date < todayIsoStr() ? "text-rose-500" : "text-ink-400"}`}>{p.due_date}{p.due_date < todayIsoStr() ? " · 已到期, 记完账记得删掉" : ""}</span>}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-rose-500 dark:text-rose-300">-{formatAmount(p.amount, p.currency_code, currencies.data)}</span>
                  <button type="button" onClick={() => delPlanned.mutate(p.id)} className="text-ink-400 hover:text-rose-500" title="删除">×</button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <input value={peName} onChange={(e) => setPeName(e.target.value)} placeholder="名称(如 学费)" className="w-28 rounded border border-ink-200 bg-transparent px-1.5 py-0.5 text-xs dark:border-ink-700" />
          <input value={peAmt} onChange={(e) => setPeAmt(e.target.value)} inputMode="decimal" placeholder="金额" className="w-20 rounded border border-ink-200 bg-transparent px-1.5 py-0.5 text-xs dark:border-ink-700" />
          <select value={peCcy || baseCurrency} onChange={(e) => setPeCcy(e.target.value)} className="rounded border border-ink-200 bg-transparent px-1 py-0.5 text-xs dark:border-ink-700">
            {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
          <input type="date" value={peDate} onChange={(e) => setPeDate(e.target.value)} className="rounded border border-ink-200 bg-transparent px-1 py-0.5 text-xs text-ink-500 dark:border-ink-700" />
          <button type="button" onClick={() => addPlanned.mutate()} disabled={addPlanned.isPending} className="rounded border border-ink-300 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-100 dark:border-ink-600 dark:text-ink-300 dark:hover:bg-ink-800">添加</button>
        </div>
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
  overdue_periods: number;   // due 时累计漏确认期数
  rhythm: { typical_day: number | null; learned_gap: number | null; samples: number; ignored: number };  // 自学习到的节奏(ignored = 剔除的补记/漏记样本)
  merged_segments: number;   // >1: 换过付款方式 / 中途另起过一组, 后端已把前后序列接成一条线
  split: { total: number; my_share: number; participants: { contact_id: number; share: number }[] } | null;  // 上期是分摊 → 模板
}

// 前 7 天 / 后 31 天: 已确认(绿)/过期待确认(琥珀)/未来预测. 标出今天位置. 无外框, 由调用方包矩形.
export function RecurringForecast() {
  const [confirm, setConfirm] = useState<{ prefill: TransactionPrefill; sourceId: number } | null>(null);
  const [back, setBack] = useState(7);  // 回看天数, 可点按钮往前扩
  // 前瞻天数: 默认一个完整月(31 天), 让每个月度账单都能看到下一期; 之前只看 7 天, 月中扣款的账单有大半个月看不到(用户反馈"8-19 的周期订单没有显示")
  const [ahead, setAhead] = useState(31);
  const dash = useQuery({ queryKey: ["dashboard", thisMonthStr()], queryFn: async () => (await api.get<DashboardData>(`/dashboard?month=${thisMonthStr()}`)).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data });
  const upcoming = useQuery({
    queryKey: ["recurring-upcoming", "window", back, ahead],
    queryFn: async () => (await api.get<ForecastItem[]>(`/recurring/upcoming?back=${back}&days=${ahead}`)).data,
  });
  const qc = useQueryClient();
  // 停用: 清掉该账单最新一笔的周期 → 不再预测/提醒(历史保留)
  const stop = useMutation({
    mutationFn: async (tid: number) => api.post(`/recurring/stop/${tid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurring-upcoming"] }); qc.invalidateQueries({ queryKey: ["recurring-by-month"] }); qc.invalidateQueries({ queryKey: ["transactions"] }); },
    onError: (e: unknown) => { const r = (e as { response?: { data?: { detail?: string } } }).response; alert(r?.data?.detail ?? "停用失败"); },
  });
  // 学习说明: "通常 25 号" / "约每 14 天"
  const rhythmText = (it: ForecastItem) => {
    const r = it.rhythm;
    if (r.typical_day != null) return `学自 ${r.samples} 期 · 通常 ${r.typical_day} 号${r.ignored > 0 ? ` · 忽略 ${r.ignored} 期补记` : ""}`;
    if (r.learned_gap != null) return `学自 ${r.samples} 期 · 约每 ${r.learned_gap} 天${r.ignored > 0 ? ` · 忽略 ${r.ignored} 段异常间隔` : ""}`;
    return "";
  };

  const catName = (id: number | null) => id == null ? "未分类" : categories.data?.find((c) => c.id === id)?.name ?? "?";
  const catEmoji = (id: number | null) => id == null ? "" : categories.data?.find((c) => c.id === id)?.emoji ?? "";
  const merchantName = (id: number | null) => id == null ? "" : merchants.data?.find((m) => m.id === id)?.name ?? "";
  const walletName = (id: number) => dash.data?.wallet_balances.find((w) => w.wallet_id === id)?.wallet_name ?? "?";

  const todayIso = todayIsoStr();
  const [showStale, setShowStale] = useState(false);
  // 逾期 2 期以上的(用户要求折叠): 多半是取消了的订阅, 或换了记法没接上; 默认折叠, 给一键停用, 别把时间轴淹了
  const STALE = 2;
  const staleItems = useMemo(() => (upcoming.data ?? []).filter((it) => it.status === "due" && it.overdue_periods >= STALE), [upcoming.data]);
  // 一键停用只碰逾期半年以上的(刚漏一两期的多半还活着, 误停会让它从预测里消失); confirm 里列出名单可核对
  const DEAD = 6;
  const deadItems = useMemo(() => staleItems.filter((it) => it.overdue_periods >= DEAD), [staleItems]);
  const recurItems = useMemo(() => {
    return (upcoming.data ?? [])
      .filter((it) => showStale || !(it.status === "due" && it.overdue_periods >= STALE))
      .slice()
      .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  }, [upcoming.data, showStale]);

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1 text-sm font-medium text-ink-600"><CalendarClock size={14} /> 预测 · 前 {back} 天 · 后 {ahead} 天</h3>
      <div className="card divide-y divide-ink-100 p-0">
        <div className="flex items-center justify-center gap-3 px-4 py-2 text-xs">
          <button onClick={() => setBack((b) => b + 7)} className="font-medium text-ink-500 hover:text-ink-700 dark:hover:text-ink-300">↑ 再往前 7 天</button>
          {back > 7 && <button onClick={() => setBack(7)} className="text-ink-400 hover:text-ink-600 dark:hover:text-ink-300">收起</button>}
        </div>
        {staleItems.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-ink-50 px-4 py-2 text-xs dark:bg-ink-800/40">
            <span className="text-ink-500">有 {staleItems.length} 个周期账单逾期 2 期以上（多半已取消，或换了记法没接上）</span>
            <div className="flex gap-2">
              <button onClick={() => setShowStale((v) => !v)} className="text-ink-500 hover:text-ink-700 dark:hover:text-ink-300">{showStale ? "收起" : "展开"}</button>
              {deadItems.length > 0 && (
                <button
                  onClick={() => {
                    const names = deadItems.map((it) => merchantName(it.transaction.merchant_id) || it.transaction.note || catName(it.transaction.category_id)).join("、");
                    if (window.confirm(`停用这 ${deadItems.length} 个逾期半年以上的周期账单？\n${names}\n历史记录保留，只是不再预测和提醒。逾期不足半年的不会动。`)) deadItems.forEach((it) => stop.mutate(it.transaction.id));
                  }}
                  className="text-rose-600 hover:underline"
                >停用逾期半年以上的 {deadItems.length} 个</button>
              )}
            </div>
          </div>
        )}
        {recurItems.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-ink-500">
            {staleItems.length > 0 ? `这段时间没有待处理的周期账单（${staleItems.length} 个逾期账单已折叠，点「展开」查看）` : "这段时间没有周期账单"}
          </div>
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
                    {it.status === "due" && it.overdue_periods <= 1 && (
                      <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">待确认</span>
                    )}
                    {it.status === "due" && it.overdue_periods > 1 && (
                      <span className="rounded bg-rose-100 px-1 text-[10px] text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" title="连续多期没有确认扣款; 若已取消订阅请点「停用」">逾期 {it.overdue_periods} 期</span>
                    )}
                  </div>
                  <div className="text-xs text-ink-500">
                    {it.status === "confirmed" ? "已扣款 " : it.status === "due" ? "应已扣款 " : "下次约 "}{it.due} · {walletName(t.wallet_id)}{mname && t.note ? ` · ${t.note}` : ""}
                    {it.status !== "confirmed" && rhythmText(it) && <span className="ml-1.5 text-ink-400">· {rhythmText(it)}</span>}
                    {it.merged_segments > 1 && <span className="ml-1.5 text-ink-400" title="换过付款方式或中途另起过一组, 已按同商家同分类接成一条账单">· 已接上之前 {it.merged_segments - 1} 段记录</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className={`${it.status === "confirmed" ? "font-medium text-ink-700 dark:text-ink-200" : "text-rose-600"} ${dim ? "opacity-60" : ""}`}>
                    {it.status === "confirmed" ? "" : "~"}{formatAmount(t.amount, t.currency_code, currencies.data)}
                  </div>
                  {it.split && (
                    <div className="text-[10px] text-ink-400" title="上期是分摊记的: 确认扣款会按总额 + 各人份额预填">
                      总 {formatAmount(it.split.total, t.currency_code, currencies.data)} · 分摊 {it.split.participants.length} 人
                    </div>
                  )}
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
                          split: it.split,
                        },
                      })}
                      className="rounded-full border border-emerald-500 px-2 py-0.5 text-[11px] font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    >确认扣款</button>
                  )}
                  {it.status !== "confirmed" && (
                    <button
                      onClick={() => { if (window.confirm(`停用「${primary}」的周期提醒？\n以后不再预测和提醒这个账单（历史记录保留；想恢复就编辑它重新选周期）。`)) stop.mutate(t.id); }}
                      className="text-[10px] text-ink-400 hover:text-rose-600"
                      title="已取消的订阅 / 不再需要提醒"
                    >停用</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-center gap-3 px-4 py-2 text-xs">
          <button onClick={() => setAhead((a) => a + 31)} className="font-medium text-ink-500 hover:text-ink-700 dark:hover:text-ink-300">↓ 再往后 31 天</button>
          {ahead > 31 && <button onClick={() => setAhead(31)} className="text-ink-400 hover:text-ink-600 dark:hover:text-ink-300">收起</button>}
        </div>
        {recurItems.some((it) => it.status === "due") && (
          <div className="px-4 py-2 text-[11px] text-ink-400">
            「待确认」= 按上次金额推算的过去扣款，实际可能不同。点「确认扣款」记一笔后会变成绿色「已确认」（金额 / 账户 / 日期可改）。扣款日由该账单的历史实际扣款日自动学习（通常几号 / 约每几天），不再机械按固定天数推。已取消的订阅点「停用」。
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
