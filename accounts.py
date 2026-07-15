"""Accounts for Food.io: users, sessions, search history, favorites, rate limits.

Storage is a local SQLite file (set FOODIO_DB_PATH to relocate it). Passwords
are hashed with PBKDF2-HMAC-SHA256; sessions are random tokens delivered as an
HttpOnly cookie and also accepted as a Bearer token for API clients.
"""

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

DB_PATH = os.getenv("FOODIO_DB_PATH", "foodio.db")

SESSION_COOKIE = "foodio_session"
SESSION_TTL_SECONDS = 30 * 24 * 3600  # 30 days

PBKDF2_ITERATIONS = 200_000
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
MIN_PASSWORD_LENGTH = 8


# =========================================
# Database
# =========================================

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS search_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                search_type TEXT NOT NULL,
                query       TEXT NOT NULL,
                location    TEXT,
                created_at  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_history_user
                ON search_history(user_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS favorites (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                kind       TEXT NOT NULL,
                title      TEXT NOT NULL,
                payload    TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(user_id, kind, title)
            );
            """
        )


# =========================================
# Password hashing (PBKDF2, stdlib only)
# =========================================

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, expected = stored.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


# =========================================
# Rate limiting (sliding window, in-memory)
# =========================================

class RateLimiter:
    """Sliding-window limiter keyed by client (user id or IP)."""

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def try_acquire(self, key: str) -> Optional[int]:
        """Record a hit. Returns None if allowed, else seconds until retry."""
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if t > cutoff]
            if len(hits) >= self.max_requests:
                self._hits[key] = hits
                return max(1, int(hits[0] - cutoff) + 1)
            hits.append(now)
            self._hits[key] = hits
            # Opportunistically drop stale keys so memory stays bounded.
            if len(self._hits) > 10_000:
                self._hits = {
                    k: v for k, v in self._hits.items() if v and v[-1] > cutoff
                }
            return None


# Login/register attempts: 10 per 5 minutes per IP.
auth_limiter = RateLimiter(max_requests=10, window_seconds=300)
# AI search calls: 60 per 5 minutes per client. One full ingredient search
# fires 8 backend calls, so this allows roughly 7 searches per 5 minutes.
search_limiter = RateLimiter(max_requests=60, window_seconds=300)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce_auth_rate_limit(request: Request) -> None:
    retry_after = auth_limiter.try_acquire(f"auth:{_client_ip(request)}")
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Too many login attempts. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )


def enforce_search_rate_limit(request: Request) -> None:
    user = get_optional_user(request)
    key = f"user:{user['id']}" if user else f"ip:{_client_ip(request)}"
    retry_after = search_limiter.try_acquire(key)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Too many search requests. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )


# =========================================
# Sessions / current user
# =========================================

def _create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with _connect() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, now, now + SESSION_TTL_SECONDS),
        )
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
    return token


def _session_token(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(SESSION_COOKIE)


def get_optional_user(request: Request) -> Optional[dict]:
    token = _session_token(request)
    if not token:
        return None
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT u.id, u.username FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ? AND s.expires_at > ?
            """,
            (token, int(time.time())),
        ).fetchone()
    return {"id": row["id"], "username": row["username"]} if row else None


def get_required_user(request: Request) -> dict:
    user = get_optional_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required")
    return user


def record_search(user: Optional[dict], search_type: str, query: str,
                  location: Optional[str] = None) -> None:
    if user is None:
        return
    with _connect() as conn:
        conn.execute(
            "INSERT INTO search_history (user_id, search_type, query, location, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (user["id"], search_type, query, location, int(time.time())),
        )


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
    )


# =========================================
# API models
# =========================================

class Credentials(BaseModel):
    username: str
    password: str


class FavoriteCreate(BaseModel):
    kind: str  # "search" or "recipe"
    title: str
    payload: dict


# =========================================
# Routes
# =========================================

router = APIRouter()


@router.post("/auth/register")
def register(credentials: Credentials, request: Request, response: Response):
    enforce_auth_rate_limit(request)

    username = credentials.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3-20 characters: letters, numbers, or underscores",
        )
    if len(credentials.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )

    with _connect() as conn:
        try:
            cursor = conn.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                (username, hash_password(credentials.password), int(time.time())),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="That username is already taken")
        user_id = cursor.lastrowid

    _set_session_cookie(response, _create_session(user_id))
    return {"id": user_id, "username": username}


@router.post("/auth/login")
def login(credentials: Credentials, request: Request, response: Response):
    enforce_auth_rate_limit(request)

    with _connect() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (credentials.username.strip(),),
        ).fetchone()

    if row is None or not verify_password(credentials.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    _set_session_cookie(response, _create_session(row["id"]))
    return {"id": row["id"], "username": row["username"]}


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    token = _session_token(request)
    if token:
        with _connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    response.delete_cookie(SESSION_COOKIE)
    return {"status": "logged out"}


@router.get("/auth/me")
def me(user: dict = Depends(get_required_user)):
    return user


@router.get("/history")
def get_history(user: dict = Depends(get_required_user), limit: int = 50):
    limit = max(1, min(limit, 200))
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, search_type, query, location, created_at FROM search_history "
            "WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            (user["id"], limit),
        ).fetchall()
    return {"history": [dict(r) for r in rows]}


@router.delete("/history")
def clear_history(user: dict = Depends(get_required_user)):
    with _connect() as conn:
        conn.execute("DELETE FROM search_history WHERE user_id = ?", (user["id"],))
    return {"status": "cleared"}


@router.get("/favorites")
def get_favorites(user: dict = Depends(get_required_user)):
    import json as _json

    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, kind, title, payload, created_at FROM favorites "
            "WHERE user_id = ? ORDER BY created_at DESC, id DESC",
            (user["id"],),
        ).fetchall()
    favorites = []
    for r in rows:
        item = dict(r)
        try:
            item["payload"] = _json.loads(item["payload"])
        except ValueError:
            item["payload"] = {}
        favorites.append(item)
    return {"favorites": favorites}


@router.post("/favorites")
def add_favorite(favorite: FavoriteCreate, user: dict = Depends(get_required_user)):
    import json as _json

    if favorite.kind not in {"search", "recipe"}:
        raise HTTPException(status_code=400, detail="kind must be 'search' or 'recipe'")
    title = favorite.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")

    with _connect() as conn:
        try:
            cursor = conn.execute(
                "INSERT INTO favorites (user_id, kind, title, payload, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (user["id"], favorite.kind, title[:200],
                 _json.dumps(favorite.payload), int(time.time())),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Already in your favorites")
    return {"id": cursor.lastrowid, "status": "saved"}


@router.delete("/favorites/{favorite_id}")
def delete_favorite(favorite_id: int, user: dict = Depends(get_required_user)):
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM favorites WHERE id = ? AND user_id = ?",
            (favorite_id, user["id"]),
        )
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Favorite not found")
    return {"status": "deleted"}
