import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, type Currency, type Wallet } from "../lib/api";
import { formatAmount, parseAmount, todayIso } from "../lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
}

// 信用卡还款 = 从支付账户转账到信用卡 (同币种), 复用 /transactions/transfer
export default function CreditRepayForm({ open, onClose }: Props) {
  const qc = useQueryClient();
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: async () => (await api.get<Wallet[]>("/wallets")).data, enabled: open });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data, enabled: open });

  const [cardId, setCardId] = useState<number | null>(null);
  const [payId, setPayId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const cards = useMemo(
    () => (wallets.data ?? []).filter((w) => w.type === "credit_card" && !w.archived),
    [wallets.data],
  );
  const card = wallets.data?.find((w) => w.id === cardId) ?? null;
  const digits = currencies.data?.find((c) => c.code === card?.currency_code)?.decimal_digits ?? 2;
  // 信用卡待还 = -系统余额 (刷卡让余额变负)
  const debt = card ? -card.balance : 0;
  // 可选支付账户: 同币种, 非信用卡
  const payOptions = useMemo(
    () => (wallets.data ?? []).filter((w) => !w.archived && w.type !== "credit_card" && w.currency_code === card?.currency_code),
    [wallets.data, card],
  );
  const amount = parseAmount(amountText || "0", digits);

  useEffect(() => {
    if (!open) return;
    setCardId(null);
    setPayId(null);
    setAmountText("");
    setOccurredOn(todayIso());
    setNote("");
    setError("");
  }, [open]);

  // 选了卡之后默认带出待还金额, 并清空支付账户(币种可能变)
  useEffect(() => {
    if (card && debt > 0) setAmountText((debt / Math.pow(10, digits)).toString());
    setPayId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!card) throw new Error("请选择要还款的信用卡");
      if (!payId) throw new Error("请选择支付账户");
      if (amount <= 0) throw new Error("还款金额需大于 0");
      await api.post("/transactions/transfer", {
        from_wallet_id: payId,
        to_wallet_id: card.id,
        from_amount: amount,
        to_amount: amount,
        occurred_on: occurredOn,
        note: note || `信用卡还款: ${card.name}`,
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
    <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center">
      <div className="anim-sheet max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl dark:bg-ink-900">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">信用卡还款</div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          {/* 选信用卡 */}
          <div>
            <div className="mb-1 text-xs text-ink-500">还哪张信用卡</div>
            <div className="flex flex-wrap gap-1.5">
              {cards.map((c) => {
                const on = cardId === c.id;
                const d = -c.balance;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCardId(c.id)}
                    className={on ? "chip chip-selected" : "chip chip-idle"}
                  >
                    {on && <span className="mr-0.5">✓</span>}
                    {c.name}
                    {d > 0 && <span className="ml-1 opacity-70">待还 {formatAmount(d, c.currency_code, currencies.data)}</span>}
                  </button>
                );
              })}
              {cards.length === 0 && <span className="text-sm text-ink-400">没有信用卡账户</span>}
            </div>
          </div>

          {card && (
            <>
              {/* 还款金额 + 全部还款 */}
              <div className="border-t border-ink-100 pt-3 dark:border-ink-700">
                <div className="mb-1 flex items-center justify-between text-xs text-ink-500">
                  <span>还款金额</span>
                  {debt > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmountText((debt / Math.pow(10, digits)).toString())}
                      className="rounded-full border border-emerald-500 px-2 py-0.5 text-[11px] text-emerald-600 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    >全部还清 {formatAmount(debt, card.currency_code, currencies.data)}</button>
                  )}
                </div>
                <div className="flex items-stretch gap-2">
                  <input
                    inputMode="decimal"
                    className="input flex-1 text-2xl"
                    placeholder="0"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                  />
                  <div className="flex shrink-0 items-center rounded-md bg-ink-800 px-3 text-sm font-semibold text-white">
                    {card.currency_code}
                  </div>
                </div>
                {debt > 0 && amount > debt && (
                  <div className="mt-1 text-[11px] text-amber-600">还款额超过待还 {formatAmount(debt, card.currency_code, currencies.data)}，多出的会让该卡变成正余额（预存）。</div>
                )}
              </div>

              {/* 支付账户 (同币种, 非信用卡) */}
              <div className="border-t border-ink-100 pt-3 dark:border-ink-700">
                <div className="mb-1 text-xs text-ink-500">从哪个账户扣款（{card.currency_code}）</div>
                <div className="flex flex-wrap gap-1.5">
                  {payOptions.map((w) => {
                    const on = payId === w.id;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => setPayId(w.id)}
                        className={on ? "chip chip-selected" : "chip chip-idle"}
                      >
                        {on && <span className="mr-0.5">✓</span>}
                        {w.name}
                      </button>
                    );
                  })}
                  {payOptions.length === 0 && <span className="text-sm text-ink-400">没有同币种的可用账户</span>}
                </div>
              </div>

              <label className="block">
                <span className="text-xs text-ink-500">日期</span>
                <input className="input mt-0.5" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
              </label>

              <label className="block">
                <span className="text-xs text-ink-500">备注</span>
                <input className="input mt-0.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder={`信用卡还款: ${card.name}`} />
              </label>
            </>
          )}

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:pt-1">
            <button onClick={onClose} className="btn-ghost min-h-[44px] sm:min-h-0">取消</button>
            <button onClick={() => save.mutate()} disabled={save.isPending || !card} className="btn-primary min-h-[44px] sm:min-h-0">
              {save.isPending ? "保存中…" : "确认还款"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
