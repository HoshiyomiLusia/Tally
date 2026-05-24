import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, type Category, type Currency, type Merchant, type Transaction, type Wallet } from "../lib/api";
import { parseAmount, todayIso } from "../lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: Transaction | null;
}

export default function TransactionForm({ open, onClose, editing }: Props) {
  const qc = useQueryClient();
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: async () => (await api.get<Wallet[]>("/wallets")).data, enabled: open });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data, enabled: open });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data, enabled: open });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data, enabled: open });

  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [walletId, setWalletId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [merchantInput, setMerchantInput] = useState("");
  const [merchantId, setMerchantId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setKind(editing.kind === "income" ? "income" : "expense");
      setWalletId(editing.wallet_id);
      setCategoryId(editing.category_id);
      setMerchantId(editing.merchant_id);
      setMerchantInput(merchants.data?.find((m) => m.id === editing.merchant_id)?.name ?? "");
      setOccurredOn(editing.occurred_on);
      setNote(editing.note);
      const cur = currencies.data?.find((c) => c.code === editing.currency_code);
      const digits = cur?.decimal_digits ?? 2;
      setAmountText((editing.amount / Math.pow(10, digits)).toString());
    } else {
      setKind("expense");
      setCategoryId(null);
      setMerchantInput("");
      setMerchantId(null);
      setAmountText("");
      setOccurredOn(todayIso());
      setNote("");
    }
    setError("");
    setTimeout(() => amountRef.current?.focus(), 50);
  }, [open, editing, merchants.data, currencies.data]);

  const wallet = wallets.data?.find((w) => w.id === walletId) ?? null;

  useEffect(() => {
    if (!open) return;
    if (walletId == null && wallets.data?.length) {
      const active = wallets.data.find((w) => !w.archived) ?? wallets.data[0];
      setWalletId(active.id);
    }
  }, [open, wallets.data, walletId]);

  const filteredCategories = useMemo(() => {
    return (categories.data ?? []).filter((c) => c.kind === kind);
  }, [categories.data, kind]);

  const topLevel = filteredCategories.filter((c) => c.parent_id === null);
  const childrenByParent = useMemo(() => {
    const m = new Map<number, Category[]>();
    for (const c of filteredCategories) {
      if (c.parent_id != null) {
        const arr = m.get(c.parent_id) ?? [];
        arr.push(c);
        m.set(c.parent_id, arr);
      }
    }
    return m;
  }, [filteredCategories]);
  const selectedCat = filteredCategories.find((c) => c.id === categoryId) ?? null;
  const expandedParent = selectedCat?.parent_id ?? (selectedCat && childrenByParent.get(selectedCat.id) ? selectedCat.id : null);

  const merchantSuggestions = useMemo(() => {
    const all = merchants.data ?? [];
    if (!merchantInput) return all.slice(0, 8);
    const q = merchantInput.toLowerCase();
    return all.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [merchants.data, merchantInput]);

  const save = useMutation({
    mutationFn: async () => {
      if (!wallet) throw new Error("请选择 Wallet");
      const digits = currencies.data?.find((c) => c.code === wallet.currency_code)?.decimal_digits ?? 2;
      const amount = parseAmount(amountText, digits);
      if (amount <= 0) throw new Error("金额需大于 0");
      let mid = merchantId;
      const matched = merchants.data?.find((m) => m.name === merchantInput.trim());
      if (merchantInput.trim() && !matched) {
        const r = await api.post<Merchant>("/merchants", { name: merchantInput.trim() });
        mid = r.data.id;
        qc.invalidateQueries({ queryKey: ["merchants"] });
      } else if (matched) {
        mid = matched.id;
      } else {
        mid = null;
      }
      const payload = {
        wallet_id: wallet.id,
        category_id: categoryId,
        merchant_id: mid,
        amount,
        currency_code: wallet.currency_code,
        kind,
        occurred_on: occurredOn,
        note,
      };
      if (editing) {
        await api.patch(`/transactions/${editing.id}`, payload);
      } else {
        await api.post("/transactions", payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "保存失败";
      setError(msg);
    },
  });

  function onMerchantPick(m: Merchant) {
    setMerchantInput(m.name);
    setMerchantId(m.id);
    if (m.default_category_id && !categoryId) {
      setCategoryId(m.default_category_id);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">{editing ? "编辑交易" : "添加交易"}</div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setKind("expense")}
              className={`flex-1 rounded-md py-2 text-sm font-medium ${kind === "expense" ? "bg-ink-800 text-white" : "bg-ink-100 text-ink-600"}`}
            >支出</button>
            <button
              type="button"
              onClick={() => setKind("income")}
              className={`flex-1 rounded-md py-2 text-sm font-medium ${kind === "income" ? "bg-emerald-600 text-white" : "bg-ink-100 text-ink-600"}`}
            >收入</button>
          </div>

          <div className="flex items-baseline gap-2">
            <input
              ref={amountRef}
              inputMode="decimal"
              className="input flex-1 text-2xl"
              placeholder="0"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
            <div className="text-ink-500">{wallet?.currency_code ?? ""}</div>
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-500">Wallet</div>
            <div className="flex flex-wrap gap-1">
              {(wallets.data ?? []).filter((w) => !w.archived).map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWalletId(w.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${walletId === w.id ? "border-ink-800 bg-ink-800 text-white" : "border-ink-200 bg-white text-ink-600"}`}
                >
                  {w.name} <span className="opacity-60">{w.currency_code}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-500">分类</div>
            <div className="flex flex-wrap gap-1">
              {topLevel.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    const kids = childrenByParent.get(p.id);
                    if (kids && kids.length) {
                      setCategoryId(kids[0].id);
                    } else {
                      setCategoryId(p.id);
                    }
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs ${expandedParent === p.id ? "border-ink-800 bg-ink-100 text-ink-900" : "border-ink-200 bg-white text-ink-600"}`}
                >
                  {p.emoji} {p.name}
                </button>
              ))}
            </div>
            {expandedParent != null && childrenByParent.get(expandedParent) && (
              <div className="mt-1.5 flex flex-wrap gap-1 border-t border-ink-100 pt-1.5">
                {(childrenByParent.get(expandedParent) ?? []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryId(c.id)}
                    className={`rounded-full px-2.5 py-1 text-xs ${categoryId === c.id ? "bg-ink-800 text-white" : "bg-ink-50 text-ink-700 hover:bg-ink-100"}`}
                  >
                    {c.emoji} {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-500">商家 (可选)</div>
            <input
              className="input"
              value={merchantInput}
              placeholder="输入或选择"
              onChange={(e) => { setMerchantInput(e.target.value); setMerchantId(null); }}
            />
            {merchantSuggestions.length > 0 && merchantInput !== merchants.data?.find((m) => m.id === merchantId)?.name && (
              <div className="mt-1 flex flex-wrap gap-1">
                {merchantSuggestions.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onMerchantPick(m)}
                    className="rounded-full bg-ink-50 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-100"
                  >{m.name}</button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-ink-500">日期</span>
              <input className="input mt-0.5" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-ink-500">备注</span>
              <input className="input mt-0.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
            </label>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn-ghost">取消</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
              {save.isPending ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
