from datetime import datetime

from pydantic import BaseModel, Field

from schema.system_user.users import SystemUserRole


class LoginRequest(BaseModel):
    username_or_email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: str = Field(min_length=3, max_length=254)
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=200)


class CurrentUserSchema(BaseModel):
    id: int
    role: SystemUserRole
    email: str
    username: str
    display_name: str = ""
    auth_mode: str = "desktop"


class AuthSessionSchema(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: CurrentUserSchema
