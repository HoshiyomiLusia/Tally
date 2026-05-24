import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, type Currency } from "../lib/api";
import { todayIso } from "../lib/format";
import { useAuth } from "../lib/auth";

interface Rate {
  id: number;
  on_date: string;
  base: string;
  quote: string;
  rate: number;
}

export default function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");

  const reset = useMutation({
    mutationFn: async () => api.post("/account/reset"),
    onSuccess: () => {
      qc.clear();
      setResetOpen(false);
      setResetConfirm("");
      navigate("/", { replace: true });
    },
  });

  const rates = useQuery({ queryKey: ["rates"], queryFn: async () => (await api.get<Rate[]>("/exchange-rates")).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

  const [d, setD] = useState(todayIso());
  const [base, setBase] = useState("JPY");
  const [quote, setQuote] = useState("CNY");
  const [rate, setRate] = useState("");

  useEffect(() => {
    if (currencies.data && !currencies.data.find((c) => c.code === base)) {
      setBase(currencies.data[0]?.code ?? "JPY");
    }
  }, [currencies.data, base]);

  const upsert = useMutation({
    mutationFn: async () => api.post("/exchange-rates", { on_date: d, base, quote, rate: parseFloat(rate) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rates"] });
      setRate("");
    },
  });

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/exchange-rates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rates"] }),
  });

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">设置</h1>
        <p className="text-sm text-ink-500">账号信息 · 汇率管理</p>
      </div>

      <div className="card mb-3">
        <div className="text-sm text-ink-500">已登录</div>
        <div className="font-medium">{user?.username}</div>
      </div>

      <div className="card">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="font-medium">汇率（手动）</div>
            <div className="text-xs text-ink-500">v0.1 手动维护，v0.5 自动拉取</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <input type="date" className="input" value={d} onChange={(e) => setD(e.target.value)} />
          <select className="input" value={base} onChange={(e) => setBase(e.target.value)}>
            {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
          <select className="input" value={quote} onChange={(e) => setQuote(e.target.value)}>
            {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
          <input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="如 22.91" />
          <button onClick={() => upsert.mutate()} disabled={upsert.isPending || !rate || base === quote} className="btn-primary">
            <Plus size={14} /> 添加
          </button>
        </div>
        <div className="mt-3 divide-y divide-ink-100">
          {(rates.data ?? []).length === 0 && <div className="py-4 text-center text-sm text-ink-500">还没维护汇率</div>}
          {(rates.data ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2 text-sm">
              <div>{r.on_date} · 1 {r.base} = {r.rate} {r.quote}</div>
              <button onClick={() => del.mutate(r.id)} className="btn-danger p-1.5"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="card mt-3 border-rose-200">
        <div className="mb-2 flex items-center gap-1.5 text-rose-600">
          <AlertTriangle size={16} />
          <div className="font-medium">危险区域</div>
        </div>
        <div className="text-sm text-ink-600">
          清除当前账号下的所有 Wallet、交易、分类、商家，并重新填充默认分类和商家。账号本身保留。汇率（全局）不受影响。
        </div>
        <button onClick={() => setResetOpen(true)} className="btn-danger mt-2 bg-rose-50">
          <Trash2 size={14} /> 重置所有数据
        </button>
      </div>

      {resetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => !reset.isPending && setResetOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-1.5 text-rose-600">
              <AlertTriangle size={18} />
              <div className="font-semibold">重置所有数据</div>
            </div>
            <div className="text-sm text-ink-600">
              这会删除当前账号下的全部 Wallet、交易、分类、商家。账号保留，分类与商家会重新种子。**不可撤销**。
            </div>
            <div className="mt-3 text-xs text-ink-500">输入 <span className="font-mono font-semibold">RESET</span> 以确认</div>
            <input
              className="input mt-1"
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              autoFocus
              placeholder="RESET"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setResetOpen(false)} disabled={reset.isPending} className="btn-ghost">取消</button>
              <button
                onClick={() => reset.mutate()}
                disabled={resetConfirm !== "RESET" || reset.isPending}
                className="btn-danger bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300"
              >
                {reset.isPending ? "重置中…" : "确认重置"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
