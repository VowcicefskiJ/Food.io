# Security overview & deployment checklist

Food.io is designed so the safe settings are the defaults. This document explains
what protections are built in and the few things **you must do when hosting it on
the public internet**.

## What's built in

**Accounts & passwords**
- Passwords are hashed with **PBKDF2-HMAC-SHA256, 600,000 iterations** and a
  random 16-byte per-user salt (OWASP-recommended). Plain passwords are never
  stored or logged. The hash format is self-describing, so the cost can be
  raised later without locking anyone out.
- Login uses a **constant-time comparison** and does dummy work when a username
  doesn't exist, so attackers can't discover valid usernames by timing.
- Weak passwords are rejected (minimum 8 characters, a common-password
  blocklist, and can't equal the username).
- Sessions are random 256-bit bearer tokens, expire after 30 days, and expired
  ones are purged automatically. Logout deletes the session server-side.

**Rate limiting** (returns HTTP 429 with `Retry-After`)
- Login / registration: **10 attempts per 5 minutes** per client IP.
- AI endpoints: **60 requests/minute and 600/hour** per user (per IP when signed
  out). One ingredient search = 8 requests.
- Saves/deletes: **60 per minute** per user.

**Input & abuse limits**
- Request bodies over **64 KB** are rejected before being read.
- Ingredient, location, language, username, password, and saved-item fields all
  have hard length caps, so oversized input can't reach the AI (which costs
  money) or bloat the database.
- Per-user caps: 500 favorites, 100 history entries (oldest trimmed).
- All database access uses parameterized queries (no SQL injection). All
  user/AI content is HTML-escaped before display (XSS mitigation).

**HTTP hardening** (headers on every response)
- `Content-Security-Policy` restricting scripts, styles, images, and
  connections to known sources.
- `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` (clickjacking).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`.
- Host-header validation (set `ALLOWED_HOSTS`).
- Unhandled errors return a generic message — no stack traces leak to clients.
- Auth uses bearer tokens (not cookies), so the app is not exposed to CSRF.

## Required steps before going public

1. **Serve over HTTPS.** Put the app behind a reverse proxy (nginx, Caddy) or a
   platform that terminates TLS. Never expose plain HTTP publicly.

2. **Set these environment variables** (alongside `OPENAI_API_KEY`):

   | Variable | Set it to | Why |
   |---|---|---|
   | `ALLOWED_HOSTS` | your domain(s), e.g. `food.example.com,www.food.example.com` | Blocks Host-header attacks |
   | `TRUST_PROXY` | `1` | So rate limiting sees the real client IP from `X-Forwarded-For`, not the proxy's |
   | `HTTPS_ONLY` | `1` | Sends HSTS so browsers refuse to downgrade to HTTP |
   | `FOODIO_DB` | a path on persistent storage, e.g. `/data/foodio.db` | Keeps accounts across restarts/deploys |

3. **Run with proxy headers trusted only from your proxy.** Example:
   ```bash
   uvicorn main:app --host 127.0.0.1 --port 8000 \
       --proxy-headers --forwarded-allow-ips="127.0.0.1"
   ```
   (`--forwarded-allow-ips` should be your proxy's address.) For real traffic,
   run multiple workers behind the proxy, e.g. `gunicorn -k uvicorn.workers.UvicornWorker -w 4 main:app`.

4. **Never commit secrets.** `.env` and `foodio.db` are already git-ignored. Keep
   your `OPENAI_API_KEY` only in the server's environment.

5. **Back up the database** (`foodio.db` or your `FOODIO_DB` path) — it holds all
   user accounts, history, and favorites.

## Known limitations / good next steps

- **CSP allows `'unsafe-inline'` for scripts and styles**, because the UI uses
  inline `onclick`/`style` attributes. This still restricts external sources but
  not inline injection. The strongest next hardening step is to move event
  handlers into `app.js` and switch to a nonce-based CSP without `unsafe-inline`.
- **Rate limiting is in-memory**, so it resets on restart and isn't shared across
  multiple worker processes/servers. For a large multi-server deployment, back it
  with Redis.
- **No email/password reset or 2FA yet.** Usernames are the only identifier; if a
  user forgets their password there's no self-service recovery. Add email +
  reset tokens if you need account recovery.
- Consider a CAPTCHA on registration if you see automated signup abuse beyond
  what the IP rate limit stops.

Found a security issue? Open a private report rather than a public issue.
