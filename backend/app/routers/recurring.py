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


def _next_due(d: date, period_days: int) -> date:
    """按周期推进下次扣款日。月度(≈30)/季度(≈90)/半年(≈180)/年度(≈365)按自然月/年推进,
    不把"月"当固定天数, 否则每逢长短月就使预测日跨月漂移、连带"确认扣款"落库到错误自然月
    (审计 #75)。周/两周/自定义天数按字面天数(它们本就是精确天数)。"""
    if 28 <= period_days <= 31:
        return _add_months(d, 1)
    if 88 <= period_days <= 92:
        return _add_months(d, 3)
    if 175 <= period_days <= 185:
        return _add_months(d, 6)
    if 360 <= period_days <= 366:
        return _add_months(d, 12)
    return d + timedelta(days=period_days)


def _period_months(period_days: int) -> int | None:
    """月度类周期对应的自然月数; 固定天数类返回 None。与 _next_due 同一套容差。"""
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


def _learn(history: list[date], period_days: int) -> LearnedRhythm:
    """自学习: 用最近 6 期的真实扣款日推典型节奏。
    - 月度/季度/半年/年度: 取"每月几号"的中位数 —— 某期晚记了几天不会把后面的预测整体带偏,
      订阅换了扣款日则中位数在 3 期内跟上。
    - 固定天数(周/两周/自定义): 取相邻间隔的中位数, 只在 [0.5x, 2x] 设定值内采纳(防补记造成离谱间隔)。"""
    recent = sorted(history)[-6:]
    months = _period_months(period_days)
    if months is not None:
        if len(recent) >= 2:
            days = sorted(d.day for d in recent)
            return LearnedRhythm(typical_day=days[len(days) // 2], samples=len(recent))
        return LearnedRhythm(samples=len(recent))
    if len(recent) >= 3:
        gaps = sorted((b - a).days for a, b in zip(recent, recent[1:]) if (b - a).days > 0)
        if gaps:
            g = gaps[len(gaps) // 2]
            if 0.5 * period_days <= g <= 2 * period_days:
                return LearnedRhythm(learned_gap=g, samples=len(gaps))
    return LearnedRhythm(samples=0)


def _next_after(d: date, period_days: int, rhythm: LearnedRhythm) -> date:
    """在日期 d 之后的下一期: 有学到的节奏就按节奏, 否则退回设定周期。"""
    months = _period_months(period_days)
    if months is not None:
        if rhythm.typical_day is None:
            return _add_months(d, months)
        base = _add_months(d.replace(day=1), months)
        nxt = date(base.year, base.month, min(rhythm.typical_day, calendar.monthrange(base.year, base.month)[1]))
        if nxt <= d:  # d 本身晚于典型日(补记)时再推一期, 保证严格向后
            nxt = _add_months(nxt, months)
        return nxt
    return d + timedelta(days=rhythm.learned_gap or period_days)


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


class ForecastItem(BaseModel):
    transaction: TransactionRead
    due: date          # confirmed=本期实际扣款日, due/predicted=预测扣款日
    status: str        # "confirmed" 已确认 | "due" 过期待确认 | "predicted" 未来预测
    overdue_periods: int = 0          # due 时: 到今天为止累计漏了几期(>1 说明连续多期没确认)
    rhythm: LearnedRhythm = LearnedRhythm()


@router.get("/upcoming", response_model=list[ForecastItem])
async def upcoming(
    days: int = Query(14, ge=0, le=3660),   # 审计 #116: 上界防 today+timedelta 越过 9999 年 OverflowError
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
    # 按组收齐全部历史(不只最新一笔): 自学习要用历史各期的实际扣款日
    groups: dict[tuple[str | None, int | None], list[Transaction]] = {}
    for t in rows:
        key = (t.recurrence_group_id, t.id if t.recurrence_group_id is None else None)
        groups.setdefault(key, []).append(t)

    items: list[ForecastItem] = []
    for txs in groups.values():
        txs.sort(key=lambda x: (x.occurred_on, x.id))
        latest = txs[-1]
        if not latest.recurrence_period_days:
            continue  # 最新一笔周期被清空 = 已停用(历史仍保留"周期"标记供月度面板用)
        period = latest.recurrence_period_days
        rhythm = _learn([x.occurred_on for x in txs], period)
        # 本期已记录的真实扣款 (最新一笔落在回看窗内)
        if floor <= latest.occurred_on <= today:
            items.append(ForecastItem(transaction=latest, due=latest.occurred_on, status="confirmed", rhythm=rhythm))
        next_due = _next_after(latest.occurred_on, period, rhythm)
        if next_due <= today:
            # 已过期: 不管过期多久都要露出来(此前落到回看窗之前就静默消失, 33/56 组因此不见了),
            # 显示最早漏掉的那期, 并数一数到今天累计漏了几期
            overdue, probe = 1, next_due
            while overdue < 240:
                nxt = _next_after(probe, period, rhythm)
                if nxt > today:
                    break
                overdue, probe = overdue + 1, nxt
            items.append(ForecastItem(transaction=latest, due=next_due, status="due", overdue_periods=overdue, rhythm=rhythm))
        elif next_due <= horizon:
            items.append(ForecastItem(transaction=latest, due=next_due, status="predicted", rhythm=rhythm))
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
            ).order_by(Transaction.occurred_on.desc(), Transaction.id.desc()).limit(1)
        )).scalar_one()
    else:
        latest = t
    latest.recurrence_period_days = None
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

    bucket: dict[tuple, list[Transaction]] = {}
    for t in rows:
        key = (t.recurrence_group_id, None) if t.recurrence_group_id else ("__single__", t.id)
        bucket.setdefault(key, []).append(t)

    out: list[RecurringGroup] = []
    today = date.today()
    for key, txs in bucket.items():
        txs.sort(key=lambda x: x.occurred_on)
        latest = txs[-1]
        wallet = wallets.get(latest.wallet_id)
        cat = cats.get(latest.category_id) if latest.category_id else None
        period = latest.recurrence_period_days
        next_due = _next_after(latest.occurred_on, period, _learn([x.occurred_on for x in txs], period)) if period else None
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
