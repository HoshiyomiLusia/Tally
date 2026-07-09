import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";

interface Props {
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  maxW?: string;  // tailwind max-w-* , 默认 max-w-lg
}

// 统一弹窗外壳: 右上角关闭 X + 点击外部关闭.
// 外部关闭要求"完整地在背景层按下并松开"(mousedown 和 mouseup 都落在背景上),
// 这样从框内拖到框外松手、或框外拖进框内, 都不会误触关闭.
export default function Modal({ onClose, title, children, maxW = "max-w-lg" }: Props) {
  const downOnBackdrop = useRef(false);
  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div className={`anim-sheet max-h-[92dvh] w-full ${maxW} overflow-y-auto rounded-t-2xl bg-white p-5 pb-24 sm:rounded-2xl sm:pb-5 dark:bg-ink-900`}>
        {title !== undefined && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-lg font-semibold">{title}</div>
            <button type="button" onClick={onClose} className="shrink-0 text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"><X size={18} /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
