import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Delete, Paperclip, Plus, Trash2, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

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
import type { WalletType } from "../lib/api";
import { formatAmount, parseAmount, todayIso } from "../lib/format";
import DateField from "./DateField";
import Modal from "./Modal";
import { invalidateMoney } from "../lib/invalidate";

const WALLET_TYPE_ORDER: WalletType[] = ["bank", "e_wallet", "cash", "credit_card", "virtual"];
const WALLET_TYPE_LABEL: Record<WalletType, string> = {
  bank: "银行账户",
  e_wallet: "电子钱包",
  cash: "现金",
  credit_card: "信用卡",
  virtual: "虚拟账户",
};

export interface TransactionPrefill {
  kind: "expense" | "income";
  wallet_id: number;
  category_id: number | null;
  merchant_id: number | null;
  amount: number;            // 最小单位
  currency_code: string;
  occurred_on: string;
  note: string;
  is_recurring: boolean;
  recurrence_period_days: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: Transaction | null;
  // 周期账单"确认扣款": 用模板预填一笔新账单 (整张表单都能改, 含分摊/附件等)
  prefill?: TransactionPrefill | null;
  recurrenceSourceId?: number | null;
}

interface ParticipantState {
  contact_id: number;
  share_text: string;
}

export default function TransactionForm({ open, onClose, editing, prefill, recurrenceSourceId }: Props) {
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
  const [padOpen, setPadOpen] = useState(false);
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceText, setRecurrenceText] = useState("");
  const [splitOn, setSplitOn] = useState(false);
  const [participants, setParticipants] = useState<ParticipantState[]>([]);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const merchantInputRef = useRef<HTMLInputElement>(null);
  const stagedFileRef = useRef<HTMLInputElement>(null);
  const initKey = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initKey.current = null;
      return;
    }
    const key = editing ? `edit:${editing.id}` : prefill ? `prefill:${recurrenceSourceId ?? "x"}:${prefill.occurred_on}` : "new";
    // editing / prefill 需要 currencies / merchants 才能算对金额单位和回填商家名
    if ((editing || prefill) && (!currencies.data || !merchants.data)) return;
    if (initKey.current === key) return;
    initKey.current = key;
    if (editing) {
      setKind(editing.kind === "income" ? "income" : "expense");
      setWalletId(editing.wallet_id);
      setCategoryId(editing.category_id);
      setMerchantId(editing.merchant_id);
      const initName = merchants.data?.find((m) => m.id === editing.merchant_id)?.name ?? "";
      setMerchantInput(initName);
      if (merchantInputRef.current) merchantInputRef.current.value = initName;
      setOccurredOn(editing.occurred_on);
      setNote(editing.note);
      setIsRecurring(editing.is_recurring);
      setRecurrenceText(editing.recurrence_period_days?.toString() ?? "");
      const cur = currencies.data?.find((c) => c.code === editing.currency_code);
      const digits = cur?.decimal_digits ?? 2;
      setAmountText((editing.amount / Math.pow(10, digits)).toString());
      setSplitOn(false);
      setParticipants([]);
    } else if (prefill) {
      setKind(prefill.kind);
      setWalletId(prefill.wallet_id);
      setCategoryId(prefill.category_id);
      setMerchantId(prefill.merchant_id);
      const initName = merchants.data?.find((m) => m.id === prefill.merchant_id)?.name ?? "";
      setMerchantInput(initName);
      if (merchantInputRef.current) merchantInputRef.current.value = initName;
      setOccurredOn(prefill.occurred_on);
      setNote(prefill.note);
      setIsRecurring(prefill.is_recurring);
      setRecurrenceText(prefill.recurrence_period_days?.toString() ?? "");
      const cur = currencies.data?.find((c) => c.code === prefill.currency_code);
      const digits = cur?.decimal_digits ?? 2;
      setAmountText((prefill.amount / Math.pow(10, digits)).toString());
      setSplitOn(false);
      setParticipants([]);
    } else {
      setKind("expense");
      setCategoryId(null);
      setMerchantInput("");
      if (merchantInputRef.current) merchantInputRef.current.value = "";
      setMerchantId(null);
      setAmountText("");
      setOccurredOn(todayIso());
      setNote("");
      setIsRecurring(false);
      setRecurrenceText("");
      setSplitOn(false);
      setParticipants([]);
    }
    setStagedFiles([]);
    setError("");
    setPadOpen(false);
    setMyShareText("");  // 重开表单要清"我的分摊额", 否则陈旧值会抑制自动均摊(审计: 唯一漏重置的字段)
    setTimeout(() => amountRef.current?.focus(), 50);
  }, [open, editing, prefill, recurrenceSourceId, merchants.data, currencies.data]);

  const wallet = wallets.data?.find((w) => w.id === walletId) ?? null;
  const digits = currencies.data?.find((c) => c.code === wallet?.currency_code)?.decimal_digits ?? 2;
  const totalAmount = parseAmount(amountText || "0", digits);
  const activeContacts = (contacts.data ?? []).filter((c) => !c.archived);

  useEffect(() => {
    if (!open) return;
    // 编辑/预填(确认扣款)自带钱包, 绝不能用"默认钱包"覆盖 —— 否则与 prefill 的 setWalletId 同一渲染里
    // 竞态、后定义的本 effect 读到旧的 null 闭包再写默认钱包, 把农行的确认单错设成三菱UFJ(会记错币种/钱包)。
    if (editing || prefill) return;
    if (walletId == null && wallets.data?.length) {
      const active = wallets.data.find((w) => !w.archived) ?? wallets.data[0];
      setWalletId(active.id);
    }
  }, [open, wallets.data, walletId, editing, prefill]);

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

  const catUsage = useQuery({
    queryKey: ["merchants-usage", categoryId],
    queryFn: async () => (await api.get<{ merchant_id: number; count: number }[]>(
      `/merchants/usage-by-category?category_id=${categoryId}`,
    )).data,
    enabled: open && categoryId != null,
  });

  const deferredMerchantInput = useDeferredValue(merchantInput);
  const merchantSuggestions = useMemo(() => {
    const all = merchants.data ?? [];
    // 用户在输入时, 搜全量 —— 跨分类也能命中 (例: Uber 默认挂"共享打车", 但我
    // 现在在"固定账单"下记账, 也应该能搜到 Uber 然后用它). 分类过滤只在没输入
    // 时收窄默认 12 个建议.
    if (deferredMerchantInput) {
      const q = deferredMerchantInput.toLowerCase();
      return all.filter((m) => {
        if (m.name.toLowerCase().includes(q)) return true;
        if (m.aliases && m.aliases.toLowerCase().includes(q)) return true;
        return false;
      }).slice(0, 12);
    }
    if (!categoryId) return all.slice(0, 12);

    // 包含规则: 在当前分类用过 OR default_category 匹配 (含子类). 排序优先级:
    // 在该分类的使用次数 desc > default 匹配 > 全局 usage_count desc.
    // 这样在出租车下用过 5 次 Uber 的话, Uber 会浮到 GO Taxi 上面.
    const kids = childrenByParent.get(categoryId) ?? [];
    const accept = new Set<number>([categoryId, ...kids.map((c) => c.id)]);
    const usageMap = new Map<number, number>();
    for (const u of catUsage.data ?? []) usageMap.set(u.merchant_id, u.count);

    const scored = all.map((m) => ({
      m,
      used: usageMap.get(m.id) ?? 0,
      defMatch: m.default_category_id != null && accept.has(m.default_category_id),
    }));
    const included = scored.filter((x) => x.used > 0 || x.defMatch);
    if (included.length === 0) return all.slice(0, 12);
    included.sort((a, b) =>
      (b.used - a.used) ||
      (Number(b.defMatch) - Number(a.defMatch)) ||
      (b.m.usage_count - a.m.usage_count),
    );
    return included.slice(0, 12).map((x) => x.m);
  }, [merchants.data, deferredMerchantInput, categoryId, childrenByParent, catUsage.data]);

  const createCustomMerchant = useMutation({
    mutationFn: async (name: string) => {
      const r = await api.post<Merchant>("/merchants", {
        name,
        default_category_id: categoryId,
      });
      return r.data;
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["merchants"] });
      setMerchantInput(m.name);
      if (merchantInputRef.current) merchantInputRef.current.value = m.name;
      setMerchantId(m.id);
    },
  });

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

  // 我先填好自己那份, 把剩下的总额均摊给其他参与人 (余数落在第一个人头上)
  const splitRemainder = () => {
    if (!participants.length) return;
    const remaining = totalAmount - myShare;
    if (remaining < 0) return;
    const n = participants.length;
    const each = Math.floor(remaining / n);
    const rem = remaining - each * n;
    setParticipants(participants.map((p, i) => ({ ...p, share_text: formatAmountInput(each + (i === 0 ? rem : 0), digits) })));
  };

  // 纯代付: 我一分不摊(我=0), 全款均摊到其他参与人头上 -> 全额都是别人欠我的
  const advanceAll = () => {
    if (totalAmount <= 0 || !participants.length) return;
    const n = participants.length;
    const each = Math.floor(totalAmount / n);
    const rem = totalAmount - each * n;
    setMyShareText("0");  // 非空字符串, 同时压制自动均摊 effect
    setParticipants(participants.map((p, i) => ({ ...p, share_text: formatAmountInput(each + (i === 0 ? rem : 0), digits) })));
  };

  function onMerchantPick(m: Merchant) {
    setMerchantInput(m.name);
    if (merchantInputRef.current) merchantInputRef.current.value = m.name;
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
      // 币种小数位没加载出来时, digits 会兜底成 2, 对 JPY/KRW(0 位)会把金额放大 100 倍落库。
      // 宁可拦下也不能记错: currencies 未就绪就不许保存(审计发现的 100 倍落库根因)。
      if (!currencies.data?.some((c) => c.code === wallet.currency_code)) {
        throw new Error("货币信息未加载完成, 请稍候重试");
      }
      if (totalAmount <= 0) throw new Error("金额需大于 0");

      let mid = merchantId;
      const trimmed = merchantInput.trim();
      if (trimmed) {
        // 审计#56: 尽量拉一次最新商家列表核对(收窄重复创建窗口); GET 失败则退回缓存,
        // 不因这次辅助请求失败而阻断整笔交易保存(回归修正)。后端无 get-or-create, 只能前端兜。
        let list = merchants.data ?? [];
        try {
          list = (await api.get<Merchant[]>("/merchants")).data;
        } catch { /* 网络抖动: 用缓存兜底, 保存照常进行 */ }
        const matched = list.find((m) => m.name === trimmed);
        if (matched) {
          mid = matched.id;
        } else {
          const r = await api.post<Merchant>("/merchants", { name: trimmed });
          mid = r.data.id;
          qc.invalidateQueries({ queryKey: ["merchants"] });
        }
      } else {
        mid = null;
      }

      let attachTo: number | null = null;
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
          recurrence_source_id: recurrenceSourceId ?? null,
          my_share: myShare,
          participants: participants.map((p) => ({ contact_id: p.contact_id, share: parseAmount(p.share_text || "0", digits) })),
        };
        const r = await api.post<Transaction[]>("/loans/split", payload);
        attachTo = r.data[0]?.id ?? null;
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
          recurrence_source_id: recurrenceSourceId ?? null,
        };
        if (editing) {
          await api.patch(`/transactions/${editing.id}`, payload);
        } else {
          const r = await api.post<Transaction>("/transactions", payload);
          attachTo = r.data.id;
        }
      }

      if (attachTo != null && stagedFiles.length > 0) {
        for (const f of stagedFiles) {
          const form = new FormData();
          form.append("file", f);
          await api.post(`/transactions/${attachTo}/attachments`, form, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        }
      }
    },
    onSuccess: () => {
      invalidateMoney(qc);
      qc.invalidateQueries({ queryKey: ["merchants"] });
      onClose();
    },
    onError: (e: unknown) => {
      let msg = e instanceof Error ? e.message : "保存失败";
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      if (r?.data?.detail) msg = r.data.detail;
      setError(msg);
    },
  });

  // 鼠标小键盘: 往金额框追加/删除字符
  function pressPad(key: string) {
    setAmountText((cur) => {
      if (key === "del") return cur.slice(0, -1);
      if (key === ".") return cur.includes(".") ? cur : (cur || "0") + ".";
      if (cur === "0") return key;  // 避免出现 "05"
      return cur + key;
    });
  }

  if (!open) return null;

  return (
    <Modal onClose={onClose} title={editing ? "编辑交易" : recurrenceSourceId ? "确认扣款" : "添加交易"}>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-ink-500">日期</span>
            <DateField value={occurredOn} onChange={setOccurredOn} className="mt-0.5" />
          </label>

          <div className="flex gap-1.5 border-t border-ink-100 pt-3 dark:border-ink-700">
            <button
              type="button"
              onClick={() => setKind("expense")}
              className={`flex-1 rounded-md py-2 text-sm font-medium ${kind === "expense" ? "bg-rose-600 text-white" : "bg-ink-100 text-ink-600 dark:bg-ink-700/40 dark:text-ink-300"}`}
            >支出</button>
            <button
              type="button"
              onClick={() => { setKind("income"); setSplitOn(false); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium ${kind === "income" ? "bg-emerald-600 text-white" : "bg-ink-100 text-ink-600 dark:bg-ink-700/40 dark:text-ink-300"}`}
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
              <button
                type="button"
                onClick={() => setPadOpen((v) => !v)}
                title="数字小键盘"
                className={`flex shrink-0 items-center rounded-md border px-2.5 ${padOpen ? "border-ink-800 bg-ink-800 text-white dark:border-emerald-500 dark:bg-emerald-600" : "border-ink-200 text-ink-500 hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800"}`}
              >
                <Calculator size={18} />
              </button>
              <div className={`flex shrink-0 items-center rounded-md px-3 text-sm font-semibold ${wallet ? "bg-ink-800 text-white" : "bg-amber-50 text-amber-700"}`}>
                {wallet?.currency_code ?? "选 Wallet"}
              </div>
            </div>
            {padOpen && (
              <div className="anim-drop mt-2 grid grid-cols-3 gap-1.5 rounded-lg bg-ink-50 p-2 dark:bg-ink-800/50">
                {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "del"].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => pressPad(k)}
                    className="flex items-center justify-center rounded-md border border-ink-200 bg-white py-3 text-lg font-medium text-ink-700 hover:bg-ink-100 active:scale-95 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 dark:hover:bg-ink-800"
                  >
                    {k === "del" ? <Delete size={18} /> : k}
                  </button>
                ))}
              </div>
            )}
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

          <div className="-mx-5 border-t-4 border-ink-100 px-5 pt-3 dark:border-ink-800">
            <div className="mb-1.5 text-sm font-semibold text-ink-700 dark:text-ink-200">Wallet</div>
            <div className="space-y-2">
              {Array.from(walletsByCurrency.entries()).map(([code, list]) => {
                const byType = new Map<WalletType, Wallet[]>();
                for (const w of list) {
                  const arr = byType.get(w.type) ?? [];
                  arr.push(w);
                  byType.set(w.type, arr);
                }
                const typed = WALLET_TYPE_ORDER.filter((t) => byType.has(t));
                return (
                  <div key={code}>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">{code}</div>
                    <div className="space-y-1.5">
                      {typed.map((t) => (
                        <div key={t} className="flex flex-wrap items-center gap-1.5">
                          <span className="mr-0.5 w-14 shrink-0 text-[10px] text-ink-400">{WALLET_TYPE_LABEL[t]}</span>
                          {(byType.get(t) ?? []).map((w) => {
                            const on = walletId === w.id;
                            return (
                              <button
                                key={w.id}
                                type="button"
                                onClick={() => setWalletId(w.id)}
                                className={on ? "chip chip-selected" : "chip chip-idle"}
                              >
                                {on && <span className="mr-0.5">✓</span>}
                                {w.name}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="-mx-5 border-t-4 border-ink-100 px-5 pt-3 dark:border-ink-800">
            <div className="mb-1.5 text-sm font-semibold text-ink-700 dark:text-ink-200">分类 <span className="text-xs font-normal text-ink-400">（点大类就够了，需要更细再点小类）</span></div>
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

          <div className="-mx-5 border-t-4 border-ink-100 px-5 pt-3 dark:border-ink-800">
            <div className="mb-1.5 text-sm font-semibold text-ink-700 dark:text-ink-200">商家 <span className="text-xs font-normal text-ink-400">(可选)</span></div>
            <input
              ref={merchantInputRef}
              className="input"
              defaultValue=""
              placeholder="输入或选择 (支持中/日/英别名匹配)"
              onInput={(e) => { setMerchantInput((e.target as HTMLInputElement).value); setMerchantId(null); }}
            />
            {merchantInput !== merchants.data?.find((m) => m.id === merchantId)?.name && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {merchantSuggestions.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onMerchantPick(m)}
                    className="min-h-[32px] rounded-full bg-ink-50 px-3 py-1 text-sm text-ink-600 hover:bg-ink-100 sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-xs dark:bg-ink-700/50 dark:text-ink-200"
                  >{m.name}</button>
                ))}
                {merchantInput.trim() && !merchants.data?.some((m) => m.name.toLowerCase() === merchantInput.trim().toLowerCase()) && (
                  <button
                    type="button"
                    disabled={createCustomMerchant.isPending}
                    onClick={() => createCustomMerchant.mutate(merchantInput.trim())}
                    className="min-h-[32px] rounded-full border border-dashed border-emerald-500 px-3 py-1 text-sm font-medium text-emerald-600 hover:bg-emerald-50 sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-xs dark:border-emerald-400 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                  >+ 添加 "{merchantInput.trim()}"</button>
                )}
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-xs text-ink-500">备注</span>
            <input className="input mt-0.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
          </label>

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
                      <div className="flex justify-end gap-3">
                        <button type="button" onClick={advanceAll} className="text-xs text-ink-600 underline" title="我不摊, 出全款代付, 全额均摊给其他人 -> 别人全欠我">纯代付</button>
                        <button type="button" onClick={splitRemainder} className="text-xs text-ink-600 underline" title="保留我填的金额, 把剩下的均摊给其他人">我付完余下AA</button>
                        <button type="button" onClick={equalSplit} className="text-xs text-ink-600 underline">全部均摊</button>
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

          {editing ? (
            <AttachmentsSection transactionId={editing.id} />
          ) : (
            <StagedAttachments
              files={stagedFiles}
              fileRef={stagedFileRef}
              onAdd={(fs) => setStagedFiles([...stagedFiles, ...fs])}
              onRemove={(idx) => setStagedFiles(stagedFiles.filter((_, i) => i !== idx))}
            />
          )}

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:pt-1">
            <button onClick={onClose} className="btn-ghost min-h-[44px] sm:min-h-0">取消</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary min-h-[44px] sm:min-h-0">
              {save.isPending ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
    </Modal>
  );
}

function formatAmountInput(amount: number, digits: number): string {
  return (amount / Math.pow(10, digits)).toString();
}

function stripTrailingZero(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(8)));
}

function StagedAttachments({
  files,
  fileRef,
  onAdd,
  onRemove,
}: {
  files: File[];
  fileRef: React.RefObject<HTMLInputElement>;
  onAdd: (fs: File[]) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div className="rounded-md bg-ink-50 p-2">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1 text-ink-600"><Paperclip size={14} /> 附件 / 小票</span>
        <button onClick={() => fileRef.current?.click()} className="btn-ghost px-2 py-0.5 text-xs">
          <Plus size={12} /> 添加
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) onAdd(fs);
            e.target.value = "";
          }}
        />
      </div>
      {files.length === 0 ? (
        <div className="text-xs text-ink-400">保存后一并上传</div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {files.map((f, idx) => (
            <StagedThumb key={idx} file={f} onRemove={() => onRemove(idx)} />
          ))}
        </div>
      )}
    </div>
  );
}

function StagedThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="group relative">
      {url ? (
        <img src={url} alt={file.name} className="h-20 w-full rounded-md object-cover" />
      ) : (
        <div className="flex h-20 w-full items-center justify-center rounded-md bg-white text-xs text-ink-500">
          {file.name.split(".").pop()?.toUpperCase() || "FILE"}
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100"
      ><Trash2 size={10} /></button>
    </div>
  );
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
    // 审计#69: 上传失败别静默 (超大/截断图会 500)
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      alert(r?.data?.detail ?? "上传失败");
    },
  });

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/attachments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments", transactionId] }),
    // 审计#69: 删除附件失败别静默
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      alert(r?.data?.detail ?? "删除附件失败");
    },
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
