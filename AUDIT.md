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
