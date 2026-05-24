import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Banknote, CreditCard, Globe2, Landmark, Smartphone, type LucideIcon } from "lucide-react";

import ReconcileModal from "../components/ReconcileModal";
import { api, type Currency, type Wallet, type WalletType } from "../lib/api";
import { formatAmount, parseAmount } from "../lib/format";
import { REGION_LABELS, WALLET_PRESETS, type WalletPreset } from "../lib/walletPresets";

const TYPE_ICON: Record<WalletType, LucideIcon> = {
  cash: Banknote,
  bank: Landmark,
  credit_card: CreditCard,
  e_wallet: Smartphone,
  virtual: Globe2,
};

const TYPE_ORDER: WalletType[] = ["bank", "credit_card", "e_wallet", "cash", "virtual"];

const TYPE_SECTION_LABEL: Record<WalletType, string> = {
  bank: "借记卡 / 银行",
  credit_card: "信用卡",
  e_wallet: "电子钱包",
  cash: "现金",
  virtual: "虚拟",
};

const TYPE_LABELS: Record<WalletType, string> = {
  cash: "现金",
  bank: "借记卡",
  credit_card: "信用卡",
  e_wallet: "电子钱包",
  virtual: "虚拟",
};

export default function Wallets() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Wallet | null>(null);
  const [reconcileFor, setReconcileFor] = useState<Wallet | null>(null);

  const wallets = useQuery({
    queryKey: ["wallets"],
    queryFn: async () => (await api.get<Wallet[]>("/wallets?include_archived=true")).data,
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
        <button onClick={() => { setEditing(null); setOpen(true); }} className="btn-primary">
          <Plus size={14} /> 新建 Wallet
        </button>
      </div>

      {grouped.length === 0 && (
        <div className="card text-sm text-ink-500">还没建 Wallet。点右上"新建 Wallet"开始。</div>
      )}

      <div className="space-y-4">
        {grouped.map(([code, list]) => {
          const total = list.reduce((s, w) => s + w.balance, 0);
          const byType = new Map<WalletType, Wallet[]>();
          for (const w of list) {
            const arr = byType.get(w.type) ?? [];
            arr.push(w);
            byType.set(w.type, arr);
          }
          return (
            <div key={code}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <div className="text-sm font-medium">{code} 账户</div>
                <div className="text-sm font-semibold">{formatAmount(total, code, currencies.data)}</div>
              </div>
              <div className="space-y-3">
                {TYPE_ORDER.filter((t) => byType.has(t)).map((t) => {
                  const wallets = byType.get(t)!;
                  const Icon = TYPE_ICON[t];
                  return (
                    <div key={t}>
                      <div className="mb-1 flex items-center gap-1 px-1 text-[11px] uppercase tracking-wider text-ink-500">
                        <Icon size={11} /> {TYPE_SECTION_LABEL[t]}
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {wallets.map((w) => (
                          <WalletCardItem
                            key={w.id}
                            wallet={w}
                            currencyCode={code}
                            currencies={currencies.data ?? []}
                            onReconcile={() => setReconcileFor(w)}
                            onEdit={() => { setEditing(w); setOpen(true); }}
                            onDelete={() => { if (confirm(`删除 ${w.name}？只能删除没有交易的 Wallet`)) deleteMut.mutate(w.id); }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
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
            <div className="space-y-4">
              {TYPE_ORDER.filter((t) => presetsInRegion.some((p) => p.type === t)).map((t) => (
                <div key={t}>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">
                    {(() => { const I = TYPE_ICON[t]; return <I size={11} />; })()}
                    <span>{TYPE_SECTION_LABEL[t]}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {presetsInRegion.filter((p) => p.type === t).map((p) => (
                      <PresetCard key={p.name} preset={p} onClick={() => pickPreset(p)} />
                    ))}
                  </div>
                </div>
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

function WalletCardItem({
  wallet,
  currencyCode,
  currencies,
  onReconcile,
  onEdit,
  onDelete,
}: {
  wallet: Wallet;
  currencyCode: string;
  currencies: Currency[];
  onReconcile: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = TYPE_ICON[wallet.type];
  const color = wallet.color || DEFAULT_TYPE_COLOR[wallet.type];
  const isNegative = wallet.balance < 0;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-ink-100 bg-white p-3 shadow-sm dark:border-ink-800 dark:bg-ink-800/60">
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
      <div className="absolute right-2 top-2 opacity-30" style={{ color }}>
        <Icon size={36} />
      </div>
      <div className="relative">
        <div className="text-sm font-medium">{wallet.name}</div>
        <div className="text-xs text-ink-500">{TYPE_LABELS[wallet.type]}</div>
        <div className={`mt-1 text-lg font-semibold ${isNegative ? "text-rose-600" : ""}`}>
          {formatAmount(wallet.balance, currencyCode, currencies)}
        </div>
        <div className="mt-1 flex gap-0.5">
          <button onClick={onReconcile} className="btn-ghost px-2 py-1 text-xs" title="对账"><Scale size={12} /> 对账</button>
          <button onClick={onEdit} className="btn-ghost px-2 py-1 text-xs"><Pencil size={12} /></button>
          <button onClick={onDelete} className="btn-danger px-2 py-1 text-xs"><Trash2 size={12} /></button>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_TYPE_COLOR: Record<WalletType, string> = {
  cash: "#5f6068",
  bank: "#0b59a8",
  credit_card: "#9b1c2f",
  e_wallet: "#0f7d3a",
  virtual: "#7c3aed",
};

function PresetCard({ preset, onClick }: { preset: WalletPreset; onClick: () => void }) {
  const Icon = TYPE_ICON[preset.type];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative aspect-[16/10] overflow-hidden rounded-xl p-2.5 text-left text-white shadow-md transition hover:scale-[1.02]"
      style={{
        background: `linear-gradient(135deg, ${preset.color} 0%, ${shade(preset.color, -32)} 100%)`,
      }}
    >
      <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/15" />
      <div
        className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-15"
        style={{ background: "radial-gradient(circle, white, transparent 70%)" }}
      />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-1">
          <span className="line-clamp-2 text-xs font-semibold leading-tight drop-shadow-sm">{preset.name}</span>
          <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider">
            {preset.tag}
          </span>
        </div>
        <div className="flex items-end justify-between">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-4 rounded-[2px] bg-gradient-to-br from-amber-200 to-amber-400 opacity-80 shadow-inner" />
            <span className="text-[10px] font-medium tracking-wider opacity-90">{preset.currency_code}</span>
          </div>
          <Icon size={14} className="opacity-70" />
        </div>
      </div>
    </button>
  );
}
