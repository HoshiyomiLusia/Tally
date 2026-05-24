import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import ReconcileModal from "../components/ReconcileModal";
import { api, type Currency, type Wallet, type WalletType } from "../lib/api";
import { formatAmount, parseAmount } from "../lib/format";
import { REGION_LABELS, WALLET_PRESETS, type WalletPreset } from "../lib/walletPresets";

const TYPE_LABELS: Record<WalletType, string> = {
  cash: "现金",
  bank: "借记卡",
  credit_card: "信用卡",
  e_wallet: "电子钱包",
  virtual: "虚拟",
};

export default function Wallets() {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Wallet | null>(null);
  const [reconcileFor, setReconcileFor] = useState<Wallet | null>(null);

  const wallets = useQuery({
    queryKey: ["wallets", { archived: showArchived }],
    queryFn: async () => (await api.get<Wallet[]>(`/wallets?include_archived=${showArchived}`)).data,
  });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

  const grouped = useMemo(() => {
    const m = new Map<string, Wallet[]>();
    for (const w of wallets.data ?? []) {
      const arr = m.get(w.currency_code) ?? [];
      arr.push(w);
      m.set(w.currency_code, arr);
    }
    return Array.from(m.entries());
  }, [wallets.data]);

  const archiveMut = useMutation({
    mutationFn: async (w: Wallet) => api.patch(`/wallets/${w.id}`, { archived: !w.archived }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallets"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => api.delete(`/wallets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallets"] }),
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      alert(r?.data?.detail ?? "删除失败");
    },
  });

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Wallet</h1>
          <p className="text-sm text-ink-500">你的现金、银行卡、电子钱包都在这里</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-ink-600">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            显示已归档
          </label>
          <button onClick={() => { setEditing(null); setOpen(true); }} className="btn-primary">
            <Plus size={14} /> 新建 Wallet
          </button>
        </div>
      </div>

      {grouped.length === 0 && (
        <div className="card text-sm text-ink-500">还没建 Wallet。点右上"新建 Wallet"开始。</div>
      )}

      <div className="space-y-3">
        {grouped.map(([code, list]) => {
          const total = list.filter((w) => !w.archived).reduce((s, w) => s + w.balance, 0);
          return (
            <div key={code} className="card">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-medium">{code} 账户</div>
                <div className="text-sm text-ink-700">{formatAmount(total, code, currencies.data)}</div>
              </div>
              <div className="divide-y divide-ink-100">
                {list.map((w) => (
                  <div key={w.id} className={`flex items-center justify-between gap-2 py-2 ${w.archived ? "opacity-50" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-sm font-medium">{w.name}</span>
                        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">{TYPE_LABELS[w.type]}</span>
                        {w.archived && <span className="text-[10px] text-ink-400">已归档</span>}
                      </div>
                      <div className="text-xs text-ink-500">初始 {formatAmount(w.initial_balance, code, currencies.data)}</div>
                    </div>
                    <div className={`shrink-0 text-sm font-semibold ${w.type === "credit_card" && w.balance < 0 ? "text-rose-600" : ""}`}>
                      {formatAmount(w.balance, code, currencies.data)}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => setReconcileFor(w)} className="btn-ghost p-1.5" title="对账"><Scale size={14} /></button>
                      <button onClick={() => { setEditing(w); setOpen(true); }} className="btn-ghost p-1.5"><Pencil size={14} /></button>
                      <button onClick={() => archiveMut.mutate(w)} className="btn-ghost p-1.5" title={w.archived ? "取消归档" : "归档"}>
                        {w.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`删除 ${w.name}？只能删除没有交易的 Wallet`)) deleteMut.mutate(w.id);
                        }}
                        className="btn-danger p-1.5"
                      ><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <WalletForm open={open} onClose={() => setOpen(false)} editing={editing} />
      <ReconcileModal wallet={reconcileFor} onClose={() => setReconcileFor(null)} />
    </div>
  );
}

function WalletForm({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Wallet | null }) {
  const qc = useQueryClient();
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });

  const [name, setName] = useState("");
  const [type, setType] = useState<WalletType>("cash");
  const [currencyCode, setCurrencyCode] = useState("JPY");
  const [color, setColor] = useState("");
  const [initialText, setInitialText] = useState("");
  const [region, setRegion] = useState<WalletPreset["region"] | "ALL">("JP");
  const [showCustom, setShowCustom] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setType(editing.type);
      setCurrencyCode(editing.currency_code);
      setColor(editing.color || "");
      const cur = currencies.data?.find((c) => c.code === editing.currency_code);
      const d = cur?.decimal_digits ?? 2;
      setInitialText((editing.initial_balance / Math.pow(10, d)).toString());
      setShowCustom(true);
    } else {
      setName("");
      setType("cash");
      setCurrencyCode("JPY");
      setColor("");
      setInitialText("");
      setRegion("JP");
      setShowCustom(false);
    }
    setError("");
  }, [open, editing, currencies.data]);

  function pickPreset(p: WalletPreset) {
    setName(p.name);
    setType(p.type);
    setCurrencyCode(p.currency_code);
    setColor(p.color);
    setShowCustom(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const cur = currencies.data?.find((c) => c.code === currencyCode);
      const d = cur?.decimal_digits ?? 2;
      const initial = parseAmount(initialText || "0", d);
      const payload: Record<string, unknown> = { name, type, color };
      if (!editing) {
        payload.currency_code = currencyCode;
        payload.initial_balance = initial;
      }
      if (editing) await api.patch(`/wallets/${editing.id}`, payload);
      else await api.post("/wallets", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wallets"] });
      onClose();
    },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      setError(r?.data?.detail ?? "保存失败");
    },
  });

  if (!open) return null;

  const presetsInRegion = WALLET_PRESETS.filter((p) => p.region === region);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-lg font-semibold">{editing ? "编辑 Wallet" : "新建 Wallet"}</div>

        {!editing && !showCustom && (
          <div className="space-y-3">
            <div className="text-xs text-ink-500">选择预设卡片（或下方"自定义"）</div>
            <div className="flex gap-1 overflow-x-auto">
              {(["JP", "CN", "GLOBAL", "CASH"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRegion(r)}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs ${region === r ? "border-ink-800 bg-ink-800 text-white" : "border-ink-200 text-ink-600"}`}
                >{REGION_LABELS[r]}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {presetsInRegion.map((p) => (
                <button
                  key={p.name}
                  onClick={() => pickPreset(p)}
                  className="group relative h-20 rounded-lg p-2 text-left transition hover:scale-[1.02]"
                  style={{ background: `linear-gradient(135deg, ${p.color}, ${shade(p.color, -25)})` }}
                >
                  <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-white/20" />
                  <div className="relative flex h-full flex-col justify-between text-white">
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-xs font-semibold drop-shadow-sm">{p.name}</span>
                      <span className="shrink-0 rounded bg-white/20 px-1 text-[9px]">{p.tag}</span>
                    </div>
                    <div className="text-[10px] opacity-80">{p.currency_code} · {TYPE_LABELS[p.type]}</div>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setShowCustom(true)} className="btn-ghost w-full justify-center border border-dashed border-ink-200">
              + 自定义（不用预设）
            </button>
          </div>
        )}

        {(editing || showCustom) && (
          <div className="space-y-3">
            {!editing && (
              <button onClick={() => setShowCustom(false)} className="text-xs text-ink-500 hover:text-ink-700">← 回到预设</button>
            )}
            {color && (
              <div className="h-16 rounded-lg p-2 text-white" style={{ background: `linear-gradient(135deg, ${color}, ${shade(color, -25)})` }}>
                <div className="text-xs font-semibold">{name || "未命名"}</div>
                <div className="text-[10px] opacity-80">{currencyCode} · {TYPE_LABELS[type]}</div>
              </div>
            )}
            <label className="block">
              <span className="text-xs text-ink-500">名称</span>
              <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 三井卡 / 微信余额" autoFocus />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-ink-500">类型</span>
                <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value as WalletType)}>
                  <option value="cash">现金</option>
                  <option value="bank">借记卡</option>
                  <option value="credit_card">信用卡</option>
                  <option value="e_wallet">电子钱包</option>
                  <option value="virtual">虚拟</option>
                </select>
              </label>
              {!editing && (
                <label className="block">
                  <span className="text-xs text-ink-500">币种</span>
                  <select className="input mt-1" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
                    {(currencies.data ?? []).map((c) => (
                      <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <label className="block">
              <span className="text-xs text-ink-500">卡片颜色（可选）</span>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {["#5f6068", "#0f7d3a", "#0b59a8", "#a8051c", "#ec7c2f", "#bf0000", "#c8102e", "#07c160", "#1677ff", "#9b1c2f", "#1d1d1f"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-6 w-6 rounded-full ring-2 ${color === c ? "ring-ink-800" : "ring-transparent"}`}
                    style={{ background: c }}
                  />
                ))}
                <button type="button" onClick={() => setColor("")} className="text-xs text-ink-500">清除</button>
              </div>
            </label>
            {!editing && (
              <label className="block">
                <span className="text-xs text-ink-500">初始余额</span>
                <input className="input mt-1" inputMode="decimal" value={initialText} onChange={(e) => setInitialText(e.target.value)} placeholder="0" />
              </label>
            )}
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="btn-ghost">取消</button>
              <button onClick={() => save.mutate()} disabled={save.isPending || !name} className="btn-primary">
                {save.isPending ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function shade(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * percent / 100)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * percent / 100)));
  const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round(255 * percent / 100)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
