import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Plus, Split, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import TransactionForm from "../components/TransactionForm";
import { api, type Category, type Contact, type Currency, type Merchant, type Transaction, type Wallet } from "../lib/api";
import { formatAmount } from "../lib/format";

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
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: async () => (await api.get<Wallet[]>("/wallets?include_archived=true")).data });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data });
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: async () => (await api.get<Contact[]>("/contacts?include_archived=true")).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

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

  const hasMore = (txs.data?.length ?? 0) === pageSize;

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">账单</h1>
          <p className="text-sm text-ink-500">所有记账记录（含分摊、借贷）</p>
        </div>
        <button onClick={() => { setEditing(null); setOpen(true); }} className="btn-primary">
          <Plus size={14} /> 添加
        </button>
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
        {grouped.map(([date, list]) => (
          <div key={date} className="card p-0">
            <div className="border-b border-ink-100 px-4 py-2 text-xs text-ink-500">{date}</div>
            <div className="divide-y divide-ink-100">
              {list.map((t) => {
                const c = catName(t.category_id);
                const m = merchantName(t.merchant_id);
                const ct = contactName(t.contact_id);
                const isPositive = t.kind === "income" || t.kind === "loan_repayment" || t.kind === "transfer_in";
                const amtColor =
                  t.kind === "income" || t.kind === "loan_repayment" ? "text-emerald-600"
                  : t.kind === "loan_out" ? "text-amber-600"
                  : t.kind.startsWith("transfer") ? "text-sky-600"
                  : "text-rose-600";
                return (
                  <div key={t.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{c?.emoji}</span>
                        <span className="font-medium">{c?.name ?? "未分类"}</span>
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
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-ink-500">每页</span>
          <select className="input w-20" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-ink-500">第 {page + 1} 页</span>
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="btn-ghost px-2 py-1 disabled:opacity-30">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => setPage(page + 1)} disabled={!hasMore} className="btn-ghost px-2 py-1 disabled:opacity-30">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <TransactionForm open={open} onClose={() => { setOpen(false); setEditing(null); }} editing={editing} />
    </div>
  );
}
