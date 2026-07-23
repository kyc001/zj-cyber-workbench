from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class StrictSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterRequest(StrictSchema):
    username: str = Field(min_length=3, max_length=32)
    email: str = Field(min_length=3, max_length=254)
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(StrictSchema):
    username_or_email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class UserSchema(StrictSchema):
    id: str
    username: str
    email: str
    display_name: str
    role: str
    created_at: datetime


class AuthResponse(StrictSchema):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserSchema


class NamespaceCreateRequest(StrictSchema):
    slug: str = Field(min_length=2, max_length=48)
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=2000)
    public: bool = True


class NamespaceSchema(StrictSchema):
    slug: str
    name: str
    description: str
    owner_username: str
    public: bool
    skill_count: int = 0
    created_at: datetime


class SkillVersionSchema(StrictSchema):
    version: str
    changelog: str
    sha256: str
    size_bytes: int
    scan_status: str
    scan_warnings: list[str]
    published_at: datetime


class SkillSummarySchema(StrictSchema):
    namespace: str
    slug: str
    name: str
    summary: str
    tags: list[str]
    latest_version: str
    downloads: int
    stars: int
    rating_average: float
    rating_count: int
    updated_at: datetime


class SkillDetailSchema(SkillSummarySchema):
    description: str
    visibility: str
    author_username: str
    versions: list[SkillVersionSchema]
    starred: bool = False
    my_rating: int | None = None


class SkillListResponse(StrictSchema):
    items: list[SkillSummarySchema]
    total: int
    page: int
    page_size: int


class RatingRequest(StrictSchema):
    score: int = Field(ge=1, le=5)
