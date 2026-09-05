import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  maxW?: string;  // tailwind max-w-* , 默认 max-w-lg
}

// 打开中的弹窗栈: Esc 只关最上层(借贷分析里再开编辑弹窗时, 一下 Esc 不能把两层都关掉)
const openStack: symbol[] = [];

// 统一弹窗外壳: 右上角关闭 X + 点击外部关闭 + Esc 关闭 + 打开时焦点进入弹窗.
// 外部关闭要求"完整地在背景层按下并松开"(mousedown 和 mouseup 都落在背景上),
// 这样从框内拖到框外松手、或框外拖进框内, 都不会误触关闭.
export default function Modal({ onClose, title, children, maxW = "max-w-lg" }: Props) {
  const downOnBackdrop = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<symbol>(Symbol("modal"));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = idRef.current;
    openStack.push(id);
    // 焦点进弹窗(键盘 Tab 不会落到背后页面); 弹窗里有 autoFocus 的输入框就不抢
    const t = setTimeout(() => {
      if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 让日期/月份下拉先吃掉这次 Esc(它们会 preventDefault); 下一拍再看是否轮到弹窗
      setTimeout(() => {
        if (!e.defaultPrevented && openStack[openStack.length - 1] === id) onCloseRef.current();
      }, 0);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      const i = openStack.indexOf(id);
      if (i >= 0) openStack.splice(i, 1);
    };
  }, []);

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={`anim-sheet max-h-[92dvh] w-full ${maxW} overflow-y-auto rounded-t-2xl bg-white p-5 pb-24 outline-none sm:rounded-2xl sm:pb-5 dark:bg-ink-900`}
      >
        {title !== undefined && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-lg font-semibold">{title}</div>
            <button type="button" onClick={onClose} className="shrink-0 text-ink-400 hover:text-ink-700 dark:hover:text-ink-200" aria-label="关闭"><X size={18} /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
