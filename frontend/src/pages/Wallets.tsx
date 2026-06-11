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

      <div className="space-y-6">
        {grouped.map(([code, list], idx) => {
          // 物理余额口径: 跟卡片大数字一致, 借出未还的不计入汇总
          const total = list.reduce((s, w) => s + w.balance - w.loan_out_on_wallet + w.loan_repayment_on_wallet, 0);
          const byType = new Map<WalletType, Wallet[]>();
          for (const w of list) {
            const arr = byType.get(w.type) ?? [];
            arr.push(w);
            byType.set(w.type, arr);
          }
          return (
            <div key={code}>
              {idx > 0 && <div className="mb-6 border-t border-ink-200 dark:border-ink-700" />}
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
                            siblings={list.filter((x) => x.id !== w.id)}
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
              {(["JP", "CN", "GLOBAL"] as const).map((r) => (
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

// EMV 芯片: 金色圆角矩形 + 触点分割线 (中竖 + 上下两横), 模拟真实卡片芯片
function ChipIcon() {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="21" height="15" rx="2.5" fill="#e7c66b" stroke="#b9942f" strokeWidth="0.6" />
      <g stroke="#9c7d2a" strokeWidth="0.7">
        {/* 中央竖线 */}
        <line x1="11" y1="0.5" x2="11" y2="15.5" />
        {/* 上下两条横线 */}
        <line x1="0.5" y1="5" x2="21.5" y2="5" />
        <line x1="0.5" y1="11" x2="21.5" y2="11" />
        {/* 中央触点框 */}
        <rect x="7" y="5" width="8" height="6" fill="#dab955" />
      </g>
    </svg>
  );
}

// 底色够亮就用深色字, 否则白字 (保证卡面文字可读)
function isLight(hex: string): boolean {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 165;
}

// 信用卡类型 -> 顶部印的卡组织字样 (从 tag 推断; 无则按名字猜)
function cardScheme(name: string, tag: string): string {
  const t = tag.toUpperCase();
  if (["JCB", "AMEX", "VISA", "MASTERCARD"].includes(t)) return t;
  const n = name.toLowerCase();
  if (n.includes("amex") || name.includes("アメックス")) return "AMEX";
  if (n.includes("jcb")) return "JCB";
  return "CARD";
}

function WalletCardItem({
  wallet,
  currencyCode,
  currencies,
  siblings,
  onReconcile,
  onEdit,
  onDelete,
}: {
  wallet: Wallet;
  currencyCode: string;
  currencies: Currency[];
  siblings: Wallet[];
  onReconcile: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const Icon = TYPE_ICON[wallet.type];
  const color = wallet.color || DEFAULT_TYPE_COLOR[wallet.type];
  const physical = wallet.balance - wallet.loan_out_on_wallet + wallet.loan_repayment_on_wallet;
  const isNegative = physical < 0;
  const hasLoanDiff = wallet.loan_out_on_wallet !== 0 || wallet.loan_repayment_on_wallet !== 0;

  const moveLoans = useMutation({
    mutationFn: async (targetId: number) =>
      (await api.post<{ reattributed: number; amount: number }>(`/wallets/${wallet.id}/move-loans-to/${targetId}`)).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["loan-accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (r.reattributed === 0) {
        alert("当前钱包没有借贷调整, 无需转移");
      } else {
        alert(`已重新归属 ${r.reattributed} 笔借贷 (共 ${formatAmount(r.amount, wallet.currency_code, currencies)}). 历史交易不动, 仅借贷归属变更.`);
      }
      setPickerOpen(false);
    },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      alert(r?.data?.detail ?? "转移失败");
    },
  });

  const isCredit = wallet.type === "credit_card";
  const debt = -wallet.balance;
  const light = isLight(color);
  const faceText = light ? "text-ink-900" : "text-white";
  const faceSub = light ? "text-ink-900/70" : "text-white/75";

  return (
    <div className="group overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-800/60">
      {/* 品牌色风格化卡面 */}
      <div
        className={`relative overflow-hidden p-3 ${faceText}`}
        style={{ background: `linear-gradient(135deg, ${color} 0%, ${shade(color, -30)} 100%)` }}
      >
        <div className="absolute inset-0 ring-1 ring-inset ring-white/10" />
        <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-15" style={{ background: "radial-gradient(circle, white, transparent 70%)" }} />
        <div className="absolute right-2 top-2 opacity-25"><Icon size={30} /></div>
        <div className="relative flex h-full flex-col">
          <div className="flex items-start justify-between gap-2 pr-8">
            <div className="text-sm font-semibold leading-tight drop-shadow-sm">{wallet.name}</div>
          </div>
          <div className={`text-[10px] ${faceSub}`}>{TYPE_LABELS[wallet.type]}</div>
          {isCredit ? (
            <div className="mt-2 text-lg font-semibold tracking-tight drop-shadow-sm">
              {debt > 0 ? `待还 ${formatAmount(debt, currencyCode, currencies)}` : formatAmount(0, currencyCode, currencies)}
            </div>
          ) : (
            <div className="mt-2 text-lg font-semibold tracking-tight drop-shadow-sm">
              {formatAmount(physical, currencyCode, currencies)}
            </div>
          )}
          <div className="mt-2 flex items-end justify-between">
            <div className="flex items-center gap-1.5">
              <ChipIcon />
              <span className={`text-[10px] tracking-[0.2em] ${faceSub}`}>•••• ••••</span>
            </div>
            <span className={`text-[10px] font-medium tracking-wider ${faceSub}`}>
              {isCredit ? cardScheme(wallet.name, "") : currencyCode}
            </span>
          </div>
        </div>
      </div>
      {/* 卡面下方中性区: 左=借贷调整(可空), 右=操作按钮. 同一行, 高度恒定 */}
      <div className="flex items-center justify-between gap-2 p-2">
        <div className="min-w-0 flex-1 text-xs text-ink-500">
          {hasLoanDiff && !isCredit && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="truncate">实际 {formatAmount(wallet.balance, currencyCode, currencies)} · 含借贷调整</span>
              {siblings.length > 0 && (
                <button
                  onClick={() => setPickerOpen(true)}
                  className="rounded border border-ink-300 px-1.5 py-0.5 text-[10px] text-ink-600 hover:border-emerald-500 hover:text-emerald-600 dark:border-ink-600 dark:text-ink-300"
                >合到其他钱包</button>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button onClick={onReconcile} className="btn-ghost px-2 py-1 text-xs" title="对账"><Scale size={12} /> 对账</button>
          <button onClick={onEdit} className="btn-ghost px-2 py-1 text-xs"><Pencil size={12} /></button>
          <button onClick={onDelete} className="btn-danger px-2 py-1 text-xs"><Trash2 size={12} /></button>
        </div>
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-ink-800">
            <div className="mb-2 text-sm font-semibold">把 {wallet.name} 的借贷调整名义归到哪？</div>
            <div className="mb-3 text-xs text-ink-500">
              纯名义操作: 不创建任何新交易, 不改原借贷的钱包归属（历史保留）,
              只把"借贷调整"的累计点改到目标钱包. 结果: 当前钱包的"含借贷调整"标记消失;
              目标钱包接管这部分调整, 物理余额相应下降.
              <br/>
              <span className="mt-1 inline-block text-ink-400">两个钱包的 system_balance（小字"实际"）都不变.</span>
            </div>
            <div className="space-y-1.5">
              {siblings.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    if (confirm(`确认把 ${wallet.name} 的借贷调整名义归到 ${t.name}？\n不会动任何交易, 只改归属.`)) {
                      moveLoans.mutate(t.id);
                    }
                  }}
                  disabled={moveLoans.isPending}
                  className="flex w-full items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-left text-sm hover:border-emerald-500 dark:border-ink-700 dark:hover:border-emerald-400"
                >
                  <span>{t.name}</span>
                  <span className="text-xs text-ink-500">{t.currency_code}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={() => setPickerOpen(false)} className="btn-ghost text-xs">取消</button>
            </div>
          </div>
        </div>
      )}
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
