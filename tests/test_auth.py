"""Auth API tests — the LOGIN_ARCHITECTURE.md rules at the boundary:
login success/failure uniformity, rate limiting, session revocation (401),
bcrypt hash storage, soft-disabled accounts."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import config
from app.auth import _token_hash, hash_password
from app.main import app
from app.routers.auth import (
    _FAILED,
    _FAILED_CAP,
    MAX_EMAIL_LENGTH,
    MAX_PASSWORD_LENGTH,
    UNIFORM_FAILURE,
)
from tests.conftest import connect


@pytest.fixture(autouse=True)
def clean_db():
    with connect() as conn:
        conn.execute("DELETE FROM sessions")
        conn.execute("DELETE FROM users")
    _FAILED.clear()
    yield
    _FAILED.clear()


@pytest.fixture()
def client():
    # Entering the client runs lifespan → schema init + account seeding.
    with TestClient(app) as c:
        yield c


def login(c: TestClient, email: str, password: str = "demo"):
    return c.post("/auth/login", json={"email": email, "password": password})


def test_login_success_and_me(client):
    res = login(client, "ANA@example.com")  # email match is case-insensitive
    assert res.status_code == 200
    user = res.json()["user"]
    assert user == {
        "id": user["id"],  # shape check via keys below
        "email": "ana@example.com",
        "role": "requestor",
        "display_name": "Ana Weber",
    }
    assert list(user) == ["id", "email", "role", "display_name"]
    assert res.headers.get("set-cookie", "").startswith(f"{config.SESSION_COOKIE}=")
    assert "HttpOnly" in res.headers["set-cookie"]
    assert "SameSite=lax" in res.headers["set-cookie"]

    me = client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "ana@example.com"


def test_seed_roles(client):
    assert login(client, "admin@example.com").status_code == 200
    me = client.get("/auth/me")
    assert me.json()["user"]["role"] == "admin"


def test_wrong_password_uniform_failure(client):
    wrong = login(client, "ana@example.com", "nope")
    unknown = login(client, "nobody@example.com", "nope")
    assert wrong.status_code == unknown.status_code == 401
    # Same body for bad password and unknown email — no enumeration.
    assert wrong.json()["detail"] == unknown.json()["detail"] == UNIFORM_FAILURE


def test_me_requires_session(client):
    res = client.get("/auth/me")
    assert res.status_code == 401


def test_logout_revokes_session(client):
    assert login(client, "kim@example.com").status_code == 200
    assert client.get("/auth/me").status_code == 200
    client.post("/auth/logout")
    assert client.get("/auth/me").status_code == 401


def test_logout_without_session_clears_cookie(client):
    res = client.post("/auth/logout")
    assert res.status_code == 200


def test_login_rate_limited(client):
    email = "ana@example.com"
    for _ in range(config.LOGIN_MAX_ATTEMPTS):
        assert login(client, email, "nope").status_code == 401
    assert login(client, email).status_code == 429
    # A different email is unaffected (per-email counters).
    assert login(client, "kim@example.com").status_code == 200


def test_successful_login_resets_rate_limit(client):
    for _ in range(config.LOGIN_MAX_ATTEMPTS - 1):
        assert login(client, "ana@example.com", "nope").status_code == 401
    assert login(client, "ana@example.com").status_code == 200
    assert login(client, "ana@example.com", "nope").status_code == 401  # 1 failure again, not 429


def test_password_never_plaintext(client):
    with connect() as conn:
        row = conn.execute(
            "SELECT password_hash FROM users WHERE email = 'ana@example.com'"
        ).fetchone()
    assert row["password_hash"] != "demo"
    assert row["password_hash"].startswith("$2")


def test_disabled_account_cannot_login(client):
    with connect() as conn:
        conn.execute(
            "INSERT INTO users (email, password_hash, role, display_name, disabled_at)"
            " VALUES ('off@example.com', %s, 'requestor', 'Off User', now())",
            (hash_password("demo"),),
        )
    assert login(client, "off@example.com").status_code == 401


def test_seed_is_idempotent(client):
    first = login(client, "ana@example.com")
    assert first.status_code == 200
    client.post("/auth/logout")
    _FAILED.clear()
    with TestClient(app) as again:  # re-run lifespan (init_db + seed_users)
        assert login(again, "ana@example.com").status_code == 200


def test_overlong_inputs_get_uniform_401(client):
    long_email = "A" * (MAX_EMAIL_LENGTH + 1)
    long_pw = "P" * (MAX_PASSWORD_LENGTH + 1)
    assert client.post("/auth/login", json={"email": long_email, "password": "x"}).json()["detail"] == UNIFORM_FAILURE
    assert client.post("/auth/login", json={"email": "ana@example.com", "password": long_pw}).json()["detail"] == UNIFORM_FAILURE
    # And the overlong email must not have been admitted as a rate-limit key.
    assert not client.post(
        "/auth/login", json={"email": "A" * 500, "password": "x"}
    ).status_code == 429


def test_session_tokens_stored_hashed(client):
    token = login(client, "ana@example.com").headers["set-cookie"].split("=")[1].split(";")[0]
    with connect() as conn:
        rows = conn.execute("SELECT id FROM sessions").fetchall()
    assert len(rows) == 1
    stored = rows[0]["id"]
    assert stored != token
    assert stored == _token_hash(token)


def test_rate_limit_memory_capped(client):
    for i in range(_FAILED_CAP + 1):
        _FAILED[(f"ip{i}", f"bulk{i}@example.com")] = [0.0]
    assert len(_FAILED) > _FAILED_CAP
    login(client, "ana@example.com", "nope")  # triggers eviction
    assert len(_FAILED) <= _FAILED_CAP


def test_expired_sessions_purged_on_boot(client):
    token = login(client, "ana@example.com").headers["set-cookie"].split("=")[1].split(";")[0]
    with connect() as conn:
        conn.execute(
            "UPDATE sessions SET expires_at = %s WHERE id = %s",
            (datetime.now(timezone.utc), _token_hash(token)),
        )
    with TestClient(app) as _:  # boot purges expired sessions
        pass
    with connect() as conn:
        remaining = conn.execute(
            "SELECT count(*) AS n FROM sessions WHERE id = %s", (_token_hash(token),)
        ).fetchone()
    assert remaining["n"] == 0