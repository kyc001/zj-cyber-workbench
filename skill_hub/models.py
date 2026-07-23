from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def uuid_string() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class HubUser(Base):
    __tablename__ = "hub_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_string)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(512))
    role: Mapped[str] = mapped_column(String(24), default="user")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class HubNamespace(Base):
    __tablename__ = "hub_namespaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    owner_id: Mapped[str] = mapped_column(ForeignKey("hub_users.id", ondelete="RESTRICT"), index=True)
    public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class HubNamespaceMember(Base):
    __tablename__ = "hub_namespace_members"
    __table_args__ = (UniqueConstraint("namespace_id", "user_id", name="uq_hub_namespace_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    namespace_id: Mapped[int] = mapped_column(ForeignKey("hub_namespaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("hub_users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(24), default="member")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class HubSkill(Base):
    __tablename__ = "hub_skills"
    __table_args__ = (
        UniqueConstraint("namespace_id", "slug", name="uq_hub_skill_namespace_slug"),
        Index("ix_hub_skill_discovery", "status", "visibility", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    namespace_id: Mapped[int] = mapped_column(ForeignKey("hub_namespaces.id", ondelete="CASCADE"), index=True)
    slug: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(100))
    summary: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    author_id: Mapped[str] = mapped_column(ForeignKey("hub_users.id", ondelete="RESTRICT"), index=True)
    visibility: Mapped[str] = mapped_column(String(24), default="public")
    status: Mapped[str] = mapped_column(String(24), default="published")
    latest_version: Mapped[str] = mapped_column(String(64), default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    downloads: Mapped[int] = mapped_column(Integer, default=0)
    stars: Mapped[int] = mapped_column(Integer, default=0)
    rating_average: Mapped[float] = mapped_column(Float, default=0.0)
    rating_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class HubSkillVersion(Base):
    __tablename__ = "hub_skill_versions"
    __table_args__ = (UniqueConstraint("skill_id", "version", name="uq_hub_skill_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    skill_id: Mapped[int] = mapped_column(ForeignKey("hub_skills.id", ondelete="CASCADE"), index=True)
    version: Mapped[str] = mapped_column(String(64))
    changelog: Mapped[str] = mapped_column(Text, default="")
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(String(512), unique=True)
    manifest: Mapped[dict[str, Any]] = mapped_column(JSON)
    scan_status: Mapped[str] = mapped_column(String(24), default="passed")
    scan_warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    uploader_id: Mapped[str] = mapped_column(ForeignKey("hub_users.id", ondelete="RESTRICT"), index=True)
    published_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class HubSkillStar(Base):
    __tablename__ = "hub_skill_stars"
    __table_args__ = (UniqueConstraint("skill_id", "user_id", name="uq_hub_skill_star"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    skill_id: Mapped[int] = mapped_column(ForeignKey("hub_skills.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("hub_users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class HubSkillRating(Base):
    __tablename__ = "hub_skill_ratings"
    __table_args__ = (UniqueConstraint("skill_id", "user_id", name="uq_hub_skill_rating"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    skill_id: Mapped[int] = mapped_column(ForeignKey("hub_skills.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("hub_users.id", ondelete="CASCADE"), index=True)
    score: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class HubAuditLog(Base):
    __tablename__ = "hub_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("hub_users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    resource_type: Mapped[str] = mapped_column(String(40))
    resource_id: Mapped[str] = mapped_column(String(100))
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
