from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    transaction_id: int
    original_name: str
    stored_name: str
    mime_type: str
    size: int
    created_at: datetime
