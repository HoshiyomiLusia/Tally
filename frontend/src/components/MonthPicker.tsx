import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;       // "YYYY-MM"
  onChange: (v: string) => void;
  className?: string;
}

function parse(v: string): { y: number; m: number } {
  const [ys, ms] = v.split("-");
  return { y: parseInt(ys, 10), m: parseInt(ms, 10) };
}

function fmt(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function MonthPicker({ value, onChange, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [yearShown, setYearShown] = useState(() => parse(value).y);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 打开时把面板的年份对齐到当前选中值
  useEffect(() => {
    if (open) setYearShown(parse(value).y);
  }, [open, value]);

  // 点外面关
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cur = parse(value);
  const today = new Date();
  const thisY = today.getFullYear();
  const thisM = today.getMonth() + 1;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium hover:border-ink-400 dark:border-ink-700 dark:bg-ink-800 dark:hover:border-ink-500"
      >
        <Calendar size={14} className="text-ink-500" />
        <span>{cur.y} 年 {cur.m} 月</span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-ink-200 bg-white p-3 shadow-xl dark:border-ink-700 dark:bg-ink-800">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setYearShown((y) => y - 1)}
              className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-700"
              aria-label="上一年"
            ><ChevronLeft size={16} /></button>
            <div className="text-sm font-semibold">{yearShown} 年</div>
            <button
              type="button"
              onClick={() => setYearShown((y) => y + 1)}
              className="rounded p-1 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-700"
              aria-label="下一年"
            ><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => {
              const isActive = yearShown === cur.y && mm === cur.m;
              const isThis = yearShown === thisY && mm === thisM;
              return (
                <button
                  key={mm}
                  type="button"
                  onClick={() => {
                    onChange(fmt(yearShown, mm));
                    setOpen(false);
                  }}
                  className={
                    isActive
                      ? "rounded-md bg-ink-800 py-1.5 text-xs font-medium text-white dark:bg-emerald-600"
                      : isThis
                        ? "rounded-md border border-emerald-500 py-1.5 text-xs text-emerald-700 dark:text-emerald-300"
                        : "rounded-md py-1.5 text-xs text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-700"
                  }
                >{mm} 月</button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(fmt(thisY, thisM));
              setOpen(false);
            }}
            className="mt-2 w-full rounded-md py-1.5 text-xs text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-700"
          >回到本月</button>
        </div>
      )}
    </div>
  );
}
