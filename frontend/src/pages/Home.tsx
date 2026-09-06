import { BarChart3, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import AllTimeAnalysis from "../components/AllTimeAnalysis";
import MonthPicker from "../components/MonthPicker";
import { BalanceModule, RecurringForecast } from "../components/Overview";
import RecurringPanel from "../components/RecurringPanel";
import Stats from "./Stats";

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 板块展开状态记在 localStorage: 默认折叠(只看必要信息), 用户展开过就记住
function useFold(key: string) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(key, open ? "1" : "0"); } catch { /* 隐私模式忽略 */ } }, [key, open]);
  return [open, setOpen] as const;
}

// 三个板块统一: 折叠箭头贴在标题左边, 点标题即展开/收起
function FoldTitle({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex items-center gap-1 text-base font-semibold tracking-tight text-ink-900 hover:text-ink-600 dark:text-ink-50 dark:hover:text-ink-300"
    >
      {open ? <ChevronDown size={16} className="text-ink-400" /> : <ChevronRight size={16} className="text-ink-400" />}
      {children}
    </button>
  );
}

// 首页 = 三个独立矩形板块, 标题在矩形内部, 默认都折叠成"必要信息":
//   ① 余额   = 真实余额 + 各币种汇总 (展开: 预定支出 + 每个账户)
//   ② 仪表盘 = KPI (展开: Top商家/分类/支出节奏)
//   ③ 周期账单 = 合计对比 + 临近几笔预测 (展开: 完整条目)
export default function Home() {
  const [month, setMonth] = useState(thisMonth());
  const [showAll, setShowAll] = useState(false);
  const [balOpen, setBalOpen] = useFold("tally.fold.balance");
  const [statsOpen, setStatsOpen] = useFold("tally.fold.stats");
  const [recurOpen, setRecurOpen] = useFold("tally.fold.recurring");

  return (
    <div className="space-y-5 px-4 py-5 md:px-6">
      {/* 板块 1: 余额 (标题在 BalanceModule 内部, 与右侧指标同行) */}
      <section className="card">
        <BalanceModule expanded={balOpen} onToggle={() => setBalOpen(!balOpen)} />
      </section>

      {/* 板块 2: 仪表盘 */}
      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <FoldTitle open={statsOpen} onClick={() => setStatsOpen(!statsOpen)}>仪表盘</FoldTitle>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium hover:border-ink-400 dark:border-ink-700 dark:bg-ink-800 dark:hover:border-ink-500"
            >
              <BarChart3 size={14} className="text-ink-500" /> 总分析
            </button>
            <MonthPicker value={month} onChange={setMonth} />
          </div>
        </div>
        <Stats embedded hideHeader collapsed={!statsOpen} month={month} onMonthChange={setMonth} />
      </section>

      {/* 板块 3: 周期账单 */}
      <section className="card">
        <div className="mb-3">
          <FoldTitle open={recurOpen} onClick={() => setRecurOpen(!recurOpen)}>周期账单</FoldTitle>
        </div>
        {recurOpen && <p className="mb-3 text-xs text-ink-500">把房租 / 订阅 / 水电 这类有规律的支出标记为月度或年度，这里集中看</p>}
        <div className="space-y-4">
          <RecurringPanel month={month} summaryOnly={!recurOpen} />
          <RecurringForecast compact={!recurOpen} />
        </div>
      </section>

      {showAll && <AllTimeAnalysis onClose={() => setShowAll(false)} />}
    </div>
  );
}
