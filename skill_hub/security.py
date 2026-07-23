from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
from datetime import UTC, datetime, timedelta

import jwt

from skill_hub.config import get_skill_hub_settings

_USERNAME_PATTERN = re.compile(r"^[a-z][a-z0-9-]{2,31}$")
_SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
_VERSION_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)
_PBKDF2_ITERATIONS = 600_000


def validate_username(value: str) -> str:
    normalized = value.strip().lower()
    if not _USERNAME_PATTERN.fullmatch(normalized):
        raise ValueError("username must use 3-32 lowercase letters, numbers, or hyphens")
    return normalized


def validate_slug(value: str, *, label: str = "slug") -> str:
    normalized = value.strip().lower()
    if not _SLUG_PATTERN.fullmatch(normalized):
        raise ValueError(f"{label} must use lowercase letters, numbers, and hyphens")
    return normalized


def validate_semver(value: str) -> str:
    normalized = value.strip()
    if len(normalized) > 64 or not _VERSION_PATTERN.fullmatch(normalized):
        raise ValueError("version must be a valid semantic version such as 1.2.3")
    return normalized


def hash_password(password: str) -> str:
    if len(password) < 8 or len(password) > 200:
        raise ValueError("password length must be between 8 and 200 characters")
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        _PBKDF2_ITERATIONS,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_value, digest_value = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_value.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_value.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def create_access_token(user_id: str) -> tuple[str, datetime]:
    settings = get_skill_hub_settings()
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_minutes)
    payload = {
        "sub": user_id,
        "type": "access",
        "iat": datetime.now(UTC),
        "exp": expires_at,
        "iss": "zj-skill-hub",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256"), expires_at


def decode_access_token(token: str) -> str:
    settings = get_skill_hub_settings()
    payload = jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=["HS256"],
        issuer="zj-skill-hub",
        options={"require": ["sub", "exp", "iat"]},
    )
    if payload.get("type") != "access" or not isinstance(payload.get("sub"), str):
        raise jwt.InvalidTokenError("invalid access token")
    return payload["sub"]
