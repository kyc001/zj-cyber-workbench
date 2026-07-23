from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import jwt
from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from skill_hub.config import get_skill_hub_settings
from skill_hub.database import (
    close_skill_hub_database,
    create_skill_hub_tables,
    get_skill_hub_session,
    init_skill_hub_database,
)
from skill_hub.models import (
    HubAuditLog,
    HubNamespace,
    HubNamespaceMember,
    HubSkill,
    HubSkillRating,
    HubSkillStar,
    HubSkillVersion,
    HubUser,
)
from skill_hub.packages import PackageValidationError, validate_skill_package
from skill_hub.redis_runtime import consume_rate_limit, start_redis_runtime, stop_redis_runtime
from skill_hub.schemas import (
    AuthResponse,
    LoginRequest,
    NamespaceCreateRequest,
    NamespaceSchema,
    RatingRequest,
    RegisterRequest,
    SkillDetailSchema,
    SkillListResponse,
    SkillSummarySchema,
    SkillVersionSchema,
    UserSchema,
)
from skill_hub.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    validate_semver,
    validate_slug,
    validate_username,
    verify_password,
)
from skill_hub.storage import package_storage_path, store_package

bearer_scheme = HTTPBearer(auto_error=False)


@asynccontextmanager
async def skill_hub_lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_skill_hub_settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    init_skill_hub_database()
    await create_skill_hub_tables()
    await start_redis_runtime()
    try:
        yield
    finally:
        await stop_redis_runtime()
        await close_skill_hub_database()


def create_skill_hub_app() -> FastAPI:
    settings = get_skill_hub_settings()
    app = FastAPI(
        title="ZJ Skill Hub",
        description="Public registry for versioned Agent Skill packages.",
        version="0.1.0",
        lifespan=skill_hub_lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )
    _mount_routes(app)
    return app


def _mount_routes(app: FastAPI) -> None:
    @app.get("/health", tags=["system"])
    async def health(session: Annotated[AsyncSession, Depends(get_skill_hub_session)]) -> dict[str, object]:
        await session.execute(select(1))
        return {"service": "zj-skill-hub", "status": "ok", "version": "0.1.0"}

    @app.post("/api/v1/auth/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED, tags=["auth"])
    async def register(
        payload: RegisterRequest,
        request: Request,
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
    ) -> AuthResponse:
        await _enforce_rate_limit(request, "register", limit=10, window_seconds=60 * 60)
        try:
            username = validate_username(payload.username)
            email = _validate_email(payload.email)
            password_hash = hash_password(payload.password)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        user = HubUser(
            username=username,
            email=email,
            display_name=payload.display_name.strip(),
            password_hash=password_hash,
        )
        session.add(user)
        try:
            await session.flush()
            namespace = HubNamespace(
                slug=username,
                name=f"{payload.display_name.strip()} 的 Skills",
                description="个人 Skill 命名空间",
                owner_id=user.id,
                public=True,
            )
            session.add(namespace)
            await session.flush()
            session.add(HubNamespaceMember(namespace_id=namespace.id, user_id=user.id, role="owner"))
            _add_audit(session, user.id, "user.register", "user", user.id, request)
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="username or email is already registered",
            ) from exc
        token, expires_at = create_access_token(user.id)
        return AuthResponse(
            access_token=token,
            expires_at=expires_at,
            user=_user_schema(user),
        )

    @app.post("/api/v1/auth/login", response_model=AuthResponse, tags=["auth"])
    async def login(
        payload: LoginRequest,
        request: Request,
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
    ) -> AuthResponse:
        await _enforce_rate_limit(request, "login", limit=20, window_seconds=15 * 60)
        identity = payload.username_or_email.strip().lower()
        user = (
            await session.execute(
                select(HubUser).where(or_(HubUser.username == identity, HubUser.email == identity))
            )
        ).scalar_one_or_none()
        if user is None or not user.active or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")
        token, expires_at = create_access_token(user.id)
        _add_audit(session, user.id, "user.login", "user", user.id, request)
        await session.commit()
        return AuthResponse(
            access_token=token,
            expires_at=expires_at,
            user=_user_schema(user),
        )

    @app.get("/api/v1/auth/me", response_model=UserSchema, tags=["auth"])
    async def me(user: Annotated[HubUser, Depends(require_user)]) -> UserSchema:
        return _user_schema(user)

    @app.get("/api/v1/namespaces", response_model=list[NamespaceSchema], tags=["namespaces"])
    async def list_namespaces(
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
        user: Annotated[HubUser | None, Depends(optional_user)],
    ) -> list[NamespaceSchema]:
        visible_ids: list[int] = []
        if user is not None:
            visible_ids = list(
                (
                    await session.execute(
                        select(HubNamespaceMember.namespace_id).where(HubNamespaceMember.user_id == user.id)
                    )
                ).scalars()
            )
        condition = HubNamespace.public.is_(True)
        if visible_ids:
            condition = or_(condition, HubNamespace.id.in_(visible_ids))
        rows = (
            await session.execute(
                select(
                    HubNamespace,
                    HubUser.username,
                    func.count(HubSkill.id),
                )
                .join(HubUser, HubUser.id == HubNamespace.owner_id)
                .outerjoin(HubSkill, HubSkill.namespace_id == HubNamespace.id)
                .where(condition)
                .group_by(HubNamespace.id, HubUser.username)
                .order_by(HubNamespace.slug)
            )
        ).all()
        return [
            NamespaceSchema(
                slug=namespace.slug,
                name=namespace.name,
                description=namespace.description,
                owner_username=owner_username,
                public=namespace.public,
                skill_count=skill_count,
                created_at=namespace.created_at,
            )
            for namespace, owner_username, skill_count in rows
        ]

    @app.post(
        "/api/v1/namespaces",
        response_model=NamespaceSchema,
        status_code=status.HTTP_201_CREATED,
        tags=["namespaces"],
    )
    async def create_namespace(
        payload: NamespaceCreateRequest,
        request: Request,
        user: Annotated[HubUser, Depends(require_user)],
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
    ) -> NamespaceSchema:
        try:
            slug = validate_slug(payload.slug, label="namespace slug")
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        namespace = HubNamespace(
            slug=slug,
            name=payload.name.strip(),
            description=payload.description.strip(),
            owner_id=user.id,
            public=payload.public,
        )
        session.add(namespace)
        try:
            await session.flush()
            session.add(HubNamespaceMember(namespace_id=namespace.id, user_id=user.id, role="owner"))
            _add_audit(session, user.id, "namespace.create", "namespace", slug, request)
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="namespace slug already exists") from exc
        return NamespaceSchema(
            slug=namespace.slug,
            name=namespace.name,
            description=namespace.description,
            owner_username=user.username,
            public=namespace.public,
            skill_count=0,
            created_at=namespace.created_at,
        )

    @app.get("/api/v1/skills", response_model=SkillListResponse, tags=["skills"])
    async def list_skills(
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
        user: Annotated[HubUser | None, Depends(optional_user)],
        q: str = Query(default="", max_length=100),
        namespace: str = Query(default="", max_length=48),
        tag: str = Query(default="", max_length=32),
        sort: str = Query(default="recent", pattern="^(recent|downloads|stars|rating)$"),
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=24, ge=1, le=100),
    ) -> SkillListResponse:
        visibility_condition = HubSkill.visibility == "public"
        if user is not None:
            member_namespace_ids = list(
                (
                    await session.execute(
                        select(HubNamespaceMember.namespace_id).where(
                            HubNamespaceMember.user_id == user.id
                        )
                    )
                ).scalars()
            )
            if member_namespace_ids:
                visibility_condition = or_(
                    visibility_condition,
                    HubSkill.namespace_id.in_(member_namespace_ids),
                )
        conditions = [HubSkill.status == "published", visibility_condition]
        query_text = q.strip()
        if query_text:
            like_value = f"%{query_text}%"
            conditions.append(
                or_(
                    HubSkill.name.ilike(like_value),
                    HubSkill.slug.ilike(like_value),
                    HubSkill.summary.ilike(like_value),
                    HubSkill.description.ilike(like_value),
                )
            )
        if namespace:
            conditions.append(HubNamespace.slug == validate_slug(namespace, label="namespace"))
        count_statement = (
            select(func.count(HubSkill.id))
            .join(HubNamespace, HubNamespace.id == HubSkill.namespace_id)
            .where(*conditions)
        )
        total = int((await session.execute(count_statement)).scalar_one())
        order_column = {
            "recent": HubSkill.updated_at,
            "downloads": HubSkill.downloads,
            "stars": HubSkill.stars,
            "rating": HubSkill.rating_average,
        }[sort]
        rows = (
            await session.execute(
                select(HubSkill, HubNamespace.slug)
                .join(HubNamespace, HubNamespace.id == HubSkill.namespace_id)
                .where(*conditions)
                .order_by(order_column.desc(), HubSkill.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        items = [_skill_summary(skill, namespace_slug) for skill, namespace_slug in rows]
        if tag:
            normalized_tag = tag.strip().lower()
            items = [item for item in items if normalized_tag in item.tags]
        return SkillListResponse(items=items, total=total, page=page, page_size=page_size)

    @app.get("/api/v1/skills/{namespace}/{slug}", response_model=SkillDetailSchema, tags=["skills"])
    async def get_skill_detail(
        namespace: str,
        slug: str,
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
        user: Annotated[HubUser | None, Depends(optional_user)],
    ) -> SkillDetailSchema:
        skill, namespace_row = await _require_visible_skill(session, namespace, slug, user)
        author_username = (
            await session.execute(select(HubUser.username).where(HubUser.id == skill.author_id))
        ).scalar_one()
        versions = list(
            (
                await session.execute(
                    select(HubSkillVersion)
                    .where(HubSkillVersion.skill_id == skill.id)
                    .order_by(HubSkillVersion.published_at.desc())
                )
            ).scalars()
        )
        starred = False
        my_rating = None
        if user is not None:
            starred = (
                await session.execute(
                    select(HubSkillStar.id).where(
                        HubSkillStar.skill_id == skill.id,
                        HubSkillStar.user_id == user.id,
                    )
                )
            ).scalar_one_or_none() is not None
            my_rating = (
                await session.execute(
                    select(HubSkillRating.score).where(
                        HubSkillRating.skill_id == skill.id,
                        HubSkillRating.user_id == user.id,
                    )
                )
            ).scalar_one_or_none()
        summary = _skill_summary(skill, namespace_row.slug)
        return SkillDetailSchema(
            **summary.model_dump(),
            description=skill.description,
            visibility=skill.visibility,
            author_username=author_username,
            versions=[_version_schema(version) for version in versions],
            starred=starred,
            my_rating=my_rating,
        )

    @app.post(
        "/api/v1/skills/publish",
        response_model=SkillDetailSchema,
        status_code=status.HTTP_201_CREATED,
        tags=["skills"],
    )
    async def publish_skill(
        request: Request,
        user: Annotated[HubUser, Depends(require_user)],
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
        package: Annotated[UploadFile, File()],
        namespace: Annotated[str, Form(min_length=2, max_length=48)],
        slug: Annotated[str, Form(min_length=1, max_length=64)],
        version: Annotated[str, Form(min_length=5, max_length=64)],
        changelog: Annotated[str, Form(max_length=10_000)] = "",
        visibility: Annotated[str, Form(pattern="^(public|namespace)$")] = "public",
    ) -> SkillDetailSchema:
        await _enforce_rate_limit(request, f"publish:{user.id}", limit=30, window_seconds=60 * 60)
        try:
            namespace_slug = validate_slug(namespace, label="namespace")
            skill_slug = validate_slug(slug, label="skill slug")
            semantic_version = validate_semver(version)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        namespace_row = (
            await session.execute(select(HubNamespace).where(HubNamespace.slug == namespace_slug))
        ).scalar_one_or_none()
        if namespace_row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="namespace not found")
        await _require_namespace_publisher(session, namespace_row.id, user)
        settings = get_skill_hub_settings()
        payload = await package.read(settings.max_package_bytes + 1)
        try:
            validated = validate_skill_package(payload, skill_slug)
        except (PackageValidationError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        skill = (
            await session.execute(
                select(HubSkill).where(
                    HubSkill.namespace_id == namespace_row.id,
                    HubSkill.slug == skill_slug,
                )
            )
        ).scalar_one_or_none()
        if skill is None:
            skill = HubSkill(
                namespace_id=namespace_row.id,
                slug=skill_slug,
                name=str(validated.metadata.get("title") or skill_slug),
                summary=validated.metadata["description"],
                description=_skill_markdown_summary(validated.content),
                author_id=user.id,
                visibility=visibility,
                tags=validated.metadata["tags"],
            )
            session.add(skill)
            await session.flush()
        elif skill.status == "archived":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="skill is archived")

        existing_version = (
            await session.execute(
                select(HubSkillVersion.id).where(
                    HubSkillVersion.skill_id == skill.id,
                    HubSkillVersion.version == semantic_version,
                )
            )
        ).scalar_one_or_none()
        if existing_version is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="skill version already exists")

        storage_key = f"{namespace_slug}/{skill_slug}/{semantic_version}/{validated.sha256}.zip"
        stored_path: Path | None = None
        try:
            stored_path = store_package(storage_key, validated.content)
            version_row = HubSkillVersion(
                skill_id=skill.id,
                version=semantic_version,
                changelog=changelog.strip(),
                sha256=validated.sha256,
                size_bytes=validated.size_bytes,
                storage_key=storage_key,
                manifest=validated.manifest,
                scan_status="warning" if validated.warnings else "passed",
                scan_warnings=list(validated.warnings),
                uploader_id=user.id,
            )
            session.add(version_row)
            skill.name = str(validated.metadata.get("title") or skill.name or skill_slug)
            skill.summary = validated.metadata["description"]
            skill.description = _skill_markdown_summary(validated.content)
            skill.tags = validated.metadata["tags"]
            skill.visibility = visibility
            skill.latest_version = semantic_version
            _add_audit(
                session,
                user.id,
                "skill.publish",
                "skill",
                f"{namespace_slug}/{skill_slug}@{semantic_version}",
                request,
                {"sha256": validated.sha256, "warnings": list(validated.warnings)},
            )
            await session.commit()
        except (IntegrityError, FileExistsError) as exc:
            await session.rollback()
            if stored_path is not None:
                stored_path.unlink(missing_ok=True)
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="package version already exists") from exc
        return await get_skill_detail(namespace_slug, skill_slug, session, user)

    @app.get("/api/v1/skills/{namespace}/{slug}/download", tags=["skills"])
    async def download_skill(
        namespace: str,
        slug: str,
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
        user: Annotated[HubUser | None, Depends(optional_user)],
        version: str = Query(default="", max_length=64),
    ) -> FileResponse:
        skill, namespace_row = await _require_visible_skill(session, namespace, slug, user)
        selected_version = version.strip() or skill.latest_version
        version_row = (
            await session.execute(
                select(HubSkillVersion).where(
                    HubSkillVersion.skill_id == skill.id,
                    HubSkillVersion.version == selected_version,
                )
            )
        ).scalar_one_or_none()
        if version_row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="skill version not found")
        path = package_storage_path(version_row.storage_key)
        if not path.is_file():
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="package object is unavailable")
        skill.downloads += 1
        await session.commit()
        filename = f"{namespace_row.slug}-{skill.slug}-{version_row.version}.zip"
        return FileResponse(
            path,
            media_type="application/zip",
            filename=filename,
            headers={
                "X-Skill-SHA256": version_row.sha256,
                "X-Skill-Version": version_row.version,
            },
        )

    @app.post(
        "/api/v1/skills/{namespace}/{slug}/star",
        status_code=status.HTTP_204_NO_CONTENT,
        response_model=None,
        tags=["social"],
    )
    async def star_skill(
        namespace: str,
        slug: str,
        user: Annotated[HubUser, Depends(require_user)],
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
    ) -> None:
        skill, _ = await _require_visible_skill(session, namespace, slug, user)
        exists = (
            await session.execute(
                select(HubSkillStar.id).where(
                    HubSkillStar.skill_id == skill.id,
                    HubSkillStar.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            session.add(HubSkillStar(skill_id=skill.id, user_id=user.id))
            skill.stars += 1
            await session.commit()

    @app.delete(
        "/api/v1/skills/{namespace}/{slug}/star",
        status_code=status.HTTP_204_NO_CONTENT,
        response_model=None,
        tags=["social"],
    )
    async def unstar_skill(
        namespace: str,
        slug: str,
        user: Annotated[HubUser, Depends(require_user)],
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
    ) -> None:
        skill, _ = await _require_visible_skill(session, namespace, slug, user)
        result = await session.execute(
            delete(HubSkillStar).where(
                HubSkillStar.skill_id == skill.id,
                HubSkillStar.user_id == user.id,
            )
        )
        if result.rowcount:
            skill.stars = max(0, skill.stars - 1)
            await session.commit()

    @app.post(
        "/api/v1/skills/{namespace}/{slug}/rating",
        status_code=status.HTTP_204_NO_CONTENT,
        response_model=None,
        tags=["social"],
    )
    async def rate_skill(
        namespace: str,
        slug: str,
        payload: RatingRequest,
        user: Annotated[HubUser, Depends(require_user)],
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
    ) -> None:
        skill, _ = await _require_visible_skill(session, namespace, slug, user)
        rating = (
            await session.execute(
                select(HubSkillRating).where(
                    HubSkillRating.skill_id == skill.id,
                    HubSkillRating.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if rating is None:
            session.add(HubSkillRating(skill_id=skill.id, user_id=user.id, score=payload.score))
        else:
            rating.score = payload.score
        await session.flush()
        average, count = (
            await session.execute(
                select(func.avg(HubSkillRating.score), func.count(HubSkillRating.id)).where(
                    HubSkillRating.skill_id == skill.id
                )
            )
        ).one()
        skill.rating_average = round(float(average or 0), 2)
        skill.rating_count = int(count)
        await session.commit()

    @app.get("/api/v1/me/skills", response_model=list[SkillSummarySchema], tags=["skills"])
    async def my_skills(
        user: Annotated[HubUser, Depends(require_user)],
        session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
    ) -> list[SkillSummarySchema]:
        rows = (
            await session.execute(
                select(HubSkill, HubNamespace.slug)
                .join(HubNamespace, HubNamespace.id == HubSkill.namespace_id)
                .where(HubSkill.author_id == user.id)
                .order_by(HubSkill.updated_at.desc())
            )
        ).all()
        return [_skill_summary(skill, namespace_slug) for skill, namespace_slug in rows]


async def optional_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[AsyncSession, Depends(get_skill_hub_session)],
) -> HubUser | None:
    if credentials is None:
        return None
    try:
        user_id = decode_access_token(credentials.credentials)
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired token") from exc
    user = await session.get(HubUser, user_id)
    if user is None or not user.active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user is unavailable")
    return user


async def require_user(user: Annotated[HubUser | None, Depends(optional_user)]) -> HubUser:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    return user


async def _require_namespace_publisher(
    session: AsyncSession,
    namespace_id: int,
    user: HubUser,
) -> None:
    if user.role == "admin":
        return
    role = (
        await session.execute(
            select(HubNamespaceMember.role).where(
                HubNamespaceMember.namespace_id == namespace_id,
                HubNamespaceMember.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if role not in {"owner", "admin", "publisher"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="namespace publish permission required")


async def _require_visible_skill(
    session: AsyncSession,
    namespace: str,
    slug: str,
    user: HubUser | None,
) -> tuple[HubSkill, HubNamespace]:
    try:
        namespace_slug = validate_slug(namespace, label="namespace")
        skill_slug = validate_slug(slug, label="skill slug")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    row = (
        await session.execute(
            select(HubSkill, HubNamespace)
            .join(HubNamespace, HubNamespace.id == HubSkill.namespace_id)
            .where(
                HubNamespace.slug == namespace_slug,
                HubSkill.slug == skill_slug,
                HubSkill.status == "published",
            )
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="skill not found")
    skill, namespace_row = row
    if skill.visibility == "public":
        return skill, namespace_row
    if user is not None:
        if user.role == "admin":
            return skill, namespace_row
        membership = (
            await session.execute(
                select(HubNamespaceMember.id).where(
                    HubNamespaceMember.namespace_id == namespace_row.id,
                    HubNamespaceMember.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if membership is not None:
            return skill, namespace_row
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="skill not found")


def _validate_email(value: str) -> str:
    normalized = value.strip().lower()
    if (
        len(normalized) > 254
        or normalized.count("@") != 1
        or normalized.startswith("@")
        or normalized.endswith("@")
        or "." not in normalized.rpartition("@")[2]
    ):
        raise ValueError("email address is invalid")
    return normalized


def _user_schema(user: HubUser) -> UserSchema:
    return UserSchema(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        created_at=user.created_at,
    )


def _skill_summary(skill: HubSkill, namespace_slug: str) -> SkillSummarySchema:
    return SkillSummarySchema(
        namespace=namespace_slug,
        slug=skill.slug,
        name=skill.name,
        summary=skill.summary,
        tags=list(skill.tags or []),
        latest_version=skill.latest_version,
        downloads=skill.downloads,
        stars=skill.stars,
        rating_average=skill.rating_average,
        rating_count=skill.rating_count,
        updated_at=skill.updated_at,
    )


def _version_schema(version: HubSkillVersion) -> SkillVersionSchema:
    return SkillVersionSchema(
        version=version.version,
        changelog=version.changelog,
        sha256=version.sha256,
        size_bytes=version.size_bytes,
        scan_status=version.scan_status,
        scan_warnings=list(version.scan_warnings or []),
        published_at=version.published_at,
    )


def _skill_markdown_summary(content: bytes) -> str:
    import zipfile
    from io import BytesIO

    with zipfile.ZipFile(BytesIO(content)) as archive:
        text = archive.read("SKILL.md").decode("utf-8")
    lines = text.splitlines()
    if lines and lines[0].strip() == "---":
        for index, line in enumerate(lines[1:], 1):
            if line.strip() == "---":
                return "\n".join(lines[index + 1:]).strip()[:20_000]
    return text.strip()[:20_000]


def _add_audit(
    session: AsyncSession,
    actor_id: str | None,
    action: str,
    resource_type: str,
    resource_id: str,
    request: Request,
    details: dict[str, object] | None = None,
) -> None:
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    client_ip = forwarded or (request.client.host if request.client else "")
    session.add(
        HubAuditLog(
            actor_id=actor_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details or {},
            ip_address=client_ip[:64],
        )
    )


async def _enforce_rate_limit(
    request: Request,
    bucket: str,
    *,
    limit: int,
    window_seconds: int,
) -> None:
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    client_ip = forwarded or (request.client.host if request.client else "unknown")
    allowed, retry_after = await consume_rate_limit(
        f"{bucket}:{client_ip}",
        limit=limit,
        window_seconds=window_seconds,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="rate limit exceeded",
            headers={"Retry-After": str(retry_after)},
        )
