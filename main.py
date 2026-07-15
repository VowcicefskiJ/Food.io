from fastapi import FastAPI, HTTPException, Request, Depends, Header
from fastapi.responses import PlainTextResponse, FileResponse, JSONResponse
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
    "img-src 'self' data: https://*.wikimedia.org https://*.wikipedia.org; "
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


@app.get("/")
def serve_ui():
    return FileResponse("static/index.html")


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
        raw_text = response.output_text
    except Exception as exc:
        logger.exception("OpenAI request failed")
        raise HTTPException(status_code=502, detail="The AI service is temporarily unavailable. Please try again.") from exc

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON") from exc

    try:
        validated = MealResponse(**data)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Response JSON does not match expected schema") from exc

    return validated


def _run_json_prompt(prompt: str, with_search: bool = True):
    kwargs = {"model": "gpt-4.1-mini", "input": prompt}
    if with_search:
        kwargs["tools"] = [{"type": "web_search_preview"}]
    try:
        response = client.responses.create(**kwargs)
        raw_text = response.output_text
    except Exception as exc:
        logger.exception("OpenAI request failed")
        raise HTTPException(status_code=502, detail="The AI service is temporarily unavailable. Please try again.") from exc
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON") from exc


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


@app.post("/ingredient/image")
def ingredient_image(request: IngredientRequest, http_request: Request, user: Optional[dict] = Depends(current_user)):
    _ai_guard(http_request, user)
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")
    return {"image_url": _wikipedia_image(request.ingredient)}


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

Return ONLY valid JSON with this exact structure — no markdown, no extra text:
{{
  "name": "string",
  "description": "string (2-3 rich paragraphs drawing from what you found)",
  "origin": "string",
  "nutritional_highlights": "string (cite specific values where found)",
  "history": "string (2 paragraphs of historically accurate context from real sources)",
  "best_season": "string",
  "selection_tips": "string",
  "storage_tips": "string",
  "fun_fact": "string (one surprising fact verified from a real source)"
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
  "flavor_pairings": "string (classic ingredients that pair well)",
  "pro_tips": "string (2-3 expert tips)"
}}

Provide 3-4 primary cooking methods that genuinely suit this ingredient."""

    return _run_json_prompt(prompt)


@app.post("/ingredient/authenticity")
def ingredient_authenticity(request: IngredientRequest, http_request: Request, user: Optional[dict] = Depends(current_user)):
    _ai_guard(http_request, user)
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a food authentication and fraud-prevention expert.

Research how "{request.ingredient}" is commonly faked, adulterated, mislabeled, or substituted in the global food market.
Use real reporting (e.g., FDA, EU food fraud reports, Oceana, Olive Oil Times, Saffron Trade Association, journalism) to ground your answer.
Explain how a regular consumer can tell the real version from a counterfeit, and where to source the authentic product.
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "fraud_risk": "string ('Low' | 'Medium' | 'High' | 'Very High')",
  "fraud_overview": "string (1-2 paragraphs explaining how it's commonly faked)",
  "common_fakes": [
    {{
      "fake_name": "string (e.g., 'Safflower passed off as saffron')",
      "how_it_is_faked": "string",
      "how_to_spot_it": "string (specific tests, visual / smell / taste cues)"
    }}
  ],
  "authenticity_checks": ["string (concrete at-home tests or label checks)", "string", "string"],
  "trusted_certifications": "string (e.g., DOP, PDO, Fair Trade, organic seals — list real ones)",
  "where_to_buy_authentic": "string (types of trusted vendors, regions of origin to look for)",
  "red_flags": ["string", "string", "string"]
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

    location_context = f"near {request.location}" if request.location else "in a typical city"
    location_search  = f"in {request.location}" if request.location else "at farmers markets and specialty stores"

    prompt = f"""You are a local food sourcing expert helping people find fresh, high-quality ingredients.

Search the web to find real, current places to buy "{request.ingredient}" {location_search}.
Look for actual farmers markets, ethnic grocery stores, food co-ops, and specialty shops — not big chains.

Focus ONLY on these source types:
- Farmers markets and farm stands
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
  "sources": [
    {{
      "type": "string",
      "description": "string (include real store names or market names if found online)",
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

Provide 3-5 most relevant source types."""

    response = client.responses.create(
        model="gpt-4.1-mini",
        tools=[{"type": "web_search_preview"}],
        input=prompt,
    )
    raw_text = response.output_text

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON") from exc

    return data


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
      "method": "string (authentic traditional technique)"
    }}
  ],
  "modern_recipes": [
    {{
      "name": "string",
      "style": "string (e.g., 'Contemporary French', 'Modern Japanese')",
      "description": "string",
      "ingredients_summary": "string",
      "method": "string"
    }}
  ]
}}

Provide 4-5 historical recipes spanning different eras and world regions (covering at least 1000 years), and 2-3 modern recipes."""

    response = client.responses.create(
        model="gpt-4.1-mini",
        tools=[{"type": "web_search_preview"}],
        input=prompt,
    )
    raw_text = response.output_text

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON") from exc

    return data
