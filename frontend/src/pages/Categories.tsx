import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import Modal from "../components/Modal";
import { api, type Category, type CategoryKind } from "../lib/api";

export default function Categories() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [newParent, setNewParent] = useState<Category | null>(null);

  const list = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await api.get<Category[]>("/categories")).data,
  });

  const filtered = (list.data ?? []).filter((c) => c.kind === kind);
  const tree = useMemo(() => {
    const parents = filtered.filter((c) => c.parent_id === null).sort((a, b) => a.sort_order - b.sort_order);
    return parents.map((p) => ({
      ...p,
      children: filtered.filter((c) => c.parent_id === p.id).sort((a, b) => a.sort_order - b.sort_order),
    }));
  }, [filtered]);

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">分类</h1>
          <p className="text-sm text-ink-500">两级结构，emoji 可改</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-md bg-ink-100 p-0.5">
            <button onClick={() => setKind("expense")} className={`rounded-md px-3 py-1 text-sm ${kind === "expense" ? "bg-white shadow-sm" : "text-ink-600"}`}>支出</button>
            <button onClick={() => setKind("income")} className={`rounded-md px-3 py-1 text-sm ${kind === "income" ? "bg-white shadow-sm" : "text-ink-600"}`}>收入</button>
          </div>
          <button onClick={() => { setEditing(null); setNewParent(null); setOpen(true); }} className="btn-primary">
            <Plus size={14} /> 新增一级
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {tree.map((p) => (
          <div key={p.id} className="card">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-base font-medium">
                <span className="text-xl">{p.emoji}</span>
                <span>{p.name}</span>
              </div>
              <div className="flex gap-0.5">
                <button onClick={() => { setEditing(null); setNewParent(p); setOpen(true); }} className="btn-ghost p-1.5" title="加子分类"><Plus size={14} /></button>
                <button onClick={() => { setEditing(p); setNewParent(null); setOpen(true); }} className="btn-ghost p-1.5"><Pencil size={14} /></button>
                <button onClick={() => { if (confirm(`删除"${p.name}"及其全部子分类？`)) del.mutate(p.id); }} className="btn-danger p-1.5"><Trash2 size={14} /></button>
              </div>
            </div>
            {p.children.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {p.children.map((c) => (
                  <div key={c.id} className="group flex items-center gap-1 rounded-full bg-ink-50 py-1 pl-2.5 pr-1 text-sm">
                    <span>{c.emoji}</span> <span>{c.name}</span>
                    <button onClick={() => { setEditing(c); setNewParent(null); setOpen(true); }} className="text-ink-400 hover:text-ink-700"><Pencil size={11} /></button>
                    <button onClick={() => { if (confirm(`删除"${c.name}"？`)) del.mutate(c.id); }} className="text-ink-400 hover:text-rose-600"><Trash2 size={11} /></button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-ink-400">（无子分类）</div>
            )}
          </div>
        ))}
      </div>

      <CategoryForm
        open={open}
        onClose={() => setOpen(false)}
        editing={editing}
        parent={newParent}
        defaultKind={kind}
      />
    </div>
  );
}

function CategoryForm({
  open,
  onClose,
  editing,
  parent,
  defaultKind,
}: {
  open: boolean;
  onClose: () => void;
  editing: Category | null;
  parent: Category | null;
  defaultKind: CategoryKind;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [error, setError] = useState("");

  useMemo(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setEmoji(editing?.emoji ?? "");
    setError("");
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        await api.patch(`/categories/${editing.id}`, { name, emoji });
      } else {
        await api.post("/categories", {
          name,
          emoji,
          parent_id: parent?.id ?? null,
          kind: parent ? parent.kind : defaultKind,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      onClose();
    },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      setError(r?.data?.detail ?? "保存失败");
    },
  });

  if (!open) return null;
  const title = editing ? "编辑分类" : parent ? `在「${parent.name}」下添加子分类` : "新建一级分类";

  return (
    <Modal onClose={onClose} title={title} maxW="max-w-sm">
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-ink-500">名称</span>
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">Emoji</span>
            <input className="input mt-1" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🍱" maxLength={4} />
          </label>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn-ghost">取消</button>
            <button onClick={() => save.mutate()} disabled={save.isPending || !name} className="btn-primary">
              {save.isPending ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
    </Modal>
  );
}
