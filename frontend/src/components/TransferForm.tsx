import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, type Currency, type Wallet } from "../lib/api";
import { parseAmount, todayIso } from "../lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FxPreview {
  from_currency: string;
  to_currency: string;
  from_amount: number;
  to_amount: number;
  rate: number | null;
  on_date: string | null;
}

export default function TransferForm({ open, onClose }: Props) {
  const qc = useQueryClient();
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: async () => (await api.get<Wallet[]>("/wallets")).data, enabled: open });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data, enabled: open });

  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [autoFetched, setAutoFetched] = useState<{ rate: number; on_date: string | null } | null>(null);
  const fromRef = useRef<HTMLInputElement>(null);

  const fromW = wallets.data?.find((w) => w.id === fromId) ?? null;
  const toW = wallets.data?.find((w) => w.id === toId) ?? null;
  const fromDigits = currencies.data?.find((c) => c.code === fromW?.currency_code)?.decimal_digits ?? 2;
  const toDigits = currencies.data?.find((c) => c.code === toW?.currency_code)?.decimal_digits ?? 2;
  const sameCurrency = fromW && toW && fromW.currency_code === toW.currency_code;
  const fromAmount = parseAmount(fromText || "0", fromDigits);
  const toAmount = sameCurrency ? fromAmount : parseAmount(toText || "0", toDigits);

  useEffect(() => {
    if (!open) return;
    setFromId(null);
    setToId(null);
    setFromText("");
    setToText("");
    setOccurredOn(todayIso());
    setNote("");
    setError("");
    setAutoFetched(null);
    setTimeout(() => fromRef.current?.focus(), 50);
  }, [open]);

  // pick sensible defaults once wallets load
  useEffect(() => {
    if (!open || !wallets.data?.length) return;
    if (fromId == null) {
      const active = wallets.data.find((w) => !w.archived) ?? wallets.data[0];
      setFromId(active.id);
    }
  }, [open, wallets.data, fromId]);

  const walletsByCurrency = useMemo(() => {
    const m = new Map<string, Wallet[]>();
    for (const w of (wallets.data ?? []).filter((x) => !x.archived)) {
      const arr = m.get(w.currency_code) ?? [];
      arr.push(w);
      m.set(w.currency_code, arr);
    }
    return Array.from(m.entries());
  }, [wallets.data]);

  const autoFill = useMutation({
    mutationFn: async () => {
      if (!fromW || !toW || fromAmount <= 0) throw new Error("先选钱包并填转出金额");
      const r = await api.get<FxPreview>("/transactions/fx-preview", {
        params: { from_currency: fromW.currency_code, to_currency: toW.currency_code, from_amount: fromAmount },
      });
      return r.data;
    },
    onSuccess: (p) => {
      if (!p.rate) {
        setError("汇率不存在，请去设置 → 汇率手动加一条");
        return;
      }
      setAutoFetched({ rate: p.rate, on_date: p.on_date });
      setToText((p.to_amount / Math.pow(10, toDigits)).toString());
      setError("");
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "获取汇率失败";
      setError(msg);
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!fromW || !toW) throw new Error("请选转出与转入钱包");
      if (fromW.id === toW.id) throw new Error("转出与转入钱包必须不同");
      if (fromAmount <= 0) throw new Error("转出金额需大于 0");
      if (toAmount <= 0) throw new Error("转入金额需大于 0");
      await api.post("/transactions/transfer", {
        from_wallet_id: fromW.id,
        to_wallet_id: toW.id,
        from_amount: fromAmount,
        to_amount: toAmount,
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
          <div className="text-lg font-semibold">转移</div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-ink-500">日期</span>
            <input className="input mt-0.5" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
          </label>

          <WalletPicker
            label="从（转出）"
            groups={walletsByCurrency}
            selectedId={fromId}
            disabledId={toId}
            onPick={(id) => setFromId(id)}
          />

          <div className="flex justify-center text-ink-400"><ArrowRight size={18} /></div>

          <WalletPicker
            label="到（转入）"
            groups={walletsByCurrency}
            selectedId={toId}
            disabledId={fromId}
            onPick={(id) => setToId(id)}
          />

          <div className="border-t border-ink-100 pt-3 dark:border-ink-700">
            <div className="flex items-stretch gap-2">
              <div className="flex-1">
                <div className="mb-0.5 text-xs text-ink-500">转出金额</div>
                <div className="flex">
                  <input
                    ref={fromRef}
                    inputMode="decimal"
                    className="input rounded-r-none text-lg"
                    placeholder="0"
                    value={fromText}
                    onChange={(e) => { setFromText(e.target.value); setAutoFetched(null); }}
                  />
                  <div className="flex shrink-0 items-center rounded-r-md bg-ink-800 px-3 text-sm font-semibold text-white">
                    {fromW?.currency_code ?? "—"}
                  </div>
                </div>
              </div>
              <div className="flex-1">
                <div className="mb-0.5 text-xs text-ink-500">转入金额{sameCurrency && <span className="text-ink-400">（同币种）</span>}</div>
                <div className="flex">
                  <input
                    inputMode="decimal"
                    className="input rounded-r-none text-lg"
                    placeholder="0"
                    value={sameCurrency ? fromText : toText}
                    onChange={(e) => { setToText(e.target.value); setAutoFetched(null); }}
                    disabled={!!sameCurrency}
                  />
                  <div className="flex shrink-0 items-center rounded-r-md bg-ink-800 px-3 text-sm font-semibold text-white">
                    {toW?.currency_code ?? "—"}
                  </div>
                </div>
              </div>
            </div>

            {!sameCurrency && fromW && toW && (
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => autoFill.mutate()}
                  disabled={autoFill.isPending || fromAmount <= 0}
                  className="btn-ghost px-2 py-1 text-xs"
                ><RefreshCw size={12} /> {autoFill.isPending ? "查询中…" : "按汇率自动换算"}</button>
                {autoFetched && (
                  <span className="text-xs text-ink-500">
                    1 {fromW.currency_code} = {autoFetched.rate.toFixed(6)} {toW.currency_code}
                    {autoFetched.on_date && <span className="text-ink-400"> · {autoFetched.on_date}</span>}
                  </span>
                )}
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-xs text-ink-500">备注</span>
            <input className="input mt-0.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选（例：5月房租转账 / 换汇）" />
          </label>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:pt-1">
            <button onClick={onClose} className="btn-ghost min-h-[44px] sm:min-h-0">取消</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary min-h-[44px] sm:min-h-0">
              {save.isPending ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WalletPicker({
  label, groups, selectedId, disabledId, onPick,
}: {
  label: string;
  groups: [string, Wallet[]][];
  selectedId: number | null;
  disabledId: number | null;
  onPick: (id: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-ink-500">{label}</div>
      <div className="space-y-1.5">
        {groups.map(([code, list]) => (
          <div key={code}>
            <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-500">{code}</div>
            <div className="flex flex-wrap gap-1.5">
              {list.map((w) => {
                const on = selectedId === w.id;
                const disabled = disabledId === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick(w.id)}
                    className={
                      on
                        ? "chip chip-selected"
                        : disabled
                          ? "chip chip-idle opacity-30"
                          : "chip chip-idle"
                    }
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
  );
}
