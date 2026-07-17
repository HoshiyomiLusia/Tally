from pydantic import BaseModel, ConfigDict, Field


class MerchantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    default_category_id: int | None = None
    region: str = ""
    aliases: str = ""


class MerchantUpdate(BaseModel):
    # 审计#70: 对齐 Create 的 max_length=128, 防改档时写入超长名
    name: str | None = Field(default=None, max_length=128)
    default_category_id: int | None = None
    region: str | None = None
    aliases: str | None = None


class MerchantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    default_category_id: int | None
    region: str
    usage_count: int
    aliases: str
