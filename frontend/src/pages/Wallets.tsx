import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Pencil, Plus, Scale, Trash2, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Banknote, CreditCard, Globe2, Landmark, Smartphone, type LucideIcon } from "lucide-react";

import Modal from "../components/Modal";
import ReconcileModal from "../components/ReconcileModal";
import { api, type Currency, type Wallet, type WalletType } from "../lib/api";
import { invalidateMoney } from "../lib/invalidate";
import { walletPhysical } from "../lib/wallet";
import { formatAmount, parseAmount } from "../lib/format";
import { WALLET_PRESETS, type WalletPreset } from "../lib/walletPresets";

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
    // 审计#47: 含归档用独立 key ["wallets","all"], 与不含归档的 ["wallets"] 分开缓存避免互相污染;
    // invalidateMoney 失效 ["wallets"] 会按前缀连带失效本 key, 刷新不受影响
    queryKey: ["wallets", "all"],
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
    onSuccess: () => invalidateMoney(qc),
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
          // 审计#52: 币种汇总排除归档钱包, 与首页/后端净值口径一致 (归档卡仍作卡片展示, 只是不计入合计)
          const active = list.filter((w) => !w.archived);
          const nonCredit = active.filter((w) => w.type !== "credit_card");
          const physOf = walletPhysical;
          // 卡片只显物理; 借贷/投资 单独立账; 真实 = 各钱包系统余额之和
          const phys = nonCredit.reduce((s, w) => s + physOf(w), 0);
          // 借贷算上信用卡上垫付的: 不管借记卡还是信用卡, 替人垫的都是应收
          const loan = active.reduce((s, w) => s + w.loan_out_on_wallet - w.loan_repayment_on_wallet, 0);
          const invest = active.reduce((s, w) => s + w.invest_out_on_wallet - w.invest_in_on_wallet, 0);
          // 信用卡待还按实际刷卡额(含垫付)= -物理余额, 这样占用的额度才对得上
          const debt = active.filter((w) => w.type === "credit_card").reduce((s, w) => s + Math.max(0, -physOf(w)), 0);
          const real = active.reduce((s, w) => s + w.balance, 0);
          const byType = new Map<WalletType, Wallet[]>();
          for (const w of list) {
            const arr = byType.get(w.type) ?? [];
            arr.push(w);
            byType.set(w.type, arr);
          }
          return (
            <div key={code}>
              {idx > 0 && <div className="mb-6 border-t border-ink-200 dark:border-ink-700" />}
              {/* 右上角一行汇总: 物理 / 借贷 / 待还 不同色, 真实高亮收尾 */}
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
                <div className="text-sm font-medium">{code} 账户</div>
                <div className="flex flex-wrap items-baseline gap-x-2.5 text-xs">
                  <span className="text-ink-500">物理 <span className="font-medium text-ink-700 dark:text-ink-200">{formatAmount(phys, code, currencies.data)}</span></span>
                  {loan !== 0 && <span className="text-emerald-600 dark:text-emerald-400">借贷 {formatAmount(loan, code, currencies.data)}</span>}
                  {invest !== 0 && <span className="text-sky-600 dark:text-sky-400">投资 {formatAmount(invest, code, currencies.data)}</span>}
                  {debt !== 0 && <span className="text-rose-500">待还 {formatAmount(debt, code, currencies.data)}</span>}
                  <span className="text-ink-500">真实 <span className="text-sm font-bold text-ink-900 dark:text-ink-50">{formatAmount(real, code, currencies.data)}</span></span>
                </div>
              </div>
              <div className="space-y-3">
                {/* 借贷账户: 与各类账户同级, 不做卡片, 只一行小标题 + 高亮数字 (紧挨着) */}
                {loan !== 0 && (
                  <div className="flex items-baseline gap-2 px-1">
                    <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-ink-500">
                      <HandCoins size={11} /> 借贷账户
                    </span>
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatAmount(loan, code, currencies.data)}</span>
                  </div>
                )}
                {invest !== 0 && (
                  <div className="flex items-baseline gap-2 px-1">
                    <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-ink-500">
                      <TrendingUp size={11} /> 投资账户
                    </span>
                    <span className="text-sm font-bold text-sky-600 dark:text-sky-400">{formatAmount(invest, code, currencies.data)}</span>
                  </div>
                )}
                {TYPE_ORDER.filter((t) => byType.has(t)).map((t) => {
                  const wallets = byType.get(t)!;
                  const Icon = TYPE_ICON[t];
                  return (
                    <div key={t}>
                      <div className="mb-1 flex items-center gap-1 px-1 text-[11px] uppercase tracking-wider text-ink-500">
                        <Icon size={11} /> {TYPE_SECTION_LABEL[t]}
                      </div>
                      {/* 一律左对齐, 跟上面的类型标题(px-1)对齐; 单张卡也靠左不居中 */}
                      <div className="flex flex-wrap gap-3 px-1">
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
  const [creditLimitText, setCreditLimitText] = useState("");  // 信用卡额度
  const [region, setRegion] = useState<string>("JPY");  // 现按币种体系分组, region 存币种代码
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
      setCreditLimitText(editing.credit_limit != null ? (editing.credit_limit / Math.pow(10, d)).toString() : "");
      setShowCustom(true);
    } else {
      setName("");
      setType("cash");
      setCurrencyCode("JPY");
      setColor("");
      setInitialText("");
      setCreditLimitText("");
      setRegion("JPY");
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
      const creditLimit = type === "credit_card" && creditLimitText ? parseAmount(creditLimitText, d) : null;
      const payload: Record<string, unknown> = { name, type, color, credit_limit: creditLimit };
      if (!editing) {
        payload.currency_code = currencyCode;
        payload.initial_balance = initial;
      }
      if (editing) await api.patch(`/wallets/${editing.id}`, payload);
      else await api.post("/wallets", payload);
    },
    onSuccess: () => {
      invalidateMoney(qc);
      onClose();
    },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      setError(r?.data?.detail ?? "保存失败");
    },
  });

  if (!open) return null;

  // 预设按币种体系分组 (JPY / CNY / USD / EUR ...), 不按国家
  const presetCurrencies = Array.from(new Set(WALLET_PRESETS.map((p) => p.currency_code)));
  const activeCur = presetCurrencies.includes(region) ? region : presetCurrencies[0];
  const presetsInRegion = WALLET_PRESETS.filter((p) => p.currency_code === activeCur);

  return (
    <Modal onClose={onClose} title={editing ? "编辑 Wallet" : "新建 Wallet"} maxW="max-w-2xl">

        {!editing && !showCustom && (
          <div className="space-y-3">
            <div className="text-xs text-ink-500">选择预设卡片（或下方"自定义"）</div>
            <div className="flex gap-1 overflow-x-auto">
              {presetCurrencies.map((c) => (
                <button
                  key={c}
                  onClick={() => setRegion(c)}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs ${activeCur === c ? "border-ink-800 bg-ink-800 text-white" : "border-ink-200 text-ink-600"}`}
                >{c}</button>
              ))}
            </div>
            <div className="space-y-4">
              {TYPE_ORDER.filter((t) => presetsInRegion.some((p) => p.type === t)).map((t) => (
                <div key={t}>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">
                    {(() => { const I = TYPE_ICON[t]; return <I size={11} />; })()}
                    <span>{TYPE_SECTION_LABEL[t]}</span>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
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
            {type === "credit_card" && (
              <label className="block">
                <span className="text-xs text-ink-500">信用额度（{currencyCode}）</span>
                <input className="input mt-1" inputMode="decimal" value={creditLimitText} onChange={(e) => setCreditLimitText(e.target.value)} placeholder="如 300000" />
                <span className="mt-0.5 block text-[10px] text-ink-400">卡片会显示本月可用 = 额度 − 待还</span>
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
    </Modal>
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

// 信用卡 -> 卡面右下印的卡组织字样 (按名字猜)
function cardScheme(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("amex") || name.includes("アメックス")) return "AMEX";
  if (n.includes("jcb")) return "JCB";
  return "CARD";
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
  const color = wallet.color || DEFAULT_TYPE_COLOR[wallet.type];
  const isCredit = wallet.type === "credit_card";
  // 卡片只显物理余额; 借出/投资的钱已归到币种下的"借贷账户/投资账户", 不再摊在每张卡上
  const physical = walletPhysical(wallet);
  // 信用卡: 实际欠银行 = -物理(含替人垫付的), 占用额度才对
  const debt = -physical;
  const light = isLight(color);
  const faceText = light ? "text-ink-900" : "text-white";
  const faceSub = light ? "text-ink-900/70" : "text-white/75";

  return (
    <div
      className={`relative aspect-[856/540] w-[calc(50%-0.375rem)] overflow-hidden rounded-xl p-3 shadow-sm sm:w-[260px] ${faceText}`}
      style={{ background: `linear-gradient(135deg, ${color} 0%, ${shade(color, -30)} 100%)` }}
    >
      <div className="absolute inset-0 ring-1 ring-inset ring-white/10" />
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-15" style={{ background: "radial-gradient(circle, white, transparent 70%)" }} />

      {/* 操作浮层: 右上角小图标 */}
      <div className="absolute right-1.5 top-1.5 z-10 flex gap-0.5">
        <button onClick={onReconcile} title="对账" className="rounded-md bg-black/15 p-1 backdrop-blur-sm hover:bg-black/35"><Scale size={13} /></button>
        <button onClick={onEdit} title="编辑" className="rounded-md bg-black/15 p-1 backdrop-blur-sm hover:bg-black/35"><Pencil size={13} /></button>
        <button onClick={onDelete} title="删除" className="rounded-md bg-black/15 p-1 backdrop-blur-sm hover:bg-rose-500/60"><Trash2 size={13} /></button>
      </div>

      <div className="relative flex h-full flex-col justify-between">
        <div className="min-w-0 pr-20">
          <div className="truncate text-sm font-semibold leading-tight drop-shadow-sm">{wallet.name}</div>
          <div className={`text-[10px] ${faceSub}`}>{TYPE_LABELS[wallet.type]}</div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold tabular-nums tracking-tight drop-shadow-sm">
            {isCredit
              ? (debt > 0 ? `待还 ${formatAmount(debt, currencyCode, currencies)}` : formatAmount(0, currencyCode, currencies))
              : formatAmount(physical, currencyCode, currencies)}
          </div>
          {isCredit && wallet.credit_limit != null && (
            <div className={`truncate text-[10px] tabular-nums ${faceSub}`}>
              可用 {formatAmount(wallet.credit_limit + physical, currencyCode, currencies)} / 额度 {formatAmount(wallet.credit_limit, currencyCode, currencies)}
            </div>
          )}
        </div>
        <div className="flex items-end justify-between">
          <div className="flex items-center gap-1.5">
            <ChipIcon />
            <span className={`text-[10px] tracking-[0.2em] ${faceSub}`}>•••• ••••</span>
          </div>
          <span className={`text-[10px] font-medium tracking-wider ${faceSub}`}>
            {isCredit ? cardScheme(wallet.name) : currencyCode}
          </span>
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
      className="group relative aspect-[856/540] w-[calc(50%-0.25rem)] max-w-[180px] overflow-hidden rounded-xl p-2.5 text-left text-white shadow-md transition hover:scale-[1.02] sm:w-[150px]"
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
          <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider">{preset.tag}</span>
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
