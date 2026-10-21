# Login & Authentication Architecture

Design for user authentication in askLio. This supersedes the "authentication is a non-goal" stance of the first iteration in [PROJECT_PLAN.md](PROJECT_PLAN.md) — the product now gains accounts, but with the same pragmatic, locally-deployable constraints.

## Goals & constraints

| Goal | Detail |
|------|--------|
| Distinguish actors | **Requestor** (submits procurement requests) vs **Procurement** (manages request status) — the role split already assumed by [ARCHITECTURE.md](ARCHITECTURE.md) and [DEPLOYMENT.md](DEPLOYMENT.md) |
| Protect data | Requests and status history are only visible to authenticated users |
| Preserve the demo contract | Local deployment with **no external identity provider dependency**; the app must still start without cloud services |
| Prove the UI | A visible login/logout flow exercises the design system ([DESIGN.md](DESIGN.md)) end-to-end |

Out of scope for this iteration: SSO/OIDC federation, multi-tenancy, password reset via email (no mail server locally), MFA, SCIM provisioning.

## Identity model

### Actors

| Role | Can do |
|------|--------|
| `requestor` | Create requests, upload offers, view **own** requests and their history |
| `procurement` | View **all** requests, update status, full access to status history |
| `admin` | `procurement` + user management (create/disable accounts) |

Authorization is enforced **server-side at the API boundary**; the front-end only hides what the role cannot see — it never decides authorization.

### Account type

Local accounts (username/email + password), stored in the app database. No OAuth — no third-party dependency, aligns with "deployment on your local machine is fine".

Seeding: first start creates a configurable set of accounts from environment variables (e.g. `SEED_USERS="ana:ana@example.com:requestor,..."`), so demo/evaluation environments have working logins without a signup flow. Registration is disabled by default — the admin creates accounts.

## Sessions (recommended approach)

**Server-side sessions with an HTTP-only cookie**, not JWTs:

| Consideration | Why sessions win here |
|---------------|----------------------|
| Logout / revocation | Server deletes the session row — instant, no token blacklist needed |
| Status changes by `procurement` are audited | Session row carries the user id; every status-history entry records *who*, matching the audit requirement in [ARCHITECTURE.md](ARCHITECTURE.md) |
| Front-end complexity | Cookie auth works with same-origin requests, no token storage in JS (an XSS cannot read it) |
| Scale | Irrelevant at local/demo scale; JWT's scaling advantage buys nothing here |

Session parameters: opaque random id (128-bit, not derivable from user data), `HttpOnly` + `SameSite=Lax` + `Secure` (in HTTPS contexts) cookie, server-side expiry after e.g. 12 hours of idle, sliding renew.

## Data model

```
USER (new)
├─ id
├─ email            (unique)
├─ password_hash    (bcrypt — never plaintext, never reversible)
├─ role             (requestor | procurement | admin)
├─ display_name
├─ created_at
└─ disabled_at      (soft-disable instead of hard delete, to keep history authors)

SESSION (new)
├─ id               (opaque token)
├─ user_id (FK)
├─ created_at
├─ last_seen_at     (for idle expiry)
└─ expires_at
```

Existing tables change minimally:

- `REQUEST` gains `created_by → USER.id` (requestor identity now comes from the session, not a free-text field — the existing `requestor_name` stays as the human-readable name taken from the account).
- `STATUS_HISTORY` gains `changed_by → USER.id` (nullable, for pre-auth seed data) — completing "retain every status update accurately" with the *actor*.

## Flows

### Login

```
Browser                          Back-end
   │  POST /auth/login               │
   │  {email, password}              │
   │────────────────────────────────▶│ lookup user (by email)
   │                                 │ verify password (constant-time)
   │                                 │ ── on failure: uniform error,
   │                                 │    increment rate-limit counter
   │                                 │ ── on success: create SESSION row
   │◀──── Set-Cookie: session=…;HttpOnly;SameSite=Lax ──────┐
   │  redirect to role's home               │
   │        (requestor → intake, procurement → overview)    │
```

Notes:

- **Uniform failure message** ("invalid email or password") for unknown user and bad password — no user enumeration.
- **Rate limit** per email and per IP (e.g. 5 attempts / 15 min) — plain counters in the DB or memory; no Redis dependency.
- Passwords: **bcrypt** (`bcrypt` PyPI package, cost ≥ 12) via the `bcrypt` library's constant-time `checkpw`; never logged, never returned.

### Authenticated request

Every API call (except `/auth/login`, `/auth/logout`) requires a valid session cookie → resolved to `User` → role checked against the route. Invalid/expired session → `401` → front-end redirects to `/login`. Role mismatch → `403`.

### Logout

`POST /auth/logout` deletes the session row and clears the cookie. Front-end also discards cached request lists.

## API surface

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /auth/login` | none | Authenticate, create session |
| `POST /auth/logout` | session | Destroy session |
| `GET /auth/me` | session | Current user (id, email, role, display name) — the front-end bootstraps role-dependent UI from this |
| *(existing request endpoints)* | session + role | Role rules as in the Identity model |

CSRF: cookie auth needs CSRF protection on state-changing endpoints — the standard mitigations apply (`SameSite=Lax` blocks cross-site POSTs from other origins; additionally a per-session CSRF token for state-changing calls, or the Double Submit Cookie pattern).

## Front-end

- `/login` view per [DESIGN.md](DESIGN.md) components: minimal card (radius 20px, raised surface), pill primary button, `#767676` hairline inputs, error text in the standard error style.
- Router guard: unauthenticated → `/login`; authenticated user hitting `/login` → their home.
- Role-dependent navigation: `requestor` sees intake + own requests; `procurement`/`admin` see the full overview (incl. status controls).
- Front-end calls `GET /auth/me` on boot instead of storing user data in `localStorage`.

## Security checklist

- [x] Passwords hashed (bcrypt, cost ≥ 12), constant-time comparison
- [x] Cookie `HttpOnly`, `SameSite=Lax`, `Secure` when HTTPS
- [x] Server-side revocation on logout and on password change (drop other sessions)
- [x] Login rate limiting + uniform failure messages
- [x] Authorization enforced server-side, per-route (role)
- [x] CSRF protection on state-changing endpoints
- [x] Session ids: 128-bit random, rotated on login, expired sessions purged
- [x] Soft-disabled users: sessions revoked at disable time; history authors preserved

## Testing impact

Additions to [TESTING.md](TESTING.md) / [E2E_TESTING.md](E2E_TESTING.md):

- **API tests**: login success/failure uniformity, rate limiting, expired-session 401, role-based 403 (`requestor` cannot update status or view foreign requests), CSRF rejection.
- **Hash-format test**: stored `USER.password_hash` is never the plaintext.
- **E2E journeys**:
  - **J7 — login flow**: visit app → redirected to `/login` → wrong password shows uniform error → login as requestor → lands on intake → logout → `/login` again.
  - **J8 — role visibility**: login as `requestor` → no status controls; login as `procurement` → sees all requests, updates a status; status history now shows the actor's display name.
  - **J9 — persistence across restarts** extended: session survives app restart (session row in DB), logout is durable.

## Implementation notes (when the auth slice landed)

Decisions made during implementation, amending the checklist above:

- **Session tokens are stored hashed** (SHA-256 of the cookie token in `sessions.id`) — a DB leak yields no usable session credentials; only the cookie holds the usable secret. The checklist's "opaque random id" is thus stronger than the token itself.
- **Login timing is equalized**: the unknown-email path runs a dummy bcrypt check, so unknown-email vs wrong-password are indistinguishable in response time (~cost-12) — enumeration is blocked beyond the uniform message.
- **Inputs are bounded at the boundary**: email ≤ 254 chars, password ≤ 1024 chars; anything longer gets the uniform 401 (no size oracle). bcrypt's 72-byte truncation is documented in `app/auth.py` (`BCRYPT_MAX_BYTES`).
- **Rate limiting** is an in-process per-(ip, email) failed-attempt map (5 / 15 min, success clears the key): expired keys are pruned and the map is hard-capped (10 000) so unauthenticated traffic cannot grow it without end. Counters reset on app restart — an accepted local-deployment trade-off.
- **CSF-state**: no CORS middleware exists yet — the API is same-origin (FastAPI serves the SPA or a dev proxy fronts it), and `SameSite=Lax` blocks cross-site POSTs. CSRF tokens become mandatory with the first cross-origin transport (frontend `api/http.js` behind a proxy or any `Access-Control-Allow-*` usage).
- **Proxy hardening**: the `Secure` flag derives from `request.url.scheme`; behind a TLS-terminating proxy this needs forwarded-proto handling (uvicorn `--proxy-headers --forwarded-allow-ips=…`) so cookies aren't downgraded to non-Secure.

## Path to production

What a hosted deployment would swap in (no architecture change): local accounts → **OIDC federation** (company SSO), session cookie unchanged; `admin` user management becomes directory groups; password policies disappear (SSO owns them). The route table above already models this: `/auth/login` becomes the OIDC redirect entry point.