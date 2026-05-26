import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Download, LogOut, Plus, RefreshCw, Store, Tags, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api, type Currency } from "../lib/api";
import { useAuth } from "../lib/auth";
import { todayIso } from "../lib/format";

interface Rate {
  id: number;
  on_date: string;
  base: string;
  quote: string;
  rate: number;
  source: string;
}

export default function Settings() {
  const { user, logout, refresh: refreshUser } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const savePrimaryCurrency = useMutation({
    mutationFn: async (code: string) => api.patch("/users/me", { primary_currency_code: code }),
    onSuccess: () => { refreshUser(); },
  });
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

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

  const refresh = useMutation({
    mutationFn: async () => (await api.post<{ updated: number }>("/exchange-rates/refresh")).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["rates"] });
      alert(`已更新 ${data.updated} 条汇率（来自 frankfurter.app）`);
    },
    onError: () => alert("自动拉取失败，可能没有网络"),
  });

  const reset = useMutation({
    mutationFn: async () => api.post("/account/reset"),
    onSuccess: () => {
      qc.clear();
      setResetOpen(false);
      setResetConfirm("");
      navigate("/", { replace: true });
    },
  });

  async function downloadExport(kind: "json" | "csv" | "xlsx") {
    const r = await api.get(`/export/${kind}`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    const ext = kind === "xlsx" ? "xlsx" : kind;
    a.download = `tally-${user?.username}-${todayIso()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const importMut = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const data = JSON.parse(text);
      await api.post("/import/json", { data });
    },
    onSuccess: () => {
      qc.clear();
      alert("导入成功");
      navigate("/", { replace: true });
    },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      alert(`导入失败：${r?.data?.detail ?? (e as Error).message}`);
    },
  });

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">设置</h1>
        <p className="text-sm text-ink-500">账号 · 汇率 · 备份导入导出</p>
      </div>

      <div className="card mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm text-ink-500">已登录</div>
          <div className="font-medium">{user?.username}</div>
        </div>
        <button onClick={logout} className="btn-ghost"><LogOut size={14} /> 登出</button>
      </div>

      <div className="card mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">主要使用币种</div>
          <div className="text-xs text-ink-500">仪表盘 / 统计页跨币种汇总默认折算到这个币种</div>
        </div>
        <select
          value={user?.primary_currency_code ?? ""}
          onChange={(e) => savePrimaryCurrency.mutate(e.target.value)}
          disabled={savePrimaryCurrency.isPending}
          className="input w-auto"
        >
          <option value="">(未设置, 默认 JPY)</option>
          {(currencies.data ?? []).map((c) => (
            <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
          ))}
        </select>
      </div>

      <div className="card mb-3 p-0">
        <div className="px-4 pt-3 pb-2 text-xs font-medium uppercase tracking-wider text-ink-500">管理</div>
        {[
          { to: "/categories", label: "分类", desc: "二级分类树 + emoji", icon: Tags },
          { to: "/merchants",  label: "商家", desc: "常用商家 + 默认分类", icon: Store },
        ].map((m) => (
          <Link key={m.to} to={m.to} className="flex items-center justify-between gap-2 border-t border-ink-100 px-4 py-3 hover:bg-ink-50">
            <div className="flex items-center gap-3">
              <m.icon size={16} className="text-ink-500" />
              <div>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="text-xs text-ink-500">{m.desc}</div>
              </div>
            </div>
            <ChevronRight size={16} className="text-ink-400" />
          </Link>
        ))}
      </div>

      <div className="card mb-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="font-medium">备份 / 导入</div>
            <div className="text-xs text-ink-500">本地数据导出供异机迁移 · 导入会清空现有数据</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => downloadExport("json")} className="btn-ghost"><Download size={14} /> 导出 JSON (备份用)</button>
          <button onClick={() => downloadExport("csv")} className="btn-ghost"><Download size={14} /> 导出 CSV</button>
          <button onClick={() => downloadExport("xlsx")} className="btn-ghost"><Download size={14} /> 导出 Excel</button>
          <button onClick={() => importRef.current?.click()} className="btn-ghost"><Upload size={14} /> 导入 JSON</button>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && confirm("导入会清空当前账号的所有数据后用文件覆盖，继续？")) importMut.mutate(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="card mb-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="font-medium">汇率</div>
            <div className="text-xs text-ink-500">自动从 frankfurter.app 拉取 · 每 6 小时一次 · 手动条目优先</div>
          </div>
          <button onClick={() => refresh.mutate()} disabled={refresh.isPending} className="btn-ghost">
            <RefreshCw size={14} className={refresh.isPending ? "animate-spin" : ""} /> 立即刷新
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <input type="date" className="input" value={d} onChange={(e) => setD(e.target.value)} />
          <select className="input" value={base} onChange={(e) => setBase(e.target.value)}>
            {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
          <select className="input" value={quote} onChange={(e) => setQuote(e.target.value)}>
            {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
          <input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="手动如 22.91" />
          <button onClick={() => upsert.mutate()} disabled={upsert.isPending || !rate || base === quote} className="btn-primary">
            <Plus size={14} /> 添加
          </button>
        </div>
        <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-ink-100">
          {(rates.data ?? []).length === 0 && <div className="py-4 text-center text-sm text-ink-500">还没有汇率数据</div>}
          {(rates.data ?? []).slice(0, 50).map((r) => (
            <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
              <div>
                <span className="text-ink-700">{r.on_date}</span>
                <span className="ml-2">1 {r.base} = {r.rate} {r.quote}</span>
                <span className={`ml-2 rounded px-1 text-[10px] ${r.source === "manual" ? "bg-amber-50 text-amber-700" : "bg-ink-100 text-ink-600"}`}>{r.source}</span>
              </div>
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
          清除当前账号下的所有 Wallet、交易、分类、商家、联系人、预算、附件，并重新填充默认分类和商家。账号本身保留。汇率（全局）不受影响。
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
              这会删除当前账号下的全部 Wallet、交易、分类、商家、联系人、预算、附件。账号保留，分类与商家会重新种子。**不可撤销**。
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
