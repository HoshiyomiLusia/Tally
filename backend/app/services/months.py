import re
from datetime import date

from fastapi import HTTPException

_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


def parse_month(month: str | None, default: date | None = None) -> date:
    """把查询参数 YYYY-MM 解析为该月 1 号; 空则用 default(默认今天)所在月.
    审计 #106: 此前各路由直接 date.fromisoformat(month + "-01"), 非法值抛 ValueError → 500;
    9999-12 还会在推算下月时 year 越界. 这里统一 400, 并把年份限制在 1900..2999."""
    if not month:
        return (default or date.today()).replace(day=1)
    m = _MONTH_RE.match(month.strip())
    if not m or not (1900 <= int(m.group(1)) <= 2999):
        raise HTTPException(400, "month 须为 YYYY-MM(1900-2999)")
    return date(int(m.group(1)), int(m.group(2)), 1)
