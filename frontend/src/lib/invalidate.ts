import type { QueryClient } from "@tanstack/react-query";

// 所有依赖"余额 / 净值 / 统计"的查询 key. 任何动了钱的写操作 (建/改/删交易、转账、
// 报销、信用卡还款、借贷、投资买卖、对账、改钱包余额) 成功后都应调 invalidateMoney,
// 一次性把它们全部失效 —— 避免某个页面 (尤其首页"真实余额" cross-currency-total)
// 数字不同步. 参考资料类 (categories / merchants / currencies / rates) 不在此列.
const MONEY_KEYS = [
  "transactions",
  "wallets",
  "dashboard",
  "cross-currency-total",
  "loan-accounts",
  "loan-history",
  "positions",
  "invest-events",
  "frequent",
  "recurring-upcoming",
  "recurring-by-month",
  "stats-summary",
  "stats-daily",
  "stats-compare",
  "stats-lifetime",
  "stats-top-merchants",
  "reconciliation",
];

export function invalidateMoney(qc: QueryClient) {
  for (const key of MONEY_KEYS) qc.invalidateQueries({ queryKey: [key] });
}
