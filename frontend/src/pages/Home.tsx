import { BarChart3 } from "lucide-react";
import { useState } from "react";

import AllTimeAnalysis from "../components/AllTimeAnalysis";
import MonthPicker from "../components/MonthPicker";
import { BalanceModule, RecurringForecast } from "../components/Overview";
import RecurringPanel from "../components/RecurringPanel";
import Stats from "./Stats";

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 首页 = 三个独立矩形板块, 标题在矩形内部:
//   ① 余额   = 资产总览 + Wallet 余额
//   ② 仪表盘 = KPI + Top商家/分类 + 支出节奏 (随月份)
//   ③ 周期账单 = 预测时间轴 + 本月/上月对比
export default function Home() {
  const [month, setMonth] = useState(thisMonth());
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="space-y-5 px-4 py-5 md:px-6">
      {/* 板块 1: 余额 (标题在 BalanceModule 内部, 与右侧指标同行) */}
      <section className="card">
        <BalanceModule />
      </section>

      {/* 板块 2: 仪表盘 */}
      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">仪表盘</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium hover:border-ink-400 dark:border-ink-700 dark:bg-ink-800 dark:hover:border-ink-500"
            >
              <BarChart3 size={14} className="text-ink-500" /> 总分析
            </button>
            <MonthPicker value={month} onChange={setMonth} />
          </div>
        </div>
        <Stats embedded hideHeader month={month} onMonthChange={setMonth} />
      </section>

      {/* 板块 3: 周期账单 */}
      <section className="card">
        <h2 className="mb-3 text-base font-semibold tracking-tight">周期账单</h2>
        <p className="mb-3 text-xs text-ink-500">把房租 / 订阅 / 水电 这类有规律的支出标记为月度或年度，这里集中看</p>
        <div className="space-y-4">
          <RecurringForecast />
          <RecurringPanel month={month} />
        </div>
      </section>

      {showAll && <AllTimeAnalysis onClose={() => setShowAll(false)} />}
    </div>
  );
}
