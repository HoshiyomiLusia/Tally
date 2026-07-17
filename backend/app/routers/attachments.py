import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import current_user
from ..core.config import settings
from ..core.db import get_session
from ..models import Attachment, Transaction, User
from ..schemas.attachment import AttachmentRead

logger = logging.getLogger("tally.attachments")

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


def _safe_stored_name(stored_name: str) -> str:
    """只取文件名部分, 挡掉 import 注入的 ../ 路径穿越 (stored_name 可能来自不可信备份 JSON)。
    Path(x).name 永远只返回最后一段, 不含分隔符或 .., 故 udir / name 必然落在 udir 内。"""
    name = Path(stored_name).name
    if not name or name in (".", ".."):
        raise HTTPException(404, "file missing")
    return name


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

    ext = Path(file.filename or "").suffix.lower() or ".bin"
    stored_name = f"{uuid.uuid4().hex}{ext}"
    udir = _user_dir(user.id)
    path = udir / stored_name

    # 审计#50: 不再整体 read() 进内存, 避免超大文件 OOM 掉树莓派。
    # 先用 UploadFile.size (若客户端提供) 快速拦截, 再分块写盘, 累计超过上限即中止并清理半文件。
    if file.size is not None and file.size > MAX_BYTES:
        raise HTTPException(400, f"file too large (max {MAX_BYTES // 1024 // 1024} MB)")
    total = 0
    try:
        with path.open("wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(400, f"file too large (max {MAX_BYTES // 1024 // 1024} MB)")
                f.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)  # 中止/出错时清理已写入的部分文件, 不留孤儿
        raise

    if file.content_type.startswith("image/"):
        try:
            with Image.open(path) as img:
                img.thumbnail((600, 600))
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.save(udir / f"{Path(stored_name).stem}_thumb.jpg", "JPEG", quality=80, optimize=True)
        except Exception:
            # 审计#68: 缩略图是可选的, 截断图(OSError)/超大图(DecompressionBombError)等失败就跳过, 保住原图与入库。
            logger.warning("thumbnail generation failed for %s", stored_name, exc_info=True)

    att = Attachment(
        user_id=user.id,
        transaction_id=tid,
        original_name=file.filename or stored_name,
        stored_name=stored_name,
        mime_type=file.content_type,
        size=total,
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
    name = _safe_stored_name(att.stored_name)  # 防路径穿越
    if thumb:
        path = udir / f"{Path(name).stem}_thumb.jpg"
        if not path.exists():
            path = udir / name
        media = "image/jpeg" if path.suffix == ".jpg" else att.mime_type
    else:
        path = udir / name
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
    name = Path(att.stored_name).name  # 防路径穿越: 只在确认是纯文件名时才动磁盘
    if name and name not in (".", ".."):
        (udir / name).unlink(missing_ok=True)
        (udir / f"{Path(name).stem}_thumb.jpg").unlink(missing_ok=True)
    await session.delete(att)
    await session.commit()
