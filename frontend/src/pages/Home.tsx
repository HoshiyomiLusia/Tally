import { useState } from "react";

import MonthPicker from "../components/MonthPicker";
import { BalanceModule, DashboardTop } from "../components/Overview";
import Stats from "./Stats";

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 首页 = 两个板块: ①余额 (资产总览 + Wallet) ②仪表盘 (当月收支 + 周期预测 + 统计)
export default function Home() {
  const [month, setMonth] = useState(thisMonth());

  return (
    <div className="space-y-8 px-4 py-5 md:px-6">
      {/* 板块 1: 余额 */}
      <section>
        <h1 className="mb-3 text-xl font-semibold tracking-tight">余额</h1>
        <BalanceModule />
      </section>

      {/* 板块 2: 仪表盘 — 共用一个月份选择器 */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">仪表盘</h1>
          <MonthPicker value={month} onChange={setMonth} />
        </div>
        <div className="space-y-5">
          <DashboardTop month={month} />
          <Stats embedded hideHeader month={month} onMonthChange={setMonth} />
        </div>
      </section>
    </div>
  );
}
