import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number): string { return String(n).padStart(2, "0"); }
function iso(y: number, m: number, d: number): string { return `${y}-${pad(m)}-${pad(d)}`; }
function todayIso(): string {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
function parse(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
function daysInMonth(y: number, m: number): number { return new Date(y, m, 0).getDate(); }
function firstWeekday(y: number, m: number): number { return new Date(y, m - 1, 1).getDay(); }
function display(s: string): string {
  if (!ISO_RE.test(s)) return "选择日期";
  const { y, m, d } = parse(s);
  return `${y} 年 ${m} 月 ${d} 日 · 周${WEEK[new Date(y, m - 1, d).getDay()]}`;
}
// 本地时区安全的 ±天 (Date 自动处理跨月/跨年)
function shiftDay(s: string, delta: number): string {
  const src = ISO_RE.test(s) ? parse(s) : parse(todayIso());
  const dt = new Date(src.y, src.m - 1, src.d + delta);
  return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

const ARROW = "flex shrink-0 items-center rounded-lg border border-ink-200 px-2.5 text-ink-500 hover:border-ink-400 hover:text-ink-700 dark:border-ink-700 dark:hover:border-ink-500 dark:hover:text-ink-200";

export default function DateField({ value, onChange, className = "" }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const base = ISO_RE.test(value) ? parse(value) : parse(todayIso());
  const [view, setView] = useState({ y: base.y, m: base.m });
  const ref = useRef<HTMLDivElement>(null);

  // 打开时把日历跳到所选日期那个月
  useEffect(() => {
    if (open && ISO_RE.test(value)) { const p = parse(value); setView({ y: p.y, m: p.m }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 点外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const today = todayIso();
  const shiftMonth = (delta: number) => setView((v) => {
    let m = v.m + delta, y = v.y;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    return { y, m };
  });

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday(view.y, view.m); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth(view.y, view.m); d++) cells.push(d);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div className="flex items-stretch gap-1.5">
        <button type="button" onClick={() => onChange(shiftDay(value, -1))} title="前一天" className={ARROW}><ChevronLeft size={16} /></button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="input flex flex-1 cursor-pointer items-center justify-between gap-2 text-left"
        >
          <span className={ISO_RE.test(value) ? "" : "text-ink-400"}>{display(value)}</span>
          <CalendarDays size={16} className="shrink-0 text-ink-400" />
        </button>
        <button type="button" onClick={() => onChange(shiftDay(value, 1))} title="后一天" className={ARROW}><ChevronRight size={16} /></button>
      </div>

      {open && (
        <div className="anim-drop absolute left-0 top-full z-50 mt-1.5 w-[288px] max-w-[calc(100vw-2rem)] rounded-xl border border-ink-200 bg-white p-3 shadow-xl dark:border-ink-700 dark:bg-ink-900">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><ChevronLeft size={16} /></button>
            <span className="text-sm font-semibold tabular-nums">{view.y} 年 {view.m} 月</span>
            <button type="button" onClick={() => shiftMonth(1)} className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><ChevronRight size={16} /></button>
          </div>
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] text-ink-400">
            {WEEK.map((w) => <div key={w} className="py-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (d === null) return <div key={i} />;
              const cur = iso(view.y, view.m, d);
              const sel = cur === value;
              const isToday = cur === today;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => { onChange(cur); setOpen(false); }}
                  className={`flex h-9 items-center justify-center rounded-lg text-sm tabular-nums transition-colors ${
                    sel ? "bg-emerald-600 font-semibold text-white"
                      : isToday ? "font-semibold text-emerald-600 hover:bg-ink-100 dark:text-emerald-400 dark:hover:bg-ink-800"
                        : "text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"
                  }`}
                >{d}</button>
              );
            })}
          </div>
          <div className="mt-2 border-t border-ink-100 pt-2 text-center dark:border-ink-800">
            <button
              type="button"
              onClick={() => { const p = parse(today); setView({ y: p.y, m: p.m }); onChange(today); setOpen(false); }}
              className="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
            >回到今天</button>
          </div>
        </div>
      )}
    </div>
  );
}
