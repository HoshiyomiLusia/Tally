import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, Calculator, ChevronLeft, ChevronRight, Delete, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import Modal from "../components/Modal";
import { api, type Currency, type InvestEvent, type Position, type Wallet, type WalletType } from "../lib/api";
import { invalidateMoney } from "../lib/invalidate";
import { formatAmount, parseAmount, todayIso } from "../lib/format";

const WALLET_TYPE_ORDER: WalletType[] = ["bank", "e_wallet", "cash", "credit_card", "virtual"];
const WALLET_TYPE_LABEL: Record<WalletType, string> = {
  bank: "银行账户", e_wallet: "电子钱包", cash: "现金", credit_card: "信用卡", virtual: "虚拟账户",
};

function shiftDay(iso: string, delta: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + delta);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function stripTrailingZero(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(8)));
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  invalidateMoney(qc);
}

export default function Investments() {
  const qc = useQueryClient();
  const positions = useQuery({ queryKey: ["positions"], queryFn: async () => (await api.get<Position[]>("/investments/positions")).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: async () => (await api.get<Wallet[]>("/wallets")).data });

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/investments/positions/${id}`),
    onSuccess: () => invalidateAll(qc),
  });

  const [buyOpen, setBuyOpen] = useState(false);
  const [buyTarget, setBuyTarget] = useState<Position | null>(null);  // 非空 = 追加到该持仓
  const [sellFor, setSellFor] = useState<Position | null>(null);
  const [editFor, setEditFor] = useState<Position | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  // 每币种汇总: 投资中(剩余成本) + 已实现盈亏
  const totals = useMemo(() => {
    const m = new Map<string, { invested: number; pnl: number }>();
    for (const p of positions.data ?? []) {
      const e = m.get(p.currency_code) ?? { invested: 0, pnl: 0 };
      e.invested += p.cost_remaining;
      e.pnl += p.realized_pnl;
      m.set(p.currency_code, e);
    }
    return Array.from(m.entries()).filter(([, v]) => v.invested !== 0 || v.pnl !== 0);
  }, [positions.data]);

  const list = (positions.data ?? []).filter((p) => showClosed || p.status === "open");
  const hasClosed = (positions.data ?? []).some((p) => p.status === "closed");

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">投资</h1>
          <p className="text-sm text-ink-500">买入 = 现金转进持仓（不算消费）· 卖出按对应买入结算 · 盈亏自动记投资收益/亏损</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setHistoryOpen(true)} className="btn-ghost">历史</button>
          <button onClick={() => { setBuyTarget(null); setBuyOpen(true); }} className="btn-primary"><Plus size={14} /> 买入</button>
        </div>
      </div>

      {totals.length > 0 && (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {totals.map(([code, v]) => (
            <div key={code} className="card">
              <div className="text-xs text-ink-500">{code} 投资中（持有成本）</div>
              <div className="text-lg font-semibold text-sky-600 dark:text-sky-400">{formatAmount(v.invested, code, currencies.data)}</div>
              <div className={`mt-0.5 text-xs ${v.pnl > 0 ? "text-emerald-600" : v.pnl < 0 ? "text-rose-600" : "text-ink-400"}`}>
                已实现盈亏 {v.pnl > 0 ? "+" : ""}{formatAmount(v.pnl, code, currencies.data)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {list.length === 0 && (
          <div className="card text-sm text-ink-500">还没有持仓。点右上"买入"开一个。</div>
        )}
        {list.map((p) => {
          const closed = p.status === "closed";
          return (
            <div key={p.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="rounded bg-ink-100 px-1.5 text-[10px] text-ink-500 dark:bg-ink-800">{p.currency_code}</span>
                    {closed && <span className="rounded bg-ink-100 px-1.5 text-[10px] text-ink-400 dark:bg-ink-800">已清仓</span>}
                  </div>
                  <div className="text-xs text-ink-500">
                    买入 {formatAmount(p.cost_total, p.currency_code, currencies.data)} · {p.opened_on}
                    {p.note ? ` · ${p.note}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {!closed && (
                    <div className="text-base font-semibold text-sky-600 dark:text-sky-400">
                      {formatAmount(p.cost_remaining, p.currency_code, currencies.data)}
                    </div>
                  )}
                  {p.realized_pnl !== 0 && (
                    <div className={`text-xs ${p.realized_pnl > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      已实现 {p.realized_pnl > 0 ? "+" : ""}{formatAmount(p.realized_pnl, p.currency_code, currencies.data)}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-0.5">
                  {!closed && (
                    <button onClick={() => { setBuyTarget(p); setBuyOpen(true); }} className="btn-ghost text-xs" title="追加买入">
                      <Plus size={12} /> 追加
                    </button>
                  )}
                  {!closed && (
                    <button onClick={() => setSellFor(p)} className="btn-ghost text-xs" title="卖出结算">
                      <ArrowDownLeft size={12} /> 卖出
                    </button>
                  )}
                  <button onClick={() => setEditFor(p)} className="btn-ghost p-1.5" title="编辑持仓"><Pencil size={14} /></button>
                  <button
                    onClick={() => {
                      if (confirm(`删除持仓「${p.name}」？会一并删掉它的买入/卖出/盈亏记录，并撤销对余额的影响。`)) del.mutate(p.id);
                    }}
                    className="btn-danger p-1.5" title="删除持仓"
                  ><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          );
        })}
        {hasClosed && (
          <button onClick={() => setShowClosed((v) => !v)} className="w-full rounded-md border border-ink-200 py-1.5 text-xs text-ink-500 hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800">
            {showClosed ? "隐藏已清仓" : "显示已清仓"}
          </button>
        )}
      </div>

      <BuyModal open={buyOpen} initialTarget={buyTarget} positions={positions.data ?? []} wallets={wallets.data ?? []} currencies={currencies.data ?? []} onClose={() => { setBuyOpen(false); setBuyTarget(null); }} />
      <SellModal pos={sellFor} wallets={wallets.data ?? []} currencies={currencies.data ?? []} onClose={() => setSellFor(null)} />
      <EditModal pos={editFor} onClose={() => setEditFor(null)} />
      <HistoryModal open={historyOpen} currencies={currencies.data ?? []} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}

function fmtInput(amount: number, digits: number): string {
  return (amount / Math.pow(10, digits)).toString();
}

function BuyModal({ open, initialTarget, positions, wallets, currencies, onClose }: {
  open: boolean; initialTarget: Position | null; positions: Position[]; wallets: Wallet[]; currencies: Currency[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [targetId, setTargetId] = useState<number | null>(null);  // null = 新建持仓; 否则追加到该持仓
  const [name, setName] = useState("");
  const [walletId, setWalletId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [padOpen, setPadOpen] = useState(false);
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");

  const openPositions = positions.filter((p) => p.status === "open");
  const target = targetId != null ? positions.find((p) => p.id === targetId) ?? null : null;
  const selWallet = wallets.find((w) => w.id === walletId) ?? null;
  // 新建: 币种跟随所选钱包; 追加: 锁定持仓币种
  const effCurrency = target ? target.currency_code : (selWallet?.currency_code ?? "");
  const digits = currencies.find((c) => c.code === effCurrency)?.decimal_digits ?? 2;

  // 可选钱包: 追加→只列持仓币种; 新建→全部活跃钱包 (选哪个就用哪个币种)
  const walletsByCurrency = useMemo(() => {
    const pool = target
      ? wallets.filter((w) => !w.archived && w.currency_code === target.currency_code)
      : wallets.filter((w) => !w.archived);
    const m = new Map<string, Wallet[]>();
    for (const w of pool) { const arr = m.get(w.currency_code) ?? []; arr.push(w); m.set(w.currency_code, arr); }
    return m;
  }, [wallets, target?.currency_code]);

  useEffect(() => {
    if (!open) return;
    setTargetId(initialTarget?.id ?? null);
    setName(""); setAmountText(""); setPadOpen(false); setOccurredOn(todayIso()); setNote(""); setOpening(false); setError("");
    const pool = initialTarget
      ? wallets.filter((w) => !w.archived && w.currency_code === initialTarget.currency_code)
      : wallets.filter((w) => !w.archived);
    setWalletId(pool[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pressPad(key: string) {
    setAmountText((cur) => {
      if (key === "del") return cur.slice(0, -1);
      if (key === ".") return cur.includes(".") ? cur : (cur || "0") + ".";
      if (cur === "0") return key;
      return cur + key;
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      const amount = parseAmount(amountText, digits);
      if (amount <= 0) throw new Error("金额需大于 0");
      if (target) {
        if (!walletId) throw new Error("请选择资金来源 Wallet");
        await api.post(`/investments/positions/${target.id}/buy`, { wallet_id: walletId, amount, occurred_on: occurredOn, note, opening });
      } else {
        if (!name.trim()) throw new Error("请填持仓类型名称");
        if (!selWallet) throw new Error("请选择资金来源 Wallet");
        await api.post("/investments/buy", { name: name.trim(), currency_code: selWallet.currency_code, wallet_id: selWallet.id, amount, occurred_on: occurredOn, note, opening });
      }
    },
    onSuccess: () => { invalidateAll(qc); onClose(); },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      setError(r?.data?.detail ?? (e instanceof Error ? e.message : "保存失败"));
    },
  });

  if (!open) return null;
  return (
    <Modal onClose={onClose} title={target ? `追加买入 · ${target.name}` : "买入 · 新建持仓"} maxW="max-w-sm">
      <div className="mb-3 text-xs text-ink-500">
        {opening
          ? "已持有资产：不扣钱包，净资产 +本金、投资中 +本金（适合补录之前没记、钱已花出去的持仓）。"
          : "资金从选定 Wallet 转进持仓：物理余额↓、真实余额不变（钱还是你的，押在投资里）。"}
      </div>
      <div className="space-y-3">
        {/* 买入到: 新建 / 追加到已有持仓 */}
        <label className="block">
          <span className="text-xs text-ink-500">买入到</span>
          <select
            className="input mt-1"
            value={targetId ?? ""}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              setTargetId(v);
              const p = v != null ? positions.find((x) => x.id === v) : null;
              const pool = p ? wallets.filter((w) => !w.archived && w.currency_code === p.currency_code) : wallets.filter((w) => !w.archived);
              setWalletId((cur) => (pool.some((w) => w.id === cur) ? cur : (pool[0]?.id ?? null)));
            }}
          >
            <option value="">➕ 新建持仓（按类型，如 基金 / 股票 / 加密货币）</option>
            {openPositions.map((p) => (
              <option key={p.id} value={p.id}>追加到 {p.name}（{p.currency_code}）· 持有 {formatAmount(p.cost_remaining, p.currency_code, currencies)}</option>
            ))}
          </select>
        </label>

        {!target && (
          <label className="block">
            <span className="text-xs text-ink-500">类型名称</span>
            <input className="input mt-1" list="pos-type-suggestions" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 基金 / 股票 / 加密货币" autoFocus />
            <datalist id="pos-type-suggestions">
              <option value="基金" /><option value="股票" /><option value="加密货币" /><option value="债券" /><option value="其他投资" />
            </datalist>
          </label>
        )}

        {/* 金额: 大输入 + 小键盘 + 倍数快捷 (跟"添加账单"一致) */}
        <div>
          <span className="text-xs text-ink-500">买入金额</span>
          <div className="mt-1 flex items-stretch gap-2">
            <input inputMode="decimal" className="input flex-1 text-2xl" placeholder="0" value={amountText} onChange={(e) => setAmountText(e.target.value)} autoFocus={!!target} />
            <button type="button" onClick={() => setPadOpen((v) => !v)} title="数字小键盘" className={`flex shrink-0 items-center rounded-md border px-2.5 ${padOpen ? "border-ink-800 bg-ink-800 text-white dark:border-emerald-500 dark:bg-emerald-600" : "border-ink-200 text-ink-500 hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800"}`}><Calculator size={18} /></button>
            <div className={`flex shrink-0 items-center rounded-md px-3 text-sm font-semibold ${effCurrency ? "bg-ink-800 text-white" : "bg-amber-50 text-amber-700"}`}>{effCurrency || "选钱包"}</div>
          </div>
          {padOpen && (
            <div className="anim-drop mt-2 grid grid-cols-3 gap-1.5 rounded-lg bg-ink-50 p-2 dark:bg-ink-800/50">
              {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "del"].map((k) => (
                <button key={k} type="button" onClick={() => pressPad(k)} className="flex items-center justify-center rounded-md border border-ink-200 bg-white py-3 text-lg font-medium text-ink-700 hover:bg-ink-100 active:scale-95 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 dark:hover:bg-ink-800">{k === "del" ? <Delete size={18} /> : k}</button>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[{ label: "×10", factor: 10 }, { label: "×100", factor: 100 }, { label: "×千", factor: 1000 }, { label: "×万", factor: 10000 }].map((b) => (
              <button key={b.label} type="button" onClick={() => { const cur = parseFloat(amountText) || 1; setAmountText(stripTrailingZero(cur * b.factor)); }} className="min-h-[36px] rounded-md bg-ink-100 px-3.5 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-200 sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-xs dark:bg-ink-700/40 dark:text-ink-200">{b.label}</button>
            ))}
            <button type="button" onClick={() => setAmountText("")} className="min-h-[36px] rounded-md bg-ink-50 px-3.5 py-1.5 text-sm text-ink-500 hover:bg-ink-100 sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-xs dark:bg-ink-800/40">清空</button>
          </div>
        </div>

        {/* 资金来源 Wallet: 按币种→类型 分组的 chip (跟"添加账单"一致) */}
        <div>
          <div className="mb-1.5 text-xs text-ink-500">{opening ? "记在哪个 Wallet 名下（不扣款）" : "资金来源 Wallet"}</div>
          <div className="space-y-2">
            {Array.from(walletsByCurrency.entries()).map(([code, list]) => {
              const byType = new Map<WalletType, Wallet[]>();
              for (const w of list) { const arr = byType.get(w.type) ?? []; arr.push(w); byType.set(w.type, arr); }
              const typed = WALLET_TYPE_ORDER.filter((t) => byType.has(t));
              return (
                <div key={code}>
                  {walletsByCurrency.size > 1 && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">{code}</div>}
                  <div className="space-y-1.5">
                    {typed.map((t) => (
                      <div key={t} className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-0.5 w-14 shrink-0 text-[10px] text-ink-400">{WALLET_TYPE_LABEL[t]}</span>
                        {(byType.get(t) ?? []).map((w) => {
                          const on = walletId === w.id;
                          return <button key={w.id} type="button" onClick={() => setWalletId(w.id)} className={on ? "chip chip-selected" : "chip chip-idle"}>{on && <span className="mr-0.5">✓</span>}{w.name}</button>;
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {walletsByCurrency.size === 0 && <div className="text-xs text-rose-600">还没有可用的 Wallet</div>}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="h-4 w-4" />
          <span>已持有资产（不扣钱包，作为额外资产计入）</span>
        </label>

        <div>
          <span className="text-xs text-ink-500">日期</span>
          <div className="mt-1 flex items-stretch gap-2">
            <button type="button" onClick={() => setOccurredOn(shiftDay(occurredOn, -1))} title="前一天" className="flex shrink-0 items-center rounded-md border border-ink-200 px-2.5 text-ink-500 hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800"><ChevronLeft size={18} /></button>
            <input className="input flex-1" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            <button type="button" onClick={() => setOccurredOn(shiftDay(occurredOn, 1))} title="后一天" className="flex shrink-0 items-center rounded-md border border-ink-200 px-2.5 text-ink-500 hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800"><ChevronRight size={18} /></button>
          </div>
        </div>
        <label className="block">
          <span className="text-xs text-ink-500">备注</span>
          <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
        </label>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost">取消</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">{save.isPending ? "保存中…" : (target ? "确认追加" : "确认买入")}</button>
        </div>
      </div>
    </Modal>
  );
}

function SellModal({ pos, wallets, currencies, onClose }: {
  pos: Position | null; wallets: Wallet[]; currencies: Currency[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [walletId, setWalletId] = useState<number | null>(null);
  const [costText, setCostText] = useState("");
  const [proceedsText, setProceedsText] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const matchingWallets = wallets.filter((w) => w.currency_code === pos?.currency_code && !w.archived);
  const digits = currencies.find((c) => c.code === pos?.currency_code)?.decimal_digits ?? 2;

  useEffect(() => {
    if (!pos) return;
    setWalletId(matchingWallets[0]?.id ?? null);
    setCostText(fmtInput(pos.cost_remaining, digits));
    setProceedsText("");
    setOccurredOn(todayIso());
    setNote("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  const cost = pos ? parseAmount(costText || "0", digits) : 0;
  const proceeds = pos ? parseAmount(proceedsText || "0", digits) : 0;
  const pnl = proceeds - cost;

  const save = useMutation({
    mutationFn: async () => {
      if (!pos || !walletId) throw new Error("请选择回款 Wallet");
      if (cost <= 0) throw new Error("卖出成本需大于 0");
      if (cost > pos.cost_remaining) throw new Error("卖出成本不能超过剩余持有成本");
      await api.post("/investments/sell", {
        position_id: pos.id, wallet_id: walletId, cost_amount: cost,
        proceeds, occurred_on: occurredOn, note,
      });
    },
    onSuccess: () => { invalidateAll(qc); onClose(); },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      setError(r?.data?.detail ?? (e instanceof Error ? e.message : "保存失败"));
    },
  });

  if (!pos) return null;
  const fmt = (a: number) => formatAmount(a, pos.currency_code, currencies);
  return (
    <Modal onClose={onClose} title={`卖出结算 — ${pos.name}`} maxW="max-w-sm">
      <div className="mb-2 text-xs text-ink-500">
        当前持有成本 {fmt(pos.cost_remaining)}。部分卖出就把"卖出成本"改小，剩下的继续持有。
      </div>
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-ink-500">回款 Wallet ({pos.currency_code})</span>
          <select className="input mt-1" value={walletId ?? ""} onChange={(e) => setWalletId(Number(e.target.value) || null)}>
            {matchingWallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-ink-500">卖出成本</span>
            <input className="input mt-1" inputMode="decimal" value={costText} onChange={(e) => setCostText(e.target.value)} />
            <button type="button" onClick={() => setCostText(fmtInput(pos.cost_remaining, digits))} className="mt-1 text-[10px] text-sky-600 hover:underline">全部卖出</button>
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">到手金额</span>
            <input className="input mt-1" inputMode="decimal" value={proceedsText} onChange={(e) => setProceedsText(e.target.value)} autoFocus />
          </label>
        </div>
        <div className={`rounded-md px-3 py-2 text-sm ${pnl > 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : pnl < 0 ? "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "bg-ink-50 text-ink-500 dark:bg-ink-800/40"}`}>
          本次盈亏：{pnl > 0 ? "+" : ""}{fmt(pnl)}
          {pnl !== 0 && <span className="ml-1 text-[11px] opacity-70">（记 {pnl > 0 ? "投资收益" : "投资亏损"}）</span>}
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
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost">取消</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !walletId} className="btn-primary">{save.isPending ? "结算中…" : "确认卖出"}</button>
        </div>
      </div>
    </Modal>
  );
}

function EditModal({ pos, onClose }: { pos: Position | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [openedOn, setOpenedOn] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pos) return;
    setName(pos.name);
    setOpenedOn(pos.opened_on);
    setNote(pos.note ?? "");
    setError("");
  }, [pos]);

  const save = useMutation({
    mutationFn: async () => {
      if (!pos) return;
      if (!name.trim()) throw new Error("请填标的名称");
      await api.patch(`/investments/positions/${pos.id}`, {
        name: name.trim(), opened_on: openedOn, note,
      });
    },
    onSuccess: () => { invalidateAll(qc); onClose(); },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      setError(r?.data?.detail ?? (e instanceof Error ? e.message : "保存失败"));
    },
  });

  if (!pos) return null;
  return (
    <Modal onClose={onClose} title={`编辑持仓 — ${pos.name}`} maxW="max-w-sm">
      <div className="mb-2 text-xs text-ink-500">
        只改名称 / 日期 / 备注，不动金额与账务。改日期会同步移动对应的买入记录。
      </div>
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-ink-500">标的名称</span>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-ink-500">币种（不可改）</span>
            <input className="input mt-1 opacity-60" value={pos.currency_code} disabled />
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">买入日期</span>
            <input type="date" className="input mt-1" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-ink-500">备注</span>
          <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
        </label>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost">取消</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">{save.isPending ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </Modal>
  );
}

function HistoryModal({ open, currencies, onClose }: {
  open: boolean; currencies: Currency[]; onClose: () => void;
}) {
  const list = useQuery({
    queryKey: ["invest-events"],
    queryFn: async () => (await api.get<InvestEvent[]>("/investments/transactions")).data,
    enabled: open,
  });
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(60);

  const rows = useMemo(() => {
    let r = list.data ?? [];
    if (filter !== "all") r = r.filter((e) => e.type === filter);
    const kw = q.trim().toLowerCase();
    if (kw) r = r.filter((e) => e.position_name.toLowerCase().includes(kw) || (e.note ?? "").toLowerCase().includes(kw) || e.occurred_on.includes(kw));
    return r;
  }, [list.data, filter, q]);

  if (!open) return null;
  const fmt = (a: number, code: string) => formatAmount(a, code, currencies);
  const shown = rows.slice(0, limit);

  return (
    <Modal onClose={onClose} title="投资历史" maxW="max-w-lg">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {([["all", "全部"], ["buy", "买入"], ["sell", "卖出"]] as const).map(([k, lbl]) => (
          <button key={k} type="button" onClick={() => { setFilter(k); setLimit(60); }}
            className={filter === k
              ? "rounded-full bg-ink-800 px-2.5 py-0.5 text-xs text-white dark:bg-sky-600"
              : "rounded-full border border-ink-200 px-2.5 py-0.5 text-xs text-ink-600 dark:border-ink-700 dark:text-ink-300"}>
            {lbl}</button>
        ))}
        <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(60); }} placeholder="搜标的 / 备注 / 日期"
          className="ml-auto w-36 rounded-md border border-ink-200 bg-transparent px-2 py-1 text-xs dark:border-ink-700" />
      </div>
      <div className="max-h-[56vh] divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
        {shown.length === 0 && <div className="py-6 text-center text-sm text-ink-500">无记录</div>}
        {shown.map((e) => (
          <div key={e.key} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate">
                {e.type === "buy" ? "🟦 买入" : "🟩 卖出"} · {e.position_name}
                <span className="ml-1 text-[10px] text-ink-400">{e.currency_code}</span>
              </div>
              <div className="text-xs text-ink-500">
                {e.occurred_on}
                {e.type === "sell" && e.proceeds != null && <> · 到手 {fmt(e.proceeds, e.currency_code)}</>}
                {e.note ? ` · ${e.note}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="tabular-nums text-ink-600 dark:text-ink-300">{e.type === "buy" ? "-" : ""}{fmt(e.cost, e.currency_code)}</div>
              {e.type === "sell" && e.pnl != null && e.pnl !== 0 && (
                <div className={`text-[11px] tabular-nums ${e.pnl > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {e.pnl > 0 ? "+" : ""}{fmt(e.pnl, e.currency_code)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {rows.length > shown.length && (
        <button type="button" onClick={() => setLimit((n) => n + 100)}
          className="mt-2 w-full rounded-md border border-ink-200 py-1.5 text-xs text-ink-500 hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800">
          加载更多（还有 {rows.length - shown.length} 条）
        </button>
      )}
      <div className="mt-1 text-center text-[10px] text-ink-400">共 {rows.length} 条{filter !== "all" || q ? "（已筛选）" : ""}</div>
    </Modal>
  );
}
