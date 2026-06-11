import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, type Currency, type Transaction, type Wallet } from "../lib/api";
import { formatAmount, parseAmount } from "../lib/format";

interface Props {
  tx: Transaction | null;   // 周期账单模板 (upcoming 里的代表笔)
  due: string;              // 预计扣款日, 作日期默认值
  name: string;             // 账单显示名 (商家/备注/分类)
  open: boolean;
  onClose: () => void;
}

// 确认某期周期账单实际扣款: 金额/日期/账户预填, 可改, 确认即落一笔真实账单
export default function RecurringConfirmForm({ tx, due, name, open, onClose }: Props) {
  const qc = useQueryClient();
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: async () => (await api.get<Wallet[]>("/wallets")).data, enabled: open });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data, enabled: open });

  const [amountText, setAmountText] = useState("");
  const [occurredOn, setOccurredOn] = useState(due);
  const [walletId, setWalletId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const digits = currencies.data?.find((c) => c.code === tx?.currency_code)?.decimal_digits ?? 2;
  const payOptions = useMemo(
    () => (wallets.data ?? []).filter((w) => !w.archived && w.currency_code === tx?.currency_code),
    [wallets.data, tx],
  );
  const amount = parseAmount(amountText || "0", digits);

  // 打开时按模板预填
  useEffect(() => {
    if (!open || !tx) return;
    setAmountText((tx.amount / Math.pow(10, digits)).toString());
    setOccurredOn(due);
    setWalletId(tx.wallet_id);
    setNote(tx.note || "");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tx?.id, due, digits]);

  const save = useMutation({
    mutationFn: async () => {
      if (!tx) throw new Error("无账单");
      if (!walletId) throw new Error("请选择扣款账户");
      if (amount <= 0) throw new Error("金额需大于 0");
      await api.post(`/recurring/${tx.id}/confirm`, {
        amount,
        occurred_on: occurredOn,
        wallet_id: walletId,
        note,
      });
    },
    onSuccess: () => {
      for (const k of ["transactions", "wallets", "dashboard", "recurring-upcoming", "recurring-by-month", "recurring-groups", "stats-summary", "stats-compare", "stats-top-merchants", "stats-daily"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      onClose();
    },
    onError: (e: unknown) => {
      let msg = e instanceof Error ? e.message : "保存失败";
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      if (r?.data?.detail) msg = r.data.detail;
      setError(msg);
    },
  });

  if (!open || !tx) return null;
  const code = tx.currency_code;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl dark:bg-ink-900">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-lg font-semibold">确认扣款</div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700"><X size={18} /></button>
        </div>
        <div className="mb-3 truncate text-sm text-ink-500">{name}</div>

        <div className="space-y-3">
          {/* 金额 */}
          <div>
            <div className="mb-1 text-xs text-ink-500">实际扣款金额</div>
            <div className="flex items-stretch gap-2">
              <input
                inputMode="decimal"
                className="input flex-1 text-2xl"
                placeholder="0"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
              <div className="flex shrink-0 items-center rounded-md bg-ink-800 px-3 text-sm font-semibold text-white">{code}</div>
            </div>
          </div>

          {/* 扣款账户 (同币种) */}
          <div>
            <div className="mb-1 text-xs text-ink-500">扣款账户（{code}）</div>
            <div className="flex flex-wrap gap-1.5">
              {payOptions.map((w) => {
                const on = walletId === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setWalletId(w.id)}
                    className={on ? "chip chip-selected" : "chip chip-idle"}
                  >
                    {on && <span className="mr-0.5">✓</span>}
                    {w.name}
                  </button>
                );
              })}
              {payOptions.length === 0 && <span className="text-sm text-ink-400">没有同币种的账户</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-ink-500">扣款日期</span>
              <input className="input mt-0.5" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-ink-500">备注</span>
              <input className="input mt-0.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
            </label>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button onClick={onClose} className="btn-ghost min-h-[44px] sm:min-h-0">取消</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary min-h-[44px] sm:min-h-0">
              {save.isPending ? "保存中…" : `确认扣款 ${formatAmount(amount, code, currencies.data)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
