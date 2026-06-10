import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownLeft, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import ContactForm from "../components/ContactForm";
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">收到还款 — {acct.contact_name}</div>
          <button onClick={onClose} className="text-ink-400"><X size={18} /></button>
        </div>
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
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center gap-1.5 text-rose-600">
          <AlertTriangle size={18} /> <div className="font-semibold">核销坏账 — {acct.contact_name}</div>
        </div>
        <div className="mb-2 text-sm text-ink-600">
          会生成两笔：一笔"坏账损失"消费扣在选定 Wallet（让系统余额与物理对齐）+ 一笔贷款还款清掉欠款。
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
      </div>
    </div>
  );
}

function HistoryModal({ acct, currencies, onClose }: {
  acct: LoanAccount | null;
  currencies: Currency[];
  onClose: () => void;
}) {
  const list = useQuery({
    queryKey: ["loan-history", acct?.contact_id, acct?.currency_code],
    queryFn: async () => (await api.get<Transaction[]>(`/transactions?contact_id=${acct!.contact_id}&currency_code=${acct!.currency_code}&limit=500`)).data,
    enabled: !!acct,
  });

  if (!acct) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">{acct.contact_name} · {acct.currency_code} 明细</div>
          <button onClick={onClose} className="text-ink-400"><X size={18} /></button>
        </div>
        <div className="divide-y divide-ink-100">
          {(list.data ?? []).filter((t) => t.kind === "loan_out" || t.kind === "loan_repayment").map((t) => (
            <div key={t.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div>{t.kind === "loan_out" ? "🟥 借出" : "🟩 还款"} · {t.occurred_on}</div>
                {t.note && <div className="text-xs text-ink-500">{t.note}</div>}
              </div>
              <div className={t.kind === "loan_out" ? "text-rose-600" : "text-emerald-600"}>
                {t.kind === "loan_out" ? "-" : "+"}{formatAmount(t.amount, t.currency_code, currencies)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatAmountInput(amount: number, digits: number): string {
  return (amount / Math.pow(10, digits)).toString();
}
