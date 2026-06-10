import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronLeft, ChevronRight, FileText, Pencil, Plus, Split, Trash2, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import ReimburseForm from "../components/ReimburseForm";
import TransactionForm from "../components/TransactionForm";
import TransferForm from "../components/TransferForm";
import { api, type Category, type Contact, type Currency, type Merchant, type Transaction, type Wallet } from "../lib/api";
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

const KIND_LABEL: Record<string, string> = {
  expense: "支出", income: "收入", transfer_out: "转出", transfer_in: "转入",
  loan_out: "借出", loan_repayment: "还款",
};

const PAGE_SIZES = [25, 50, 100, 200];

export default function Transactions() {
  const qc = useQueryClient();
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
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: async () => (await api.get<Wallet[]>("/wallets?include_archived=true")).data });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data });
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: async () => (await api.get<Contact[]>("/contacts?include_archived=true")).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const frequent = useQuery({ queryKey: ["frequent"], queryFn: async () => (await api.get<FrequentItem[]>("/transactions/frequent?min_count=3&limit=12")).data });

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
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["frequent"] });
      qc.invalidateQueries({ queryKey: ["merchants"] });
    },
  });

  const catName = (id: number | null) => categories.data?.find((c) => c.id === id);
  const walletName = (id: number) => wallets.data?.find((w) => w.id === id)?.name ?? "?";
  const merchantName = (id: number | null) => merchants.data?.find((m) => m.id === id)?.name ?? "";
  const contactName = (id: number | null) => contacts.data?.find((c) => c.id === id)?.name ?? "";

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
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["loan-accounts"] });
    },
  });
  const unsplit = useMutation({
    mutationFn: async (group_id: string) => api.post(`/loans/unsplit/${group_id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["loan-accounts"] });
    },
  });

  const total = totalCount.data ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasMore = page + 1 < totalPages;

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
          <button onClick={() => setQuickOpen(true)} className="btn-ghost">
            <Zap size={14} /> 快速添加
          </button>
          <button onClick={() => { setEditing(null); setOpen(true); }} className="btn-primary">
            <Plus size={14} /> 添加
          </button>
        </div>
      </div>

      <div className="card mb-3 space-y-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select className="input" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            <option value="">所有 Wallet</option>
            {(wallets.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="">所有币种</option>
            {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">所有类型</option>
            <option value="expense">支出</option>
            <option value="income">收入</option>
            <option value="loan_out">借出</option>
            <option value="loan_repayment">还款</option>
          </select>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="备注关键词" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select className="input" value={parentCatId} onChange={(e) => setParentCatId(e.target.value)}>
            <option value="">所有大类</option>
            {(categories.data ?? []).filter((c) => c.parent_id === null).map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
            ))}
          </select>
          <select
            className="input"
            value={childCatId}
            onChange={(e) => setChildCatId(e.target.value)}
            disabled={!parentCatId}
          >
            <option value="">{parentCatId ? "全部子分类" : "先选大类"}</option>
            {(categories.data ?? []).filter((c) => parentCatId && c.parent_id === Number(parentCatId)).map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
            ))}
          </select>
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} placeholder="开始" />
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="结束" />
        </div>
      </div>

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
          return (
          <div key={date} className="card p-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-ink-100 px-4 py-2 text-xs">
              <span className="text-ink-500">{date}</span>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {Array.from(totals.entries()).map(([code, row]) => (
                  <span key={code} className="flex items-center gap-1.5">
                    {row.expense > 0 && (
                      <span className="text-rose-600">支 -{formatAmount(row.expense, code, currencies.data)}</span>
                    )}
                    {row.income > 0 && (
                      <span className="text-emerald-600">收 +{formatAmount(row.income, code, currencies.data)}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
            <div className="divide-y divide-ink-100">
              {list.map((t) => {
                const c = catName(t.category_id);
                const m = merchantName(t.merchant_id);
                const ct = contactName(t.contact_id);
                const isTransfer = t.kind === "transfer_in" || t.kind === "transfer_out";
                const isPositive = t.kind === "income" || t.kind === "loan_repayment" || t.kind === "transfer_in";
                const amtColor =
                  t.kind === "income" || t.kind === "loan_repayment" ? "text-emerald-600"
                  : t.kind === "loan_out" ? "text-amber-600"
                  : t.kind.startsWith("transfer") ? "text-sky-600"
                  : "text-rose-600";
                const titleEmoji = isTransfer ? "🔁" : (c?.emoji ?? "");
                const titleName = isTransfer ? "转移" : (c?.name ?? "未分类");
                return (
                  <div key={t.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{titleEmoji}</span>
                        <span className="font-medium">{titleName}</span>
                        {m && <span className="text-xs text-ink-500">· {m}</span>}
                        {ct && <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-700">@{ct}</span>}
                        {t.kind !== "expense" && t.kind !== "income" && (
                          <span className="rounded bg-ink-100 px-1 text-[10px] text-ink-600">{KIND_LABEL[t.kind]}</span>
                        )}
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
                      <button onClick={() => { setEditing(t); setOpen(true); }} className="btn-ghost p-2 sm:p-1.5"><Pencil size={14} /></button>
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
      <ReimburseForm open={reimburseOpen} onClose={() => setReimburseOpen(false)} />

      <button
        type="button"
        onClick={() => { setEditing(null); setOpen(true); }}
        aria-label="添加交易"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink-800 text-white shadow-lg shadow-black/30 hover:bg-ink-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        <Plus size={22} />
      </button>

      {quickOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={() => setQuickOpen(false)}>
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
