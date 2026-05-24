import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import TransactionForm from "../components/TransactionForm";
import { api, type Category, type Currency, type Merchant, type Transaction, type Wallet } from "../lib/api";
import { formatAmount } from "../lib/format";

export default function Transactions() {
  const qc = useQueryClient();
  const [walletId, setWalletId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [currency, setCurrency] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (walletId) p.set("wallet_id", walletId);
    if (categoryId) p.set("category_id", categoryId);
    if (currency) p.set("currency_code", currency);
    if (kind) p.set("kind", kind);
    if (q) p.set("q", q);
    if (start) p.set("start", start);
    if (end) p.set("end", end);
    p.set("limit", "200");
    return p.toString();
  }, [walletId, categoryId, currency, kind, q, start, end]);

  const txs = useQuery({
    queryKey: ["transactions", params],
    queryFn: async () => (await api.get<Transaction[]>(`/transactions?${params}`)).data,
  });
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: async () => (await api.get<Wallet[]>("/wallets?include_archived=true")).data });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

  const catName = (id: number | null) => categories.data?.find((c) => c.id === id);
  const walletName = (id: number) => wallets.data?.find((w) => w.id === id)?.name ?? "?";
  const merchantName = (id: number | null) => merchants.data?.find((m) => m.id === id)?.name ?? "";

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
    },
  });

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">交易</h1>
          <p className="text-sm text-ink-500">所有记账记录</p>
        </div>
        <button onClick={() => { setEditing(null); setOpen(true); }} className="btn-primary">
          <Plus size={14} /> 添加
        </button>
      </div>

      <div className="card mb-3 space-y-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select className="input" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            <option value="">所有 Wallet</option>
            {(wallets.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">所有分类</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.parent_id ? "  ↳ " : ""}{c.emoji} {c.name}</option>
            ))}
          </select>
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="">所有币种</option>
            {(currencies.data ?? []).map((c) => (
              <option key={c.code} value={c.code}>{c.code}</option>
            ))}
          </select>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">收入+支出</option>
            <option value="expense">仅支出</option>
            <option value="income">仅收入</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} placeholder="开始" />
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="结束" />
          <input className="input sm:col-span-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="备注关键词" />
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
                return (
                  <div key={t.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span>{c?.emoji}</span>
                        <span className="font-medium">{c?.name ?? "未分类"}</span>
                        {m && <span className="text-xs text-ink-500">· {m}</span>}
                      </div>
                      <div className="truncate text-xs text-ink-500">
                        {walletName(t.wallet_id)}{t.note ? ` · ${t.note}` : ""}
                      </div>
                    </div>
                    <div className={`shrink-0 font-semibold ${t.kind === "income" ? "text-emerald-600" : "text-rose-600"}`}>
                      {t.kind === "income" ? "+" : "-"}{formatAmount(t.amount, t.currency_code, currencies.data)}
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <button onClick={() => { setEditing(t); setOpen(true); }} className="btn-ghost p-1.5"><Pencil size={14} /></button>
                      <button onClick={() => { if (confirm("删除这笔交易？")) del.mutate(t.id); }} className="btn-danger p-1.5"><Trash2 size={14} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <TransactionForm open={open} onClose={() => { setOpen(false); setEditing(null); }} editing={editing} />
    </div>
  );
}
