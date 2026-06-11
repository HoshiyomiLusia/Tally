import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, type Category, type Merchant } from "../lib/api";

const REGIONS = [
  { value: "", label: "全部" },
  { value: "JP", label: "🇯🇵 日本" },
  { value: "CN", label: "🇨🇳 中国" },
  { value: "GLOBAL", label: "🌐 全球" },
  { value: "OTHER", label: "其他" },
];

export default function Merchants() {
  const qc = useQueryClient();
  const [region, setRegion] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Merchant | null>(null);

  const list = useQuery({
    queryKey: ["merchants"],
    queryFn: async () => (await api.get<Merchant[]>("/merchants")).data,
  });
  const categories = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get<Category[]>("/categories")).data });

  const filtered = useMemo(() => {
    let arr = list.data ?? [];
    if (region) arr = arr.filter((m) => (region === "OTHER" ? !["JP", "CN", "GLOBAL"].includes(m.region) : m.region === region));
    if (q) arr = arr.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
    return arr;
  }, [list.data, region, q]);

  const catName = (id: number | null) => categories.data?.find((c) => c.id === id)?.name ?? "—";

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/merchants/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["merchants"] }),
  });

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">商家</h1>
          <p className="text-sm text-ink-500">常用商家清单 · 可绑定默认分类</p>
        </div>
        <button onClick={() => { setEditing(null); setOpen(true); }} className="btn-primary">
          <Plus size={14} /> 新增商家
        </button>
      </div>

      <div className="card mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
          {REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <input className="input sm:col-span-3" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索商家名" />
      </div>

      <div className="card divide-y divide-ink-100 p-0">
        {filtered.length === 0 && <div className="px-4 py-6 text-center text-sm text-ink-500">没有匹配的商家</div>}
        {filtered.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{m.name}</div>
              <div className="text-xs text-ink-500">
                {m.region || "—"} · 默认分类: {catName(m.default_category_id)} · 用过 {m.usage_count} 次
              </div>
            </div>
            <div className="flex shrink-0 gap-0.5">
              <button onClick={() => { setEditing(m); setOpen(true); }} className="btn-ghost p-1.5"><Pencil size={14} /></button>
              <button onClick={() => { if (confirm(`删除"${m.name}"？`)) del.mutate(m.id); }} className="btn-danger p-1.5"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      <MerchantForm open={open} onClose={() => setOpen(false)} editing={editing} categories={categories.data ?? []} />
    </div>
  );
}

function MerchantForm({
  open,
  onClose,
  editing,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  editing: Merchant | null;
  categories: Category[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setRegion(editing?.region ?? "");
    setCategoryId(editing?.default_category_id ? String(editing.default_category_id) : "");
    setError("");
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        region,
        default_category_id: categoryId ? Number(categoryId) : null,
      };
      if (editing) await api.patch(`/merchants/${editing.id}`, payload);
      else await api.post("/merchants", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["merchants"] });
      onClose();
    },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      setError(r?.data?.detail ?? "保存失败");
    },
  });

  if (!open) return null;
  return (
    <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-lg font-semibold">{editing ? "编辑商家" : "新增商家"}</div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-ink-500">名称</span>
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">地区</span>
            <select className="input mt-1" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">未设置</option>
              <option value="JP">🇯🇵 日本</option>
              <option value="CN">🇨🇳 中国</option>
              <option value="GLOBAL">🌐 全球</option>
              <option value="OTHER">其他</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">默认分类</span>
            <select className="input mt-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">无</option>
              {categories.filter((c) => c.parent_id !== null).map((c) => (
                <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
              ))}
            </select>
          </label>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn-ghost">取消</button>
            <button onClick={() => save.mutate()} disabled={save.isPending || !name} className="btn-primary">
              {save.isPending ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
