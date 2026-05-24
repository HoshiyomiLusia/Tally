import csv
import io
import json
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.db import get_session
from ..models import Budget, Category, Contact, Merchant, Transaction, User, Wallet

router = APIRouter(tags=["io"])

EXPORT_VERSION = "0.2"


def _default(o):
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    raise TypeError


async def _full_export(session: AsyncSession, user: User) -> dict:
    wallets = (await session.execute(select(Wallet).where(Wallet.user_id == user.id))).scalars().all()
    cats = (await session.execute(select(Category).where(Category.user_id == user.id))).scalars().all()
    merchants = (await session.execute(select(Merchant).where(Merchant.user_id == user.id))).scalars().all()
    contacts = (await session.execute(select(Contact).where(Contact.user_id == user.id))).scalars().all()
    budgets = (await session.execute(select(Budget).where(Budget.user_id == user.id))).scalars().all()
    txs = (await session.execute(select(Transaction).where(Transaction.user_id == user.id))).scalars().all()

    def row(obj, fields):
        return {f: getattr(obj, f) for f in fields}

    return {
        "version": EXPORT_VERSION,
        "exported_at": datetime.utcnow(),
        "user": {"username": user.username},
        "wallets": [row(w, ["id", "name", "type", "currency_code", "initial_balance", "icon", "color", "archived", "sort_order"]) for w in wallets],
        "categories": [row(c, ["id", "parent_id", "name", "kind", "emoji", "color", "sort_order"]) for c in cats],
        "merchants": [row(m, ["id", "name", "default_category_id", "region", "usage_count"]) for m in merchants],
        "contacts": [row(c, ["id", "name", "color", "note", "archived"]) for c in contacts],
        "budgets": [row(b, ["id", "category_id", "currency_code", "period", "amount", "active", "note"]) for b in budgets],
        "transactions": [row(t, [
            "id", "wallet_id", "category_id", "merchant_id", "contact_id", "amount", "currency_code",
            "kind", "occurred_on", "note", "split_group_id", "is_recurring", "recurrence_period_days",
            "recurrence_group_id", "transfer_pair_id",
        ]) for t in txs],
    }


@router.get("/export/json")
async def export_json(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await _full_export(session, user)
    body = json.dumps(data, default=_default, ensure_ascii=False, indent=2)
    return StreamingResponse(
        iter([body]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="tally-{user.username}-{date.today().isoformat()}.json"'},
    )


@router.get("/export/csv")
async def export_csv(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await _full_export(session, user)
    cats = {c["id"]: c["name"] for c in data["categories"]}
    wallets = {w["id"]: w["name"] for w in data["wallets"]}
    merchants = {m["id"]: m["name"] for m in data["merchants"]}
    contacts = {c["id"]: c["name"] for c in data["contacts"]}

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "occurred_on", "kind", "wallet", "category", "merchant", "contact", "amount", "currency", "note"])
    for t in data["transactions"]:
        w.writerow([
            t["id"], t["occurred_on"], t["kind"],
            wallets.get(t["wallet_id"], ""),
            cats.get(t["category_id"], ""),
            merchants.get(t["merchant_id"], ""),
            contacts.get(t["contact_id"], ""),
            t["amount"], t["currency_code"], t["note"],
        ])
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="tally-{user.username}-{date.today().isoformat()}.csv"'},
    )


@router.get("/export/xlsx")
async def export_xlsx(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await _full_export(session, user)
    cats = {c["id"]: c["name"] for c in data["categories"]}
    wallets = {w["id"]: w["name"] for w in data["wallets"]}
    merchants = {m["id"]: m["name"] for m in data["merchants"]}
    contacts = {c["id"]: c["name"] for c in data["contacts"]}

    wb = Workbook()
    ws = wb.active
    ws.title = "Transactions"
    ws.append(["id", "occurred_on", "kind", "wallet", "category", "merchant", "contact", "amount", "currency", "note"])
    for t in data["transactions"]:
        ws.append([
            t["id"], str(t["occurred_on"]), t["kind"],
            wallets.get(t["wallet_id"], ""),
            cats.get(t["category_id"], ""),
            merchants.get(t["merchant_id"], ""),
            contacts.get(t["contact_id"], ""),
            t["amount"], t["currency_code"], t["note"],
        ])

    for sheet_name, rows in (("Wallets", data["wallets"]), ("Categories", data["categories"]),
                              ("Merchants", data["merchants"]), ("Contacts", data["contacts"]),
                              ("Budgets", data["budgets"])):
        s = wb.create_sheet(sheet_name)
        if rows:
            headers = list(rows[0].keys())
            s.append(headers)
            for r in rows:
                s.append([str(r[h]) if r[h] is not None else "" for h in headers])

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return StreamingResponse(
        out,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="tally-{user.username}-{date.today().isoformat()}.xlsx"'},
    )


class ImportRequest(BaseModel):
    data: dict


@router.post("/import/json", status_code=status.HTTP_204_NO_CONTENT)
async def import_json(
    payload: ImportRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    d = payload.data
    if d.get("version") != EXPORT_VERSION:
        raise HTTPException(400, f"version mismatch: expect {EXPORT_VERSION}, got {d.get('version')}")

    for model in (Transaction, Budget, Contact, Merchant, Category, Wallet):
        await session.execute(delete(model).where(model.user_id == user.id))
    await session.flush()

    wallet_map: dict[int, int] = {}
    cat_map: dict[int, int] = {}
    merchant_map: dict[int, int] = {}
    contact_map: dict[int, int] = {}

    for w in d.get("wallets", []):
        obj = Wallet(
            user_id=user.id,
            name=w["name"], type=w["type"], currency_code=w["currency_code"],
            initial_balance=w["initial_balance"], icon=w.get("icon", ""), color=w.get("color", ""),
            archived=w.get("archived", False), sort_order=w.get("sort_order", 0),
        )
        session.add(obj)
        await session.flush()
        wallet_map[w["id"]] = obj.id

    pending_cats = list(d.get("categories", []))
    resolved: set[int] = set()
    iterations = 0
    while pending_cats and iterations < 10:
        next_batch = []
        for c in pending_cats:
            if c.get("parent_id") is None or c["parent_id"] in resolved:
                obj = Category(
                    user_id=user.id,
                    parent_id=cat_map.get(c["parent_id"]) if c.get("parent_id") else None,
                    name=c["name"], kind=c.get("kind", "expense"),
                    emoji=c.get("emoji", ""), color=c.get("color", ""), sort_order=c.get("sort_order", 0),
                )
                session.add(obj)
                await session.flush()
                cat_map[c["id"]] = obj.id
                resolved.add(c["id"])
            else:
                next_batch.append(c)
        pending_cats = next_batch
        iterations += 1

    for m in d.get("merchants", []):
        obj = Merchant(
            user_id=user.id,
            name=m["name"],
            default_category_id=cat_map.get(m["default_category_id"]) if m.get("default_category_id") else None,
            region=m.get("region", ""), usage_count=m.get("usage_count", 0),
        )
        session.add(obj)
        await session.flush()
        merchant_map[m["id"]] = obj.id

    for c in d.get("contacts", []):
        obj = Contact(
            user_id=user.id,
            name=c["name"], color=c.get("color", ""), note=c.get("note", ""),
            archived=c.get("archived", False),
        )
        session.add(obj)
        await session.flush()
        contact_map[c["id"]] = obj.id

    for b in d.get("budgets", []):
        obj = Budget(
            user_id=user.id,
            category_id=cat_map.get(b["category_id"]) if b.get("category_id") else None,
            currency_code=b["currency_code"], period=b.get("period", "monthly"),
            amount=b["amount"], active=b.get("active", True), note=b.get("note", ""),
        )
        session.add(obj)

    tx_id_map: dict[int, int] = {}
    pending_tx = list(d.get("transactions", []))
    for t in pending_tx:
        obj = Transaction(
            user_id=user.id,
            wallet_id=wallet_map[t["wallet_id"]],
            category_id=cat_map.get(t["category_id"]) if t.get("category_id") else None,
            merchant_id=merchant_map.get(t["merchant_id"]) if t.get("merchant_id") else None,
            contact_id=contact_map.get(t["contact_id"]) if t.get("contact_id") else None,
            amount=t["amount"], currency_code=t["currency_code"], kind=t.get("kind", "expense"),
            occurred_on=date.fromisoformat(t["occurred_on"]) if isinstance(t["occurred_on"], str) else t["occurred_on"],
            note=t.get("note", ""),
            split_group_id=t.get("split_group_id"),
            is_recurring=t.get("is_recurring", False),
            recurrence_period_days=t.get("recurrence_period_days"),
            recurrence_group_id=t.get("recurrence_group_id"),
        )
        session.add(obj)
        await session.flush()
        tx_id_map[t["id"]] = obj.id

    for t in pending_tx:
        if t.get("transfer_pair_id"):
            obj_id = tx_id_map.get(t["id"])
            pair_id = tx_id_map.get(t["transfer_pair_id"])
            if obj_id and pair_id:
                obj = await session.get(Transaction, obj_id)
                obj.transfer_pair_id = pair_id

    await session.commit()
