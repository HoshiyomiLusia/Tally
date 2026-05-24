import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api, type Budget, type BudgetProgress, type Category, type Currency } from "../lib/api";
import { formatAmount, parseAmount } from "../lib/format";

export default function Budgets() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);

  const list = useQuery({ queryKey: ["budgets"], queryFn: async () => (await api.get<Budget[]>("/budgets")).data });
  const progress = useQuery({ queryKey: ["budgets-progress"], queryFn: async () => (await api.get<BudgetProgress[]>("/budgets/progress")).data });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/budgets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["budgets-progress"] });
    },
  });

  const catName = (id: number | null) => id == null ? "总预算" : categories.data?.find((c) => c.id === id)?.name ?? "?";

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">预算</h1>
          <p className="text-sm text-ink-500">按分类 + 币种 + 周期，超支自动提示</p>
        </div>
        <button onClick={() => { setEditing(null); setOpen(true); }} className="btn-primary">
          <Plus size={14} /> 新建预算
        </button>
      </div>

      <div className="space-y-2">
        {(progress.data ?? []).length === 0 && <div className="card text-sm text-ink-500">还没有预算</div>}
        {(progress.data ?? []).map((p) => {
          const over = p.percent > 1;
          const warn = p.percent > 0.8 && !over;
          const barColor = over ? "bg-rose-500" : warn ? "bg-amber-500" : "bg-emerald-500";
          const note = list.data?.find((b) => b.id === p.budget_id)?.note ?? "";
          const isTotal = p.category_id == null;
          return (
            <div key={p.budget_id} className="card">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{p.category_name} <span className="text-xs text-ink-400">{p.currency_code} · {p.period === "monthly" ? "月" : "年"}</span></div>
                  {note ? (
                    <div className="truncate text-xs text-ink-500">{note}</div>
                  ) : isTotal ? (
                    <div className="truncate text-xs text-ink-400 italic">无备注（点编辑添加，方便区分多个总预算）</div>
                  ) : null}
                </div>
                <div className="shrink-0 text-sm">
                  <span className={over ? "text-rose-600" : warn ? "text-amber-600" : "text-ink-700"}>
                    {formatAmount(p.spent, p.currency_code, currencies.data)}
                  </span>
                  <span className="text-ink-400"> / {formatAmount(p.budget_amount, p.currency_code, currencies.data)}</span>
                </div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
                <div className={`h-full ${barColor}`} style={{ width: `${Math.min(p.percent * 100, 100)}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-xs">
                <span className="text-ink-500">{(p.percent * 100).toFixed(0)}% 已用</span>
                <span className={p.remaining >= 0 ? "text-ink-500" : "text-rose-600"}>
                  {p.remaining >= 0 ? "余 " : "超 "}{formatAmount(Math.abs(p.remaining), p.currency_code, currencies.data)}
                </span>
              </div>
              <div className="mt-2 flex justify-end gap-1">
                <button onClick={() => { const b = list.data?.find((x) => x.id === p.budget_id) ?? null; setEditing(b); setOpen(true); }} className="btn-ghost px-2 py-0.5 text-xs"><Pencil size={11} /> 编辑</button>
                <button onClick={() => { if (confirm("删除该预算？")) del.mutate(p.budget_id); }} className="btn-danger px-2 py-0.5 text-xs"><Trash2 size={11} /></button>
              </div>
            </div>
          );
        })}
      </div>

      <BudgetForm
        open={open}
        onClose={() => setOpen(false)}
        editing={editing}
        categories={categories.data ?? []}
        currencies={currencies.data ?? []}
      />
    </div>
  );
}

function BudgetForm({ open, onClose, editing, categories, currencies }: {
  open: boolean;
  onClose: () => void;
  editing: Budget | null;
  categories: Category[];
  currencies: Currency[];
}) {
  const qc = useQueryClient();
  const [categoryId, setCategoryId] = useState<string>("");
  const [currencyCode, setCurrencyCode] = useState("JPY");
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setCategoryId(editing?.category_id ? String(editing.category_id) : "");
    setCurrencyCode(editing?.currency_code ?? "JPY");
    setPeriod(editing?.period ?? "monthly");
    const cur = currencies.find((c) => c.code === (editing?.currency_code ?? "JPY"));
    const d = cur?.decimal_digits ?? 2;
    setAmountText(editing ? (editing.amount / Math.pow(10, d)).toString() : "");
    setNote(editing?.note ?? "");
    setError("");
  }, [open, editing, currencies]);

  const save = useMutation({
    mutationFn: async () => {
      const cur = currencies.find((c) => c.code === currencyCode);
      const d = cur?.decimal_digits ?? 2;
      const amount = parseAmount(amountText, d);
      if (amount <= 0) throw new Error("金额需大于 0");
      if (editing) {
        await api.patch(`/budgets/${editing.id}`, { amount, note });
      } else {
        await api.post("/budgets", {
          category_id: categoryId ? Number(categoryId) : null,
          currency_code: currencyCode,
          period,
          amount,
          note,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["budgets-progress"] });
      onClose();
    },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      const msg = e instanceof Error ? e.message : "保存失败";
      setError(r?.data?.detail ?? msg);
    },
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-lg font-semibold">{editing ? "编辑预算" : "新建预算"}</div>
        <div className="space-y-3">
          {!editing && (
            <>
              <label className="block">
                <span className="text-xs text-ink-500">分类（不选 = 总预算）</span>
                <select className="input mt-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">总预算（含所有支出）</option>
                  {categories.filter((c) => c.kind === "expense").map((c) => (
                    <option key={c.id} value={c.id}>{c.parent_id ? "  ↳ " : ""}{c.emoji} {c.name}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-ink-500">币种</span>
                  <select className="input mt-1" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
                    {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-ink-500">周期</span>
                  <select className="input mt-1" value={period} onChange={(e) => setPeriod(e.target.value as "monthly" | "yearly")}>
                    <option value="monthly">月</option>
                    <option value="yearly">年</option>
                  </select>
                </label>
              </div>
            </>
          )}
          <label className="block">
            <span className="text-xs text-ink-500">金额</span>
            <input className="input mt-1" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} autoFocus />
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">备注</span>
            <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn-ghost">取消</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">{save.isPending ? "保存中…" : "保存"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
