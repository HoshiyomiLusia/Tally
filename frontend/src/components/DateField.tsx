import { ChevronLeft, ChevronRight } from "lucide-react";

// 本地时区安全的 ±天 (不走 UTC)
function shiftDay(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export default function DateField({ value, onChange, className = "" }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-stretch gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => onChange(shiftDay(value, -1))}
        title="前一天"
        className="shrink-0 rounded-lg border border-ink-200 px-2.5 text-ink-500 hover:border-ink-400 hover:text-ink-700 dark:border-ink-700 dark:hover:border-ink-500 dark:hover:text-ink-200"
      ><ChevronLeft size={16} /></button>
      <input type="date" className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      <button
        type="button"
        onClick={() => onChange(shiftDay(value, 1))}
        title="后一天"
        className="shrink-0 rounded-lg border border-ink-200 px-2.5 text-ink-500 hover:border-ink-400 hover:text-ink-700 dark:border-ink-700 dark:hover:border-ink-500 dark:hover:text-ink-200"
      ><ChevronRight size={16} /></button>
    </div>
  );
}
