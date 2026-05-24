import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  type Attachment,
  type Category,
  type Contact,
  type Currency,
  type Merchant,
  type Transaction,
  type Wallet,
} from "../lib/api";
import { formatAmount, parseAmount, todayIso } from "../lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: Transaction | null;
}

interface ParticipantState {
  contact_id: number;
  share_text: string;
}

export default function TransactionForm({ open, onClose, editing }: Props) {
  const qc = useQueryClient();
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: async () => (await api.get<Wallet[]>("/wallets")).data, enabled: open });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data, enabled: open });
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: async () => (await api.get<Merchant[]>("/merchants")).data, enabled: open });
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: async () => (await api.get<Currency[]>("/currencies")).data, enabled: open });
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: async () => (await api.get<Contact[]>("/contacts")).data, enabled: open });

  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [walletId, setWalletId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [merchantInput, setMerchantInput] = useState("");
  const [merchantId, setMerchantId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceText, setRecurrenceText] = useState("");
  const [composingMerchant, setComposingMerchant] = useState(false);
  const [splitOn, setSplitOn] = useState(false);
  const [participants, setParticipants] = useState<ParticipantState[]>([]);
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setKind(editing.kind === "income" ? "income" : "expense");
      setWalletId(editing.wallet_id);
      setCategoryId(editing.category_id);
      setMerchantId(editing.merchant_id);
      setMerchantInput(merchants.data?.find((m) => m.id === editing.merchant_id)?.name ?? "");
      setOccurredOn(editing.occurred_on);
      setNote(editing.note);
      setIsRecurring(editing.is_recurring);
      setRecurrenceText(editing.recurrence_period_days?.toString() ?? "");
      const cur = currencies.data?.find((c) => c.code === editing.currency_code);
      const digits = cur?.decimal_digits ?? 2;
      setAmountText((editing.amount / Math.pow(10, digits)).toString());
      setSplitOn(false);
      setParticipants([]);
    } else {
      setKind("expense");
      setCategoryId(null);
      setMerchantInput("");
      setMerchantId(null);
      setAmountText("");
      setOccurredOn(todayIso());
      setNote("");
      setIsRecurring(false);
      setRecurrenceText("");
      setSplitOn(false);
      setParticipants([]);
    }
    setError("");
    setTimeout(() => amountRef.current?.focus(), 50);
  }, [open, editing, merchants.data, currencies.data]);

  const wallet = wallets.data?.find((w) => w.id === walletId) ?? null;
  const digits = currencies.data?.find((c) => c.code === wallet?.currency_code)?.decimal_digits ?? 2;
  const totalAmount = parseAmount(amountText || "0", digits);
  const activeContacts = (contacts.data ?? []).filter((c) => !c.archived);

  useEffect(() => {
    if (!open) return;
    if (walletId == null && wallets.data?.length) {
      const active = wallets.data.find((w) => !w.archived) ?? wallets.data[0];
      setWalletId(active.id);
    }
  }, [open, wallets.data, walletId]);

  const filteredCategories = useMemo(
    () => (categories.data ?? []).filter((c) => c.kind === kind),
    [categories.data, kind],
  );
  const topLevel = filteredCategories.filter((c) => c.parent_id === null);
  const childrenByParent = useMemo(() => {
    const m = new Map<number, Category[]>();
    for (const c of filteredCategories) {
      if (c.parent_id != null) {
        const arr = m.get(c.parent_id) ?? [];
        arr.push(c);
        m.set(c.parent_id, arr);
      }
    }
    return m;
  }, [filteredCategories]);
  const selectedCat = filteredCategories.find((c) => c.id === categoryId) ?? null;
  const expandedParent = selectedCat?.parent_id ?? (selectedCat && childrenByParent.get(selectedCat.id) ? selectedCat.id : null);

  const merchantSuggestions = useMemo(() => {
    const all = merchants.data ?? [];
    let pool = all;
    if (categoryId) {
      const matched = all.filter((m) => m.default_category_id === categoryId);
      if (matched.length > 0) pool = matched;
    }
    if (!merchantInput) return pool.slice(0, 12);
    const q = merchantInput.toLowerCase();
    return pool.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 12);
  }, [merchants.data, merchantInput, categoryId]);

  const walletsByCurrency = useMemo(() => {
    const m = new Map<string, Wallet[]>();
    for (const w of (wallets.data ?? []).filter((x) => !x.archived)) {
      const arr = m.get(w.currency_code) ?? [];
      arr.push(w);
      m.set(w.currency_code, arr);
    }
    return m;
  }, [wallets.data]);

  const equalSplit = () => {
    if (totalAmount <= 0 || !participants.length) return;
    const n = participants.length + 1;
    const each = Math.floor(totalAmount / n);
    const remainder = totalAmount - each * n;
    setMyShareText(formatAmountInput(each + remainder, digits));
    setParticipants(participants.map((p) => ({ ...p, share_text: formatAmountInput(each, digits) })));
  };

  const [myShareText, setMyShareText] = useState("");
  useEffect(() => {
    if (splitOn && totalAmount > 0 && participants.length > 0 && !myShareText) {
      equalSplit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitOn, totalAmount, participants.length]);

  const myShare = parseAmount(myShareText || "0", digits);
  const participantsSum = participants.reduce((s, p) => s + parseAmount(p.share_text || "0", digits), 0);
  const shareDiff = totalAmount - myShare - participantsSum;

  function onMerchantPick(m: Merchant) {
    setMerchantInput(m.name);
    setMerchantId(m.id);
    if (m.default_category_id && !categoryId) {
      setCategoryId(m.default_category_id);
    }
  }

  function addParticipant(contact_id: number) {
    if (participants.some((p) => p.contact_id === contact_id)) return;
    setParticipants([...participants, { contact_id, share_text: "" }]);
  }
  function removeParticipant(contact_id: number) {
    setParticipants(participants.filter((p) => p.contact_id !== contact_id));
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!wallet) throw new Error("请选择 Wallet");
      if (totalAmount <= 0) throw new Error("金额需大于 0");

      let mid = merchantId;
      const matched = merchants.data?.find((m) => m.name === merchantInput.trim());
      if (merchantInput.trim() && !matched) {
        const r = await api.post<Merchant>("/merchants", { name: merchantInput.trim() });
        mid = r.data.id;
        qc.invalidateQueries({ queryKey: ["merchants"] });
      } else if (matched) {
        mid = matched.id;
      } else {
        mid = null;
      }

      if (splitOn && !editing) {
        if (participants.length === 0) throw new Error("请至少选择 1 个分摊参与人");
        if (shareDiff !== 0) throw new Error(`分摊金额合计差 ${formatAmount(shareDiff, wallet.currency_code, currencies.data)}`);
        const payload = {
          wallet_id: wallet.id,
          category_id: categoryId,
          merchant_id: mid,
          amount: totalAmount,
          currency_code: wallet.currency_code,
          occurred_on: occurredOn,
          note,
          is_recurring: isRecurring,
          recurrence_period_days: isRecurring && recurrenceText ? Number(recurrenceText) : null,
          my_share: myShare,
          participants: participants.map((p) => ({ contact_id: p.contact_id, share: parseAmount(p.share_text || "0", digits) })),
        };
        await api.post("/loans/split", payload);
      } else {
        const payload = {
          wallet_id: wallet.id,
          category_id: categoryId,
          merchant_id: mid,
          amount: totalAmount,
          currency_code: wallet.currency_code,
          kind,
          occurred_on: occurredOn,
          note,
          is_recurring: isRecurring,
          recurrence_period_days: isRecurring && recurrenceText ? Number(recurrenceText) : null,
        };
        if (editing) {
          await api.patch(`/transactions/${editing.id}`, payload);
        } else {
          await api.post("/transactions", payload);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["wallets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["loan-accounts"] });
      onClose();
    },
    onError: (e: unknown) => {
      let msg = e instanceof Error ? e.message : "保存失败";
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      if (r?.data?.detail) msg = r.data.detail;
      setError(msg);
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">{editing ? "编辑交易" : "添加交易"}</div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setKind("expense")}
              className={`flex-1 rounded-md py-2 text-sm font-medium ${kind === "expense" ? "bg-ink-800 text-white" : "bg-ink-100 text-ink-600"}`}
            >支出</button>
            <button
              type="button"
              onClick={() => { setKind("income"); setSplitOn(false); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium ${kind === "income" ? "bg-emerald-600 text-white" : "bg-ink-100 text-ink-600"}`}
            >收入</button>
          </div>

          <div>
            <div className="flex items-stretch gap-2">
              <input
                ref={amountRef}
                inputMode="decimal"
                className="input flex-1 text-2xl"
                placeholder="0"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
              <div className={`flex shrink-0 items-center rounded-md px-3 text-sm font-semibold ${wallet ? "bg-ink-800 text-white" : "bg-amber-50 text-amber-700"}`}>
                {wallet?.currency_code ?? "选 Wallet"}
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[
                { label: "×10", factor: 10 },
                { label: "×100", factor: 100 },
                { label: "×千", factor: 1000 },
                { label: "×万", factor: 10000 },
              ].map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => {
                    const cur = parseFloat(amountText) || 1;
                    setAmountText(stripTrailingZero(cur * b.factor));
                  }}
                  className="min-h-[36px] rounded-md bg-ink-100 px-3.5 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-200 sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-xs"
                >{b.label}</button>
              ))}
              <button
                type="button"
                onClick={() => setAmountText("")}
                className="min-h-[36px] rounded-md bg-ink-50 px-3.5 py-1.5 text-sm text-ink-500 hover:bg-ink-100 sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-xs"
              >清空</button>
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-500">Wallet</div>
            <div className="space-y-1.5">
              {Array.from(walletsByCurrency.entries()).map(([code, list]) => (
                <div key={code}>
                  <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-500">{code}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((w) => {
                      const on = walletId === w.id;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => setWalletId(w.id)}
                          className={
                            on
                              ? "chip chip-selected"
                              : "chip chip-idle"
                          }
                        >
                          {on && <span className="mr-0.5">✓</span>}
                          {w.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-500">分类 <span className="text-ink-400">（点大类就够了，需要更细再点小类）</span></div>
            <div className="flex flex-wrap gap-1.5">
              {topLevel.map((p) => {
                const isSelected = categoryId === p.id;
                const isExpanded = expandedParent === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setCategoryId(p.id)}
                    className={
                      isSelected
                        ? "chip chip-selected"
                        : isExpanded
                          ? "chip chip-active-parent"
                          : "chip chip-idle"
                    }
                  >
                    {isSelected && <span className="mr-0.5">✓</span>}
                    {p.emoji} {p.name}
                  </button>
                );
              })}
            </div>
            {expandedParent != null && childrenByParent.get(expandedParent) && (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-ink-100 pt-2 dark:border-ink-700">
                {(childrenByParent.get(expandedParent) ?? []).map((c) => {
                  const on = categoryId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategoryId(c.id)}
                      className={on ? "chip chip-selected" : "chip chip-sub-idle"}
                    >
                      {on && <span className="mr-0.5">✓</span>}
                      {c.emoji} {c.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-500">商家 (可选)</div>
            <input
              className="input"
              value={merchantInput}
              placeholder="输入或选择"
              onCompositionStart={() => setComposingMerchant(true)}
              onCompositionEnd={(e) => {
                setComposingMerchant(false);
                setMerchantInput((e.target as HTMLInputElement).value);
                setMerchantId(null);
              }}
              onChange={(e) => {
                setMerchantInput(e.target.value);
                if (!composingMerchant) setMerchantId(null);
              }}
            />
            {!composingMerchant && merchantSuggestions.length > 0 && merchantInput !== merchants.data?.find((m) => m.id === merchantId)?.name && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {merchantSuggestions.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onMerchantPick(m)}
                    className="min-h-[32px] rounded-full bg-ink-50 px-3 py-1 text-sm text-ink-600 hover:bg-ink-100 sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-xs dark:bg-ink-700/50 dark:text-ink-200"
                  >{m.name}</button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-ink-500">日期</span>
              <input className="input mt-0.5" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs text-ink-500">备注</span>
              <input className="input mt-0.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
            </label>
          </div>

          <div className="rounded-md bg-ink-50 p-2 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => {
                  setIsRecurring(e.target.checked);
                  if (e.target.checked && !recurrenceText) setRecurrenceText("30");
                  if (!e.target.checked) setRecurrenceText("");
                }}
              />
              标记为周期账单
            </label>
            {isRecurring && (
              <div className="mt-1.5 flex items-center gap-1 pl-5">
                <span className="mr-1 text-xs text-ink-500">频率</span>
                <button
                  type="button"
                  onClick={() => setRecurrenceText("30")}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${recurrenceText === "30" ? "border-ink-800 bg-ink-800 text-white" : "border-ink-200 text-ink-600"}`}
                >月度</button>
                <button
                  type="button"
                  onClick={() => setRecurrenceText("365")}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${recurrenceText === "365" ? "border-ink-800 bg-ink-800 text-white" : "border-ink-200 text-ink-600"}`}
                >年度</button>
              </div>
            )}
          </div>

          {kind === "expense" && !editing && (
            <div className="rounded-md bg-ink-50 p-2">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={splitOn} onChange={(e) => setSplitOn(e.target.checked)} /> 分摊订单（AA）
              </label>
              {splitOn && (
                <div className="mt-2 space-y-2">
                  <div className="text-xs text-ink-500">参与人（除了你自己）</div>
                  <div className="flex flex-wrap gap-1">
                    {activeContacts.map((c) => {
                      const on = participants.some((p) => p.contact_id === c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => on ? removeParticipant(c.id) : addParticipant(c.id)}
                          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${on ? "border-ink-800 bg-ink-800 text-white" : "border-ink-200 bg-white text-ink-600"}`}
                        >
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: c.color || "#abacb4" }} />
                          {c.name}
                        </button>
                      );
                    })}
                    {activeContacts.length === 0 && (
                      <span className="text-xs text-ink-400">没有联系人。先去 联系人 页加。</span>
                    )}
                  </div>

                  {participants.length > 0 && (
                    <>
                      <div className="flex justify-end">
                        <button type="button" onClick={equalSplit} className="text-xs text-ink-600 underline">均摊</button>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <div className="w-20 shrink-0 text-ink-500">我</div>
                          <input
                            inputMode="decimal"
                            className="input"
                            value={myShareText}
                            onChange={(e) => setMyShareText(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        {participants.map((p) => {
                          const c = activeContacts.find((x) => x.id === p.contact_id);
                          return (
                            <div key={p.contact_id} className="flex items-center gap-2 text-sm">
                              <div className="flex w-20 shrink-0 items-center gap-1 text-ink-500">
                                <span className="inline-block h-2 w-2 rounded-full" style={{ background: c?.color || "#abacb4" }} />
                                <span className="truncate">{c?.name}</span>
                              </div>
                              <input
                                inputMode="decimal"
                                className="input"
                                value={p.share_text}
                                onChange={(e) => setParticipants(participants.map((x) => x.contact_id === p.contact_id ? { ...x, share_text: e.target.value } : x))}
                                placeholder="0"
                              />
                              <button type="button" onClick={() => removeParticipant(p.contact_id)} className="text-ink-400"><X size={14} /></button>
                            </div>
                          );
                        })}
                        <div className={`text-right text-xs ${shareDiff === 0 ? "text-ink-500" : "text-rose-600"}`}>
                          {shareDiff === 0
                            ? "✓ 合计正好"
                            : `差 ${formatAmount(shareDiff, wallet?.currency_code ?? "", currencies.data)}`}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {editing && <AttachmentsSection transactionId={editing.id} />}

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:pt-1">
            <button onClick={onClose} className="btn-ghost min-h-[44px] sm:min-h-0">取消</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary min-h-[44px] sm:min-h-0">
              {save.isPending ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatAmountInput(amount: number, digits: number): string {
  return (amount / Math.pow(10, digits)).toString();
}

function stripTrailingZero(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(8)));
}

function AttachmentsSection({ transactionId }: { transactionId: number }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const list = useQuery({
    queryKey: ["attachments", transactionId],
    queryFn: async () => (await api.get<Attachment[]>(`/transactions/${transactionId}/attachments`)).data,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/transactions/${transactionId}/attachments`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments", transactionId] }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/attachments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments", transactionId] }),
  });

  return (
    <div className="rounded-md bg-ink-50 p-2">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1 text-ink-600"><Paperclip size={14} /> 附件 / 小票</span>
        <button onClick={() => fileRef.current?.click()} className="btn-ghost px-2 py-0.5 text-xs">
          <Plus size={12} /> 上传
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = "";
          }}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(list.data ?? []).map((a) => (
          <div key={a.id} className="group relative">
            {a.mime_type.startsWith("image/") ? (
              <AttachmentImage attachmentId={a.id} alt={a.original_name} />
            ) : (
              <button
                onClick={() => downloadAttachment(a)}
                className="flex h-20 w-full items-center justify-center rounded-md bg-white text-xs text-ink-500"
              >{a.original_name.split(".").pop()?.toUpperCase()}</button>
            )}
            <button
              onClick={() => { if (confirm("删除该附件？")) del.mutate(a.id); }}
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100"
            ><Trash2 size={10} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttachmentImage({ attachmentId, alt }: { attachmentId: number; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let blobUrl: string | null = null;
    api.get(`/attachments/${attachmentId}?thumb=true`, { responseType: "blob" }).then((r) => {
      if (!active) return;
      blobUrl = URL.createObjectURL(r.data);
      setUrl(blobUrl);
    }).catch(() => {});
    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [attachmentId]);
  if (!url) return <div className="h-20 w-full animate-pulse rounded-md bg-ink-100" />;
  return <img src={url} alt={alt} className="h-20 w-full rounded-md object-cover" />;
}

async function downloadAttachment(a: Attachment) {
  const r = await api.get(`/attachments/${a.id}`, { responseType: "blob" });
  const u = URL.createObjectURL(r.data);
  const link = document.createElement("a");
  link.href = u;
  link.download = a.original_name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
