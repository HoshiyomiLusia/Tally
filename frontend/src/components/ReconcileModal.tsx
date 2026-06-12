import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, type Currency, type ReconciliationView, type Wallet } from "../lib/api";
import { formatAmount, parseAmount, todayIso } from "../lib/format";
import Modal from "./Modal";

const JPY_DENOMS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];
const CNY_DENOMS = [100, 50, 20, 10, 5, 1, 0.5, 0.1];
const USD_DENOMS = [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05, 0.01];

interface DenomRow {
  value: number;
  count: string;
}

function denomsFor(code: string, digits: number): number[] {
  switch (code) {
    case "JPY": return JPY_DENOMS;
    case "CNY": return CNY_DENOMS;
    case "USD": return USD_DENOMS;
    default: return digits === 0 ? [1000, 500, 100, 50, 10, 5, 1] : [100, 50, 20, 10, 5, 1, 0.5, 0.1];
  }
}

export default function ReconcileModal({ wallet, onClose }: { wallet: Wallet | null; onClose: () => void }) {
  const qc = useQueryClient();
  const view = useQuery({
    queryKey: ["reconciliation", wallet?.id],
    queryFn: async () => (await api.get<ReconciliationView>(`/wallets/${wallet!.id}/reconciliation`)).data,
    enabled: !!wallet,
  });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

  const digits = currencies.data?.find((c) => c.code === wallet?.currency_code)?.decimal_digits ?? 2;
  const [useDenom, setUseDenom] = useState(false);
  const [denomRows, setDenomRows] = useState<DenomRow[]>([]);
  const [actualText, setActualText] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!wallet) return;
    setUseDenom(wallet.type === "cash");
    setDenomRows(denomsFor(wallet.currency_code, digits).map((v) => ({ value: v, count: "" })));
    setActualText("");
    setOccurredOn(todayIso());
    setNote("");
    setError("");
  }, [wallet, digits]);

  const denomSum = useMemo(() => {
    let total = 0;
    for (const r of denomRows) {
      const n = parseInt(r.count || "0", 10) || 0;
      total += Math.round(r.value * Math.pow(10, digits)) * n;
    }
    return total;
  }, [denomRows, digits]);

  const actual = useDenom ? denomSum : parseAmount(actualText || "0", digits);
  const expected = view.data?.expected_physical ?? 0;
  const diff = actual - expected;

  const submit = useMutation({
    mutationFn: async () => {
      if (!wallet) return;
      await api.post(`/wallets/${wallet.id}/reconciliation`, {
        actual_balance: actual,
        occurred_on: occurredOn,
        note,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["reconciliation", wallet?.id] });
      onClose();
    },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      setError(r?.data?.detail ?? "对账失败");
    },
  });

  if (!wallet) return null;
  return (
    <Modal onClose={onClose} title={`对账 — ${wallet.name}`} maxW="max-w-md">

        <div className="mb-3 space-y-1 rounded-md bg-ink-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-600">真实余额</span>
            <span className="font-medium">{formatAmount(view.data?.system_balance ?? 0, wallet.currency_code, currencies.data)}</span>
          </div>
          {(view.data?.loan_out_on_wallet ?? 0) > 0 && (
            <div className="flex justify-between text-rose-600">
              <span>− 该卡借出</span>
              <span>{formatAmount(view.data!.loan_out_on_wallet, wallet.currency_code, currencies.data)}</span>
            </div>
          )}
          {(view.data?.loan_repayment_on_wallet ?? 0) > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>+ 该卡收到的还款</span>
              <span>{formatAmount(view.data!.loan_repayment_on_wallet, wallet.currency_code, currencies.data)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-ink-200 pt-1 font-semibold">
            <span>期望物理余额</span>
            <span>{formatAmount(expected, wallet.currency_code, currencies.data)}</span>
          </div>
        </div>

        <div className="mb-2 flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={useDenom} onChange={(e) => setUseDenom(e.target.checked)} />
            按面额计算（现金）
          </label>
        </div>

        {useDenom ? (
          <div className="mb-3 space-y-1.5 rounded-md bg-ink-50 p-2">
            {denomRows.map((r, i) => (
              <div key={r.value} className="flex items-center gap-2 text-sm">
                <div className="w-20 shrink-0 text-right">{r.value}</div>
                <div className="text-ink-400">×</div>
                <input
                  inputMode="numeric"
                  className="input"
                  value={r.count}
                  onChange={(e) => {
                    const copy = [...denomRows];
                    copy[i] = { ...r, count: e.target.value.replace(/\D/g, "") };
                    setDenomRows(copy);
                  }}
                  placeholder="0"
                />
              </div>
            ))}
            <div className="flex justify-end pt-1 text-sm">
              <span className="text-ink-500">合计：</span>
              <span className="ml-1 font-semibold">{formatAmount(denomSum, wallet.currency_code, currencies.data)}</span>
            </div>
          </div>
        ) : (
          <label className="mb-3 block">
            <span className="text-xs text-ink-500">实点金额</span>
            <input className="input mt-1" inputMode="decimal" value={actualText} onChange={(e) => setActualText(e.target.value)} autoFocus />
          </label>
        )}

        <div className="mb-2 rounded-md bg-ink-50 p-2 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-600">差额</span>
            <span className={`font-semibold ${diff === 0 ? "text-ink-500" : diff > 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {diff === 0 ? "0 (对得上)" : `${diff > 0 ? "+" : ""}${formatAmount(diff, wallet.currency_code, currencies.data)}`}
            </span>
          </div>
          {diff !== 0 && (
            <div className="mt-1 text-xs text-ink-500">
              将生成一笔 {diff > 0 ? "income (对账多出)" : "expense (对账缺失)"} 入分类「对账调整」
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-ink-500">日期</span>
            <input type="date" className="input mt-1" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">备注</span>
            <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
          </label>
        </div>

        {error && <div className="mt-2 text-sm text-red-600">{error}</div>}

        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">取消</button>
          <button onClick={() => submit.mutate()} disabled={submit.isPending} className="btn-primary">
            {submit.isPending ? "对账中…" : diff === 0 ? "确认（无差）" : "对账并调整"}
          </button>
        </div>
    </Modal>
  );
}
