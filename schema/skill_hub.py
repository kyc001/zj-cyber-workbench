from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class HubSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HubSkillVersionSchema(HubSchema):
    version: str
    changelog: str
    sha256: str
    size_bytes: int
    scan_status: str
    scan_warnings: list[str]
    published_at: datetime


class HubSkillSummarySchema(HubSchema):
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


class HubSkillDetailSchema(HubSkillSummarySchema):
    description: str
    visibility: str
    author_username: str
    versions: list[HubSkillVersionSchema]
    starred: bool = False
    my_rating: int | None = None


class HubSkillListSchema(HubSchema):
    items: list[HubSkillSummarySchema]
    total: int
    page: int
    page_size: int


class InstalledHubSkillSchema(HubSchema):
    name: str
    namespace: str
    slug: str
    version: str
    sha256: str
    installed_at: datetime


class InstallHubSkillRequest(HubSchema):
    namespace: str = Field(min_length=1, max_length=48)
    slug: str = Field(min_length=1, max_length=64)
    version: str = Field(default="", max_length=64)


class InstallHubSkillResponse(HubSchema):
    installed: InstalledHubSkillSchema
    updated: bool
