import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  type Category,
  type Currency,
  type Merchant,
  type Transaction,
  type Wallet,
} from "../lib/api";
import { formatAmount, parseAmount, todayIso } from "../lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ReimburseForm({ open, onClose }: Props) {
  const qc = useQueryClient();
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: async () => (await api.get<Wallet[]>("/wallets")).data, enabled: open });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data, enabled: open });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data, enabled: open });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data, enabled: open });

  const [q, setQ] = useState("");
  const recent = useQuery({
    queryKey: ["transactions", "for-reimburse", q],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("kind", "expense");
      p.set("limit", "50");
      if (q) p.set("q", q);
      return (await api.get<Transaction[]>(`/transactions?${p.toString()}`)).data;
    },
    enabled: open,
  });

  const [picked, setPicked] = useState<Transaction | null>(null);
  const [walletId, setWalletId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setPicked(null);
    setWalletId(null);
    setAmountText("");
    setOccurredOn(todayIso());
    setNote("");
    setError("");
  }, [open]);

  const reimburseCat = useMemo(
    () => (categories.data ?? []).find((c) => c.kind === "income" && c.name === "报销"),
    [categories.data],
  );

  const wallet = wallets.data?.find((w) => w.id === walletId) ?? null;
  const digits = currencies.data?.find((c) => c.code === wallet?.currency_code)?.decimal_digits ?? 2;
  const amount = parseAmount(amountText || "0", digits);

  const walletsByCurrency = useMemo(() => {
    const m = new Map<string, Wallet[]>();
    for (const w of (wallets.data ?? []).filter((x) => !x.archived)) {
      const arr = m.get(w.currency_code) ?? [];
      arr.push(w);
      m.set(w.currency_code, arr);
    }
    return Array.from(m.entries());
  }, [wallets.data]);

  const catName = (id: number | null) => id == null ? "未分类" : categories.data?.find((c) => c.id === id)?.name ?? "?";
  const catEmoji = (id: number | null) => id == null ? "" : categories.data?.find((c) => c.id === id)?.emoji ?? "";
  const walletName = (id: number) => wallets.data?.find((w) => w.id === id)?.name ?? "?";
  const merchantName = (id: number | null) => id == null ? "" : merchants.data?.find((m) => m.id === id)?.name ?? "";

  function pick(t: Transaction) {
    setPicked(t);
    setWalletId(t.wallet_id);
    setAmountText((t.amount / Math.pow(10, currencies.data?.find((c) => c.code === t.currency_code)?.decimal_digits ?? 2)).toString());
    const desc = merchantName(t.merchant_id) || catName(t.category_id);
    setNote(`报销: ${desc} [tx#${t.id}]`);
    setTimeout(() => amountRef.current?.focus(), 50);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error("先选要报销的账单");
      if (!wallet) throw new Error("请选入账钱包");
      if (amount <= 0) throw new Error("金额需大于 0");
      if (!reimburseCat) throw new Error("找不到 '报销' 分类, 设置里检查一下");
      await api.post("/transactions", {
        wallet_id: wallet.id,
        category_id: reimburseCat.id,
        merchant_id: picked.merchant_id,
        amount,
        currency_code: wallet.currency_code,
        kind: "income",
        occurred_on: occurredOn,
        note,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e: unknown) => {
      let msg = e instanceof Error ? e.message : "保存失败";
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      if (r?.data?.detail) msg = r.data.detail;
      setError(msg);
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">报销</div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700"><X size={18} /></button>
        </div>

        {!picked ? (
          <div className="space-y-3">
            <div className="text-xs text-ink-500">① 选要报销的账单</div>
            <input
              className="input"
              placeholder="搜索备注 / 商家 / 分类..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
              {(recent.data ?? []).length === 0 && (
                <div className="rounded-md bg-ink-50 p-4 text-center text-sm text-ink-500 dark:bg-ink-800/40">
                  {q ? "没匹配到账单" : "没有可报销的支出"}
                </div>
              )}
              {(recent.data ?? []).map((t) => (
                <button
                  key={t.id}
                  onClick={() => pick(t)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink-200 bg-white p-2.5 text-left text-sm hover:border-emerald-500 dark:border-ink-700 dark:bg-ink-800/60 dark:hover:border-emerald-400"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span>{catEmoji(t.category_id)}</span>
                      <span className="truncate font-medium">{catName(t.category_id)}</span>
                      {merchantName(t.merchant_id) && (
                        <span className="truncate text-xs text-ink-500">· {merchantName(t.merchant_id)}</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-ink-500">
                      {t.occurred_on} · {walletName(t.wallet_id)}{t.note ? ` · ${t.note}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 font-semibold text-rose-600">
                    {formatAmount(t.amount, t.currency_code, currencies.data)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-ink-500">② 报销详情</div>
              <button onClick={() => setPicked(null)} className="btn-ghost px-2 py-0.5 text-xs">
                <ChevronLeft size={12} /> 重选账单
              </button>
            </div>

            <div className="rounded-lg border border-ink-200 bg-ink-50 p-2.5 text-sm dark:border-ink-700 dark:bg-ink-800/40">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span>{catEmoji(picked.category_id)}</span>
                    <span className="truncate font-medium">{catName(picked.category_id)}</span>
                    {merchantName(picked.merchant_id) && (
                      <span className="truncate text-xs text-ink-500">· {merchantName(picked.merchant_id)}</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-ink-500">
                    {picked.occurred_on} · {walletName(picked.wallet_id)}{picked.note ? ` · ${picked.note}` : ""}
                  </div>
                </div>
                <div className="shrink-0 font-semibold text-rose-600">
                  {formatAmount(picked.amount, picked.currency_code, currencies.data)}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs text-ink-500">入账钱包（可与原账单不同币种）</div>
              <div className="space-y-1.5">
                {walletsByCurrency.map(([code, list]) => (
                  <div key={code}>
                    <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-500">{code}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((w) => {
                        const on = walletId === w.id;
                        return (
                          <button
                            key={w.id}
                            type="button"
                            onClick={() => {
                              // 切到不同币种时清空金额, 强制用户按实际入账金额重填
                              if (wallet && wallet.currency_code !== w.currency_code) {
                                setAmountText("");
                              }
                              setWalletId(w.id);
                            }}
                            className={on ? "chip chip-selected" : "chip chip-idle"}
                          >
                            {on && <span className="mr-0.5">✓</span>}
                            {w.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-ink-500">
                <span>报销金额</span>
                {wallet && picked.currency_code !== wallet.currency_code && (
                  <span className="text-amber-600">跨币种, 按实际入账填</span>
                )}
              </div>
              <div className="flex items-stretch gap-2">
                <input
                  ref={amountRef}
                  inputMode="decimal"
                  className="input flex-1 text-lg"
                  placeholder="0"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                />
                <div className={`flex shrink-0 items-center rounded-md px-3 text-sm font-semibold ${wallet ? "bg-ink-800 text-white" : "bg-amber-50 text-amber-700"}`}>
                  {wallet?.currency_code ?? "—"}
                </div>
              </div>
            </div>

            <label className="block">
              <span className="text-xs text-ink-500">日期</span>
              <input className="input mt-0.5" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </label>

            <label className="block">
              <span className="text-xs text-ink-500">备注</span>
              <input className="input mt-0.5" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:pt-1">
              <button onClick={onClose} className="btn-ghost min-h-[44px] sm:min-h-0">取消</button>
              <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary min-h-[44px] sm:min-h-0">
                {save.isPending ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
