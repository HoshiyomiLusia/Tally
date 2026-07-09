# Tally 代码逻辑错误整改清单

由全项目只读审计得出,按严重度排序;修完打勾并注日期。已修的历史 bug(账单空白、删投资不刷新、周期账单换卡配对、信用卡待还统一、全局 invalidateMoney)不在此列。

> 新增共用 `services/internal_cats.py`(NULL 安全的 `not_internal` 过滤 + `internal_cat_ids`),统计/首页/预算统一走它。

## P0 — 静默算错钱/统计,优先

- [x] **1** ✅ 统计页把"未分类"交易整条丢掉(`stats.py` `NULL NOT IN`)→ 改用 `not_internal`(显式放行 NULL)。已验证:计入笔数不变(本用户无未分类),对 NULL 逻辑正确。
- [x] **2** ✅ 删"期初持仓"漏删对账收入 → 迁移 0008 加 `opening_for_position_id` 列 + 回填(实测把 ¥500,000 幽灵收入挂到 BTC 持仓,删持仓时一并删,且因不用 position_id 故不进盈亏)。
- [x] **3** ✅ 改/刷汇率后首页总额不刷新 → key 统一为 `["exchange-rates"]`,三个汇率 mutation 调 `invalidateMoney` + 失效 `["exchange-rates"]`。
- [x] **4** ✅ 首页月度收支/分类把 `对账调整` 当真实收支 → `dashboard.py` 收支与分类明细都加 `not_internal`。已验证剔除 ¥46,246,387 的对账调整收入。
- [x] **5** ✅ 备份/恢复丢数据 → export/import 补 position_id/attributed_wallet_id/opening_for_position_id + Position 表;import/reset 清 Attachment/Position;版本升 0.3(兼容 0.2)。实测导出含 4 持仓 + 各字段。

## P1

- [x] **6** ✅ 统计趋势/榜单不排除内部分类 → `monthly_trend`/`category_trend`/`top` 均加 `not_internal`(top_merchants 因 merchant_id 非空天然排除)。
- [x] **7** ✅ 借贷单账户余额颜色反了 → `Loans.tsx` 负数(应收)=绿、正数(应付)=红,与汇总卡/首页一致。
- [x] **8** ✅ 坏账核销两笔未关联 → `loans.py` 两笔加同一 `split_group_id`,删任一级联删掉另一笔。
- [x] **9** ✅ 删"清仓卖出"后持仓卡在"已清仓" → `transactions.py` 删除后按剩余成本重算 Position status。已验证(剩余>0→open)。
- [x] **10** ✅ 账单铅笔能编辑转账/借贷腿 → 铅笔改为只对 expense/income 显示(特殊类型在各自流程改)。后端 update_transaction 拒改配对腿仍待补(见备注)。
- [ ] **11** 缺汇率时整种货币折算成 0 且无提示

## P2

- [ ] **12** (决策·暂保持现状)投资盈亏/坏账是否算进消费/收入(`INTERNAL_CATEGORY_NAMES` 是否纳入)—— 待你拍板
- [x] **13** ✅ 总预算包含内部分类 → `budgets.py` 加 `not_internal`。
- [x] **14** ✅ 周期账单组名运算符优先级 bug → `recurring.py` 改 `latest.note or (cat.name if cat else None)`。
- [ ] **15** stats `month` 参数只在长度==7 时生效 —— 低优先(前端不会传非规范月串),暂留
- [x] **16** ✅ import 用 `wallet_map.get` + 缺钱包跳过(随 #5 一起修)。
- [x] **17** ✅ unsplit 校验:含 invest_* / position_id 的组拒绝撤销。
- [x] **18** ✅ 通用 `POST /transactions` 只收 expense/income,其余走专门流程。
- [ ] **19** 对账弹窗算式漏投资项 —— 需给 `ReconciliationView` 加投资字段 + 前端,中等,暂留
- [ ] **20** fx 汇率日期用今天而非报价日 —— 影响很小,暂留
- [ ] **21** (不确定·可能有意)净值排除归档钱包但丢其名下应收/持仓 —— 待确认
- [ ] **22** (不确定·换卡配对的取舍)周期账单配对键可能撞 —— 待确认
