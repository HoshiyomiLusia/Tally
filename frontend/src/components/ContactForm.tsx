import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, type Contact } from "../lib/api";

export const CONTACT_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#8b5cf6", "#ec4899", "#92400e", "#5f6068",
];

export default function ContactForm({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: Contact | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(CONTACT_COLORS[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setColor(editing?.color || CONTACT_COLORS[0]);
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
          <div className="block">
            <span className="text-xs text-ink-500">标识色</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CONTACT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ring-2 transition ${color === c ? "ring-ink-800" : "ring-transparent hover:ring-ink-200"}`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
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
