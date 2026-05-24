from pydantic import BaseModel, ConfigDict, Field

USERNAME_PATTERN = r"^[a-zA-Z0-9_-]{2,32}$"


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32, pattern=USERNAME_PATTERN)
    password: str = Field(min_length=6, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    is_active: bool
