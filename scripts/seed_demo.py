"""建一个演示账号 demo / demo1234, 灌一批好看的样例数据 (仅用于 README 截图).
幂等: 已存在就先清掉它的钱包/交易/联系人再重灌. 不动其它账号.

Run:
    docker compose exec app python seed_demo.py
"""
import asyncio
from datetime import date

from sqlalchemy import delete, select

from app.core.auth import create_access_token, hash_password
from app.core.db import SessionLocal
from app.models import Category, Contact, Transaction, User, Wallet
from app.services.seed import seed_user_defaults

DEMO_USER = "demo"
DEMO_PASS = "demo1234"

# (name, type, currency, color, credit_limit, initial_balance —— 后两个是显示单位)
WALLETS = [
    ("三井住友銀行", "bank", "JPY", "#0f7d3a", None, 0),
    ("三菱UFJ銀行", "bank", "JPY", "#a8051c", None, 120000),
    ("楽天カード", "credit_card", "JPY", "#bf0000", 300000, 0),
    ("メルカード", "credit_card", "JPY", "#ff0211", 100000, 0),
    ("Suica", "e_wallet", "JPY", "#1c8456", None, 5000),
    ("PayPay", "e_wallet", "JPY", "#ff0035", None, 3000),
    ("现金", "cash", "JPY", "#5f6068", None, 10000),
    ("招商银行", "bank", "CNY", "#c8102e", None, 5000),
    ("微信钱包", "e_wallet", "CNY", "#07c160", None, 2000),
]

# (date, kind, category 名(None=借出), wallet, 显示金额, note, recurrence_period_days)
TXNS = [
    (date(2026, 6, 10), "income", "工资", "三井住友銀行", 280000, "6月工资", None),
    (date(2026, 6, 3), "income", "奖学金", "三井住友銀行", 50000, "", None),
    (date(2026, 6, 12), "expense", "外卖", "Suica", 1200, "Uber Eats", None),
    (date(2026, 6, 12), "expense", "电车地铁", "Suica", 320, "", None),
    (date(2026, 6, 12), "expense", "自动贩卖机", "现金", 160, "", None),
    (date(2026, 6, 11), "expense", "线下餐饮", "现金", 3500, "拉面", None),
    (date(2026, 6, 10), "expense", "便利店", "Suica", 680, "", None),
    (date(2026, 6, 9), "expense", "超市", "三井住友銀行", 4280, "一周食材", None),
    (date(2026, 6, 8), "expense", "线下餐饮", "楽天カード", 720, "咖啡", None),
    (date(2026, 6, 7), "expense", "数码电器", "楽天カード", 45800, "机械键盘", None),
    (date(2026, 6, 5), "expense", "服装鞋帽", "楽天カード", 12800, "", None),
    (date(2026, 5, 15), "expense", "会员订阅", "楽天カード", 1580, "Netflix", 30),
    (date(2026, 6, 9), "expense", "会员订阅", "楽天カード", 980, "Spotify", 30),
    (date(2026, 6, 10), "expense", "外卖", "微信钱包", 35, "美团", None),
    (date(2026, 6, 8), "expense", "生活用品", "微信钱包", 88, "日用百货", None),
    (date(2026, 6, 6), "loan_out", None, "三井住友銀行", 30000, "上次吃饭垫付", None),
]

DIGITS = {"JPY": 0, "CNY": 2}


async def main() -> None:
    async with SessionLocal() as s:
        user = (await s.execute(select(User).where(User.username == DEMO_USER))).scalar_one_or_none()
        if user is None:
            user = User(username=DEMO_USER, hashed_password=hash_password(DEMO_PASS), primary_currency_code="JPY")
            s.add(user)
            await s.flush()
        else:
            user.primary_currency_code = "JPY"
            await s.execute(delete(Transaction).where(Transaction.user_id == user.id))
            await s.execute(delete(Wallet).where(Wallet.user_id == user.id))
            await s.execute(delete(Contact).where(Contact.user_id == user.id))
        uid = user.id
        await s.commit()

        await seed_user_defaults(s, uid)

        contact = Contact(user_id=uid, name="小明", color="#1677ff")
        s.add(contact)
        wmap: dict[str, Wallet] = {}
        for name, typ, cur, color, limit, initial in WALLETS:
            w = Wallet(
                user_id=uid, name=name, type=typ, currency_code=cur, color=color,
                initial_balance=initial * 10 ** DIGITS[cur],
                credit_limit=(limit * 10 ** DIGITS[cur]) if limit is not None else None,
            )
            s.add(w)
            wmap[name] = w
        await s.flush()

        cats = {(c.name, c.kind): c for c in (await s.execute(select(Category).where(Category.user_id == uid))).scalars().all()}
        for d, kind, cat_name, wname, amt, note, period in TXNS:
            w = wmap[wname]
            digits = DIGITS[w.currency_code]
            cat = None
            if cat_name is not None:
                cat = cats.get((cat_name, "income" if kind == "income" else "expense"))
            t = Transaction(
                user_id=uid, wallet_id=w.id,
                category_id=cat.id if cat else None,
                contact_id=contact.id if kind == "loan_out" else None,
                amount=amt * 10 ** digits, currency_code=w.currency_code,
                kind=kind, occurred_on=d, note=note,
                is_recurring=period is not None, recurrence_period_days=period,
            )
            s.add(t)
        await s.commit()

        print(f"demo user id={uid}; token below for screenshots:")
        print(create_access_token(uid))


if __name__ == "__main__":
    asyncio.run(main())
