import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api, type Contact } from "../lib/api";

export default function Contacts() {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  const list = useQuery({
    queryKey: ["contacts", { archived: showArchived }],
    queryFn: async () => (await api.get<Contact[]>(`/contacts?include_archived=${showArchived}`)).data,
  });

  const archive = useMutation({
    mutationFn: async (c: Contact) => api.patch(`/contacts/${c.id}`, { archived: !c.archived }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">联系人</h1>
          <p className="text-sm text-ink-500">分摊订单和借贷记账用</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-ink-600">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            显示已归档
          </label>
          <button onClick={() => { setEditing(null); setOpen(true); }} className="btn-primary">
            <Plus size={14} /> 新增联系人
          </button>
        </div>
      </div>

      <div className="card divide-y divide-ink-100 p-0">
        {(list.data ?? []).length === 0 && <div className="px-4 py-6 text-center text-sm text-ink-500">还没有联系人</div>}
        {(list.data ?? []).map((c) => (
          <div key={c.id} className={`flex items-center justify-between gap-2 px-4 py-2.5 text-sm ${c.archived ? "opacity-50" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: c.color || "#abacb4" }} />
              <span className="font-medium">{c.name}</span>
              {c.note && <span className="text-xs text-ink-500">· {c.note}</span>}
              {c.archived && <span className="text-[10px] text-ink-400">已归档</span>}
            </div>
            <div className="flex gap-0.5">
              <button onClick={() => { setEditing(c); setOpen(true); }} className="btn-ghost p-1.5"><Pencil size={14} /></button>
              <button onClick={() => archive.mutate(c)} className="btn-ghost p-1.5" title={c.archived ? "取消归档" : "归档"}>
                {c.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </button>
              <button onClick={() => { if (confirm(`删除联系人"${c.name}"？相关贷款记录的联系人会清空`)) del.mutate(c.id); }} className="btn-danger p-1.5"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      <ContactForm open={open} onClose={() => setOpen(false)} editing={editing} />
    </div>
  );
}

function ContactForm({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Contact | null }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#888888");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setColor(editing?.color || "#888888");
    setNote(editing?.note ?? "");
    setError("");
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name, color, note };
      if (editing) await api.patch(`/contacts/${editing.id}`, payload);
      else await api.post("/contacts", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      onClose();
    },
    onError: (e: unknown) => {
      const r = (e as { response?: { data?: { detail?: string } } }).response;
      setError(r?.data?.detail ?? "保存失败");
    },
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-lg font-semibold">{editing ? "编辑联系人" : "新增联系人"}</div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-ink-500">名称</span>
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">标识色</span>
            <input className="mt-1 h-8 w-16" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-ink-500">备注 (可选)</span>
            <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
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
