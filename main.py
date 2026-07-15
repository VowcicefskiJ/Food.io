from fastapi import FastAPI, HTTPException, Request, Depends, Header
from fastapi.responses import PlainTextResponse, FileResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field
from openai import OpenAI
from typing import List, Optional
from collections import defaultdict, deque
import os
import re
import json
import time
import hmac
import hashlib
import secrets
import sqlite3
import logging
import threading
import urllib.parse
import urllib.request

logger = logging.getLogger("foodio")

# Field length caps — hard limits that stop oversized input from reaching the
# AI (which costs money) or bloating the database.
MAX_INGREDIENT = 100
MAX_LOCATION = 120
MAX_LANGUAGE = 40
MAX_MEAL_ITEMS = 30
MAX_MEAL_ITEM_LEN = 80
MAX_FAV_TITLE = 200
MAX_FAV_PAYLOAD_BYTES = 20_000
MAX_FAVORITES_PER_USER = 500
MAX_HISTORY_PER_USER = 100


class MealRequest(BaseModel):
    ingredients: List[str] = Field(min_length=1, max_length=MAX_MEAL_ITEMS)
    meal_type: str = Field(max_length=20)
    language: str = Field(default="English", max_length=MAX_LANGUAGE)


class MealSuggestion(BaseModel):
    dish: str
    region: str
    description: str


class MealResponse(BaseModel):
    suggestions: List[MealSuggestion]


class IngredientRequest(BaseModel):
    ingredient: str = Field(max_length=MAX_INGREDIENT)
    location: Optional[str] = Field(default=None, max_length=MAX_LOCATION)
    language: str = Field(default="English", max_length=MAX_LANGUAGE)
    latitude: Optional[float] = None
    longitude: Optional[float] = None


app = FastAPI()

api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("OPENAI_API_KEY environment variable is required")
client = OpenAI(api_key=api_key)

verification_token = os.getenv("OPENAI_APPS_CHALLENGE", "")


# =============================================================================
# SECURITY CONFIGURATION (all via environment variables — safe local defaults)
# =============================================================================

# Set TRUST_PROXY=1 ONLY when running behind a reverse proxy you control that
# sets X-Forwarded-For (nginx, a cloud load balancer). Otherwise clients could
# spoof that header to dodge rate limits.
TRUST_PROXY = os.getenv("TRUST_PROXY", "").lower() in ("1", "true", "yes")

# Comma-separated hostnames the app will answer to (blocks Host-header attacks).
# Default "*" is fine for local testing; set it in production, e.g.
# ALLOWED_HOSTS="food.example.com,www.food.example.com"
ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "*").split(",") if h.strip()]

# Send HSTS + secure-cookie hints. Turn on when served over HTTPS in production.
HTTPS_ONLY = os.getenv("HTTPS_ONLY", "").lower() in ("1", "true", "yes")

MAX_BODY_BYTES = 64 * 1024  # reject request bodies larger than 64 KB

app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

_CSP = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'; "
    "object-src 'none'; "
    "img-src 'self' data: https:; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "script-src 'self' 'unsafe-inline'; "
    "connect-src 'self'"
)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # Reject oversized bodies early, before we read them into memory.
    cl = request.headers.get("content-length")
    if cl:
        try:
            if int(cl) > MAX_BODY_BYTES:
                return JSONResponse(status_code=413, content={"detail": "Request too large"})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length"})

    response = await call_next(request)

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(), payment=()"
    response.headers["Content-Security-Policy"] = _CSP
    response.headers["X-Robots-Tag"] = "noindex"
    if HTTPS_ONLY:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Never leak stack traces or internal error text to clients.
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong. Please try again."})


app.mount("/static", StaticFiles(directory="static"), name="static")


# =============================================================================
# DATABASE (SQLite — created automatically on first run)
# =============================================================================

DB_PATH = os.getenv("FOODIO_DB", "foodio.db")
SESSION_DAYS = 30


def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db():
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY,
                username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt          TEXT NOT NULL,
                created_at    REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id),
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS history (
                id          INTEGER PRIMARY KEY,
                user_id     INTEGER NOT NULL REFERENCES users(id),
                ingredient  TEXT NOT NULL,
                location    TEXT,
                searched_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS favorites (
                id         INTEGER PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id),
                kind       TEXT NOT NULL CHECK (kind IN ('search', 'recipe')),
                title      TEXT NOT NULL,
                payload    TEXT NOT NULL DEFAULT '{}',
                created_at REAL NOT NULL,
                UNIQUE (user_id, kind, title)
            );
            CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, searched_at DESC);
            CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id, created_at DESC);
        """)


_init_db()


# =============================================================================
# RATE LIMITING (in-memory sliding window)
# =============================================================================

AUTH_LIMIT, AUTH_WINDOW = 10, 300      # login/register attempts per IP: 10 per 5 min
AI_LIMIT, AI_WINDOW = 60, 60           # AI calls per user/IP: 60 per minute (one search = 8 calls)
AI_HOURLY_LIMIT, AI_HOURLY_WINDOW = 600, 3600

_rate_lock = threading.Lock()
_rate_hits: dict = defaultdict(deque)


def check_rate(key: str, limit: int, window: int):
    now = time.time()
    with _rate_lock:
        hits = _rate_hits[key]
        while hits and hits[0] <= now - window:
            hits.popleft()
        if len(hits) >= limit:
            retry_in = max(1, int(hits[0] + window - now) + 1)
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests — please wait {retry_in} seconds and try again",
                headers={"Retry-After": str(retry_in)},
            )
        hits.append(now)


def _client_ip(http_request: Request) -> str:
    # Behind a trusted proxy, the real client is the first entry of
    # X-Forwarded-For. We only honor it when TRUST_PROXY is set, so an
    # untrusted client can't spoof the header to escape rate limits.
    if TRUST_PROXY:
        xff = http_request.headers.get("x-forwarded-for")
        if xff:
            first = xff.split(",")[0].strip()
            if first:
                return first
    return http_request.client.host if http_request.client else "unknown"


def _ai_guard(http_request: Request, user: Optional[dict]):
    key = f"ai:user:{user['id']}" if user else f"ai:ip:{_client_ip(http_request)}"
    check_rate(key + ":min", AI_LIMIT, AI_WINDOW)
    check_rate(key + ":hr", AI_HOURLY_LIMIT, AI_HOURLY_WINDOW)


# =============================================================================
# AUTH
# =============================================================================

class AuthRequest(BaseModel):
    username: str = Field(max_length=60)
    password: str = Field(max_length=200)


class FavoriteRequest(BaseModel):
    kind: str = Field(max_length=20)
    title: str = Field(max_length=MAX_FAV_TITLE)
    payload: dict = {}


# Password hashing — PBKDF2-HMAC-SHA256 at the OWASP-recommended iteration
# count, in a self-describing format so the cost can be raised later without
# breaking existing accounts.
PBKDF2_ITERATIONS = 600_000

# A tiny blocklist of the most common passwords; rejected outright.
COMMON_PASSWORDS = {
    "password", "password1", "password123", "12345678", "123456789", "1234567890",
    "qwerty123", "qwertyuiop", "11111111", "00000000", "iloveyou", "abc12345",
    "letmein1", "welcome1", "admin123", "football", "baseball", "sunshine",
    "princess", "trustno1", "changeme", "passw0rd",
}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str, legacy_salt: str = "") -> bool:
    try:
        if stored.startswith("pbkdf2_sha256$"):
            _, iters, salt_hex, hash_hex = stored.split("$")
            dk = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters)
            )
            return hmac.compare_digest(dk.hex(), hash_hex)
        # Legacy format (200k iterations, salt in its own column).
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(legacy_salt), 200_000)
        return hmac.compare_digest(dk.hex(), stored)
    except (ValueError, TypeError):
        return False


# Precomputed hash used to equalize timing when a username doesn't exist, so an
# attacker can't tell real usernames from fake ones by response speed.
_DUMMY_HASH = hash_password(secrets.token_hex(16))


def _validate_password(username: str, password: str):
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if password.lower() in COMMON_PASSWORDS:
        raise HTTPException(status_code=400, detail="That password is too common — please choose a stronger one")
    if password.lower() == username.lower():
        raise HTTPException(status_code=400, detail="Password can't be the same as your username")


def _create_session(conn, user_id: int) -> str:
    now = time.time()
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))  # opportunistic cleanup
    token = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, user_id, now, now + SESSION_DAYS * 86400),
    )
    return token


def current_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Optional auth — returns {'id', 'username'} or None."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:].strip()
    if not token:
        return None
    with _db() as conn:
        row = conn.execute(
            """SELECT u.id, u.username, s.expires_at
               FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token = ?""",
            (token,),
        ).fetchone()
    if not row or row["expires_at"] < time.time():
        return None
    return {"id": row["id"], "username": row["username"]}


def require_user(user: Optional[dict] = Depends(current_user)) -> dict:
    if not user:
        raise HTTPException(status_code=401, detail="Please sign in first")
    return user


@app.post("/auth/register")
def auth_register(body: AuthRequest, http_request: Request):
    check_rate(f"auth:{_client_ip(http_request)}", AUTH_LIMIT, AUTH_WINDOW)
    username = body.username.strip()
    if not re.fullmatch(r"[A-Za-z0-9_]{3,30}", username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3-30 characters: letters, numbers, or underscores",
        )
    _validate_password(username, body.password)

    password_hash = hash_password(body.password)
    with _db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)",
                (username, password_hash, "", time.time()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="That username is already taken")
        token = _create_session(conn, cur.lastrowid)
    return {"token": token, "username": username}


@app.post("/auth/login")
def auth_login(body: AuthRequest, http_request: Request):
    check_rate(f"auth:{_client_ip(http_request)}", AUTH_LIMIT, AUTH_WINDOW)
    with _db() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash, salt FROM users WHERE username = ?",
            (body.username.strip(),),
        ).fetchone()
        if not row:
            verify_password(body.password, _DUMMY_HASH)  # equalize timing vs. real users
            raise HTTPException(status_code=401, detail="Invalid username or password")
        if not verify_password(body.password, row["password_hash"], row["salt"]):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        token = _create_session(conn, row["id"])
    return {"token": token, "username": row["username"]}


@app.post("/auth/logout")
def auth_logout(authorization: Optional[str] = Header(None), user: dict = Depends(require_user)):
    token = authorization[7:].strip()
    with _db() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    return {"ok": True}


@app.get("/auth/me")
def auth_me(user: dict = Depends(require_user)):
    return {"username": user["username"]}


# =============================================================================
# HISTORY & FAVORITES
# =============================================================================

@app.get("/me/history")
def get_history(user: dict = Depends(require_user)):
    with _db() as conn:
        rows = conn.execute(
            """SELECT id, ingredient, location, searched_at FROM history
               WHERE user_id = ? ORDER BY searched_at DESC LIMIT 50""",
            (user["id"],),
        ).fetchall()
    return {"history": [dict(r) for r in rows]}


@app.delete("/me/history")
def clear_history(user: dict = Depends(require_user)):
    with _db() as conn:
        conn.execute("DELETE FROM history WHERE user_id = ?", (user["id"],))
    return {"ok": True}


@app.get("/me/favorites")
def get_favorites(user: dict = Depends(require_user)):
    with _db() as conn:
        rows = conn.execute(
            """SELECT id, kind, title, payload, created_at FROM favorites
               WHERE user_id = ? ORDER BY created_at DESC LIMIT 200""",
            (user["id"],),
        ).fetchall()
    favorites = []
    for r in rows:
        item = dict(r)
        try:
            item["payload"] = json.loads(item["payload"])
        except (TypeError, json.JSONDecodeError):
            item["payload"] = {}
        favorites.append(item)
    return {"favorites": favorites}


@app.post("/me/favorites")
def add_favorite(body: FavoriteRequest, http_request: Request, user: dict = Depends(require_user)):
    check_rate(f"write:user:{user['id']}", 60, 60)  # 60 saves/deletes per minute per user
    if body.kind not in ("search", "recipe"):
        raise HTTPException(status_code=400, detail="kind must be 'search' or 'recipe'")
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title cannot be empty")
    payload_json = json.dumps(body.payload)
    if len(payload_json.encode("utf-8")) > MAX_FAV_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="That item is too large to save")
    with _db() as conn:
        existing = conn.execute(
            "SELECT id FROM favorites WHERE user_id = ? AND kind = ? AND title = ?",
            (user["id"], body.kind, title),
        ).fetchone()
        if not existing:
            count = conn.execute(
                "SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?", (user["id"],)
            ).fetchone()["c"]
            if count >= MAX_FAVORITES_PER_USER:
                raise HTTPException(
                    status_code=409,
                    detail=f"You've reached the {MAX_FAVORITES_PER_USER}-favorite limit — remove some first",
                )
        conn.execute(
            """INSERT INTO favorites (user_id, kind, title, payload, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (user_id, kind, title) DO UPDATE SET payload = excluded.payload""",
            (user["id"], body.kind, title, payload_json, time.time()),
        )
        row = conn.execute(
            "SELECT id FROM favorites WHERE user_id = ? AND kind = ? AND title = ?",
            (user["id"], body.kind, title),
        ).fetchone()
    return {"ok": True, "id": row["id"]}


@app.delete("/me/favorites/{fav_id}")
def remove_favorite(fav_id: int, user: dict = Depends(require_user)):
    with _db() as conn:
        conn.execute(
            "DELETE FROM favorites WHERE id = ? AND user_id = ?", (fav_id, user["id"])
        )
    return {"ok": True}


@app.get("/.well-known/openai-apps-challenge", response_class=PlainTextResponse)
def openai_apps_challenge():
    return verification_token


@app.get("/health")
def health_check():
    return {"status": "ok"}


def _asset_version() -> str:
    """A version string that changes whenever the CSS/JS/HTML change, so the
    browser fetches the new files instead of stale cached ones."""
    try:
        newest = max(
            os.path.getmtime("static/index.html"),
            os.path.getmtime("static/style.css"),
            os.path.getmtime("static/app.js"),
        )
        return str(int(newest))
    except OSError:
        return "1"


@app.get("/")
def serve_ui():
    # Stamp a cache-busting version onto the CSS/JS links and tell the browser
    # to always revalidate the page, so updates show up on a normal refresh.
    ver = _asset_version()
    with open("static/index.html", encoding="utf-8") as f:
        html = f.read()
    html = html.replace("/static/style.css", f"/static/style.css?v={ver}")
    html = html.replace("/static/app.js", f"/static/app.js?v={ver}")
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


@app.post("/meals", response_model=MealResponse)
def suggest_meals(request: MealRequest, http_request: Request, user: Optional[dict] = Depends(current_user)):
    _ai_guard(http_request, user)
    if not request.ingredients:
        raise HTTPException(status_code=400, detail="Ingredients list cannot be empty")

    if any(len(item) > MAX_MEAL_ITEM_LEN for item in request.ingredients):
        raise HTTPException(status_code=400, detail="One of the ingredients is too long")

    if request.meal_type not in {"breakfast", "lunch", "dinner"}:
        raise HTTPException(
            status_code=400,
            detail="meal_type must be breakfast, lunch, or dinner",
        )

    prompt = f"""You are a traditional cooking expert.

RULES:
- Use only traditional cooking methods
- No modern or processed food techniques
- Keep explanations very short
- Focus on regional dishes from around the world
- Respond in {request.language}

OUTPUT RULES (VERY IMPORTANT):
- Return ONLY valid JSON
- Do NOT include explanations, markdown, or extra text
- The JSON MUST match this structure exactly:

{{
  "suggestions": [
    {{
      "dish": "string",
      "region": "string",
      "description": "string"
    }}
  ]
}}

Ingredients: {", ".join(request.ingredients)}
Meal type: {request.meal_type}

Return 3-5 meal suggestions."""

    try:
        response = client.responses.create(model="gpt-4.1-mini", input=prompt)
    except Exception as exc:
        logger.exception("OpenAI request failed")
        raise HTTPException(status_code=502, detail="The AI service is temporarily unavailable. Please try again.") from exc
    data = _parse_json(response.output_text)

    try:
        validated = MealResponse(**data)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Response JSON does not match expected schema") from exc

    return validated


_MD_LINK = re.compile(r"\[([^\]]*)\]\((https?://[^)\s]+)\)")
# A parenthetical made up entirely of one or more markdown links, e.g. "([FDA](url), [Oceana](url))"
_PAREN_CITATION = re.compile(r"\s*\(\s*(?:\[[^\]]*\]\(https?://[^)\s]+\)\s*[,;]?\s*)+\)")


def _clean_url(url: str) -> str:
    url = re.sub(r"[?&]utm_source=openai\b", "", url)
    return url.rstrip("?&")


def _strip_citations(value, collected: list):
    """Recursively remove inline markdown citations from string fields,
    collecting every URL into `collected` so nothing is lost."""
    if isinstance(value, str):
        for m in _MD_LINK.finditer(value):
            title, url = m.group(1).strip(), _clean_url(m.group(2))
            collected.append({"title": title or url, "url": url})
        text = _PAREN_CITATION.sub("", value)
        text = _MD_LINK.sub(lambda m: m.group(1), text)
        return re.sub(r"\s{2,}", " ", text).replace(" .", ".").strip()
    if isinstance(value, list):
        return [_strip_citations(v, collected) for v in value]
    if isinstance(value, dict):
        return {k: _strip_citations(v, collected) for k, v in value.items()}
    return value


def _citation_sources(response) -> list:
    """Pull url_citation annotations attached by the web-search tool."""
    sources = []
    for item in getattr(response, "output", None) or []:
        for part in getattr(item, "content", None) or []:
            for ann in getattr(part, "annotations", None) or []:
                if getattr(ann, "type", "") == "url_citation":
                    url = _clean_url(getattr(ann, "url", "") or "")
                    if url:
                        sources.append({"title": getattr(ann, "title", "") or url, "url": url})
    return sources


def _dedupe_sources(sources: list) -> list:
    seen, out = set(), []
    for s in sources:
        key = s["url"].rstrip("/")
        if key not in seen:
            seen.add(key)
            out.append(s)
    return out


def _strip_trailing_commas(s: str) -> str:
    return re.sub(r",(\s*[}\]])", r"\1", s)


def _close_unbalanced(s: str) -> str:
    """If a JSON object/array got truncated, append the missing closers so it parses.
    Tracks string state so braces inside strings are ignored."""
    stack, in_str, esc = [], False, False
    for ch in s:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append(ch)
        elif ch == "}" and stack and stack[-1] == "{":
            stack.pop()
        elif ch == "]" and stack and stack[-1] == "[":
            stack.pop()
    tail = s.rstrip()
    if in_str:
        tail += '"'
    tail = _strip_trailing_commas(tail)
    for opener in reversed(stack):
        tail += "}" if opener == "{" else "]"
    return tail


def _extract_json(raw_text: str):
    """Best-effort parse of model output. Returns a dict/list, or None if hopeless."""
    if not raw_text:
        return None
    text = raw_text.strip()

    # Pull out of a ```json ... ``` fence if present.
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()

    def candidates():
        yield text
        for op, cl in (("{", "}"), ("[", "]")):
            a, b = text.find(op), text.rfind(cl)
            if a != -1 and b > a:
                sub = text[a:b + 1]
                yield sub
                yield _strip_trailing_commas(sub)
        # Last resort: truncated output — close what was left open.
        a = text.find("{")
        if a != -1:
            yield _close_unbalanced(text[a:])

    for cand in candidates():
        try:
            return json.loads(cand)
        except (json.JSONDecodeError, ValueError):
            continue
    return None


def _parse_json(raw_text: str):
    data = _extract_json(raw_text)
    if data is None:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON")
    return data


_NO_INLINE_CITATIONS = """

IMPORTANT: Do NOT put citations, source names, URLs, or markdown links inside any JSON string value — keep the prose clean and readable. Your search citations are captured separately."""


def _run_json_prompt(prompt: str, with_search: bool = True):
    kwargs = {"model": "gpt-4.1-mini", "input": prompt + (_NO_INLINE_CITATIONS if with_search else "")}
    if with_search:
        kwargs["tools"] = [{"type": "web_search_preview"}]
    try:
        response = client.responses.create(**kwargs)
    except Exception as exc:
        logger.exception("OpenAI request failed")
        raise HTTPException(status_code=502, detail="The AI service is temporarily unavailable. Please try again.") from exc
    citation_sources = _citation_sources(response)
    data = _extract_json(response.output_text)

    # If the model returned malformed/truncated output, ask it once to fix the JSON.
    if data is None:
        try:
            repair = client.responses.create(
                model="gpt-4.1-mini",
                input=(
                    "The text below was supposed to be a single JSON object but is malformed "
                    "or truncated. Return ONLY a corrected, complete, valid JSON object — fix "
                    "syntax, remove trailing commas, close any unclosed brackets. No markdown, "
                    "no commentary:\n\n" + (response.output_text or "")
                ),
            )
            data = _extract_json(repair.output_text)
        except Exception:
            logger.exception("JSON repair request failed")

    if data is None:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON")

    if isinstance(data, dict):
        inline_sources = []
        data = _strip_citations(data, inline_sources)
        data["sources"] = _dedupe_sources(citation_sources + inline_sources)
    return data


def _themealdb_image(ingredient: str) -> Optional[str]:
    """TheMealDB hosts clean, recognizable product photos of common ingredients
    on a plain background (e.g. the actual turmeric powder, not the plant).
    Returns the URL only if a real image exists for this ingredient."""
    try:
        name = urllib.parse.quote(ingredient.strip().title())
        url = f"https://www.themealdb.com/images/ingredients/{name}.png"
        req = urllib.request.Request(url, headers={"User-Agent": "Food.io/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            ctype = resp.headers.get("Content-Type", "")
            clen = int(resp.headers.get("Content-Length") or 0)
            # A missing ingredient returns a tiny placeholder; require a real image.
            if resp.status == 200 and "image" in ctype and clen > 1500:
                return url
    except Exception:
        pass
    return None


def _wikipedia_image(ingredient: str) -> Optional[str]:
    try:
        title = urllib.parse.quote(ingredient.strip().replace(" ", "_"))
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
        req = urllib.request.Request(url, headers={"User-Agent": "Food.io/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        thumb = (data.get("originalimage") or {}).get("source") or (data.get("thumbnail") or {}).get("source")
        return thumb
    except Exception:
        return None


def _ingredient_photo(ingredient: str) -> Optional[str]:
    """Prefer a clean product shot of the actual ingredient; fall back to
    Wikipedia's lead image for anything TheMealDB doesn't cover."""
    return _themealdb_image(ingredient) or _wikipedia_image(ingredient)


def _reverse_geocode(latitude: float, longitude: float) -> Optional[str]:
    """Turn GPS coordinates into a human place name (e.g. 'Somerville, Massachusetts')
    using OpenStreetMap's free Nominatim service. Returns None on failure."""
    try:
        lat = max(-90.0, min(90.0, float(latitude)))
        lon = max(-180.0, min(180.0, float(longitude)))
        params = urllib.parse.urlencode({
            "lat": lat, "lon": lon, "format": "json", "zoom": "12", "addressdetails": "1",
        })
        url = f"https://nominatim.openstreetmap.org/reverse?{params}"
        req = urllib.request.Request(url, headers={"User-Agent": "Food.io/1.0 (ingredient sourcing)"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        addr = data.get("address") or {}
        town = (addr.get("neighbourhood") or addr.get("suburb") or addr.get("city")
                or addr.get("town") or addr.get("village") or addr.get("county"))
        region = addr.get("state") or addr.get("region") or addr.get("country")
        parts = [p for p in (town, region) if p]
        if parts:
            return ", ".join(parts)
        return data.get("display_name")
    except Exception:
        return None


@app.post("/ingredient/image")
def ingredient_image(request: IngredientRequest, http_request: Request, user: Optional[dict] = Depends(current_user)):
    _ai_guard(http_request, user)
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")
    return {"image_url": _ingredient_photo(request.ingredient)}


@app.post("/ingredient/info")
def ingredient_info(request: IngredientRequest, http_request: Request, user: Optional[dict] = Depends(current_user)):
    _ai_guard(http_request, user)
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    # Logged-in users get their searches recorded (one entry per search —
    # the other 7 endpoints of a search fan-out don't record).
    if user:
        with _db() as conn:
            conn.execute(
                "INSERT INTO history (user_id, ingredient, location, searched_at) VALUES (?, ?, ?, ?)",
                (user["id"], request.ingredient.strip(), request.location, time.time()),
            )
            # Keep only the most recent N searches per user so the table can't
            # grow without bound.
            conn.execute(
                """DELETE FROM history WHERE user_id = ? AND id NOT IN (
                       SELECT id FROM history WHERE user_id = ?
                       ORDER BY searched_at DESC LIMIT ?
                   )""",
                (user["id"], user["id"], MAX_HISTORY_PER_USER),
            )

    prompt = f"""You are a culinary historian and nutritionist expert.

Search the web to find accurate, up-to-date information about the ingredient: "{request.ingredient}"
Use your search results to ground your response in real sources.
Respond in {request.language}.

Keep everything SHORT, plain, and scannable. Prefer simple wording a busy home cook can skim.
Write full sentences only for "description" and "history" (and keep those brief); everything else should be short bullet phrases, NOT paragraphs.

Return ONLY valid JSON with this exact structure — no markdown, no extra text:
{{
  "name": "string",
  "description": "string (2-3 short, simple sentences — what it is and what it tastes like)",
  "key_facts": ["3-5 very short bullet phrases: flavor, texture, typical cook time, diet notes, etc. (e.g. 'Nutty, chewy', 'Cooks in ~30 min', 'High in fiber')"],
  "origin": "string (short — region + rough era, e.g. 'Fertile Crescent, ~10,000 years ago')",
  "history": "string (2-3 short sentences max — no walls of text)",
  "nutritional_highlights": "string (one short sentence summary)",
  "nutrition_facts": ["short bullet phrases with numbers where known (e.g. '170 cal per 1/4 cup', '6g protein', '5g fiber')"],
  "common_uses": ["3-5 short bullet phrases of how it's used (e.g. 'Salads', 'Soups & stews', 'Grain bowls')"],
  "best_season": "string (short)",
  "buying_tips": ["2-4 short bullet phrases on what to look for when buying"],
  "storage_tips": ["2-4 short bullet phrases on how to store it"],
  "fun_fact": "string (one short surprising sentence)"
}}"""

    return _run_json_prompt(prompt)


@app.post("/ingredient/cooking")
def ingredient_cooking(request: IngredientRequest, http_request: Request, user: Optional[dict] = Depends(current_user)):
    _ai_guard(http_request, user)
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a master chef and culinary instructor.

Research how to correctly cook and prepare "{request.ingredient}" based on authoritative cooking sources, traditional culinary practice, and food science.
Cover the full life-cycle: cleaning, prepping, ideal cooking methods, common mistakes, doneness cues, and pairings.
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "preparation": "string (cleaning, peeling, trimming, soaking — whatever applies)",
  "primary_methods": [
    {{
      "method": "string (e.g., 'Steaming', 'Roasting', 'Braising', 'Toasting')",
      "why_it_works": "string (food-science reasoning)",
      "step_by_step": "string (numbered or sequential steps)",
      "time_and_temp": "string (specific minutes / °F or °C)",
      "doneness_cues": "string (visual / texture / aroma cues)"
    }}
  ],
  "common_mistakes": ["string", "string", "string"],
  "common_uses": "string (what this ingredient is used for day to day: cuisines it stars in, dish types, condiments, drinks, desserts)",
  "classic_dishes": ["string (a famous dish it's essential to, with one-line description)", "string", "string"],
  "flavor_pairings": "string (classic ingredients that pair well)",
  "pro_tips": "string (2-3 expert tips)"
}}

Provide 3-4 primary cooking methods that genuinely suit this ingredient, and 3-5 classic dishes."""

    return _run_json_prompt(prompt)


@app.post("/ingredient/authenticity")
def ingredient_authenticity(request: IngredientRequest, http_request: Request, user: Optional[dict] = Depends(current_user)):
    _ai_guard(http_request, user)
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a food authentication and fraud-prevention expert.

Research "{request.ingredient}" so a regular shopper can tell whether what they're buying is REAL or FAKE. Cover:
1. Fraud & counterfeits — how it's commonly faked, adulterated, mislabeled, or substituted
2. GMO status — is a genetically modified version of this crop grown commercially? How can a shopper tell / avoid it?
3. Organic — what organic certification means for this specific item and how to verify it (USDA Organic seal, PLU codes starting with 9, etc.)

Use real reporting (e.g., FDA, USDA, EU food fraud reports, Non-GMO Project, Oceana, journalism) to ground your answer.
Keep every field SHORT and scannable — bullet phrases and 1-2 sentence explanations, not paragraphs.
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text, no trailing commas:
{{
  "ingredient": "string",
  "fraud_risk": "string ('Low' | 'Medium' | 'High' | 'Very High')",
  "fraud_overview": "string (2-3 short sentences explaining how it's commonly faked)",
  "gmo_status": "string (short verdict, e.g. 'No GMO version exists commercially' or 'Commonly GMO — ~90% of US crop is genetically modified')",
  "gmo_details": "string (1-2 short sentences: how to avoid or identify the GMO version — Non-GMO Project seal, organic certification, country of origin)",
  "organic_guidance": "string (1-2 short sentences: what organic means for THIS item, whether it's worth it, and how to verify — seals, PLU code starting with 9)",
  "common_fakes": [
    {{
      "fake_name": "string (e.g., 'Safflower passed off as saffron')",
      "how_it_is_faked": "string (one short sentence)",
      "how_to_spot_it": "string (specific test or visual / smell / taste cue, short)"
    }}
  ],
  "authenticity_checks": ["string (concrete at-home test or label check, short)", "string", "string"],
  "trusted_certifications": "string (real seals to look for: USDA Organic, Non-GMO Project, DOP/PDO, Fair Trade)",
  "where_to_buy_authentic": "string (1-2 short sentences: trusted vendor types, regions of origin)",
  "red_flags": ["string (short)", "string", "string"]
}}

Provide 3-5 common fakes/adulterations and 3-5 authenticity checks."""

    return _run_json_prompt(prompt)


@app.post("/ingredient/cultivation")
def ingredient_cultivation(request: IngredientRequest, http_request: Request, user: Optional[dict] = Depends(current_user)):
    _ai_guard(http_request, user)
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a horticulturist and small-farm grower.

Research how to grow "{request.ingredient}" at home, in a garden, or on a small farm. Use authoritative horticulture and extension-service sources.
If the ingredient cannot reasonably be grown by a regular person (e.g., it's an animal product, a deep-sea fish, an industrial extract), say so clearly in "growability" and explain what is realistic instead (e.g., raising chickens for eggs, sourcing wild-foraged, etc.).
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "growability": "string ('Easy' | 'Moderate' | 'Hard' | 'Not typically grown — explanation')",
  "climate": "string (zones, temperature ranges)",
  "soil": "string (pH, drainage, composition)",
  "sunlight_water": "string",
  "propagation": "string (seed, cutting, division, tuber, etc., with timing)",
  "growing_steps": ["string (step 1)", "string (step 2)", "string (step 3)", "string (step 4)"],
  "time_to_harvest": "string",
  "harvest_signs": "string (when and how to harvest)",
  "common_pests_diseases": "string",
  "container_friendly": "string (yes/no + tips for pot growing if applicable)"
}}"""

    return _run_json_prompt(prompt)


@app.post("/ingredient/preservation")
def ingredient_preservation(request: IngredientRequest, http_request: Request, user: Optional[dict] = Depends(current_user)):
    _ai_guard(http_request, user)
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a food-safety and preservation expert (USDA / NCHFP / Ball Canning–level knowledge).

Research safe, effective ways to store and preserve "{request.ingredient}", with realistic shelf-life estimates from authoritative sources (USDA FoodKeeper, NCHFP, StillTasty, etc.).
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "shelf_life": {{
    "pantry": "string (or 'N/A')",
    "refrigerator": "string (or 'N/A')",
    "freezer": "string (or 'N/A')"
  }},
  "best_storage": "string (the optimal default storage method and why)",
  "storage_dos_and_donts": ["string", "string", "string"],
  "preservation_methods": [
    {{
      "method": "string (e.g., 'Freezing', 'Pickling', 'Drying', 'Fermenting', 'Canning', 'Curing')",
      "how_to": "string (step-by-step at home)",
      "shelf_life": "string (realistic span)",
      "safety_notes": "string (botulism / acidity / temp / sealing concerns where relevant)"
    }}
  ],
  "spoilage_signs": "string (smell, texture, color, mold cues)",
  "freshness_revival": "string (e.g., wilted greens in ice water — only if applicable; else 'N/A')"
}}

Provide 3-4 preservation methods that actually suit this ingredient."""

    return _run_json_prompt(prompt)


@app.post("/ingredient/markets")
def ingredient_markets(request: IngredientRequest, http_request: Request, user: Optional[dict] = Depends(current_user)):
    _ai_guard(http_request, user)
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    # If the browser sent GPS coordinates, turn them into a real place name so
    # the web search can find genuinely nearby markets.
    location = request.location
    if not location and request.latitude is not None and request.longitude is not None:
        location = _reverse_geocode(request.latitude, request.longitude)

    if location:
        location_search = f"near {location}"
        location_line = (
            f'The person is located near "{location}". Prioritize REAL, specific, named '
            f'farmers markets, organic/natural-food stores, and ethnic grocers that are '
            f'actually in or close to {location}, with neighborhoods or cross-streets where known.'
        )
    else:
        location_search = "at farmers markets, organic markets, and specialty stores"
        location_line = "No specific location was given — describe the best types of places to look."

    prompt = f"""You are a local food sourcing expert helping people find fresh, high-quality ingredients.

Search the web to find real, current places to buy "{request.ingredient}" {location_search}.
{location_line}
Focus on farmers markets, organic and natural-food markets, ethnic grocery stores, food co-ops, and specialty shops — never big chains.

Focus ONLY on these source types:
- Farmers markets and farm stands
- Organic / natural-food markets and health-food stores (e.g. local co-op naturals)
- Chinese / Asian supermarkets
- Korean markets (like H Mart)
- Japanese grocery stores
- Mexican or Latin American mercados
- Middle Eastern or specialty ethnic grocery stores
- Italian delis and specialty stores
- Food co-ops and buying clubs
- CSA (Community Supported Agriculture) farm boxes
- Local independent grocers known for fresh produce

Do NOT suggest Walmart, Target, Kroger, Safeway, or similar large chains.
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "searched_near": {json.dumps(location) if location else '""'},
  "places": [
    {{
      "type": "string",
      "name": "string (the actual market/store name if found, else empty)",
      "description": "string (include real store or market names and neighborhoods if found online)",
      "why_quality": "string",
      "what_to_look_for": "string",
      "typical_availability": "string",
      "price_context": "string"
    }}
  ],
  "seasonal_advice": "string",
  "quality_indicators": "string",
  "sourcing_tip": "string (a specific real-world tip from your search)"
}}

Provide 3-5 most relevant places — prefer specific named markets near the person when a location is known."""

    return _run_json_prompt(prompt)


@app.post("/ingredient/recipes")
def ingredient_recipes(request: IngredientRequest, http_request: Request, user: Optional[dict] = Depends(current_user)):
    _ai_guard(http_request, user)
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a culinary historian researching real recipes for "{request.ingredient}".

Search the web for:
- Documented historical recipes using "{request.ingredient}" from ancient, medieval, and pre-modern sources
- Real traditional cooking methods and techniques from different cultures
- Authentic modern recipes from reputable food sites, chefs, or culinary publications
- For each recipe, an actual YouTube video that demonstrates making that dish (search "<dish name> recipe youtube")

Use your search results to provide accurate, sourced recipes spanning human culinary history.
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "historical_recipes": [
    {{
      "name": "string",
      "era": "string (e.g., 'Ancient Egypt', 'Tang Dynasty China', 'Medieval Europe')",
      "period": "string (e.g., '3000 BCE', '700s CE', '1300s AD')",
      "region": "string",
      "description": "string",
      "historical_context": "string (include source or reference if found)",
      "ingredients_summary": "string",
      "method": "string (authentic traditional technique)",
      "video_url": "string (a real, full YouTube watch URL you actually found in search that shows how to make this dish, e.g. 'https://www.youtube.com/watch?v=...'; use an empty string '' if you did not find a genuine one — never invent or guess a URL)"
    }}
  ],
  "modern_recipes": [
    {{
      "name": "string",
      "style": "string (e.g., 'Contemporary French', 'Modern Japanese')",
      "description": "string",
      "ingredients_summary": "string",
      "method": "string",
      "video_url": "string (a real, full YouTube watch URL you actually found in search that shows how to make this dish; use an empty string '' if you did not find a genuine one — never invent or guess a URL)"
    }}
  ]
}}

For video_url, only include a link you genuinely encountered in your web search results. If unsure, leave it as an empty string — a wrong link is worse than none.

Provide 4-5 historical recipes spanning different eras and world regions (covering at least 1000 years), and 2-3 modern recipes."""

    return _run_json_prompt(prompt)
