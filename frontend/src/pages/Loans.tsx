import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownLeft, Pencil, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import ContactForm from "../components/ContactForm";
import Modal from "../components/Modal";
import { api, type Contact, type Currency, type LoanAccount, type Transaction, type Wallet } from "../lib/api";
import { formatAmount, parseAmount, todayIso } from "../lib/format";

export default function Loans() {
  const qc = useQueryClient();
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: async () => (await api.get<Contact[]>("/contacts")).data });
  const accounts = useQuery({ queryKey: ["loan-accounts"], queryFn: async () => (await api.get<LoanAccount[]>("/loans/accounts")).data });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data });
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: async () => (await api.get<Wallet[]>("/wallets")).data });

  const [repayFor, setRepayFor] = useState<LoanAccount | null>(null);
  const [writeOffFor, setWriteOffFor] = useState<LoanAccount | null>(null);
  const [historyFor, setHistoryFor] = useState<LoanAccount | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [contactFormOpen, setContactFormOpen] = useState(false);

  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of accounts.data ?? []) m.set(a.currency_code, (m.get(a.currency_code) ?? 0) + a.balance);
    return Array.from(m.entries()).filter(([, v]) => v !== 0);
  }, [accounts.data]);

  // Group loan accounts by contact_id
  const acctsByContact = useMemo(() => {
    const m = new Map<number, LoanAccount[]>();
    for (const a of accounts.data ?? []) {
      const arr = m.get(a.contact_id) ?? [];
      arr.push(a);
      m.set(a.contact_id, arr);
    }
    return m;
  }, [accounts.data]);

  const delContact = useMutation({
    mutationFn: async (id: number) => api.delete(`/contacts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["loan-accounts"] });
    },
  });

  const contactList = (contacts.data ?? []).filter((c) => !c.archived);

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">借贷</h1>
          <p className="text-sm text-ink-500">每个联系人 = 一张借贷账户 · 负数 = 应收（对方未还） · 正数 = 应付（我未还）</p>
        </div>
        <button onClick={() => { setEditingContact(null); setContactFormOpen(true); }} className="btn-primary">
          <UserPlus size={14} /> 新建联系人
        </button>
      </div>

      {totals.length > 0 && (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {totals.map(([code, total]) => (
            <div key={code} className="card">
              <div className="text-xs text-ink-500">{code} 应收/应付净额</div>
              <div className={`text-lg font-semibold ${total < 0 ? "text-emerald-600" : total > 0 ? "text-rose-600" : ""}`}>
                {formatAmount(total, code, currencies.data)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {contactList.length === 0 && (
          <div className="card text-sm text-ink-500">
            还没有联系人。点右上"新建联系人"开始。
          </div>
        )}
        {contactList.map((c) => {
          const accts = acctsByContact.get(c.id) ?? [];
          return (
            <div key={c.id} className="card">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: c.color || "#abacb4" }} />
                  <div>
                    <div className="font-medium">{c.name}</div>
                    {c.note && <div className="text-xs text-ink-500">{c.note}</div>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <button onClick={() => { setEditingContact(c); setContactFormOpen(true); }} className="btn-ghost p-1.5"><Pencil size={14} /></button>
                  <button
                    onClick={() => {
                      const msg = accts.length > 0
                        ? `${c.name} 还有 ${accts.length} 个币种的借贷记录，删除联系人后这些记录的"联系人"会变空。继续？`
                        : `删除联系人"${c.name}"？`;
                      if (confirm(msg)) delContact.mutate(c.id);
                    }}
                    className="btn-danger p-1.5"
                  ><Trash2 size={14} /></button>
                </div>
              </div>

              {accts.length === 0 ? (
                <div className="text-xs text-ink-400">暂无借贷往来</div>
              ) : (
                <div className="divide-y divide-ink-100 dark:divide-ink-700">
                  {accts.map((a) => (
                    <div key={`${a.contact_id}-${a.currency_code}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-ink-500">
                          {a.currency_code} · 借出 {formatAmount(a.loan_out_total, a.currency_code, currencies.data)} · 已还 {formatAmount(a.loan_repayment_total, a.currency_code, currencies.data)}
                        </div>
                      </div>
                      <div className={`shrink-0 text-base font-semibold ${a.balance < 0 ? "text-rose-600" : a.balance > 0 ? "text-emerald-600" : "text-ink-500"}`}>
                        {formatAmount(a.balance, a.currency_code, currencies.data)}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button onClick={() => setHistoryFor(a)} className="btn-ghost text-xs">明细</button>
                        <button onClick={() => setRepayFor(a)} className="btn-ghost text-xs" title="收到还款">
                          <ArrowDownLeft size={12} /> 还款
                        </button>
                        {a.balance < 0 && (
                          <button onClick={() => setWriteOffFor(a)} className="btn-danger text-xs" title="坏账核销">
                            <AlertTriangle size={12} /> 核销
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <RepaymentModal acct={repayFor} wallets={wallets.data ?? []} currencies={currencies.data ?? []} onClose={() => setRepayFor(null)} />
      <WriteOffModal acct={writeOffFor} wallets={wallets.data ?? []} currencies={currencies.data ?? []} onClose={() => setWriteOffFor(null)} />
      <HistoryModal acct={historyFor} currencies={currencies.data ?? []} onClose={() => setHistoryFor(null)} />
      <ContactForm open={contactFormOpen} onClose={() => setContactFormOpen(false)} editing={editingContact} />
    </div>
  );
}

function RepaymentModal({ acct, wallets, currencies, onClose }: {
  acct: LoanAccount | null;
  wallets: Wallet[];
  currencies: Currency[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [walletId, setWalletId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const matchingWallets = wallets.filter((w) => w.currency_code === acct?.currency_code && !w.archived);
  const digits = currencies.find((c) => c.code === acct?.currency_code)?.decimal_digits ?? 2;

  useEffect(() => {
    if (!acct) return;
    const def = matchingWallets[0]?.id ?? null;
    setWalletId(def);
    setAmountText(formatAmountInput(-acct.balance, digits));
    setOccurredOn(todayIso());
    setNote("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acct]);

  const save = useMutation({
    mutationFn: async () => {
      if (!acct || !walletId) throw new Error("请选择入账 Wallet");
      const amount = parseAmount(amountText, digits);
      if (amount <= 0) throw new Error("金额需大于 0");
      await api.post("/loans/repayment", {
        contact_id: acct.contact_id,
        currency_code: acct.currency_code,
        wallet_id: walletId,
        amount,
        occurred_on: occurredOn,
        note,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loan-accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "保存失败";
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      setError(r?.data?.detail ?? msg);
    },
  });

  if (!acct) return null;
  return (
    <Modal onClose={onClose} title={`收到还款 — ${acct.contact_name}`} maxW="max-w-sm">
        <div className="mb-2 text-xs text-ink-500">
          当前余额 {formatAmount(acct.balance, acct.currency_code, currencies)}
          {acct.balance < 0 && <>（还需 {formatAmount(-acct.balance, acct.currency_code, currencies)}）</>}
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-ink-500">入账 Wallet ({acct.currency_code})</span>
            <select className="input mt-1" value={walletId ?? ""} onChange={(e) => setWalletId(Number(e.target.value) || null)}>
              {matchingWallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            {matchingWallets.length === 0 && <div className="mt-1 text-xs text-rose-600">该币种下还没有 Wallet</div>}
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">金额</span>
            <input className="input mt-1" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} autoFocus />
          </label>
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
            <button onClick={() => save.mutate()} disabled={save.isPending || !walletId} className="btn-primary">
              {save.isPending ? "保存中…" : "确认收款"}
            </button>
          </div>
        </div>
    </Modal>
  );
}

function WriteOffModal({ acct, wallets, currencies, onClose }: {
  acct: LoanAccount | null;
  wallets: Wallet[];
  currencies: Currency[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [walletId, setWalletId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const matchingWallets = wallets.filter((w) => w.currency_code === acct?.currency_code && !w.archived);
  const digits = currencies.find((c) => c.code === acct?.currency_code)?.decimal_digits ?? 2;

  useEffect(() => {
    if (!acct) return;
    setWalletId(matchingWallets[0]?.id ?? null);
    setAmountText(formatAmountInput(-acct.balance, digits));
    setNote("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acct]);

  const save = useMutation({
    mutationFn: async () => {
      if (!acct || !walletId) throw new Error("请选择 Wallet");
      const amount = parseAmount(amountText, digits);
      if (amount <= 0) throw new Error("金额需大于 0");
      await api.post("/loans/write-off", {
        contact_id: acct.contact_id,
        currency_code: acct.currency_code,
        wallet_id: walletId,
        amount,
        occurred_on: todayIso(),
        note: note || `${acct.contact_name} 坏账核销`,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loan-accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      const msg = e instanceof Error ? e.message : "保存失败";
      setError(r?.data?.detail ?? msg);
    },
  });

  if (!acct) return null;
  return (
    <Modal onClose={onClose} title={<span className="flex items-center gap-1.5 text-rose-600"><AlertTriangle size={18} /> 核销坏账 — {acct.contact_name}</span>} maxW="max-w-sm">
        <div className="mb-2 text-sm text-ink-600">
          会生成两笔：一笔"坏账损失"消费扣在选定 Wallet（让真实余额与物理余额对齐）+ 一笔贷款还款清掉欠款。
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-ink-500">原始借出 Wallet ({acct.currency_code})</span>
            <select className="input mt-1" value={walletId ?? ""} onChange={(e) => setWalletId(Number(e.target.value) || null)}>
              {matchingWallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">核销金额</span>
            <input className="input mt-1" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">备注</span>
            <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn-ghost">取消</button>
            <button onClick={() => save.mutate()} disabled={save.isPending || !walletId} className="btn-danger bg-rose-600 text-white hover:bg-rose-700">
              {save.isPending ? "核销中…" : "确认核销"}
            </button>
          </div>
        </div>
    </Modal>
  );
}

function HistoryModal({ acct, currencies, onClose }: {
  acct: LoanAccount | null;
  currencies: Currency[];
  onClose: () => void;
}) {
  const list = useQuery({
    queryKey: ["loan-history", acct?.contact_id, acct?.currency_code],
    queryFn: async () => (await api.get<Transaction[]>(`/transactions?contact_id=${acct!.contact_id}&currency_code=${acct!.currency_code}&limit=2000`)).data,
    enabled: !!acct,
  });
  const [filter, setFilter] = useState<"all" | "loan_out" | "loan_repayment">("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(60);

  const sums = useMemo(() => {
    let out = 0, rep = 0, no = 0, nr = 0;
    for (const t of list.data ?? []) {
      if (t.kind === "loan_out") { out += t.amount; no++; }
      else if (t.kind === "loan_repayment") { rep += t.amount; nr++; }
    }
    return { out, rep, no, nr };
  }, [list.data]);

  const rows = useMemo(() => {
    let r = (list.data ?? []).filter((t) => t.kind === "loan_out" || t.kind === "loan_repayment");
    if (filter !== "all") r = r.filter((t) => t.kind === filter);
    const kw = q.trim().toLowerCase();
    if (kw) r = r.filter((t) => (t.note ?? "").toLowerCase().includes(kw) || t.occurred_on.includes(kw));
    return [...r].sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : b.id - a.id));
  }, [list.data, filter, q]);

  if (!acct) return null;
  const fmt = (a: number) => formatAmount(a, acct.currency_code, currencies);
  const shown = rows.slice(0, limit);

  return (
    <Modal onClose={onClose} title={`${acct.contact_name} · ${acct.currency_code} 明细`} maxW="max-w-lg">
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Sum label={`借出 · ${sums.no}笔`} v={fmt(sums.out)} tone="rose" />
        <Sum label={`还款 · ${sums.nr}笔`} v={fmt(sums.rep)} tone="emerald" />
        <Sum label="净额 (她欠你)" v={fmt(sums.out - sums.rep)} tone={sums.out - sums.rep >= 0 ? "rose" : "emerald"} />
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {([["all", "全部"], ["loan_out", "借出"], ["loan_repayment", "还款"]] as const).map(([k, lbl]) => (
          <button key={k} type="button" onClick={() => { setFilter(k); setLimit(60); }}
            className={filter === k
              ? "rounded-full bg-ink-800 px-2.5 py-0.5 text-xs text-white dark:bg-emerald-600"
              : "rounded-full border border-ink-200 px-2.5 py-0.5 text-xs text-ink-600 dark:border-ink-700 dark:text-ink-300"}>
            {lbl}</button>
        ))}
        <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(60); }} placeholder="搜备注 / 日期"
          className="ml-auto w-32 rounded-md border border-ink-200 bg-transparent px-2 py-1 text-xs dark:border-ink-700" />
      </div>
      <div className="max-h-[52vh] divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
        {shown.length === 0 && <div className="py-6 text-center text-sm text-ink-500">无记录</div>}
        {shown.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <div>{t.kind === "loan_out" ? "🟥 借出" : "🟩 还款"} · {t.occurred_on}</div>
              {t.note && <div className="truncate text-xs text-ink-500">{t.note}</div>}
            </div>
            <div className={`shrink-0 tabular-nums ${t.kind === "loan_out" ? "text-rose-600" : "text-emerald-600"}`}>
              {t.kind === "loan_out" ? "-" : "+"}{fmt(t.amount)}
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

function Sum({ label, v, tone }: { label: string; v: string; tone: "rose" | "emerald" }) {
  return (
    <div className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800/40">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone === "rose" ? "text-rose-600" : "text-emerald-600"}`}>{v}</div>
    </div>
  );
}

function formatAmountInput(amount: number, digits: number): string {
  return (amount / Math.pow(10, digits)).toString();
}
