# Tally 代码逻辑错误整改清单

由全项目只读审计得出,按严重度排序;修完打勾并注日期。已修的历史 bug(账单空白、删投资不刷新、周期账单换卡配对、信用卡待还统一、全局 invalidateMoney)不在此列。

> 新增共用 `services/internal_cats.py`(NULL 安全的 `not_internal` 过滤 + `internal_cat_ids`),统计/首页/预算统一走它。

## P0 — 静默算错钱/统计,优先

- [x] **1** ✅ 统计页把"未分类"交易整条丢掉(`stats.py` `NULL NOT IN`)→ 改用 `not_internal`(显式放行 NULL)。已验证:计入笔数不变(本用户无未分类),对 NULL 逻辑正确。
- [x] **2** ✅ 删"期初持仓"漏删对账收入 → 迁移 0008 加 `opening_for_position_id` 列 + 回填(实测把 ¥500,000 幽灵收入挂到 BTC 持仓,删持仓时一并删,且因不用 position_id 故不进盈亏)。**从账单删单笔期初买入**也连带删掉与它 1:1 配套的期初收入(select limit(1),同额同日同持仓的多笔各删一条,不会一次删光);dry-run 验证 2→1。残留极窄边角:同持仓下"非期初"追加买入与某期初买入指纹(钱包+金额+币种+日期)完全相同且删的是前者时可能误删,概率极低,暂记不迁移。
- [x] **3** ✅ 改/刷汇率后首页总额不刷新 → key 统一为 `["exchange-rates"]`,三个汇率 mutation 调 `invalidateMoney` + 失效 `["exchange-rates"]`。
- [x] **4** ✅ 首页月度收支/分类把 `对账调整` 当真实收支 → `dashboard.py` 收支与分类明细都加 `not_internal`。已验证剔除 ¥46,246,387 的对账调整收入。
- [x] **5** ✅ 备份/恢复丢数据 → export/import 补 position_id/attributed_wallet_id/opening_for_position_id + Position 表 + **Attachment 元信息**(此前只删不建会毁收据,现已导出+按新交易 id 重建;文件仍在 receipts/,跨机需另拷该目录);reset 清 Position/Attachment;版本 0.3(兼容 0.2)。

## P1

- [x] **6** ✅ 统计趋势/榜单不排除内部分类 → `monthly_trend`/`category_trend`/`top` 均加 `not_internal`(top_merchants 因 merchant_id 非空天然排除)。
- [x] **7** ✅ 借贷单账户余额颜色反了 → `Loans.tsx` 负数(应收)=绿、正数(应付)=红,与汇总卡/首页一致。
- [x] **8** ✅ 坏账核销两笔未关联 → `loans.py` 两笔加同一 `split_group_id`,删任一级联删掉另一笔。
- [x] **9** ✅ 删"清仓卖出"后持仓卡在"已清仓" → `transactions.py` 删除后按剩余成本重算 Position status。已验证(剩余>0→open)。
- [x] **10** ✅ 账单铅笔能编辑转账/借贷腿 → 前端铅笔只对 expense/income 显示;**后端 update_transaction 已加守卫**:非 expense/income 交易不许改 amount/wallet_id(防绕过 UI 直接 PATCH 破坏配对)。dry-run 验证。
- [x] **11** ✅ 缺汇率时整种货币折算成 0 且无提示 → cross_currency_total 新增 `missing_rate_currencies` + breakdown 每项 `has_rate`;首页顶部黄条提示"缺 X 汇率未计入",明细行显示"缺汇率"而非 ×0.0000。缺汇率判定看 **net/物理/待还/投资 四口径任一非零**(而非只看 net),堵住"净额=0 但物理/待还非零被静默吞掉且不告警"的漏洞;dry-run 验证 net=0/spend=1000 的 ZZZ 被正确标记。

## P2

- [ ] **12** (决策·暂保持现状)投资盈亏/坏账是否算进消费/收入(`INTERNAL_CATEGORY_NAMES` 是否纳入)—— 待你拍板
- [x] **13** ✅ 总预算包含内部分类 → `budgets.py` 加 `not_internal`。
- [x] **14** ✅ 周期账单组名运算符优先级 bug → `recurring.py` 改 `latest.note or (cat.name if cat else None)`。
- [ ] **15** stats `month` 参数只在长度==7 时生效 —— 低优先(前端不会传非规范月串),暂留
- [x] **16** ✅ import 用 `wallet_map.get` + 缺钱包跳过(随 #5 一起修)。
- [x] **17** ✅ unsplit 校验:含 invest_* / **loan_repayment(坏账核销)** / position_id 的组都拒绝撤销(dry-run 验证)。
- [x] **18** ✅ 通用 `POST /transactions` 只收 expense/income,其余走专门流程。
- [ ] **19** 对账弹窗算式漏投资项 —— 需给 `ReconciliationView` 加投资字段 + 前端,中等,暂留
- [ ] **20** fx 汇率日期用今天而非报价日 —— 影响很小,暂留
- [ ] **21** (不确定·可能有意)净值排除归档钱包但丢其名下应收/持仓 —— 待确认
- [ ] **22** (不确定·换卡配对的取舍)周期账单配对键可能撞 —— 待确认

---

# 第二轮审计(2026-07-16 · /loop)

10 领域并行审计 + 逐条对抗性复核得出,已去重(多领域独立命中同一 bug = 交叉印证,置信更高,方括号标注命中来源数)。**均为清单未收录的新问题,尚未修**。识别键脆弱(按名字查系统分类)与 SQLite 外键未开启是两条系统性根因,牵连多项。

## P0(新)— 静默算错钱/丢数据/越权

- [x] **23** ✅[全修 07-17:代码守卫 + tx151 数据已订正为 ¥698.00 CNY/微信钱包,全库无剩余币种钱包不一致行] **编辑交易换钱包跨币种脱钩(线上已有脏数据)** — `transactions.py:340` 换钱包只校验归属不校验币种(create 有校验,PATCH 没有),且 `TransactionUpdate` 无 `currency_code` 字段、前端照发被 Pydantic `extra=ignore` 静默吞掉。→ 交易币种与钱包币种脱钩,`balances.py` 按 wallet_id 聚合、`stats/dashboard` 按 currency_code 分组,同一笔进两个币种,金额还按 10^Δdigits 漂移。**实测线上 `data/tally.db` 已有 tx151:698 CNY 挂在 JPY 三菱UFJ銀行**。改守卫也清不掉这行,需手工修数据。[账务+交易 2 命中]
- [x] **24** ✅[已修 07-17] **内部分类靠「名字」识别 + fail-open(#4 可被一次改名撤销)** — `internal_cats.py:16` 按 `name in ('对账调整',)` 反查 id;分类 API 改名/删除零守卫(`categories.py:52/68`),查不到时 `not_internal([])` 走 `true()` = 零过滤。→ 改名即让 ~¥46M 幽灵收入 + ~¥17M 幽灵支出回流 dashboard/stats/budgets/lifetime,全程无报错。更糟:写入端 `_pnl_cat`/reconcile 也按名查,改名窗口内新分录 `category_id=NULL` 落库,**改回名也救不回(不可逆)**;FK 未开→删分类后 category_id 悬空。影响 4 个用户。[账务+周期+安全 3 命中]
- [x] **25** ✅[已修 07-17] **删钱包漏查 attributed_wallet_id** — `wallets.py:148` 占用检查只看 `wallet_id`,漏 `attributed_wallet_id`。→ 删掉某笔借贷调整的「名义归属」钱包后,该金额从所有视图静默蒸发(净值虚变)。[账务+交易+安全 3 命中]
- [x] **26** ✅[已修 07-17: 按你定, 保持全局共享(家用汇率本就一致)+ 加正数/上界/base≠quote 校验挡污染] **exchange_rates 全局表无 user_id + 零校验(多租户越权)** — `exchange_rates.py:25` 汇率表无 user 归属、rate/on_date 无校验。→ 任一注册用户写一条即永久污染**所有人**的净值折算;负汇率翻符号(见 #42)、倒数抢槽(见 #41)。[安全 单命中,但根因牵连 #41/#42/#33]
- [x] **27** ✅[已修 07-17] **删联系人 → 借贷账户整条消失** — `loans.py:67` 删 Contact 后其名下 loan_out/repayment 失去归属,借贷页整账户消失,应收余额静默蒸发且无法再记还款。[投资借贷 单命中,前端侧见 #46]
- [x] **28** ✅[已修 07-17] **期初收入靠可变指纹配对,编辑即打断(#2 残留边角的放大版)** — `investments.py:247` 改持仓开仓日只挪 `invest_buy`、不挪配套期初对账收入;编辑该收入的钱包/金额/日期同理。→ 指纹(钱包+金额+币种+日期)一断,日后从账单删该买入就漏删,留下永久幽灵收入。[交易+投资 2 命中]
- [ ] **29** ⏸️[暂缓·07-17: 正确修需"分摊感知的确认流"(确认弹窗按原参与人重建 loan_out 腿),会动到共用的 TransactionForm 加单核心路径,风险大,留作单独专项]🔴 **周期账单「确认扣款」对分摊账单丢 loan_out 应收腿** — `recurring.py:83` 确认时只按 my_share 建支出,原分摊的参与人 loan_out 应收腿没了。→ 每次确认 AA 周期账单,应收凭空缩水。[周期 单命中]
- [x] **30** ✅[已修 07-17] **import 分类父子解析:父级解析不出就静默丢分类** — `io.py:190` 导入时父分类没先建好则跳过该分类,连带引用它的交易被打成「未分类」。→ 备份还原后分类树 + 交易归类残缺无告警。[备份 单命中]

## P1(新)— 真 bug,触发面较窄或后果可自愈

- [x] **31** ✅[07-17] 备份导出漏 `wallets.credit_limit` → 还原后所有信用卡额度清空,「按可用额度」对账全废(`io.py:46`)。[账务+备份 2 命中]
- [x] **32** ✅[07-17] 备份导出漏 `merchants.aliases` → 商家别名(线上 1026 条)还原后全清空(`io.py:48`)。
- [x] **33** ✅[07-17] 备份导出**不含 exchange_rates** → 手动录入的汇率还原后永久丢失(`io.py:15`,同 #26 根)。
- [x] **34** ✅[07-17] 备份导出 user 漏 `primary_currency_code` → 跨机还原后折算基准静默变回 JPY(`io.py:45`)。
- [x] **35** ✅[07-17] CSV/XLSX 导出直接吐最小单位原始整数,未按币种 `decimal_digits` 缩放 → 金额放大 10^digits 倍(`io.py:99`)。
- [ ] **36** **SQLite 外键从未开启**(`db.py` 无 `PRAGMA foreign_keys` 监听)+ 删交易不清 Attachment + rowid 复用 → 已删交易的小票挂到新交易上(`transactions.py:401`)。[交易+备份 2 命中]
- [ ] **37** `delete_category` 无级联无守卫,叠加 FK 关闭 → 子分类被孤立,UI 承诺的「级联删」是假的(`categories.py:68`,同 #36 根)。
- [x] **38** ✅[07-17] `_pnl_cat` 找不到分类静默返回 None → 期初注入/盈亏分录写成「未分类」直接进收入统计(`investments.py:123`,同 #24 根)。
- [x] **39** ✅[07-17] 坏账核销不校验未收余额上限 → 超额核销静默压低净资产 + 造出不存在的「应付」(`loans.py:206`)。
- [x] **40** ✅[07-17] 从账单删单笔 `invest_buy` 无守卫 → 持仓剩余成本可做成负数,首页「投资中」变负(`transactions.py:401`)。
- [x] **41** ✅[07-17] 倒数汇率抢占字典槽位 → 手动录入的正向汇率被静默忽略,前后端用两个不同汇率(`stats.py:517`,同 #26 根)。
- [x] **42** ✅[已修 07-17, 随 #26 一起] 汇率无正数校验 → 负汇率静默翻转折算符号且不报警(`exchange_rate.py:10`,同 #26 根)。
- [x] **43** ✅[07-17] 信用卡待还:后端不夹 0(预存卡可负、冲抵总额)、前端每卡 `max(0,·)` → 首页同一张卡并排显示两个不同「待还」(`stats.py:503` + `Overview.tsx:184`)。[账务+前端 2 命中]
- [ ] **44** Top 商家跨币种按「最小单位整数」排序 + 截断,前端再筛币种 → 拿到残缺榜(`Stats.tsx:234`)。
- [ ] **45** Stats「全部」/ 总分析「汇总」/ 账单每日「≈JPY」缺汇率时静默按 0 折算无提示(**#11 只修了首页**)(`Stats.tsx:111`)。
- [x] **46** ✅[07-17] Contacts 页删联系人未失效 `["loan-accounts"]` → 首页「借贷·应收」残留已删债权(`Contacts.tsx:25`,#27 的前端侧)。
- [x] **47** ✅[07-17] query key `["wallets"]`/`["contacts"]` 被「含/不含归档」两个 URL 共用 → 谁先挂载谁的数据赢,30s 内互相污染、合计漏算归档(`Wallets.tsx:48`、`Transactions.tsx:112`)。
- [x] **48** ✅[07-17] `reconciliation`/`investments`/`write-off` 三处按分类名 `scalar_one_or_none()` 查系统分类 → 用户建一个重名分类就让对账/投资/坏账核销全部 500(`reconciliation.py:64`,同 #24 根)。
- [x] **49** ✅[07-17] 交易 `category_id`/`merchant_id` 不校验归属 + 统计 join 不带 user 过滤 → 可枚举出别的用户的分类名/商家名(IDOR 读)(`transactions.py:143`)。
- [x] **50** ✅[07-17] 附件上传先 `read()` 整个文件进内存再判大小 → 8MB 上限形同虚设,一次大上传即可 OOM 掉整台树莓派(`attachments.py:47`)。

## P2(新)— 边角 / 一致性 / 优化

- [ ] **51** 删持仓唯一一笔买入后剩余=0 被判「已清仓」,既不能追加也无法复原(`transactions.py:415`,#9 的边角)。
- [x] **52** ✅[07-17] Wallets 页币种汇总含归档钱包,首页/后端都不含 → 同一「真实/物理」两页对不上(`Wallets.tsx:90`,同 #47 根)。
- [x] **53** ✅[07-17] 信用卡还款切到「待还=0」的卡时不重置金额,沿用上一张卡的金额(可能还是另一币种)(`CreditRepayForm.tsx:61`)。
- [ ] **54** 借贷「明细」弹窗净额颜色与 #7 定的约定相反(列表绿、弹窗红)(`Loans.tsx:555`)。
- [x] **55** ✅[07-17] 支出节奏图 `new Date("YYYY-MM-DD")` 按 UTC 解析再取本地日期 → 负时区每日桶整体前移一天(`Stats.tsx:207`)。
- [x] **56** ✅[07-17] TransactionForm 按「陈旧缓存里的商家名」判断是否新建 → 抢跑窗口内重复创建同名商家(`TransactionForm.tsx:309`)。
- [x] **57** ✅[07-17] GET `/exchange-rates` 返回全量历史(线上 3024 行 / 307KB,98% 前端丢弃,每年 +2MB),首页每次全拉(`exchange_rates.py:20`)。
- [ ] **58** **性能优化组**(均非错但值得做):① 缺 `(user_id, occurred_on)` 复合索引,按月统计退化成全用户全表扫(实测 36×)`transaction.py:30`;② 账单搜索框无防抖,每敲一键发 2 请求且各触发 LIKE 全表扫 `Transactions.tsx:207`;③ `cross-currency-total` 每次读整张汇率表拼 dict `stats.py:507`;④ `fx.refresh_rates` 循环内逐条 SELECT(~240 次串行,卡在启动流程)`fx.py:54`;⑤ `budgets/progress` N+1,每预算一次全表聚合 `budgets.py:111`;⑥ `Stats.tsx` `fxTo` 未 memo 化,废掉 4 个 useMemo `Stats.tsx:104`;⑦ RecurringPanel 发 3 次 by-month、2 次扫同年,拉整年只用一月 `RecurringPanel.tsx:117`。

---

# 第三轮审计(2026-07-16 · /loop · 深度算法/精度角度)

代码自第二轮以来未变,故换 6 个错误类型视角(精度取整 / 日期时区 / 多步原子性 / 迁移一致性 / 前后端契约 / 核心算法)复查。复核员双否决(不成立 / 已在 #1-#58),仅 6 条通过、0 条与旧项重复、1 条判不成立。**清单趋于收敛。**

## P0(新)

- [x] **59** ✅[已修 07-17] **删「期初对账收入」那条腿不连带删买入 —— #2 守卫只做了单向** — `transactions.py:388` 的连带删只处理 `kind=="invest_buy"`(删买入→删配套收入),**反向没做**:从账单删掉那笔 `income`(期初持仓·额外资产,`opening_for_position_id` 非空、`position_id`=NULL)时,买入腿仍在。→ 收入的 +本金抵消没了、买入的 -本金还在,净值与物理余额**各静默少算一整笔本金**。修法:删除时若是 opening 收入腿,同样连带删/或禁止单独删。(症状与 #28 相反:#28 留幽灵收入虚高,本条留裸买入虚低。)

## P1(新)

- [x] **60** ✅[07-17] 编辑交易切换 **支出↔收入被静默丢弃** — `TransactionUpdate`(`schemas/transaction.py:29`)没有 `kind` 字段,前端编辑表单若发 `kind`,被 Pydantic `extra=ignore` 吞掉(与 **#23** 同根:currency_code 同样被吞)。→ 用户把一笔支出改成收入、保存后仍是支出,无报错。应在 schema 显式接收并走校验,或前端禁用该切换。
- [x] **61** ✅[07-17] **账号重置非原子** — `account.py:37` `reset_my_data` 分三步跨两次已提交事务:先 `commit` 清空 8 张表 → `shutil.rmtree` 删 receipts(文件系统不可回滚)→ 再调 `seed_user_defaults`(内部又一次独立 `commit`)。中途断电/OOM/seed 抛错 → 账号停在空状态,连系统分类(对账调整/坏账损失/投资收益/投资亏损)一起没了,此后对账/卖出因按名查不到而落 `category_id=NULL`(接 #24/#38)。对比 `io.py` import 是单事务、异常整体回滚 —— reset 应同样单事务。

## P2(新)

- [x] **62** ✅[07-17] cross-currency 折算用 `int()` 截断而非四舍五入 → 与后端 `fx_preview`(`transactions.py:264` 用 `int(round(...))`)及**全部前端折算**(Overview/Stats/AllTime/Transactions/RecurringPanel 均 `Math.round`)不一致 → 首页 total/physical/credit/invested 四总额恒向零偏小(每外币每口径 ≤1 个 base 最小单位,不落库、有界)。修:`stats.py:524` 改 `int(round(...))` 对齐全站。
- [ ] **63** 同用户**并发 read-check-write 跨 await 无锁**(TOCTOU) — `reconciliation.py:66` 先连续 await 读 expected、到末尾才建 diff 调整并 commit:两个并发对账各读到同一 expected → 各建一笔 diff,钱包定格在 `actual+diff`;`investments.py:180` sell 先读 remaining 再 `cost<=remaining` 检查、之后才写 → 两笔并发卖出都过检、剩余成本变负 + 物理多入账。aiosqlite 无行锁、每个 await 都是切换点,窗口真实;单用户 Pi 并发少见故 P2。(与 #40 删 invest_buy 变负是**不同触发路径**:TOCTOU 而非删除无守卫。)
- [x] **64** ✅[07-17] env.py 启动跑迁移时 `fileConfig(disable_existing_loggers=True)` 关掉全部既有 logger — `alembic/env.py:14` 用默认参数,而 `_run_migrations()` 在 lifespan 里触发它,`alembic.ini` 的 logger 名单只含 root/sqlalchemy/alembic → uvicorn/uvicorn.access/tally 全被 `.disabled=True` 且无人复启(**实测该容器 6 天 0 条访问日志**)。修:`fileConfig(..., disable_existing_loggers=False)`。运维可观测性问题,非钱账。

---

# 第四轮审计(2026-07-16 · /loop · 错误处理/输入校验/配置部署)

代码仍未变,换 3 个此前未做的横切角度(错误处理与异常吞没 / 输入校验与边界 / 配置部署与死代码),自证式精简巡检。挖出一条**安全 P0**(附件路径穿越)+ 与之叠加的默认密钥 P1。

## P0(新)

- [x] **65** ✅🔐 **附件 `stored_name` 路径穿越 → 任意文件读/删(已修)** — 曾:import 把备份 JSON 的 `stored_name` 原样落库(`io.py`),下载/删除 `udir / att.stored_name` 不做 `../` 限定、归属校验只看行 user_id 不看解析路径 → 任一注册用户 import `stored_name:"../../tally.db"`/`"../../../.env"` 即可读走全体共享库/密钥或删库。**已修(2026-07-16)**:import 落库前 `Path(x).name` 去目录;下载走新 `_safe_stored_name`、删除走 basename,均限定在 `udir` 内。dry-run 验证:`stored_name="../../tally.db"` 的下载从「服务 DB」变为 **HTTP 404**;`../`、`/etc/passwd`、`....//` 一律归一到 udir 内纯文件名,`..`/空名 404。

## P1(新)

- [x] **66** ✅🔐 **JWT 默认密钥 `change-me` + fail-closed(已修)** — 曾:`config.py:8` 默认 `secret_key="change-me"`、`docker-compose.yml:14` `${SECRET_KEY:-change-me}`、无拒启守卫 → 未设 `SECRET_KEY` 时公开仓库众所周知的默认密钥可伪造任意用户令牌。**已修(2026-07-16)**:`main.py` lifespan 启动时若 `secret_key=="change-me"` 直接 `raise` 拒启并提示生成随机密钥。实测本机(已设 64 位随机密钥,走 gitignored `.env`)照常启动、不受影响;仅挡住裸默认部署。注:`allow_registration=True` 仍默认开放(未在本次范围,留观察)。
- [ ] **67** 新建账单保存多步非原子 → 重复计钱 — `TransactionForm.tsx:357` 的 save mutationFn 串了 建商家→建交易(`POST /transactions` 后端即时 commit 落库)→ 逐个传附件,三步无补偿;`onError`(:377)只 `setError`,**不 invalidateMoney、不 onClose、不撤销已建交易**。→ 交易已落库但附件上传失败(超 8MB / 截断图触发 #68 的 500 / 网络抖动)时,表单原样留着、首页不刷新,用户看不到交易已进库 → 再点保存 → **第二笔重复交易**,当月支出算两遍。修:交易与附件同事务,或失败时刷新+提示"交易已建、附件失败"。

## P2(新)

- [x] **68** ✅[07-17] 附件缩略图 `except` 只兜 `UnidentifiedImageError`(`attachments.py:64`)— 截断图(`OSError: image file is truncated`)/超大图(`DecompressionBombError`)在 `thumbnail()` 的惰性 `.load()` 抛出、逃逸 → 整个上传 500,而原图 `:55` 已写盘、Attachment 行 `:67` 未建 → **孤儿文件**。缩略图本可选,应 `except Exception` 吞掉、保住原图与入库。
- [x] **69** ✅[07-17] 多个直接写钱/附件的前端 mutation 无 `onError` → 失败静默 — `Transactions.tsx` 的 `quickAdd(:137)`/`del(:170)`/`unsplit(:176)`、`TransactionForm.tsx` 的 `upload(:818)`/`del(:829)` 只有 onSuccess;react-query 把 rejection 内部吞掉、调用点也不渲染 isError。→ quickAdd 失败无任何提示且不刷新(用户以为记上了,实则少记;或以为没成功再点→重复记)。对照 ReconcileModal/save/Wallets 都有 onError,属遗漏。
- [x] **70** ✅[07-17] Update schema 丢弃 Create 的约束 + 路由盲 `setattr` — `BudgetUpdate.amount`(`budget.py:17`)无 `gt=0`(Create 有)→ PATCH 负预算使 `budget_progress` 的 percent/remaining 全成垃圾值不报错;`Category/Merchant/Contact/Wallet Update.name` 均无 `max_length`(Create 限 64/64/64/128)→ 可写超长名。系统性"建档校验、改档放行"(`categories.py:52`/`merchants.py:85`/`contacts.py:48`/`wallets.py:75` 均盲 setattr)。与 #23/#60(transaction 缺字段被吞)不同根:此为"字段在但约束缺失"。
- [x] **71** ✅[07-17] 金额整型无上限 `le` — `TransactionCreate.amount`(`transaction.py:18`)等仅 `gt=0`,无上界 → 单笔 ≥2⁶³ insert 触发 SQLite INTEGER 越界 500;巨额多笔累加使 `SUM` 溢出、stats/balances 500。加固:合理 `le`。
- [ ] **72** 构建不可复现 — 前端依赖全 `^` 浮动、仓库无 lockfile、`Dockerfile:4` 用 `npm install`(非 `npm ci`)→ 每次 `--build` 拉到的次版本可能不同,某天上游发版即可能构建出不一致产物。修:提交 lockfile + 改 `npm ci`。
- [x] **73** ✅[07-17] `.env.example` 的 `DATABASE_URL` 缺 `+aiosqlite` 驱动(`.env.example:1`)→ 照抄到裸机/开发直跑,`create_async_engine` 处启动即崩(需 async 驱动)。修:示例写全 `sqlite+aiosqlite:///./data/tally.db`。
- [ ] **74** **项目无任何自动化测试** — 全仓无 `test_*.py`/`*.test.ts`/pytest/vitest 配置。这么多涉及钱的分支(配对/折算/删除级联/对账)全靠手测与本清单,回归风险高。建议至少给"账务不变量"(净值=物理±借贷投资、删配对腿、折算口径)补一批后端 pytest。

---

# 第五轮审计(2026-07-16 · /loop · 深度业务逻辑数学)

代码仅含 #65/#66 安全修复的改动。3 个深度逻辑角度(周期账单/预测数学、投资成本basis、预算周期)精简巡检,**投资与预算两路核对无新问题(公式正确/已覆盖),仅周期账单 1 条**。审计已强收敛。

- [x] **75** ✅[07-17] 周期账单 `next_due` 用「上次 `occurred_on` + `period_days`」且月度=30 天(非按自然月)— `recurring.py:81`(及 `:144`)`next_due = occurred_on + timedelta(days=period_days)`,UI 月度 chip 硬编码 30(`TransactionForm.tsx:619`,库里 distinct periods={30,365})。→ 每逢 31 天月,下一期预测日相对日历系统性前漂;而「确认扣款」把漂移预测日直接预填成新交易 `occurred_on`(`Overview.tsx:347` `occurred_on: it.due`),一键确认(该按钮主用途)即落库。下游 by-month(`recurring.py:254`)与首页月度收支(`dashboard.py:83`)都按 `occurred_on` 归自然月 → 真实月账单被错分到相邻自然月:某自然月漏记(合计偏低)、某自然月重复(翻倍)。已脚本复现:period=30、首笔 2026-01-31 一键确认序列 → 2026-02 记 ¥0、2026-05 记 ¥2000(应各 ¥1000)。**当前潜伏**:真实用户手填真实扣款日、未漂,但一键确认路径必然触发;全跨度净额守恒(错分非幻影)。修:按自然月/年推进 `next_due`(月+1 归一),或确认扣款不拿漂移预测日做默认日期。

---

# 回归审查(2026-07-17 · 对「全修」批次的对抗性复查)

7 个审查员对刚提交的 ~40 项修复做回归审查, 抓出 5 处修复自身的问题, **均已修复并 dry-run 验证**:

- [x] **R-P0** ✅ import 的汇率还原 `delete(ExchangeRate)` 整表清空 → 全局共享表(无 user_id)被一个用户还原备份就抹掉所有人的手录+自动汇率。改为**按 (on_date,base,quote) upsert 合并, 绝不整表删**(`io.py`)。
- [x] **R-P1a** ✅ #59 反向连带删买入未套 #40 负成本守卫(两修互斥)→ 删期初收入可绕过把"投资中"做成负数。已在 #59 路径加同款守卫(dry-run: 买入已全卖出时删期初收入 → 400)。
- [x] **R-P1b** ✅ `update_category` 改名守卫单向 → 可把普通分类**改成**系统保留名, 重造重名 → `write_off` 的 `scalar_one_or_none` 500。已双向禁止改入系统名 + `write_off` 查找改 `first`(dry-run 验证)。
- [x] **R-P2a** ✅ #28/#59 指纹脆弱: 期初对账收入可经通用 PATCH 改日期/金额/钱包使指纹错位 → 加守卫禁止在此改这些字段(dry-run 验证)。
- [x] **R-P2b** ✅ 前端: Contacts 删除补 `onError`(否则 #27 的 409 静默)+ 修正误导性 confirm 文案; TransactionForm #56 的商家核对 GET 失败改为退回缓存, 不阻断整笔保存(回归修正)。

(未修 P2: XLSX 辅助 sheet 的钱列未按小数位缩放 —— 纯展示不一致, 留清单。)

---

# 用户实测发现(2026-07-17)

- [x] **76** ✅ **确认扣款弹窗把钱包错设成默认三菱UFJ(而非源账单的钱包)** — `TransactionForm.tsx` 的"默认钱包" effect(154-160)与 prefill effect(85)在同一渲染里竞态:prefill 先 `setWalletId(农行)`,但后定义的默认 effect 读到旧的 `null` 闭包又 `setWalletId(三菱UFJ)`,末次写入胜出 → 从历史周期账单(农行/CNY)确认扣款时,弹窗错误选中三菱UFJ/JPY。**#23 挡不住**:币种跟随被错选的钱包(→JPY),create_transaction 的 `currency==wallet` 校验反而通过,会静默把 ¥25 CNY 农行订阅记成 ¥25 JPY 三菱UFJ。修:默认钱包 effect 加 `if (editing || prefill) return;`,编辑/确认自带钱包不被覆盖。前端构建通过。

---

# 第七轮审计(2026-07-17 · 前端状态竞态 / 币种小数位)

由 #76(用户实测)引出的盲区专审:前端 effect 竞态、prefill 被默认值覆盖、以及 **`decimal_digits ?? 2` 在 currencies 未加载时对 0 位币种(JPY/KRW)造成 100 倍缩放**这一系统性根因。

- [x] **77** ✅ **P1: 新建交易金额在 currencies 未就绪时按 2 位兜底 → JPY/KRW 静默 100 倍落库** — `TransactionForm.tsx:150` `decimal_digits ?? 2`,而 save 路径(不同于 editing/prefill 在 :92 有 currencies 门闩)无守卫。currencies GET 失败(retry 用尽→本会话恒 undefined)或首屏竞态时,JPY 输 698 → 存 69800(¥69,800)。修:save 前若该钱包币种的 `decimal_digits` 未加载出来,直接拒绝保存(fail-closed)。构建通过。
- [x] **78** ✅ **P2: 首页「折算到」下拉选择不 stick** — `Overview.tsx:39` 的 `primary_currency_code` effect 每次刷新无条件覆盖 localStorage 持久化的手选币种(#76 同类:持久值被后写默认 effect 顶掉)。修:用 ref 记挂载时是否已有手选值,只在从没手选过时才用账户默认币种。
- [x] **79** ✅ **P2: 借贷收款/坏账核销/信用卡还款弹窗预填额用陈旧 digits** — `Loans.tsx:365`/`:457`、`CreditRepayForm.tsx:67` 的预填 effect 只依赖 `[acct]`/`[cardId]`,currencies 冷缓存时 digits 兜底 2 → JPY 预填缩小 100 倍且可被直接提交(落库)。修:effect 依赖加 `digits`,currencies 到货后按正确小数位重算。
- [x] **80** ✅ **P2: `myShareText` 是唯一未被 init 重置的字段** — 跨「关闭→重开」残留上一笔的"我的分摊额",抑制自动均摊。修:init effect 补 `setMyShareText("")`。
- [ ] **81** **P2: Stats `fxTo` 的 `digits ?? 2` 在 currencies 缺失时对 JPY 折算差 100 倍** — 同 #77 根,但纯展示、currencies 到货即自愈,不落库。暂留(低优先)。

---

# 分摊流程复查(2026-07-17 · 纯代付上线后)

2 审查员对新加的"纯代付" + 整个分摊流程 + #77-81 delta 做对抗性复查:**纯代付核心无 P0/P1**(数学/状态压制/后端配平三层一致)。3 个 P2 边角:

- [~] **82** ⏸️[07-17 已回退] **纯代付(my_share=0)+ 标记周期账单** — 原想把周期挂到第一条 loan_out 腿让它可见,但复查发现这引入 P1 回归:那条 loan_out 是"部分份额",`/recurring/upcoming` 不过滤 kind 会把它当待确认条目,确认扣款时 `Overview` 把 loan_out 塌缩成一笔**金额错误的个人支出**,比"周期被丢弃"更糟。已**回退**:纯代付暂不支持周期(整个"分摊感知的周期确认流"归 #29 专项)。
- [x] **83** ✅ **均摊后再加参与人 → 新人份额=0 却显示「✓合计正好」,保存后不产生应收** — 自动均摊被非空 myShareText 压制,新人 share=0,shareDiff 仍=0,后端 `continue` 跳过他。修:前端 save 前挡住"任一参与人份额≤0",提示先重新均摊或移除。
- [ ] **84** **P2(#79 引入的窄回归·可接受)** — 给 RepaymentModal/WriteOffModal/CreditRepayForm 的预填 effect 加 `digits` 依赖后,JPY/KRW 在 currencies 冷缓存迟到时会二次触发 effect、清掉用户在 <1s 窗口内的编辑(重置值正确、不 misrecord)。用一个"金额小数位窄体验回归"换掉了原来的"预填缩小 100 倍可提交"的钱错,净收益为正,暂留。

---

# 第八轮(2026-07-17 · 未审交互流程:转账/投资/金额)

`decimal_digits ?? 2` 这条系统性根因比 #77 修的范围更广 —— 转账/投资买卖弹窗同样漏了守卫且**同样落库**。本轮把它们全堵上;连同这些, 该根因现已覆盖**所有写路径**(仅 Stats #81 展示层自愈未改)。

- [x] **85** ✅ **P1: 转账弹窗金额 100 倍落库** — `TransferForm.tsx` save 无 currencies 门闩, JPY 转 ¥698 → 两腿各记 ¥69,800。修:save 前两腿币种小数位没加载出来就 fail-closed 拒绝(dry-run 逻辑同 #77)。
- [x] **86** ✅ **P1: 投资买入/追加金额 100 倍落库** — `Investments.tsx` BuyModal save 无守卫, JPY 买入 ¥698 → 存 ¥69,800(物理/投资中各错 100 倍)。修:save 前 currencies 未就绪拒绝。
- [x] **87** ✅ **P1: 投资卖出 proceeds 100 倍 + 成本预填 digit 陈旧** — `Investments.tsx` SellModal:(A)proceeds 兜底 2 位 → 幽灵投资收益;(B)预填 effect 缺 digits 依赖 → currencies 到货后成本从 ¥698 缩成 ¥7、只卖 ¥7 不清仓。修:save fail-closed + 预填 effect 加 `digits` 依赖。
- [x] **88** ✅ **P2: `TransferCreate` 金额无上界** — #71 只加固了 `TransactionCreate/Update`, 漏了转账 schema。修:`from_amount/to_amount` 加 `Field(gt=0, le=1e12)`(dry-run: 1e13 与 -5 均 422)。

---

# 第九轮(2026-07-17 · decimal_digits 根因系统性根治)

复查发现我第八轮"已覆盖所有写路径"的断言**是错的**:`decimal_digits ?? 2` 根因还漏了 **7 条会落库的写路径**——新建钱包初始余额/额度(默认币种就是 JPY!)、借出、收到还款、坏账核销、信用卡还款、**对账**(P1: 直接污染钱包真实余额)、报销。逐个 save 加守卫是打地鼠,已漏两次。

- [x] **89** ✅ **系统性根治(替代逐个加守卫)** — 币种是无写接口的 9 条种子表。在 `main.tsx` 用 `setQueryDefaults(["currencies"], { initialData: SEED_CURRENCIES })` 把标准币种小数位烘焙成所有 `["currencies"]` 查询的初始数据 → `currencies.data` **永不为 undefined**,`decimal_digits ?? 2` 对任何钱包币种都取到正确小数位,即使 `/currencies` GET 失败也不再兜底 2。**一处修复覆盖全部 14 个查询点 / 所有写路径**(含 #77/#79/#81/#85/#86/#87 及本轮新发现的对账/新建钱包/借出/还款/核销/信用卡还款/报销)。`initialDataUpdatedAt:0` 保证挂载时仍立即拉服务器最新全量币种。前端构建通过。之前各 save 的 fail-closed 守卫保留作纵深防御(现基本不会触发)。

> 教训: 同一根因散落在 14 处时, 逐点加守卫必漏(我漏了 2 次);应从数据源头(让 currencies 永远有值)一次根治。

---

# 第十轮(2026-07-17 · #89 复查 + 同类隐患扫尾)

**#89 复查结论: 可靠、无回归** —— setQueryDefaults 的 initialData 确实让 14 个 currencies 查询点的 `.data` 从挂载起即为种子表, 不破坏 isLoading/prefill 逻辑, 烘焙的 9 条与后端 seed_data.py 完全一致, 挂载仍 refetch。系统性搜"缺值静默兜底"同类隐患, **仅 1 条窄 P2**, 已强收敛。

- [x] **90** ✅ **P2: 首页借贷·应收/应付折算缺汇率时静默折 0 且不进黄条** — `Overview.tsx` 的 `loanNet.fold` 缺汇率时 `rate=0` → 该币种借贷余额静默折成 0 漏算;顶部黄条只读后端 `cross.missing_rate_currencies`(仅钱包口径、且排除归档钱包), 看不到"借贷-only 或归档钱包"的缺汇率币种。修:`loanNet` 记下折算缺汇率的币种并入黄条(与 cross 的合并去重),文案改为"余额/借贷未计入"。构建通过。

> 十轮下来两条系统性根因(系统分类按名识别、decimal_digits 缺省)已根治, 交互层写路径全覆盖, 本轮扫尾只剩窄展示 P2。审计趋于收敛。

---

# 第十一轮(2026-07-17 · 从未审的 auth/settings + 数字键盘)

补审两块从没审过的区域(上轮 DateField agent 报错未跑;auth/settings 从未审)。DateField 日期数学核对无新问题;auth 里挖到一个真 P1。

- [x] **91** ✅ **P1: 登出/登录不清 React Query 缓存 → 同浏览器切账号看到上一用户的余额/交易/持仓** — `auth.tsx` 的 login/logout 只动 token,不碰 qc;所有理财 query key 不带 user 维度 + staleTime 30s → B 登录后 30s 内组件直接渲染 A 的缓存数据(还不发请求)。家用共享浏览器的跨用户财务数据泄露。修:`AuthProvider` 用 `useQueryClient()`,login 与 logout 都 `qc.clear()`。
- [x] **92** ✅ **P2: ×10/×100/×千/×万 用 `parseFloat`(不剥逗号)** — 与落库的 `parseAmount`(先剥 `,`)不一致 → 手输"1,000"点×倍数被打成 1,少两个数量级。修:三处(`TransactionForm`/`Loans`/`Investments`)`parseFloat(amountText.replace(/,/g,""))`。
- [x] **93** ✅ **P2: 注册非原子(#61 的 register 版)** — `auth.py` 先 commit User 再 seed(seed 内部再 commit),seed 失败留下无默认/系统分类的坏账号。修:改 `flush` 拿 id、让 seed 的提交把 User+默认数据一起落库(dry-run: 注册建 67 分类含 4 系统分类)。
- [x] **94** ✅ **P2: Settings 导出/重置无错误反馈** — `downloadExport` 裸 async 无 try/catch、reset mutation 无 onError → 500 时静默无提示(用户以为已导出/已重置)。修:加 try/catch + onError alert。

---

# 实操发现(2026-07-18 · 浏览器跑真实流程)

在真实 App 上逐流程点检(#76 的确认扣款已验证修复生效:代肝/农业银行 确认弹窗正确预填 CNY/农行,不再默认三菱UFJ)。发现一条账单页与首页口径不一致:

- [x] **95** ✅ **P2: 账单页"当日支/收"小计把「对账调整」当真实收支** — `Transactions.tsx:318` 的日头汇总只排除了转账/借贷(`kind !== income/expense`),漏排内部分类「对账调整」→ 对账日(如 2026-07-30)日头显示"支 -¥269 收 +¥4,039"(全是对账调整余额校正分录),与首页/统计(已按 `not_internal` 排除,审计 #4)口径矛盾、误导用户以为当天有真实收支。修:日头汇总也跳过「对账调整」分类(前端按分类名匹配,与后端 INTERNAL_CATEGORY_NAMES 一致)。真机验证:07-30 日头改后不再显示支/收,其余日(07-31/29/28 排除借贷转账)正确。

---

# 实操发现第二轮(2026-08-23 · headless 浏览器 + API 六路并行 · 每条独立复现/反驳)

6 路探索(首页/账单/借贷投资/Wallet设置/API 一致性/近 9 提交代码审查)得 27 条候选; 严重度最高的 14 条各由独立 agent 复现+尝试反驳, **14 条全部确认、0 条反驳**(其中两条为同一问题, 合并为 13 条); 其余 13 条低严重度未独立验证, 以 P2 登记。所有 `[自动测试]` 数据已清理(交易数回到 9620, 七张表零残留, integrity ok)。`PRAGMA foreign_key_check` 另发现真实数据里 2 处历史悬空(商家 Webull id 279/1240 的默认分类指向已删分类 61/270), 即 #96 的既成事实。

## P0(新)— 静默算错钱/整站 500

- [ ] **96** **删除分类/商家后外键级联未生效: 子分类成孤儿、交易 category_id/merchant_id 悬空, 且 id 复用会把旧交易静默归到新分类** — 子分类 (296, parent_id=295) 仍留在 DB, 仍出现在 /api/categories 和商家表单「默认分类」下拉里, 只是分类树上不可见、无法再从 UI 删除; 交易 9805 删除后仍为 category_id=297, merchant_id=1329 (UI 显示「未分类」); 新建分类拿到的 id 又是 297 (SQLite 无 AUTOINCREMENT 复用 rowid), 于是旧交易 9805 自动归属到新分类。backend 全目录 grep 不到 PRAGMA foreign_keys, SQLite 默认不强制外键, 所有 ondelete 声明都是空文。 复现: 1) /categories 点「新增一级」建 "[自动测试] 父类", 再在其下加子分类 "[自动测试] 父子"; 2) 点父类的删除按钮, 确认框文案为「删除"[自动测试] 父类"及其全部子分类？」, 确认; 3) 查库 select id,parent_id,name from categories where name like '%自动测试%'; 4) 另建子分类 [自动测试] 孤儿分类(id 297) 与商家 [自动测试] 商家2(id 1329), 用它们在测试钱包上记一笔交易(id 9805); D… 文件: `backend/app/core/db.py (缺 PRAGMA foreign_keys=ON 的连接钩子); backend/app/routers/categories.py delete_category; backend/app/routers/merchants.py delete_merchant; backend/app/models/category.py` 修法: backend/app/core/db.py: 给 engine 加 sqlite 连接钩子, 例如 from sqlalchemy import event @event.listens_for(engine.sync_engine, "connect") def _fk_on(dbapi_conn, _): dbapi_conn.execute("PRAGMA foreign_keys=ON") 这样既能让 parent_id CASCADE 删子分类, 也能让 transactions/merchants 的 SET NULL 生效 (注意 wallets ON DELETE RESTR…
- [ ] **97** **借贷接口缺金额上界: 超大金额可落库并让 /wallets /dashboard /loans/accounts /stats 全部 500 (integer overflow)** — LendRequest/RepaymentRequest/WriteOffRequest/SplitCreateRequest/SplitParticipant(schemas/loan.py) 仅 gt=0/ge=0 无上界; investment.py BuyRequest/AddBuyRequest/SellRequest 与 reconciliation.py actual_balance 同样无上界。2^63 直接 500; 2^63-1 入库后 SUM(amount) 溢出, 钱包/首页/借贷/净值接口全部 500, 直到删掉该笔才恢复。 复现: 1) POST /api/loans/lend {"contact_id":4,"currency_code":"JPY","wallet_id":8,"amount":9223372036854775808,"occurred_on":"2026-08-23","note":"[自动测试] 溢出借出A"} → 500 (2^63 超 SQLite INTEGER)。2) 同样请求 amount=9223372036854775807 → 201 落库。3) 之后 GET /api/wallets、/api/loa… 文件: `backend/app/schemas/loan.py, backend/app/schemas/investment.py, backend/app/schemas/reconciliation.py` 修法: 与审计#71 对齐, 在以下字段加 le=1_000_000_000_000 (Field(gt=0/ge=0, le=1_000_000_000_000)): - backend/app/schemas/loan.py: SplitParticipant.share、SplitCreateRequest.amount/my_share、RepaymentRequest.amount、WriteOffRequest.amount、LendRequest.amount - backend/app/schemas/investment.py: BuyRequest.amount、AddBuyReq…

## P1(新)— 已确认的真 bug

- [ ] **98** **余额模块手选的折算币种在第二次刷新后被顶回主币种(Stats.tsx 每次挂载覆写 localStorage)** — 只活过一次刷新。Stats.tsx(仪表盘)挂载时 useEffect 无条件 setBaseCurrency(user.primary_currency_code) 并随后 localStorage.setItem('tally.baseCurrency', ...) 把共享键写回 JPY, 下次加载 BalanceModule 从 localStorage 读到的就是 JPY。 复现: 1. 打开 / ，在余额模块「真实余额 · 折算到」下拉选 CNY(主数字变 ¥158,211.20, localStorage tally.baseCurrency=CNY)。2. 刷新一次: 余额模块仍显示 CNY, 但 localStorage 已变成 JPY。3. 再刷新一次: 余额模块下拉回到 JPY, 主数字回到 ¥3,73x,xxx。 文件: `frontend/src/pages/Stats.tsx (useEffect setBaseCurrency(user.primary_currency_code) + localStorage.setItem 'tally.baseCurrency'); frontend/src/components/Overview.tsx BalanceModule hadSavedBase` 修法: frontend/src/pages/Stats.tsx 第 68-72 行：给 Stats 加上与 Overview.tsx BalanceModule 相同的 hadSavedBase 守卫（`const hadSavedBase = useRef(localStorage.getItem("tally.baseCurrency") != null)`，effect 改为 `if (!hadSavedBase.current && user?.primary_currency_code) setBaseCurrency(...)`）；或者更彻底地把 baseCurrency 提升为一个共享…
- [ ] **99** **日头合计只统计当前页内的行, 跨页的同一天显示不完整合计** — 第 5 页 2026-07-22 日头显示「JPY 支 -¥7,159」(3 行), 第 6 页同一天日头显示「JPY 支 -¥946」(3 行); 单日筛选后显示「支 -¥8,105」。另一例: 每页 25 时 2026-07-17 在第 6/7 页分别显示 JPY 37,063 / 16,253 (全天 53,316)。 复现: 1. 打开 /transactions, 每页 25 条, 在页码框输入 5 回车, 滚到底部看最后一组 2026-07-22 的日头; 2. 点「下一页」看第 6 页第一组 2026-07-22 的日头; 3. 用开始/结束日期筛选 2026-07-22 单日对照 (或 GET /api/transactions?start=2026-07-22&end=2026-07-22 手算)。(测试时列表含 3 条临时测试行, 共 5114 条; 清理后分页边界会移位, 但任何落在 offset=页大小整数倍 处的日期都… 文件: `frontend/src/pages/Transactions.tsx — grouped/totals 仅基于当前页 txs.data 计算, 分页接口按行切分不按日期对齐` 修法: 两种思路任选: (A) 在 Transactions.tsx 对当前页首尾两组(或所有组)加请求 GET /api/transactions?start=日期&end=日期(带同样的 filter)算全天合计, 或让后端 list 接口附带 per-day 汇总; (B) 若不想多请求, 至少在被截断的组(页首组且上一页末行同日 / 页末组且下一页首行同日, 可由 offset 和相邻页缓存判断)把日头标成「本页小计」或隐藏合计, 避免两页各显示一个像全天的数字。
- [ ] **100** **编辑时把支出改成收入, 原支出分类 id 仍被提交并落库 (收入挂在支出分类上)** — 保存成功, API 返回 kind=income 且 category_id=4 (🥤自动贩卖机, 支出分类); 列表里显示为「🥤 自动贩卖机 … +¥2,000」的收入, 日头记入「收 +¥2,000」。后续分类统计会把收入算到支出分类下。 复现: 1. 新建一笔支出 (分类 🍱饮食 > 🥤自动贩卖机, 备注 [自动测试] 支出A, 现金(JPY) 1,234) 并保存; 2. 点该行铅笔进入编辑, 点「收入」切换类型 — 分类区切换为收入分类且没有任何分类被选中 (截图可见); 3. 不选分类直接「保存」; 4. GET /api/transactions/{id} 查看 文件: `frontend/src/components/TransactionForm.tsx — setKind("income") 未重置 categoryId, payload 仍带 category_id; backend/app/routers/transactions.py update_transaction/create_transaction 未校验 Category.kind 与交易…` 修法: 前端 frontend/src/components/TransactionForm.tsx:440/445 两个类型按钮的 onClick 里, 当 kind 变化时 setCategoryId(null)(或在 useEffect 里检测 selectedCat 为 null 时清空), 并在提交前若 categoryId 不属于当前 kind 的 filteredCategories 则置 null。后端 backend/app/routers/transactions.py create_transaction/update_transaction 的归属校验处追加: 若 catego…
- [ ] **101** **分摊组的支出腿可单独编辑金额/日期, 与借出腿脱钩, 撤销分摊后合并金额错误** — 支出腿被改为 1,800 且日期变为 2026-08-22, 借出腿仍为 1,500 在 2026-08-23 (同一组两条日期不同、合计 3,300≠3,000); 撤销分摊后合并为一笔 3,300 的支出。后端 update_transaction 只拦非 expense/income 类型, 对 split_group_id 非空的支出腿不拦。 复现: 1. 「添加」→ 金额 3000, 现金(JPY), 分类饮食, 备注 [自动测试] 分摊, 勾选「分摊订单(AA)」选参与人 Kyuu, 自动均摊 我 1500 / Kyuu 1500, 保存; 2. 列表中生成两行 (🍱饮食 分摊 -¥1,500 带铅笔+撤销分摊+删除; 💸借出 @Kyuu 分摊 -¥1,500 仅删除); 3. 点支出腿的铅笔, 金额改 1800, 日期点「前一天」, 保存 (后端 PATCH 200); 4. 点支出腿「撤销分摊」(确认) 文件: `frontend/src/pages/Transactions.tsx 铅笔条件 (t.kind === "expense" || t.kind === "income") 未排除 split_group_id; backend/app/routers/transactions.py update_transaction 的 is_standalone_loan/kind 守卫未覆盖分摊组内支出腿` 修法: 后端 backend/app/routers/transactions.py update_transaction: 对 t.split_group_id 非空的交易(不论 kind), 拒绝修改 amount / wallet_id / occurred_on / kind(可保留 category_id / merchant_id / note 等不破坏组不变量的字段), 错误文案可提示"分摊订单请先撤销分摊再改"。前端 frontend/src/pages/Transactions.tsx:400 铅笔条件增加 `&& !t.split_group_id`(或编辑弹窗对分摊腿锁定金额/日…
- [ ] **102** **借贷分析弹窗顶部 4 个全时段 KPI 用打开时的 acct 快照, 弹窗内编辑/删除后不刷新, 与下方区间 KPI 自相矛盾** — 顶部 4 个 KPI 停留在弹窗打开那一刻的快照: 改金额后顶部仍显示 当前欠款 ¥106,942 / 累计借出 ¥9,104,703, 而同一弹窗下方显示 区间借出(全部) ¥9,104,753 / 净变动 +¥106,992 (API 此时 loan_out_total=9104753, balance=-106992)。删除后顶部变成 ¥106,992 / ¥9,104,753(上一次快照), 下方已是 ¥9,104,603 / +¥106,842, API 已恢复 9104603/-106842。关掉弹窗重开才正确。 复现: 1. /loans 点 Kyuu·JPY 行的「分析」打开弹窗(范围=全部)。2. 在明细搜索框输入 "[自动测试]" 找到本次测试借出那笔(独立笔, 有铅笔), 点铅笔 → 把金额 100 改成 150 → 保存。3. 观察弹窗顶部「当前欠款/累计借出」与第二行「区间借出/区间净变动」。4. 再点铅笔 → 删除 → 确认, 再观察同两行。 文件: `frontend/src/pages/Loans.tsx: HistoryModal 顶部 `owed = acct.loan_out_total - acct.loan_repayment_total` 与 `<Sum label="累计借出" v={fmt(acct.loan_out_total)}>`; 调用处 `<HistoryModal acct={historyFor} ...>` —…` 修法: frontend/src/pages/Loans.tsx: HistoryModal 不要直接用 props.acct 的金额字段渲染顶部 KPI。方案 A: 在 HistoryModal 内 `useQuery({queryKey:["loan-accounts"]})`(或由父组件传入 accounts.data), 按 acct.contact_id + acct.currency_code 取实时对象 `live = accounts.find(...) ?? acct`, 顶部 owed/loan_out_total/loan_repayment_total/repaidPct 均用…
- [ ] **103** **投资页「编辑持仓」弹窗的买入日期 DateField 被挤成 6 行(按钮高 138px), 布局明显错位** — DateField 放在 grid-cols-2 的半列(父宽 168px)里, 中间日期按钮宽仅 81px, 文本折成 "2026 / 年 8 / 月 / 23 / 日 · / 周日" 六行, 按钮高 138px, 左右箭头也被拉成 138px 高, 与左侧 JPY 输入框严重不对齐。 复现: 1. /investments 任意持仓卡片点铅笔「编辑持仓」。2. 观察「币种(不可改)」与「买入日期」并排那一行。 文件: `frontend/src/pages/Investments.tsx EditModal: `<div className="grid grid-cols-2 gap-2">` 内的 `<label>买入日期 <DateField .../>`; 其余弹窗都用 `grid-cols-1` 单独一行放 DateField` 修法: frontend/src/pages/Investments.tsx EditModal: 把「币种(不可改)」与「买入日期」所在的 `<div className="grid grid-cols-2 gap-2">` 改为 `grid-cols-1`(或把 DateField 移出该 grid 单独占一行, 并把外层 label 改为 div, 与 78d2b6b 对 SellModal 的修法一致)。
- [ ] **104** **Wallet 页没有归档/取消归档入口, 但删除失败提示让用户「改为归档」; 归档后的钱包卡片无任何标识、仍混在列表中却不计入汇总** — alert 文案「钱包仍有交易或借贷归属记录; 请改为归档而不是删除」, 但编辑表单只有名称/类型/颜色/额度, 页面任何地方找不到「归档」; PATCH archived=true 后卡片外观与其他卡完全一样(innerText 无「归档」), 仍显示 ¥1,000, 而 JPY 汇总「物理」从 ¥698,597 变为 ¥697,597 (已剔除), 用户无从得知为什么卡片合计与汇总差 1,000。 复现: 1) 新建 "[自动测试] 钱包"(JPY), 对账生成一笔交易; 2) 点卡片右上角删除, 确认; 3) 点卡片编辑, 查看表单; 4) 用 API PATCH /api/wallets/{id} {"archived":true} 后刷新 /wallets。 文件: `frontend/src/pages/Wallets.tsx (WalletForm 无 archived 字段; WalletCardItem 未渲染 archived 状态); 后端 WalletUpdate 已支持 archived` 修法: frontend/src/pages/Wallets.tsx: (a) WalletForm 编辑态增加「归档」开关并把 archived 放入 PATCH payload(后端 WalletUpdate 已支持); 或在 WalletCardItem 操作浮层加 Archive/ArchiveRestore 图标按钮(参考 Contacts.tsx 第 20、65 行的 archive mutation)。(b) WalletCardItem 对 wallet.archived 渲染「已归档」角标并 opacity-50/置灰, 或按 Contacts 页做法默认隐藏归档卡并提供「显示已归档…
- [ ] **105** **设置页汇率列表被静默截断为 50 条, 主币种 JPY 作为 base 的 6 条汇率 (JPY→CNY 等) 不显示** — API 返回 56 条 (每对最新一条), UI 只渲染 50 条且无「更多」提示; 末行是「1 JPY = 0.0063 USD」, JPY→SGD/KRW/HKD/GBP/EUR/CNY 六条看不到, 用户无法在设置页核对/删除主币种 JPY 的汇率。 复现: 1) 打开 /settings 滚到「汇率」卡片, 数列表行数并找 1 JPY = x CNY; 2) 对比 GET /api/exchange-rates 返回条数。 文件: `frontend/src/pages/Settings.tsx 汇率列表 .slice(0, 50)` 修法: frontend/src/pages/Settings.tsx:259 去掉 `.slice(0, 50)`(后端已按 (base,quote) 去重, 最多 币种数×(币种数-1) 条, 容器已有 max-h-72 滚动); 若仍想限制, 改为按 base 分组或在末尾显示「仅显示前 50 条, 共 N 条」提示。
- [ ] **106** **month 查询参数非法时多个统计/首页接口 500 (ValueError 未处理)** — 全部返回 'Internal Server Error' [HTTP 500]。date.fromisoformat(month + '-01') 的 ValueError 未捕获; dashboard 对 len!=7 的 month 直接 fromisoformat(month) 也会炸 ('2026-8')。9999-12 还会在 _add_months 算下月时产生 year 10000。 复现: GET /api/stats/summary?month=2026-13 ; /api/stats/summary?month=abcd-ef ; /api/stats/summary?month=9999-12 ; /api/stats/summary?month=0001-01 ; /api/stats/category-compare?month=2026-00 ; /api/stats/top-merchants?month=2026-13 ; /api/dashboard?month=2026-13 ;… 文件: `backend/app/routers/stats.py, backend/app/routers/dashboard.py, backend/app/routers/recurring.py` 修法: 在 /home/pi/Desktop/Tally/backend/app/routers/stats.py（summary/category-compare/top-merchants）、dashboard.py（get_dashboard）、recurring.py（by_month）中统一一个 `_parse_month(month: str | None) -> date` 辅助：用正则 ^\d{4}-\d{2}$ 校验并 try/except ValueError，失败时 raise HTTPException(400/422, "month 须为 YYYY-MM") 或回退到当月；同…
- [ ] **107** **独立借贷改钱包后 attributed_wallet_id 未清空, 物理余额归属与明细显示的钱包不一致** — PATCH 只 setattr(wallet_id), attributed_wallet_id 仍为 1; all_wallet_loan_summary/wallet_loan_summary 按 COALESCE(attributed_wallet_id, wallet_id) 归集, 所以钱包 1 物理余额照旧扣着这笔、钱包 4 不变; 而借贷分析明细/钱包分布/交易列表按 wallet_id 显示为钱包 4。同一笔借出在不同页面归到不同钱包。守卫注释声称「钱包 loan_out_on_wallet 是实时 SUM 改完即一致」在有名义归属时不成立。 复现: 1. 借贷页 → Kyuu·JPY「分析」→ 对一笔 attributed_wallet_id 非空的独立借出(如 id 9031, wallet_id=1, attributed_wallet_id=1, 备注「历史导入 2025.8」)点铅笔 → 把出账 Wallet 从「三菱UFJ銀行(1)」改成「三井住友銀行(4)」保存。2. 看首页/钱包页各钱包的物理余额(= balance - loan_out_on_wallet + loan_repayment_on_wallet)。 文件: `backend/app/routers/transactions.py:349-353, 377-383, 392-393; backend/app/services/balances.py:8-9, 112-133` 修法: backend/app/routers/transactions.py update_transaction：对 is_standalone_loan 且 updates 含 wallet_id 时，同步处理名义归属——最简单是 t.attributed_wallet_id = None（改出账钱包即视为放弃旧名义归属，归集回落到新 wallet_id）；若想保留「名义转移优先」语义，则当 attributed_wallet_id == 旧 wallet_id 时设为 None/新 wallet_id，仅在 attributed != 旧 wallet_id（真正名义转移过）时保留并在响应/U…
- [ ] **108** **支出节奏: stats-daily 固定只拉 400 天, 看过去月份时最老的历史月被截断却仍计入均值/区间带/「有数据 N 个月」** — daily 查询 start=2025-07-19, 2025-07 只有 19~31 日的数据进桶, 该月累计线在 1~18 日为 0、终值仅 ~618k; 因 some(v>0) 为真被算作 active, 把均值拉低、区间带下沿压到接近 0, 小结「比平均快 N%」随之偏高。同理 月份=2026-01/2026-07 等任何让 2025-07 落入 hist 的组合都受影响(随日期滚动, 每天都有一个被截断的月)。 复现: 1. 今天 2026-08-23, 统计页月份选择器切到 2026-07, 历史对照切「12」个月。2. 历史月含 2025-07; 观察 2025-07 那条线、灰虚线均值、灰带下沿、副标题「有数据 N 个月」与小结「比平均快/慢」。 文件: `frontend/src/pages/Stats.tsx:83-88 (daily 查询 start = 今天-400 天), 204-206 (buckets 按日归桶), 236 (active 判定), 237-251 (avg/band)` 修法: Stats.tsx daily 查询改为依赖所选月份与 paceMonths: queryKey 加入 month/paceMonths, start = 所选月往前 paceMonths 个月的 1 号 (例如 new Date(yr, mn-1-paceMonths, 1)), end = 所选月末或今天; 或简单改为固定拉「本月 1 号往前 13 个整月的 1 号」而非今天-400 天。同时在 active 判定中排除首日早于查询 start 的历史月 (或把该月整体置为不参与 avg/band/activeCount), 避免未来再出现不完整月混入。

## P2(新)— 低严重度, 探索 agent 报告、未独立验证

- [ ] **109** **仪表盘「本月 Top 商家」不剔除内部分类(对账调整), 与同页「支出」KPI 口径不一致** — top-merchants 把该笔列为 #1 (¥777,777), 而 dashboard.month_totals / summary 的 JPY 支出仍是 134,900(未计入)。首页同一块区域里 Top 商家合计可大于「支出」KPI。不确定点: 真实库里目前没有「对账调整+商家」的交易(SQL 查询为空), 需要用户手动给对账分录指定商家才会触发, 故标 low。 文件: `backend/app/routers/stats.py top_merchants(): where 子句缺 not_internal(skip_cats)`
- [ ] **110** **支出节奏小结「本月累计」与仪表盘「支出」在跨币种折算时相差 ¥1~2(逐日折算四舍五入 vs 月总额折算)** — 7 月: 支出 ¥554,057, 小结 本月 ¥554,059 (差 2)。8 月折 CNY: 支出 ¥9,104.59, 小结 ¥9,104.60 (差 0.01)。原因是节奏图按 /stats/daily 每日分别 Math.round 折算再累加, KPI 按 summary 的月总额一次折算。单币种或恰好无舍入时相等(8 月折 JPY 两者都是 ¥213,755)。属舍入误差, 标 low。 文件: `frontend/src/pages/Stats.tsx pace useMemo (fxTo 逐日) vs cur useMemo (fxTo 月总额)`
- [ ] **111** **容器时区为 UTC, 日均支出按 22 天计算而页面显示「截至 23 号」(JST 0~9 点期间后端日期落后一天)** — 后端 summary 用 date.today()(容器 UTC 仍是 8-22) 得 days_elapsed=22: JPY 134,900/22=6,131; 前端节奏图用浏览器本地日期显示「截至 23 号」。凡用 date.today() 的逻辑(日均、周期账单待确认/下次约、月份边界)在每天 JST 0~9 点都会差一天。不确定点: 可能是部署环境未设 TZ 而非代码缺陷, 故标 low。 文件: `backend/app/routers/stats.py summary() days_elapsed 用 date.today(); docker 容器未设置 TZ`
- [ ] **112** **新建交易表单的 Wallet 默认值继承上一次编辑的交易钱包, 与首次打开的默认钱包不一致** — 第 3 步表单已预选「✓ 现金 (JPY)」(脚本点击「现金 (JPY)」返回 NOBTN, 因为按钮文字已带 ✓), 即 walletId 从上次编辑残留。若上次编辑的是 CNY 钱包交易, 新记一笔日元支出时默认会落到 CNY 钱包 (币种标签随之变 CNY, 需用户留意)。不确定是否有意设计, 故标 low。 文件: `frontend/src/components/TransactionForm.tsx 初始化 effect 的 new 分支未 setWalletId(null); 默认钱包 effect 仅在 walletId==null 时生效`
- [ ] **113** **分类页删除系统分类(对账调整等)被后端 400 拒绝后页面毫无反馈** — 确认后无任何 alert/错误文案, chip 原样留下, 用户不知道为什么删不掉 (del mutation 没有 onError; 商家页 del 同样没有 onError)。守卫本身有效, 分类未被删。 文件: `frontend/src/pages/Categories.tsx del useMutation 缺 onError (对比 Wallets.tsx deleteMut 有 alert)`
- [ ] **114** **信用卡对账弹窗文案/数字问题: 待还 0 显示「¥-0」, 负差额符号位置与正差额不一致, 「按可用额度」空输入即显示 -额度 差额并可直接提交** — 「当前待还 ¥-0」; 空输入时直接显示「差额 ¥-10,000 待还比记录多, 生成一笔 expense」且「对账并调整」可点 (误点会把整张卡额度记成支出); 输入 8000 后差额显示「¥-2,000」而收入方向显示「+¥1,500」, 符号一个在 ¥ 后一个在 ¥ 前。实际提交结果本身正确 (待还 2,000 / 可用 8,000)。 文件: `frontend/src/components/ReconcileModal.tsx (formatAmount(-expected) 对 0 得 -0; diff 显示拼接; actualText 为空时 inputVal=0)`
- [ ] **115** **设置里切换「主要使用币种」后, 首页顶部「余额·折算到」不跟随 (仍为 JPY), 只有仪表盘统计部分切换, 与设置文案不一致** — 余额块仍为 JPY (¥3,736,455, 下拉 JPY), 仪表盘统计部分已变为 CNY (支出 ¥9,052.34)。源码注释表明这是有意为之 (手选过折算币种后不再被 primary 覆盖), 但首次访问就会把默认值写进 localStorage, 之后设置项对余额块永远无效; 不确定是否算 bug, 至少文案与行为不符。已改回 JPY (/api/users/me primary_currency_code=JPY)。 文件: `frontend/src/components/Overview.tsx L38-43; frontend/src/pages/Settings.tsx 主币种说明文案`
- [ ] **116** **超大/负数 days、back、months 参数及极端 end 日期导致 500 (OverflowError / year out of range)** — 全部 [HTTP 500]。today+timedelta(days) 越过 9999 年 → OverflowError; _add_months 得出年份 8335360/-8331307 → ValueError; daily 的 end-90 天越过 0001 年 → OverflowError。低严重度: 仅构造输入可触发, 不影响正常数据。 文件: `backend/app/routers/recurring.py (upcoming), backend/app/routers/stats.py (monthly_trend/category_trend/daily)`
- [ ] **117** **容器以 UTC 计算 date.today(), 与用户本地 JST 差 9 小时: 日均支出、周期账单窗口、首页默认月份在 00:00–09:00 JST 期间按"昨天"计算** — summary avg_daily_expense=6135 (=134977//22, 按 22 天); upcoming 未返回 tx9790(2026-08-30), 却把 tx9769(2026-08-15) 计入回看窗 confirmed。按服务器日期 08-22 复算则全部一致(逻辑本身正确, 偏差纯属时区)。每月 1 日 0–9 点 /api/dashboard 无 month 参数时也会落到上个月。不确定点: 若产品定义即以 UTC 为准则非 bug; 修法是给容器设 TZ=Asia/Tokyo 或后端按用户时区取"今天"。 文件: `docker-compose / 容器 TZ 环境变量; backend 各处 date.today()`
- [ ] **118** **借贷分析弹窗的 range/filter/q/limit 状态跨联系人·币种残留, 换账户后可能无 chip 高亮且全部为空** — range 仍为 "2022", 但 CNY 账户 years 只有 [2026], 范围行没有任何 chip 高亮, 区间 KPI 全 0、图表「区间内无往来」、明细「无记录(已筛选)」, 用户无法从 UI 看出是被一个不可见的年份过滤掉了。filter/q/limit 同样残留(旧版已有), 新增的 range 让后果从"少几条"变成"整页空"。 文件: `frontend/src/pages/Loans.tsx:572 (range 状态), 576-580 (years 来自当前 txs), 641 (if (!acct) return null 在 hooks 之后, 组件常驻), 660 (rangeItems)`
- [ ] **119** **首页「预定支出」合计对缺汇率币种静默折算为 0, 且合计为 0 时「从余额扣除」按钮整体隐藏** — fold 返回 0 → plannedTotal 不含这笔; 若它是唯一一笔, plannedTotal=0, 合计与「从余额扣除」按钮都不渲染, 看起来像功能失效; 若有其他币种的预定, 合计与扣减值偏小且无提示。同文件同逻辑在 Loans.tsx:48-63 已做了 missing 提示, 这里漏了。 文件: `frontend/src/components/Overview.tsx:111-123 (plannedTotal/fold: rate==null → 0), 230-237 (plannedTotal>0 才显示合计与按钮)`
- [ ] **120** **借贷分析明细一次性拉 limit=2000 无分页, 超过后最旧记录被静默截断, 逐月图起点/区间 KPI 将与全时段 KPI 脱节** — 列表按日期降序取前 2000, 最早的记录被丢弃且无任何提示; 「首笔」日期、逐月图起点、区间起点前的累计欠款起始值、「全部」范围下的区间借出/还款都会与服务端算的 acct.loan_out_total 对不上。 文件: `frontend/src/pages/Loans.tsx:565-567; backend/app/schemas/transaction.py:76 (limit le=5000), backend/app/routers/transactions.py:106 (order by occurred_on desc)`
- [ ] **121** **EditLoanTxModal 的「归档钱包保留」过滤实际无效: 传入的 wallets 列表本身不含归档钱包** — wallets 来自 /wallets(不含归档), matchingWallets 里根本没有该钱包, <select value={walletId}> 无匹配 option 显示为空白; 明细行钱包名也显示为 `#id`。保存若不改钱包不会出错(body 不带 wallet_id), 但一旦用户在空白下拉里选了别的再想改回就不可能。 文件: `frontend/src/pages/Loans.tsx:28 (GET /wallets 默认 include_archived=false), 791 (matchingWallets 过滤 !w.archived || w.id === tx.wallet_id), 647 (walletName 回退 `#id…`
