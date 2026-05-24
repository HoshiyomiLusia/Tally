"""Seed mock data for a given user.

Usage (inside container):
    python -m scripts.seed_demo <username>

Idempotent on detection: if user already has wallets, it skips creation and
only adds transactions, so re-runs only pile up more transactions.
"""
import asyncio
import random
import sys
import uuid
from datetime import date, timedelta

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import Category, Contact, Transaction, User, Wallet
from app.services.seed import seed_user_defaults


WALLETS = [
    {"name": "三井住友銀行", "type": "bank", "currency_code": "JPY", "initial_balance": 800_000, "color": "#0f7d3a"},
    {"name": "Suica", "type": "e_wallet", "currency_code": "JPY", "initial_balance": 8_000, "color": "#1c8456"},
    {"name": "現金 JPY", "type": "cash", "currency_code": "JPY", "initial_balance": 30_000, "color": "#5f6068"},
    {"name": "楽天カード", "type": "credit_card", "currency_code": "JPY", "initial_balance": 0, "color": "#bf0000"},
    {"name": "招商银行", "type": "bank", "currency_code": "CNY", "initial_balance": 250_000, "color": "#c8102e"},
    {"name": "微信钱包", "type": "e_wallet", "currency_code": "CNY", "initial_balance": 80_000, "color": "#07c160"},
]

CONTACTS = [
    {"name": "Alice", "color": "#3b82f6", "note": "室友"},
    {"name": "Bob",   "color": "#22c55e", "note": "同事"},
    {"name": "小张",  "color": "#f97316", "note": "国内朋友"},
]


def jpy(yen: int) -> int:
    return yen


def cny(yuan: float) -> int:
    return int(round(yuan * 100))


async def get_or_create_wallets(session, user_id):
    existing = (await session.execute(select(Wallet).where(Wallet.user_id == user_id))).scalars().all()
    if existing:
        return {w.name: w for w in existing}
    out = {}
    for spec in WALLETS:
        w = Wallet(user_id=user_id, **spec)
        session.add(w)
        await session.flush()
        out[w.name] = w
    return out


async def get_or_create_contacts(session, user_id):
    existing = (await session.execute(select(Contact).where(Contact.user_id == user_id))).scalars().all()
    have = {c.name: c for c in existing}
    out = dict(have)
    for spec in CONTACTS:
        if spec["name"] in have:
            continue
        c = Contact(user_id=user_id, **spec)
        session.add(c)
        await session.flush()
        out[c.name] = c
    return out


async def cat_map(session, user_id):
    rows = (await session.execute(select(Category).where(Category.user_id == user_id))).scalars().all()
    return {c.name: c.id for c in rows}


def days_ago(n):
    return date.today() - timedelta(days=n)


async def seed_for(username: str):
    async with SessionLocal() as session:
        user = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
        if not user:
            print(f"user '{username}' not found")
            sys.exit(1)

        existing_cats = (await session.execute(select(Category).where(Category.user_id == user.id))).scalars().first()
        if not existing_cats:
            await seed_user_defaults(session, user.id)

        wallets = await get_or_create_wallets(session, user.id)
        contacts = await get_or_create_contacts(session, user.id)
        cats = await cat_map(session, user.id)
        await session.commit()

        smbc = wallets["三井住友銀行"]
        suica = wallets["Suica"]
        cash_jpy = wallets["現金 JPY"]
        rakuten = wallets["楽天カード"]
        cmb = wallets["招商银行"]
        wechat = wallets["微信钱包"]
        alice = contacts["Alice"]
        bob = contacts["Bob"]
        xiaozhang = contacts["小张"]

        new_tx = []

        def tx(**kw):
            t = Transaction(user_id=user.id, **kw)
            new_tx.append(t)
            session.add(t)
            return t

        rng = random.Random(42)

        # ── 月度固定（周期账单 + 分摊房租）──
        for months_ago, occurred in [(2, days_ago(60)), (1, days_ago(30)), (0, days_ago(2))]:
            group_id = str(uuid.uuid4())
            rec_group = "rent-rec-group"
            tx(wallet_id=smbc.id, category_id=cats.get("房租"), amount=jpy(45000),
               currency_code="JPY", kind="expense", occurred_on=occurred,
               note="月房租 (我那半)", split_group_id=group_id,
               is_recurring=True, recurrence_period_days=30, recurrence_group_id=rec_group)
            tx(wallet_id=smbc.id, category_id=cats.get("房租"), amount=jpy(45000),
               currency_code="JPY", kind="loan_out", occurred_on=occurred,
               contact_id=alice.id, note="月房租 (Alice 那半)", split_group_id=group_id)

        # Alice 上月房租已还
        tx(wallet_id=smbc.id, contact_id=alice.id, amount=jpy(45000),
           currency_code="JPY", kind="loan_repayment", occurred_on=days_ago(25),
           note="Alice 还房租")

        # 月度订阅
        sub_group_chatgpt = "chatgpt-rec"
        for occ in [days_ago(58), days_ago(28)]:
            tx(wallet_id=rakuten.id, category_id=cats.get("AI 服务"), amount=jpy(3500),
               currency_code="JPY", kind="expense", occurred_on=occ, note="ChatGPT Plus",
               is_recurring=True, recurrence_period_days=30, recurrence_group_id=sub_group_chatgpt)
        sub_group_claude = "claude-rec"
        for occ in [days_ago(55), days_ago(25)]:
            tx(wallet_id=rakuten.id, category_id=cats.get("AI 服务"), amount=jpy(3280),
               currency_code="JPY", kind="expense", occurred_on=occ, note="Claude Pro",
               is_recurring=True, recurrence_period_days=30, recurrence_group_id=sub_group_claude)
        sub_group_icloud = "icloud-rec"
        for occ in [days_ago(50), days_ago(20)]:
            tx(wallet_id=rakuten.id, category_id=cats.get("云盘软件"), amount=jpy(1300),
               currency_code="JPY", kind="expense", occurred_on=occ, note="iCloud 200GB",
               is_recurring=True, recurrence_period_days=30, recurrence_group_id=sub_group_icloud)
        sub_group_netflix = "netflix-rec"
        for occ in [days_ago(45), days_ago(15)]:
            tx(wallet_id=rakuten.id, category_id=cats.get("流媒体"), amount=jpy(1980),
               currency_code="JPY", kind="expense", occurred_on=occ, note="Netflix Standard",
               is_recurring=True, recurrence_period_days=30, recurrence_group_id=sub_group_netflix)

        # 水电
        for occ in [days_ago(52), days_ago(22)]:
            tx(wallet_id=smbc.id, category_id=cats.get("水电煤"), amount=jpy(5500 + rng.randint(-800, 800)),
               currency_code="JPY", kind="expense", occurred_on=occ, note="東京電力",
               is_recurring=True, recurrence_period_days=30, recurrence_group_id="elec-rec")
        for occ in [days_ago(48), days_ago(18)]:
            tx(wallet_id=smbc.id, category_id=cats.get("网费通信"), amount=jpy(4400),
               currency_code="JPY", kind="expense", occurred_on=occ, note="ドコモ",
               is_recurring=True, recurrence_period_days=30, recurrence_group_id="docomo-rec")

        # ── 工资 ──
        for occ in [days_ago(45), days_ago(15)]:
            tx(wallet_id=smbc.id, category_id=cats.get("工资"), amount=jpy(280000),
               currency_code="JPY", kind="income", occurred_on=occ, note="月工资")

        # ── 餐饮 (JPY) ──
        meals_jpy = [
            ("吉野家",       "门店堂食", 580),
            ("松屋",         "门店堂食", 650),
            ("すき家",       "门店堂食", 700),
            ("CoCo壱番屋",   "门店堂食", 1080),
            ("一蘭",         "门店堂食", 980),
            ("McDonald's Japan", "门店堂食", 750),
            ("スターバックス", "咖啡饮品", 540),
            ("ドトール",     "咖啡饮品", 420),
            ("コメダ珈琲",   "咖啡饮品", 650),
            ("サイゼリヤ",   "门店堂食", 1450),
            ("ガスト",       "门店堂食", 1280),
            ("スシロー",     "门店堂食", 1680),
            ("Life",         "超市食材", 2380),
            ("OK",           "超市食材", 1950),
            ("業務スーパー", "超市食材", 1280),
            ("7-11 Japan",   "零食便利店", 480),
            ("FamilyMart",   "零食便利店", 380),
            ("Lawson",       "零食便利店", 520),
        ]
        for i, (merchant, cat_name, base) in enumerate(meals_jpy):
            wallet_pick = rng.choice([cash_jpy, suica, rakuten])
            amt = base + rng.randint(-100, 200)
            tx(wallet_id=wallet_pick.id, category_id=cats.get(cat_name), amount=jpy(amt),
               currency_code="JPY", kind="expense",
               occurred_on=days_ago(rng.randint(1, 55)),
               note=merchant)

        # ── 交通 (JPY) ──
        for i in range(6):
            tx(wallet_id=suica.id, category_id=cats.get("电车地铁"),
               amount=jpy(rng.choice([170, 200, 230, 280, 380])),
               currency_code="JPY", kind="expense",
               occurred_on=days_ago(rng.randint(1, 50)), note="电车")
        tx(wallet_id=suica.id, category_id=cats.get("电车地铁"), amount=jpy(5000),
           currency_code="JPY", kind="income", occurred_on=days_ago(10), note="Suica チャージ")

        # ── 购物 (JPY) ──
        tx(wallet_id=rakuten.id, category_id=cats.get("Amazon"), amount=jpy(3580),
           currency_code="JPY", kind="expense", occurred_on=days_ago(8), note="Amazon JP: 充电线")
        tx(wallet_id=rakuten.id, category_id=cats.get("服装鞋帽"), amount=jpy(4990),
           currency_code="JPY", kind="expense", occurred_on=days_ago(14), note="UNIQLO 春装")
        tx(wallet_id=rakuten.id, category_id=cats.get("数码电器"), amount=jpy(12800),
           currency_code="JPY", kind="expense", occurred_on=days_ago(20), note="ヨドバシ: 键盘")
        tx(wallet_id=cash_jpy.id, category_id=cats.get("生活用品"), amount=jpy(880),
           currency_code="JPY", kind="expense", occurred_on=days_ago(5), note="ダイソー")

        # ── 分摊烤肉聚餐 (与 Bob) ──
        bbq_group = str(uuid.uuid4())
        tx(wallet_id=rakuten.id, category_id=cats.get("门店堂食"), amount=jpy(4000),
           currency_code="JPY", kind="expense", occurred_on=days_ago(7),
           note="烤肉聚餐 (我那份)", split_group_id=bbq_group)
        tx(wallet_id=rakuten.id, category_id=cats.get("门店堂食"), amount=jpy(4000),
           currency_code="JPY", kind="loan_out", occurred_on=days_ago(7),
           contact_id=bob.id, note="烤肉聚餐 (Bob 那份)", split_group_id=bbq_group)
        tx(wallet_id=rakuten.id, category_id=cats.get("门店堂食"), amount=jpy(4000),
           currency_code="JPY", kind="loan_out", occurred_on=days_ago(7),
           contact_id=alice.id, note="烤肉聚餐 (Alice 那份)", split_group_id=bbq_group)
        # Bob 已还
        tx(wallet_id=suica.id, contact_id=bob.id, amount=jpy(4000),
           currency_code="JPY", kind="loan_repayment", occurred_on=days_ago(4), note="Bob 还烤肉")

        # ── 娱乐 ──
        tx(wallet_id=rakuten.id, category_id=cats.get("电影演出"), amount=jpy(1900),
           currency_code="JPY", kind="expense", occurred_on=days_ago(12), note="电影")
        tx(wallet_id=rakuten.id, category_id=cats.get("游戏充值"), amount=jpy(6800),
           currency_code="JPY", kind="expense", occurred_on=days_ago(35), note="Steam サマーセール")

        # ── 医疗 ──
        tx(wallet_id=cash_jpy.id, category_id=cats.get("看病药品"), amount=jpy(2300),
           currency_code="JPY", kind="expense", occurred_on=days_ago(18), note="感冒")

        # ── 报销 (作为收入) ──
        tx(wallet_id=smbc.id, category_id=cats.get("报销"), amount=jpy(3500),
           currency_code="JPY", kind="income", occurred_on=days_ago(11), note="出差打车报销")

        # ── 中国消费 (CNY) ──
        cny_items = [
            ("淘宝",    "淘宝京东",     99),
            ("淘宝",    "淘宝京东",     258),
            ("京东",    "淘宝京东",     349),
            ("拼多多",  "淘宝京东",     45),
            ("美团",    "外卖",         35.5),
            ("美团",    "外卖",         42),
            ("饿了么",  "外卖",         28),
            ("滴滴",    "共享打车",     28),
            ("滴滴",    "共享打车",     46),
            ("喜茶",    "咖啡饮品",     22),
            ("瑞幸",    "咖啡饮品",     16.9),
            ("蜜雪冰城","咖啡饮品",     6),
            ("盒马",    "超市食材",     186.5),
            ("沃尔玛",  "超市食材",     128),
            ("12306",   "长途",         553),
            ("携程",    "旅行",         480),
        ]
        for merchant, cat_name, yuan in cny_items:
            wallet_pick = rng.choice([cmb, wechat])
            tx(wallet_id=wallet_pick.id, category_id=cats.get(cat_name),
               amount=cny(yuan), currency_code="CNY", kind="expense",
               occurred_on=days_ago(rng.randint(1, 55)), note=merchant)
        # 微信红包
        tx(wallet_id=wechat.id, category_id=cats.get("其他收入"), amount=cny(50),
           currency_code="CNY", kind="income", occurred_on=days_ago(6), note="妈妈红包")

        # ── 一笔 与小张 借出（CNY，尚未还）──
        share_group = str(uuid.uuid4())
        tx(wallet_id=cmb.id, category_id=cats.get("门店堂食"), amount=cny(80),
           currency_code="CNY", kind="expense", occurred_on=days_ago(3),
           note="晚饭 (我)", split_group_id=share_group)
        tx(wallet_id=cmb.id, category_id=cats.get("门店堂食"), amount=cny(80),
           currency_code="CNY", kind="loan_out", occurred_on=days_ago(3),
           contact_id=xiaozhang.id, note="晚饭 (小张)", split_group_id=share_group)

        await session.commit()
        print(f"OK — inserted {len(new_tx)} transactions for user '{username}' (id={user.id})")
        print(f"     wallets: {len(wallets)}, contacts: {len(contacts)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python -m scripts.seed_demo <username>")
        sys.exit(1)
    asyncio.run(seed_for(sys.argv[1]))
