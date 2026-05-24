import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.config import settings
from ..core.db import get_session
from ..models import Attachment, Transaction, User
from ..schemas.attachment import AttachmentRead

router = APIRouter(tags=["attachments"])

MAX_BYTES = 8 * 1024 * 1024
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}


def _receipts_dir() -> Path:
    db_path = Path(settings.sync_database_url.split("///", 1)[-1])
    base = db_path.parent / "receipts"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _user_dir(user_id: int) -> Path:
    p = _receipts_dir() / str(user_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


@router.post("/transactions/{tid}/attachments", response_model=AttachmentRead, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    tid: int,
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    t = await session.get(Transaction, tid)
    if not t or t.user_id != user.id:
        raise HTTPException(404, "transaction not found")
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(400, f"unsupported mime: {file.content_type}")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(400, f"file too large (max {MAX_BYTES // 1024 // 1024} MB)")

    ext = Path(file.filename or "").suffix.lower() or ".bin"
    stored_name = f"{uuid.uuid4().hex}{ext}"
    udir = _user_dir(user.id)
    path = udir / stored_name
    path.write_bytes(data)

    if file.content_type.startswith("image/"):
        try:
            with Image.open(path) as img:
                img.thumbnail((600, 600))
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.save(udir / f"{Path(stored_name).stem}_thumb.jpg", "JPEG", quality=80, optimize=True)
        except UnidentifiedImageError:
            pass

    att = Attachment(
        user_id=user.id,
        transaction_id=tid,
        original_name=file.filename or stored_name,
        stored_name=stored_name,
        mime_type=file.content_type,
        size=len(data),
    )
    session.add(att)
    await session.commit()
    await session.refresh(att)
    return att


@router.get("/transactions/{tid}/attachments", response_model=list[AttachmentRead])
async def list_attachments(
    tid: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    t = await session.get(Transaction, tid)
    if not t or t.user_id != user.id:
        raise HTTPException(404)
    rows = (
        await session.execute(
            select(Attachment).where(Attachment.transaction_id == tid, Attachment.user_id == user.id).order_by(Attachment.id)
        )
    ).scalars().all()
    return rows


@router.get("/attachments/{aid}")
async def download_attachment(
    aid: int,
    thumb: bool = False,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    att = await session.get(Attachment, aid)
    if not att or att.user_id != user.id:
        raise HTTPException(404)
    udir = _user_dir(user.id)
    if thumb:
        path = udir / f"{Path(att.stored_name).stem}_thumb.jpg"
        if not path.exists():
            path = udir / att.stored_name
        media = "image/jpeg" if path.suffix == ".jpg" else att.mime_type
    else:
        path = udir / att.stored_name
        media = att.mime_type
    if not path.exists():
        raise HTTPException(404, "file missing")
    return FileResponse(path, media_type=media, filename=att.original_name)


@router.delete("/attachments/{aid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    aid: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    att = await session.get(Attachment, aid)
    if not att or att.user_id != user.id:
        raise HTTPException(404)
    udir = _user_dir(user.id)
    (udir / att.stored_name).unlink(missing_ok=True)
    (udir / f"{Path(att.stored_name).stem}_thumb.jpg").unlink(missing_ok=True)
    await session.delete(att)
    await session.commit()
