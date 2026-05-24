import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

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
        <div className="font-medium">{user?.email}</div>
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
    </div>
  );
}
