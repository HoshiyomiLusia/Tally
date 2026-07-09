import type { Wallet } from "./api";

// 物理余额: 系统余额扣掉"借出 / 投资"占用的钱 (= 手上实际能动的). 信用卡为负, 绝对值即待还.
export function walletPhysical(w: Wallet): number {
  return w.balance - w.loan_out_on_wallet + w.loan_repayment_on_wallet - w.invest_out_on_wallet + w.invest_in_on_wallet;
}

// 信用卡待还 = 实际刷卡额 − 已还 (含给别人垫付的分摊) = −物理余额 (下限 0).
// 注意: balance 只记了"你那份"支出, 给别人垫付的分摊在 loan_out_on_wallet 里 ——
// 但你欠信用卡公司的是全额, 所以必须走物理余额, 不能直接 -balance.
export function creditDebt(w: Wallet): number {
  return Math.max(0, -walletPhysical(w));
}
