import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronLeft, ChevronRight, CreditCard, FileText, Filter, Pencil, Plus, Split, Trash2, TrendingUp, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import CreditRepayForm from "../components/CreditRepayForm";
import Modal from "../components/Modal";
import ReimburseForm from "../components/ReimburseForm";
import TransactionForm from "../components/TransactionForm";
import TransferForm from "../components/TransferForm";
import { api, type Category, type Contact, type Currency, type Merchant, type Position, type Transaction, type Wallet } from "../lib/api";
import { invalidateMoney } from "../lib/invalidate";
import { useAuth } from "../lib/auth";
import { formatAmount, todayIso } from "../lib/format";

interface FrequentItem {
  wallet_id: number;
  wallet_name: string;
  category_id: number | null;
  category_name: string;
  category_emoji: string;
  merchant_id: number | null;
  merchant_name: string;
  amount: number;
  currency_code: string;
  count: number;
  last_on: string;
}

// 非收支类账单本身没有"分类", 用类型本身做标题 (而不是显示"未分类")
const SPECIAL_TITLE: Record<string, { emoji: string; name: string }> = {
  transfer_in: { emoji: "🔁", name: "转账转入" },
  transfer_out: { emoji: "🔁", name: "转账转出" },
  loan_out: { emoji: "💸", name: "借出" },
  loan_repayment: { emoji: "💰", name: "借贷还款" },
  invest_buy: { emoji: "📈", name: "投资买入" },
  invest_sell: { emoji: "📉", name: "投资卖出" },
};

const PAGE_SIZES = [25, 50, 100, 200];

export default function Transactions() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [walletId, setWalletId] = useState<string>("");
  const [parentCatId, setParentCatId] = useState<string>("");
  const [childCatId, setChildCatId] = useState<string>("");
  const [currency, setCurrency] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [reimburseOpen, setReimburseOpen] = useState(false);
  const [creditRepayOpen, setCreditRepayOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);  // 移动端筛选弹窗
  // 滑动时把右下角"+"收到屏幕右外侧 (不挡内容); 停下约 0.4s 后自动滑回来 (随时可点)
  const [fabTucked, setFabTucked] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => {
      setFabTucked(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setFabTucked(false), 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  useEffect(() => { setPage(0); }, [walletId, parentCatId, childCatId, currency, kind, q, start, end, pageSize]);
  useEffect(() => { setChildCatId(""); }, [parentCatId]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (walletId) p.set("wallet_id", walletId);
    const effectiveCat = childCatId || parentCatId;
    if (effectiveCat) p.set("category_id", effectiveCat);
    if (currency) p.set("currency_code", currency);
    if (kind) p.set("kind", kind);
    if (q) p.set("q", q);
    if (start) p.set("start", start);
    if (end) p.set("end", end);
    p.set("limit", String(pageSize));
    p.set("offset", String(page * pageSize));
    return p.toString();
  }, [walletId, parentCatId, childCatId, currency, kind, q, start, end, pageSize, page]);

  const txs = useQuery({
    queryKey: ["transactions", params],
    queryFn: async () => (await api.get<Transaction[]>(`/transactions?${params}`)).data,
  });
  // count 接口只关心 filter, 不关心 limit/offset, 单独构造 key 复用缓存
  const countParams = useMemo(() => {
    const p = new URLSearchParams(params);
    p.delete("limit");
    p.delete("offset");
    return p.toString();
  }, [params]);
  const totalCount = useQuery({
    queryKey: ["transactions", "count", countParams],
    queryFn: async () => (await api.get<{ total: number }>(`/transactions/count?${countParams}`)).data.total,
  });
  // 审计#47: 含归档的 wallets/contacts 用独立 key (…,"all"), 与不含归档的 ["wallets"]/["contacts"] 分开缓存;
  // invalidateMoney/联系人失效按前缀连带命中, 刷新不受影响
  const wallets = useQuery({ queryKey: ["wallets", "all"], queryFn: async () => (await api.get<Wallet[]>("/wallets?include_archived=true")).data });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data });
  const contacts = useQuery({ queryKey: ["contacts", "all"], queryFn: async () => (await api.get<Contact[]>("/contacts?include_archived=true")).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const positions = useQuery({ queryKey: ["positions"], queryFn: async () => (await api.get<Position[]>("/investments/positions")).data });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: async () => (await api.get<{ base: string; quote: string; rate: number }[]>("/exchange-rates")).data });
  const frequent = useQuery({ queryKey: ["frequent"], queryFn: async () => (await api.get<FrequentItem[]>("/transactions/frequent?min_count=3&limit=12")).data });

  const { user } = useAuth();
  const baseCurrency = user?.primary_currency_code || localStorage.getItem("tally.baseCurrency") || "JPY";
  // 把某币种金额折算到主币种 (当期汇率), 用于每日汇总的等效合计
  const foldToBase = useMemo(() => {
    const digits = new Map((currencies.data ?? []).map((c) => [c.code, c.decimal_digits]));
    const rateMap = new Map<string, number>();
    for (const r of rates.data ?? []) if (!rateMap.has(`${r.base}->${r.quote}`)) rateMap.set(`${r.base}->${r.quote}`, r.rate);
    return (amt: number, from: string): number => {
      if (from === baseCurrency) return amt;
      const fd = digits.get(from) ?? 2, td = digits.get(baseCurrency) ?? 2;
      let rate = rateMap.get(`${from}->${baseCurrency}`);
      if (rate == null) { const rev = rateMap.get(`${baseCurrency}->${from}`); rate = rev ? 1 / rev : 0; }
      return Math.round(amt * rate * Math.pow(10, td - fd));
    };
  }, [currencies.data, rates.data, baseCurrency]);

  const quickAdd = useMutation({
    mutationFn: async (f: FrequentItem) => api.post("/transactions", {
      wallet_id: f.wallet_id,
      category_id: f.category_id,
      merchant_id: f.merchant_id,
      amount: f.amount,
      currency_code: f.currency_code,
      kind: "expense",
      occurred_on: todayIso(),
      note: "",
    }),
    onSuccess: () => {
      invalidateMoney(qc);
      qc.invalidateQueries({ queryKey: ["merchants"] });
    },
    // 审计#69: 失败别静默, 否则用户以为记上了实则少记 (或再点一次→重复记)
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      alert(r?.data?.detail ?? "快速添加失败");
    },
  });

  const catName = (id: number | null) => categories.data?.find((c) => c.id === id);
  const walletName = (id: number) => wallets.data?.find((w) => w.id === id)?.name ?? "?";
  const merchantName = (id: number | null) => merchants.data?.find((m) => m.id === id)?.name ?? "";
  const contactName = (id: number | null) => contacts.data?.find((c) => c.id === id)?.name ?? "";
  const posName = (id: number | null) => positions.data?.find((p) => p.id === id)?.name ?? "";

  const grouped = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of txs.data ?? []) {
      const arr = m.get(t.occurred_on) ?? [];
      arr.push(t);
      m.set(t.occurred_on, arr);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [txs.data]);

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/transactions/${id}`),
    onSuccess: () => {
      invalidateMoney(qc);
    },
    // 审计#69: 删除失败别静默
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      alert(r?.data?.detail ?? "删除失败");
    },
  });
  const unsplit = useMutation({
    mutationFn: async (group_id: string) => api.post(`/loans/unsplit/${group_id}`),
    onSuccess: () => {
      invalidateMoney(qc);
    },
    // 审计#69: 撤销分摊失败别静默
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      alert(r?.data?.detail ?? "撤销分摊失败");
    },
  });

  const total = totalCount.data ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasMore = page + 1 < totalPages;

  const activeFilters = [walletId, currency, kind, q, parentCatId, childCatId, start, end].filter(Boolean).length;
  const clearFilters = () => { setWalletId(""); setCurrency(""); setKind(""); setQ(""); setParentCatId(""); setChildCatId(""); setStart(""); setEnd(""); };
  // 同一组筛选控件: 桌面平铺、移动端塞进弹窗, 两处共用
  const renderFilters = () => (
    <>
      <select className="input" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
        <option value="">所有 Wallet</option>
        {(wallets.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
        <option value="">所有币种</option>
        {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
      </select>
      <select className="input" value={kind} onChange={(e) => { setKind(e.target.value); setParentCatId(""); setChildCatId(""); }}>
        <option value="">所有类型</option>
        <option value="expense">支出</option>
        <option value="income">收入</option>
        <option value="loan_out">借出</option>
        <option value="loan_repayment">还款</option>
      </select>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="备注 / 商家" />
      <select className="input" value={parentCatId} onChange={(e) => setParentCatId(e.target.value)}>
        <option value="">所有大类</option>
        {(kind === "" || kind === "expense") && (
          <optgroup label="支出">
            {(categories.data ?? []).filter((c) => c.parent_id === null && c.kind === "expense").map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
            ))}
          </optgroup>
        )}
        {(kind === "" || kind === "income") && (
          <optgroup label="收入">
            {(categories.data ?? []).filter((c) => c.parent_id === null && c.kind === "income").map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      <select className="input" value={childCatId} onChange={(e) => setChildCatId(e.target.value)} disabled={!parentCatId}>
        <option value="">{parentCatId ? "全部子分类" : "先选大类"}</option>
        {(categories.data ?? []).filter((c) => parentCatId && c.parent_id === Number(parentCatId)).map((c) => (
          <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
        ))}
      </select>
      <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} placeholder="开始" />
      <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="结束" />
    </>
  );

  return (
    <div className="px-4 py-5 pb-28 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">账单</h1>
          <p className="text-sm text-ink-500">所有记账记录（含分摊、借贷）</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setReimburseOpen(true)} className="btn-ghost">
            <FileText size={14} /> 报销
          </button>
          <button onClick={() => setTransferOpen(true)} className="btn-ghost">
            <ArrowLeftRight size={14} /> 转移
          </button>
          <button onClick={() => setCreditRepayOpen(true)} className="btn-ghost">
            <CreditCard size={14} /> 信用卡还款
          </button>
          <button onClick={() => navigate("/investments")} className="btn-ghost">
            <TrendingUp size={14} /> 投资
          </button>
          <button onClick={() => setQuickOpen(true)} className="btn-ghost">
            <Zap size={14} /> 快速添加
          </button>
          <button onClick={() => { setEditing(null); setOpen(true); }} className="btn-primary">
            <Plus size={14} /> 添加
          </button>
        </div>
      </div>

      {/* 桌面: 筛选控件直接平铺 */}
      <div className="card mb-3 hidden grid-cols-4 gap-2 sm:grid">
        {renderFilters()}
      </div>

      {/* 移动端: 收成一个"筛选"按钮, 点开弹出 */}
      <button
        onClick={() => setFilterOpen(true)}
        className="card mb-3 flex w-full items-center justify-between sm:hidden"
      >
        <span className="flex items-center gap-2 font-medium">
          <Filter size={16} /> 筛选
          {activeFilters > 0 && (
            <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{activeFilters}</span>
          )}
        </span>
        <span className="text-xs text-ink-500">{activeFilters > 0 ? "已筛选 · 点击修改" : "全部 · 点击筛选"}</span>
      </button>

      {filterOpen && (
        <Modal onClose={() => setFilterOpen(false)} title="筛选" maxW="max-w-sm">
          <div className="grid grid-cols-1 gap-3">
            {renderFilters()}
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={clearFilters} disabled={activeFilters === 0} className="btn-ghost flex-1 disabled:opacity-40">
              清除{activeFilters > 0 ? `（${activeFilters}）` : ""}
            </button>
            <button onClick={() => setFilterOpen(false)} className="btn-primary flex-1">查看结果</button>
          </div>
        </Modal>
      )}

      <div className="space-y-3">
        {grouped.length === 0 && <div className="card text-sm text-ink-500">没有符合条件的交易</div>}
        {grouped.map(([date, list]) => {
          // 按币种汇总当日收/支 (转账/借贷不进总额)
          const totals = new Map<string, { income: number; expense: number }>();
          for (const t of list) {
            if (t.kind !== "income" && t.kind !== "expense") continue;
            const row = totals.get(t.currency_code) ?? { income: 0, expense: 0 };
            if (t.kind === "income") row.income += t.amount;
            else row.expense += t.amount;
            totals.set(t.currency_code, row);
          }
          const hasForeign = Array.from(totals.keys()).some((c) => c !== baseCurrency);
          let baseExp = 0, baseInc = 0;
          for (const [code, row] of totals) { baseExp += foldToBase(row.expense, code); baseInc += foldToBase(row.income, code); }
          return (
          <div key={date} className="card p-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-ink-100 px-4 py-2 text-xs">
              <span className="text-ink-500">{date}</span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {Array.from(totals.entries()).map(([code, row]) => (
                  <span key={code} className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-ink-400">{code}</span>
                    {row.expense > 0 && (
                      <span className="text-rose-600">支 -{formatAmount(row.expense, code, currencies.data)}</span>
                    )}
                    {row.income > 0 && (
                      <span className="text-emerald-600">收 +{formatAmount(row.income, code, currencies.data)}</span>
                    )}
                  </span>
                ))}
                {hasForeign && (baseExp > 0 || baseInc > 0) && (
                  <span className="flex items-center gap-1.5 border-l border-ink-200 pl-3 dark:border-ink-700">
                    <span className="text-[10px] font-medium text-ink-400">≈ {baseCurrency}</span>
                    {baseExp > 0 && <span className="text-rose-500/80">支 -{formatAmount(baseExp, baseCurrency, currencies.data)}</span>}
                    {baseInc > 0 && <span className="text-emerald-500/80">收 +{formatAmount(baseInc, baseCurrency, currencies.data)}</span>}
                  </span>
                )}
              </div>
            </div>
            <div className="divide-y divide-ink-100">
              {list.map((t) => {
                const c = catName(t.category_id);
                const m = merchantName(t.merchant_id);
                const ct = contactName(t.contact_id);
                const pn = (t.kind === "invest_buy" || t.kind === "invest_sell") ? posName(t.position_id) : "";
                const isPositive = t.kind === "income" || t.kind === "loan_repayment" || t.kind === "transfer_in" || t.kind === "invest_sell";
                const amtColor =
                  t.kind === "income" || t.kind === "loan_repayment" ? "text-emerald-600"
                  : t.kind === "loan_out" ? "text-amber-600"
                  : (t.kind.startsWith("transfer") || t.kind.startsWith("invest")) ? "text-sky-600"
                  : "text-rose-600";
                const special = SPECIAL_TITLE[t.kind];
                const titleEmoji = special ? special.emoji : (c?.emoji ?? "");
                const titleName = special ? special.name : (c?.name ?? "未分类");
                return (
                  <div key={t.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{titleEmoji}</span>
                        <span className="font-medium">{titleName}</span>
                        {m && <span className="text-xs text-ink-500">· {m}</span>}
                        {pn && <span className="text-xs text-ink-500">· {pn}</span>}
                        {ct && <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-700">@{ct}</span>}
                        {t.split_group_id && <span className="rounded bg-purple-50 px-1 text-[10px] text-purple-700">分摊</span>}
                        {t.is_recurring && <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">周期</span>}
                      </div>
                      <div className="truncate text-xs text-ink-500">
                        {walletName(t.wallet_id)}{t.note ? ` · ${t.note}` : ""}
                      </div>
                    </div>
                    <div className={`shrink-0 font-semibold ${amtColor}`}>
                      {isPositive ? "+" : "-"}{formatAmount(t.amount, t.currency_code, currencies.data)}
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      {t.split_group_id && t.kind === "expense" && (
                        <button
                          onClick={() => { if (confirm("撤销分摊？相关贷款条目会被合并回单笔全额消费")) unsplit.mutate(t.split_group_id!); }}
                          className="btn-ghost p-2 sm:p-1.5"
                          title="撤销分摊"
                        ><Split size={14} /></button>
                      )}
                      {(t.kind === "expense" || t.kind === "income") && (
                        <button onClick={() => { setEditing(t); setOpen(true); }} className="btn-ghost p-2 sm:p-1.5"><Pencil size={14} /></button>
                      )}
                      <button
                        onClick={() => {
                          const msg = t.split_group_id ? "这是分摊订单，删除会一并清掉该组所有条目，确认？" : "删除这笔交易？";
                          if (confirm(msg)) del.mutate(t.id);
                        }}
                        className="btn-danger p-2 sm:p-1.5"
                      ><Trash2 size={14} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-500">每页</span>
          <select className="input w-20" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-xs text-ink-500">共 {total} 条 · {totalPages} 页</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="btn-ghost flex items-center gap-1 px-3 py-1.5 disabled:opacity-30"
          >
            <ChevronLeft size={14} /> 上一页
          </button>
          <PageJump page={page} totalPages={totalPages} onJump={setPage} />
          <button
            onClick={() => setPage(page + 1)}
            disabled={!hasMore}
            className="btn-ghost flex items-center gap-1 px-3 py-1.5 disabled:opacity-30"
          >
            下一页 <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <TransactionForm open={open} onClose={() => { setOpen(false); setEditing(null); }} editing={editing} />
      <TransferForm open={transferOpen} onClose={() => setTransferOpen(false)} />
      <CreditRepayForm open={creditRepayOpen} onClose={() => setCreditRepayOpen(false)} />
      <ReimburseForm open={reimburseOpen} onClose={() => setReimburseOpen(false)} />

      <button
        type="button"
        onClick={() => { setEditing(null); setOpen(true); }}
        aria-label="添加交易"
        className={`fixed bottom-24 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink-800 text-white shadow-lg shadow-black/30 transition-all duration-300 md:bottom-8 dark:bg-emerald-600 dark:hover:bg-emerald-500 ${fabTucked ? "pointer-events-none translate-x-[150%] opacity-0" : "hover:bg-ink-700"}`}
      >
        <Plus size={22} />
      </button>

      {quickOpen && (
        <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={() => setQuickOpen(false)}>
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold">快速添加</div>
                <div className="text-xs text-ink-500">常用账单 · 点一下用今天的日期再记一笔</div>
              </div>
              <button onClick={() => setQuickOpen(false)} className="text-ink-400 hover:text-ink-700">关闭</button>
            </div>
            {(frequent.data ?? []).length === 0 ? (
              <div className="rounded-md bg-ink-50 p-4 text-center text-sm text-ink-500 dark:bg-ink-800/40">
                还没有常用账单。完全一样的账单（钱包 / 分类 / 商家 / 金额）重复 3 次以上才会进来——点一下就直接落库, 不用再改.
              </div>
            ) : (
              <div className="space-y-1.5">
                {(frequent.data ?? []).map((f) => {
                  const title = f.merchant_name || f.category_name;
                  const sub = f.merchant_name ? `${f.wallet_name} · ${f.category_name}` : f.wallet_name;
                  return (
                    <button
                      key={`${f.merchant_id ?? "none"}-${f.currency_code}-${f.wallet_id}-${f.category_id ?? 0}`}
                      onClick={() => { quickAdd.mutate(f); setQuickOpen(false); }}
                      disabled={quickAdd.isPending}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white p-3 text-left text-sm hover:border-emerald-500 hover:shadow-sm dark:border-ink-700 dark:bg-ink-800/60 dark:hover:border-emerald-400"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span>{f.category_emoji}</span>
                          <span className="truncate font-medium">{title}</span>
                          <span className="shrink-0 rounded bg-ink-100 px-1 text-[10px] text-ink-600 dark:bg-ink-700">×{f.count}</span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-ink-500">{sub}</div>
                      </div>
                      <div className="shrink-0 font-semibold text-rose-600">
                        {formatAmount(f.amount, f.currency_code, currencies.data)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PageJump({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (p: number) => void }) {
  const [text, setText] = useState(String(page + 1));
  useEffect(() => { setText(String(page + 1)); }, [page]);

  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isNaN(n)) { setText(String(page + 1)); return; }
    const clamped = Math.max(1, Math.min(totalPages, n));
    onJump(clamped - 1);
    setText(String(clamped));
  };

  return (
    <div className="flex items-center gap-1 rounded bg-ink-100 px-2 py-1 text-xs text-ink-700 dark:bg-ink-700 dark:text-ink-200">
      <span>第</span>
      <input
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); } }}
        className="w-10 rounded bg-white px-1 text-center font-medium tabular-nums dark:bg-ink-800"
      />
      <span>/ {totalPages} 页</span>
    </div>
  );
}
