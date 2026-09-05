import calendar
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..services.months import parse_month
from ..models import Category, Merchant, Transaction, User, Wallet
from ..schemas.transaction import TransactionRead

router = APIRouter(prefix="/recurring", tags=["recurring"])


def _add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))  # 月末日按目标月长度夹住


def _series_key(t: Transaction) -> tuple:
    """"同一个账单"的识别键: 商家 + 分类 + 币种 + 种类 —— 故意不含钱包, 换付款方式不算另一个账单;
    没商家的(房租这类)再用备注区分。"""
    note = "" if t.merchant_id is not None else (t.note or "").strip().lower()
    return (t.merchant_id, t.category_id, t.currency_code, t.kind, note)


class Thread:
    """一条账单的完整时间线: 可能由多个 recurrence_group(或单条无组记录)首尾相接串成。"""
    __slots__ = ("txs", "segments", "keys")

    def __init__(self, txs: list[Transaction]):
        self.txs = txs
        self.segments = 1  # 串进来的序列段数(1 = 本来就是一组)
        self.keys: set[tuple] = {_series_key(t) for t in txs}  # 这条线上出现过的所有识别键(改过分类/备注也认)


def _norm_note(t: Transaction) -> str:
    return (t.note or "").strip().lower()


def _too_close(th: Thread, s: list[Transaction]) -> bool:
    """同一商品在不到半个周期内又来一笔且金额一样 → 是并行的第二份订阅(两张卡各一份), 不是换付款方式。
    换了套餐(金额不同, 如 OpenAI Plus→Pro 相隔 5 天)仍视为同一账单接上。"""
    last, first = th.txs[-1], s[0]
    period = last.recurrence_period_days or first.recurrence_period_days or 30
    if (first.occurred_on - last.occurred_on).days >= 0.5 * period:
        return False
    if first.amount == last.amount:
        return True
    n1, n2 = _norm_note(last), _norm_note(first)
    return bool(n1 and n2 and n1 != n2)  # 备注都写了且不同(Copilot vs Github Pro) = 不同商品, 也不是换套餐


def _affinity(th: Thread, s: list[Transaction]) -> tuple:
    """多条候选线时的取舍: 备注相同优先(GitHub Pro 接 Pro 线、Copilot 接 Copilot 线), 其次金额最接近, 最后才看谁结束得晚。"""
    last, first = th.txs[-1], s[0]
    note_match = 1 if _norm_note(last) == _norm_note(first) else 0
    rel = abs(first.amount - last.amount) / max(first.amount, last.amount, 1)
    return (note_match, -rel, last.occurred_on)


def _build_threads(rows: list[Transaction]) -> list[Thread]:
    """把周期记录整理成"每个账单一条线":
    1. 先按 recurrence_group_id 分组(单条无组记录自成一组);
    2. 识别键相同、时间上前后不重叠的序列串成一条线。
       用户换了付款方式、或者没点"确认扣款"而是直接"添加"了下一期, 都会生出一个新组;
       此前每个组各算一个账单, 老组永远"逾期 N 期"(用户反馈: 房租/OpenAI/Adobe 等十几条假逾期)。
       同时期并行的(两张卡各一份 Google One、Obsidian 的 Site 与 Sync)因为时间交错或"半周期内同额"不会被串到一起。
       识别键按序列里出现过的每一笔算(不只最新一笔): 确认扣款时顺手改了分类/备注, 老段也不会脱线。"""
    groups: dict[tuple[str | None, int | None], list[Transaction]] = {}
    for t in rows:
        key = (t.recurrence_group_id, t.id if t.recurrence_group_id is None else None)
        groups.setdefault(key, []).append(t)
    series = list(groups.values())
    for s in series:
        s.sort(key=lambda x: (x.occurred_on, x.id))
    series.sort(key=lambda s: (s[0].occurred_on, s[0].id))
    by_key: dict[tuple, list[Thread]] = {}
    out: list[Thread] = []
    for s in series:
        skeys = {_series_key(t) for t in s}
        cands: list[Thread] = []
        for k in skeys:
            for th in by_key.get(k, []):
                if th not in cands and th.txs[-1].occurred_on < s[0].occurred_on and not _too_close(th, s):
                    cands.append(th)
        if cands:
            th = max(cands, key=lambda th: _affinity(th, s))
            th.txs.extend(s)  # s 全部晚于 th 的最后一笔, 顺序保持
            th.segments += 1
            for k in skeys - th.keys:
                th.keys.add(k)
                by_key.setdefault(k, []).append(th)
        else:
            th = Thread(list(s))
            out.append(th)
            for k in th.keys:
                by_key.setdefault(k, []).append(th)
    return out


def _period_months(period_days: int) -> int | None:
    """月度类周期对应的自然月数; 固定天数类返回 None。与 _next_after 同一套容差。"""
    if 28 <= period_days <= 31:
        return 1
    if 88 <= period_days <= 92:
        return 3
    if 175 <= period_days <= 185:
        return 6
    if 360 <= period_days <= 366:
        return 12
    return None


def _frequency_label(period_days: int | None) -> str:
    """月度面板的分栏口径, 与预测同一套容差(此前只认 ==30/==365, 366 天年费会被归到"其他")。"""
    if period_days is None:
        return "other"
    m = _period_months(period_days)
    return "yearly" if m == 12 else ("monthly" if m == 1 else "other")


class LearnedRhythm(BaseModel):
    """从该账单历史实际扣款日学出来的节奏, 供预测与前端解释用。"""
    typical_day: int | None = None   # 月度类: 通常每月几号扣(最近几期"日"的中位数)
    learned_gap: int | None = None   # 固定天数类: 实际间隔的中位数(天)
    samples: int = 0                 # 参与学习的期数(<2 时退回设定周期)
    ignored: int = 0                 # 被识别为补记/漏记而剔除的样本数(前端解释用)
    anchor: date | None = None       # 月度类: 最近一笔正常记录对应的典型日(季度/半年/年度靠它对齐周期网格)
    backfilled_on: date | None = None  # 最新一笔若是"漏记后的补记"(记在补记当天, 不代表本期已扣), 记它的日期


OUTLIER_DAYS = 10   # 记账日离典型日超过这么多天 → 日期"异常"; 再结合与上一笔的间隔区分"补记"和"扣款日变了"


def _circular_day_gap(a: int, b: int) -> int:
    """两个"每月几号"的距离, 月末与月初视为相邻(31 号与 1 号差 1 天)。"""
    d = abs(a - b)
    return min(d, 31 - d)


def _circular_median(days: list[int]) -> int:
    """"每月几号"的中位数, 月末与月初视为相邻: 同时出现 >=27 与 <=4 的日号时把 <=4 的加 31 展开再取中位数
    (否则 31 号账单偶尔跨到 1 号记, 排序后两簇落在两端, 中间一笔补记会被选成典型日)。"""
    ds = sorted(days)
    if ds[0] <= 4 and ds[-1] >= 27:
        ds = sorted(x + 31 if x <= 4 else x for x in ds)
    return (ds[len(ds) // 2] - 1) % 31 + 1


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def _grid_date(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def _nearest_grid(d: date, typical: int, months: int, anchor: date | None) -> date:
    """离 d 最近的典型日(上月/当月/下月三选一, 所以 1 号的账单 10-31 记也归到 11-01 那期);
    季度/半年/年度且有锚点时只在锚点所在的周期网格上选(年费 12-28 扣、1-03 记 → 归到 12-28, 不是 1-28)。"""
    span = months if (months > 1 and anchor is not None) else 1  # 有网格时窗口要盖住 2 个网格月, 年费晚记两个月也能归回去
    cands = []
    for k in range(-span, span + 1):
        base = _add_months(d.replace(day=1), k)
        cands.append(_grid_date(base.year, base.month, typical))
    if months > 1 and anchor is not None:
        cands = [c for c in cands if _months_between(anchor, c) % months == 0]
    return min(cands, key=lambda c: abs((c - d).days))


def _is_backfill(d: date, nominal: date, prev_nominal: date | None, months: int) -> bool:
    """"漏记后的补记"签名: 记账日离最近的(网格上的)典型日很远(随手记在了补记当天) 且 离上一笔正常记录对应的典型日
    比一个周期还多 OUTLIER_DAYS 以上(中间确实漏了一期)。只满足前者的是扣款日变了(取消重订/换套餐), 不算补记。"""
    if prev_nominal is None or abs((nominal - d).days) <= OUTLIER_DAYS:
        return False
    return (d - _add_months(prev_nominal, months)).days > OUTLIER_DAYS


def _learn(history: list[date], period_days: int) -> LearnedRhythm:
    """自学习: 用最近 6 期的真实扣款日推典型节奏, 并区分"周期误差"和"漏记/补记"(用户要求):
    - 月度/季度/半年/年度: 取"每月几号"的中位数(月末月初相邻); 满足补记签名(见 _is_backfill)的样本剔除后再取一次中位数 ——
      某期晚记几天(周期误差)被中位数吸收, 漏记后随手补的不会把典型日带偏;
      扣款日变了(最近两期彼此接近、都离中位数很远)则直接以最近两期为准, 两期内跟上。
    - 固定天数(周/两周/自定义): 取相邻间隔的中位数, 只采纳 [0.6x, 1.4x] 设定值内的间隔 ——
      约等于 2 倍以上的间隔是漏了一期, 不能当周期算。"""
    hist = [d for d in sorted(history) if 1900 <= d.year <= 2999]  # 极端年份(手误 9999/0001)不参与, 免得 _add_months 越界 500
    recent = hist[-6:]
    months = _period_months(period_days)
    if months is not None:
        if len(recent) < 2:
            return LearnedRhythm(samples=len(recent))
        # 粗典型日: 只用"与上一笔间隔正常"的样本 —— 漏了几期后一口气补 3 笔同一天, 不会把中位数劫持成补记那天
        approx = months * 30.4
        normal = [recent[0]] + [b for a, b in zip(recent, recent[1:]) if 0.6 * approx <= (b - a).days <= 1.4 * approx]
        med = _circular_median([d.day for d in sorted(set(normal if len(normal) >= 2 else recent))])  # 同一天多笔只算一次

        def walk(samples: list[date], typical: int) -> tuple[dict[date, bool], date | None]:
            """沿时间线走一遍: 标出补记样本, 推进网格锚点(只由正常样本推进; 相位变了就重新锚定)。"""
            flags: dict[date, bool] = {}
            anchor: date | None = None
            prev: date | None = None
            prev_nominal: date | None = None  # 上一笔正常记录对应的典型日(它本身晚记几天不影响"漏一期"的判定)
            for d in samples:
                g = _nearest_grid(d, typical, months, anchor)
                near = abs((g - d).days) <= OUTLIER_DAYS
                is_bf = _is_backfill(d, g, prev_nominal, months)
                new_rhythm = False
                if prev is not None and flags.get(prev):
                    dist_prev = abs((d - _add_months(prev, months)).days)
                    if dist_prev <= OUTLIER_DAYS and (is_bf or dist_prev <= abs((g - d).days)):
                        flags[prev] = is_bf = False  # 上一笔"补记"之后恰好一个周期又来一笔: 是新节奏(停订后重订/改了扣款日), 不是补记
                        new_rhythm = True
                flags[d] = is_bf
                if not is_bf:
                    if new_rhythm:
                        prev_nominal = d  # 新节奏以这笔为基准, 不吸附到旧网格
                    elif near:
                        anchor = prev_nominal = g
                    else:
                        g_any = _nearest_grid(d, typical, months, None)
                        if abs((g_any - d).days) <= OUTLIER_DAYS:
                            anchor = prev_nominal = g_any  # 季度/半年/年度整体换了月份(相位变了): 重新锚定
                        else:
                            prev_nominal = d  # 扣款日变了: 以这笔为基准
                prev = d
            return flags, anchor

        flags, _ = walk(hist, med)
        kept = [d for d in recent if not flags[d]] or recent
        typical = _circular_median([d.day for d in sorted(set(kept))])
        # 扣款日变了: 不等中位数慢慢翻转 ——
        # (a) 尾部连续 3 笔间隔正常、日号一致, 却与学到的典型日相差 >10 天: 这就是新节奏(停订后重订/改期), 不管补记标记怎么说
        tail = recent[-3:]
        pairs = list(zip(tail, tail[1:]))
        if len(tail) == 3 and all(0.6 * approx <= (b - a).days <= 1.4 * approx for a, b in pairs) \
                and all(_circular_day_gap(a.day, b.day) <= 3 for a, b in pairs + [(tail[0], tail[2])]) \
                and _circular_day_gap(_circular_median([d.day for d in tail]), typical) > OUTLIER_DAYS:
            for d in tail:
                flags[d] = False
            kept = [d for d in recent if not flags[d]]
            typical = _circular_median([d.day for d in tail])
        else:
            # (b) 最近两期彼此接近、都离典型日很远
            last2 = [d.day for d in kept[-2:]]
            if len(last2) == 2 and _circular_day_gap(last2[0], last2[1]) <= 3 and all(_circular_day_gap(x, typical) > OUTLIER_DAYS for x in last2):
                typical = last2[-1]
        _, anchor = walk(kept, typical)  # 用最终典型日重建锚点
        backfilled_on = hist[-1] if hist and flags.get(hist[-1]) else None
        return LearnedRhythm(typical_day=typical, samples=len(kept), ignored=len(recent) - len(kept), anchor=anchor, backfilled_on=backfilled_on)
    if len(recent) >= 3:
        gaps = [(b - a).days for a, b in zip(recent, recent[1:]) if (b - a).days > 0]
        ok = sorted(g for g in gaps if 0.6 * period_days <= g <= 1.4 * period_days)
        if ok:
            return LearnedRhythm(learned_gap=ok[len(ok) // 2], samples=len(ok), ignored=len(gaps) - len(ok))
    return LearnedRhythm(samples=0)


def _next_after(d: date, period_days: int, rhythm: LearnedRhythm) -> date:
    """在日期 d 之后的下一期: 有学到的节奏就按节奏, 否则退回设定周期。月度类:
    - d 是漏记后的补记(_learn 判定) → 它代表的是上一期, 下一期 = d 之后第一个典型日;
    - d 离最近的典型日在 OUTLIER_DAYS 内(准时 / 晚几天 / 早几天, 含跨月) → 本期已记, 下一期 = 那个典型日 + 一个周期;
    - d 离典型日很远但不是补记 → 扣款日变了, 从 d 本身往后推一个周期。
    与 _learn 用同一个阈值, 同一笔记录不会学习时算正常、预测时算补记。"""
    months = _period_months(period_days)
    if months is None:
        return d + timedelta(days=rhythm.learned_gap or period_days)
    if rhythm.typical_day is None:
        return _add_months(d, months)
    nominal = _nearest_grid(d, rhythm.typical_day, months, rhythm.anchor)
    if rhythm.backfilled_on == d:
        while nominal <= d:
            base = _add_months(nominal.replace(day=1), months)
            nominal = _grid_date(base.year, base.month, rhythm.typical_day)
        return nominal
    if abs((nominal - d).days) <= OUTLIER_DAYS:
        base = _add_months(nominal.replace(day=1), months)
        return _grid_date(base.year, base.month, rhythm.typical_day)
    return _add_months(d, months)


class RecurringGroup(BaseModel):
    group_id: str | None
    representative_id: int
    name: str
    category_id: int | None
    category_name: str
    category_emoji: str
    wallet_id: int
    wallet_name: str
    currency_code: str
    period_days: int | None
    count: int
    total_amount: int
    avg_amount: int
    last_amount: int
    last_on: date
    next_due: date | None


class SplitParticipantInfo(BaseModel):
    contact_id: int
    share: int


class SplitTemplate(BaseModel):
    """最近一期是分摊记的(如房租我付全款、室友分摊一半): 确认下一期按同样的总额/我的份额/各人份额预填。
    审计 #29: 此前预测只认支出腿(我的份额), 确认时得手动改回总额再重新勾分摊填份额。"""
    total: int
    my_share: int
    participants: list[SplitParticipantInfo]


class ForecastItem(BaseModel):
    transaction: TransactionRead
    due: date          # confirmed=本期实际扣款日, due/predicted=预测扣款日
    status: str        # "confirmed" 已确认 | "due" 过期待确认 | "predicted" 未来预测
    overdue_periods: int = 0          # due 时: 到今天为止累计漏了几期(>1 说明连续多期没确认)
    rhythm: LearnedRhythm = LearnedRhythm()
    split: SplitTemplate | None = None  # 上一期若是分摊组的支出腿, 带上分摊模板
    merged_segments: int = 1   # 这条账单由几段序列串成(>1 = 换过付款方式 / 中途用"添加"另起过一组)


@router.get("/upcoming", response_model=list[ForecastItem])
async def upcoming(
    days: int = Query(31, ge=0, le=3660),   # 默认一个完整月, 月度账单每个都能看到下一期; 审计 #116: 上界防 today+timedelta 越过 9999 年 OverflowError
    back: int = Query(7, ge=0, le=3660),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """周期账单预测窗口 [今天-back, 今天+days], 每个账单可能给出两类条目:
      - confirmed: 最近一期真实扣款已记录(occurred_on 落在回看窗口内) -> 绿色已确认
      - due/predicted: 下一期预测扣款日, 过期未记 = due(待确认), 未来 = predicted
    这样点了"确认扣款"后, 该期从 due 变成 confirmed 留在原地, 而不是消失."""
    # 不能在 SQL 里按 recurrence_period_days IS NOT NULL 过滤: "停用"是把组内最新一笔的周期清空,
    # 若在分组前就把它滤掉, 组里前一笔会顶上来继续预测, 停用形同虚设。先收齐整组, 再看最新一笔。
    rows = (
        await session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.is_recurring == True,  # noqa: E712
            )
        )
    ).scalars().all()

    today = date.today()
    horizon = today + timedelta(days=days)
    floor = today - timedelta(days=back)
    # 每个账单一条线(跨 recurrence_group 串接, 见 _build_threads); 自学习要用历史各期的实际扣款日
    threads = _build_threads(list(rows))
    # 分摊模板: 最新一期若是分摊组的支出腿, 把同组的借出腿(各参与人份额)一次查出来
    split_ids = {th.txs[-1].split_group_id for th in threads if th.txs[-1].split_group_id}
    legs_by_group: dict[str, list[Transaction]] = {}
    if split_ids:
        for r in (await session.execute(select(Transaction).where(
            Transaction.user_id == user.id,
            Transaction.split_group_id.in_(split_ids),
            Transaction.kind == "loan_out",
        ))).scalars().all():
            legs_by_group.setdefault(r.split_group_id, []).append(r)

    items: list[ForecastItem] = []
    for th in threads:
        txs = th.txs
        latest = txs[-1]
        if not latest.recurrence_period_days or latest.recurrence_period_days <= 0:
            continue  # 最新一笔周期被清空 = 已停用(历史仍保留"周期"标记供月度面板用); <=0 的脏数据同样当停用
        if not 1900 <= latest.occurred_on.year <= 2999:
            continue  # 手误年份的记录不预测(否则 _add_months 越界让整页 500)
        period = latest.recurrence_period_days
        rhythm = _learn([x.occurred_on for x in txs], period)
        split: SplitTemplate | None = None
        legs = legs_by_group.get(latest.split_group_id or "", [])
        if latest.kind == "expense" and legs:
            split = SplitTemplate(
                total=latest.amount + sum(l.amount for l in legs), my_share=latest.amount,
                participants=[SplitParticipantInfo(contact_id=l.contact_id, share=l.amount) for l in legs if l.contact_id is not None],
            )
        # 本期已记录的真实扣款 (最新一笔落在回看窗内)
        if floor <= latest.occurred_on <= today:
            items.append(ForecastItem(transaction=latest, due=latest.occurred_on, status="confirmed", rhythm=rhythm, split=split, merged_segments=th.segments))
        next_due = _next_after(latest.occurred_on, period, rhythm)
        if next_due <= today:
            # 已过期: 不管过期多久都要露出来(此前落到回看窗之前就静默消失, 33/56 组因此不见了),
            # 显示最早漏掉的那期, 并数一数到今天累计漏了几期
            overdue, probe = 1, next_due
            while overdue < 240:
                nxt = _next_after(probe, period, rhythm)
                if nxt >= today:
                    break  # 今天才到期的那期不算"已漏"
                overdue, probe = overdue + 1, nxt
            items.append(ForecastItem(transaction=latest, due=next_due, status="due", overdue_periods=overdue, rhythm=rhythm, split=split, merged_segments=th.segments))
        elif next_due <= horizon:
            items.append(ForecastItem(transaction=latest, due=next_due, status="predicted", rhythm=rhythm, split=split, merged_segments=th.segments))
    items.sort(key=lambda x: x.due)
    return items


@router.post("/stop/{tid}", status_code=status.HTTP_204_NO_CONTENT)
async def stop_recurring(
    tid: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """停用一个周期账单: 清掉该组最新一笔的周期天数 → 不再预测/提醒; is_recurring 保留, 历史仍算周期账单。
    重新启用 = 编辑该笔重新选周期。"""
    t = await session.get(Transaction, tid)
    if not t or t.user_id != user.id or not t.is_recurring:
        raise HTTPException(404, "recurring transaction not found")
    if t.recurrence_group_id:
        latest = (await session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id, Transaction.recurrence_group_id == t.recurrence_group_id,
                Transaction.is_recurring == True,  # noqa: E712  与 upcoming 同口径, 组里最新一笔若已取消周期标记不算
            ).order_by(Transaction.occurred_on.desc(), Transaction.id.desc()).limit(1)
        )).scalar_one()
    else:
        latest = t
    latest.recurrence_period_days = None
    t.recurrence_period_days = None  # 前端传的本就是线上最新一笔, 一并清掉, 保证停用生效
    await session.commit()


async def resolve_recurrence_group(session: AsyncSession, user: User, source_id: int | None) -> str | None:
    """确认周期账单本期扣款时, 让新账单并入来源账单的 recurrence_group ——
    来源原本是单条没分组的, 就顺手给它补一个 group, 这样预测永远以最新一条为准,
    过期那条不再反复出现. 返回 group_id (无来源/来源非法则 None)."""
    if source_id is None:
        return None
    src = (
        await session.execute(
            select(Transaction).where(
                Transaction.id == source_id,
                Transaction.user_id == user.id,
                Transaction.is_recurring == True,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if src is None:
        return None
    if src.recurrence_group_id is None:
        src.recurrence_group_id = str(uuid.uuid4())
        await session.flush()
    return src.recurrence_group_id


@router.get("/groups", response_model=list[RecurringGroup])
async def list_groups(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (
        await session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.is_recurring == True,  # noqa: E712
            )
        )
    ).scalars().all()

    wallets = {w.id: w for w in (await session.execute(select(Wallet).where(Wallet.user_id == user.id))).scalars().all()}
    cats = {c.id: c for c in (await session.execute(select(Category).where(Category.user_id == user.id))).scalars().all()}

    out: list[RecurringGroup] = []
    today = date.today()
    for th in _build_threads(list(rows)):  # 与预测同一套"每个账单一条线"
        txs = th.txs
        latest = txs[-1]
        wallet = wallets.get(latest.wallet_id)
        cat = cats.get(latest.category_id) if latest.category_id else None
        period = latest.recurrence_period_days
        next_due = _next_after(latest.occurred_on, period, _learn([x.occurred_on for x in txs], period)) if period and period > 0 and 1900 <= latest.occurred_on.year <= 2999 else None
        name = (latest.note or (cat.name if cat else None)) or "未命名周期账单"
        total = sum(t.amount for t in txs)
        avg = total // max(1, len(txs))
        out.append(RecurringGroup(
            group_id=latest.recurrence_group_id,
            representative_id=latest.id,
            name=name,
            category_id=latest.category_id,
            category_name=cat.name if cat else "未分类",
            category_emoji=cat.emoji if cat else "",
            wallet_id=latest.wallet_id,
            wallet_name=wallet.name if wallet else "?",
            currency_code=latest.currency_code,
            period_days=period,
            count=len(txs),
            total_amount=total,
            avg_amount=avg,
            last_amount=latest.amount,
            last_on=latest.occurred_on,
            next_due=next_due,
        ))
    out.sort(key=lambda g: (g.next_due is None, g.next_due or today, g.name))
    return out


class MonthlyRecurringItem(BaseModel):
    transaction_id: int
    occurred_on: date
    name: str
    category_id: int | None
    category_name: str
    category_emoji: str
    merchant_id: int | None = None
    merchant_name: str = ""
    note: str = ""
    wallet_id: int
    wallet_name: str
    currency_code: str
    amount: int
    frequency: str  # "monthly" | "yearly" | "other"


class MonthlyRecurringResponse(BaseModel):
    month: str
    monthly_items: list[MonthlyRecurringItem]
    yearly_items: list[MonthlyRecurringItem]
    monthly_totals: dict[str, int]
    yearly_totals: dict[str, int]


@router.get("/by-month", response_model=MonthlyRecurringResponse)
async def by_month(
    month: str | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = date.today()
    anchor = parse_month(month, today)  # 审计 #106
    m_start = anchor.replace(day=1)
    m_end = date(anchor.year + 1, 1, 1) if anchor.month == 12 else date(anchor.year, anchor.month + 1, 1)
    y_start = date(anchor.year, 1, 1)
    y_end = date(anchor.year + 1, 1, 1)

    rows = (
        await session.execute(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.is_recurring == True,  # noqa: E712
                Transaction.kind == "expense",
                Transaction.occurred_on >= y_start,
                Transaction.occurred_on < y_end,
            )
        )
    ).scalars().all()

    wallets = {w.id: w for w in (await session.execute(select(Wallet).where(Wallet.user_id == user.id))).scalars().all()}
    cats = {c.id: c for c in (await session.execute(select(Category).where(Category.user_id == user.id))).scalars().all()}
    merchants_map = {m.id: m for m in (await session.execute(select(Merchant).where(Merchant.user_id == user.id))).scalars().all()}

    monthly: list[MonthlyRecurringItem] = []
    yearly: list[MonthlyRecurringItem] = []
    m_tot: dict[str, int] = {}
    y_tot: dict[str, int] = {}

    for t in rows:
        wallet = wallets.get(t.wallet_id)
        cat = cats.get(t.category_id) if t.category_id else None
        merchant = merchants_map.get(t.merchant_id) if t.merchant_id else None
        freq = _frequency_label(t.recurrence_period_days)  # 审计: 与预测同一套容差(此前 ==365/==30 硬比较)
        is_yearly = freq == "yearly"
        item = MonthlyRecurringItem(
            transaction_id=t.id,
            occurred_on=t.occurred_on,
            name=(merchant.name if merchant else None) or t.note or (cat.name if cat else None) or "未命名",
            category_id=t.category_id,
            category_name=cat.name if cat else "未分类",
            category_emoji=cat.emoji if cat else "",
            merchant_id=t.merchant_id,
            merchant_name=merchant.name if merchant else "",
            note=t.note or "",
            wallet_id=t.wallet_id,
            wallet_name=wallet.name if wallet else "?",
            currency_code=t.currency_code,
            amount=t.amount,
            frequency=freq,
        )
        if is_yearly:
            yearly.append(item)
            y_tot[t.currency_code] = y_tot.get(t.currency_code, 0) + t.amount
        elif m_start <= t.occurred_on < m_end:
            monthly.append(item)
            m_tot[t.currency_code] = m_tot.get(t.currency_code, 0) + t.amount

    monthly.sort(key=lambda x: x.occurred_on)
    yearly.sort(key=lambda x: x.occurred_on)

    return MonthlyRecurringResponse(
        month=m_start.strftime("%Y-%m"),
        monthly_items=monthly,
        yearly_items=yearly,
        monthly_totals=m_tot,
        yearly_totals=y_tot,
    )
