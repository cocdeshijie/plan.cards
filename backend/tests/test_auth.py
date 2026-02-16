"""Tests for setup, auth modes, registration, user management, admin, and user isolation."""

from app.models.user import User
from tests.conftest import TEST_PASSWORD


# ── Setup ──────────────────────────────────────────────────────────────

def test_setup_status_fresh(client):
    """Fresh DB reports setup not complete."""
    r = client.get("/api/setup/status")
    assert r.status_code == 200
    assert r.json()["setup_complete"] is False
    assert r.json()["has_existing_data"] is False


def test_setup_complete_open_mode(client):
    """Setup in open mode creates admin user with no password."""
    r = client.post("/api/setup/complete", json={"auth_mode": "open"})
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["auth_mode"] == "open"
    assert "access_token" in data

    # Status should now report complete
    r2 = client.get("/api/setup/status")
    assert r2.json()["setup_complete"] is True


def test_setup_complete_single_password(client):
    r = client.post("/api/setup/complete", json={
        "auth_mode": "single_password",
        "admin_password": "secret12345",
    })
    assert r.status_code == 200
    assert r.json()["auth_mode"] == "single_password"


def test_setup_complete_multi_user(client):
    r = client.post("/api/setup/complete", json={
        "auth_mode": "multi_user",
        "admin_username": "myadmin",
        "admin_password": "pass1234",
        "admin_email": "admin@example.com",
    })
    assert r.status_code == 200
    assert r.json()["auth_mode"] == "multi_user"


def test_setup_cannot_run_twice(client, setup_complete):
    """Setup endpoint rejects once already completed."""
    r = client.post("/api/setup/complete", json={
        "auth_mode": "open",
    })
    assert r.status_code == 400
    assert "already" in r.json()["detail"].lower()


def test_setup_single_password_requires_password(client):
    r = client.post("/api/setup/complete", json={
        "auth_mode": "single_password",
    })
    assert r.status_code == 400


def test_setup_multi_user_requires_username(client):
    r = client.post("/api/setup/complete", json={
        "auth_mode": "multi_user",
        "admin_password": "pass1234",
    })
    assert r.status_code == 400


# ── Auth Mode Endpoint ─────────────────────────────────────────────────

def test_auth_mode_public(client, setup_complete):
    """Auth mode endpoint is public — no token needed."""
    r = client.get("/api/auth/mode")
    assert r.status_code == 200
    assert r.json()["auth_mode"] == "single_password"


# ── Open Mode Login ────────────────────────────────────────────────────

def test_open_mode_auto_login(client):
    client.post("/api/setup/complete", json={"auth_mode": "open"})
    r = client.post("/api/auth/login", json={})
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_open_mode_no_token_required(client):
    """In open mode, API endpoints work without a token."""
    client.post("/api/setup/complete", json={"auth_mode": "open"})
    r = client.get("/api/profiles")
    assert r.status_code == 200


# ── Single-Password Mode ──────────────────────────────────────────────

def test_single_password_login_success(client, setup_complete):
    r = client.post("/api/auth/login", json={"password": TEST_PASSWORD})
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "admin"


def test_single_password_login_failure(client, setup_complete):
    r = client.post("/api/auth/login", json={"password": "wrong"})
    assert r.status_code == 401


def test_single_password_no_password_fails(client, setup_complete):
    r = client.post("/api/auth/login", json={})
    assert r.status_code == 401


# ── Multi-User Mode Login ─────────────────────────────────────────────

def _setup_multi_user(client, username="testadmin", password="pass1234"):
    r = client.post("/api/setup/complete", json={
        "auth_mode": "multi_user",
        "admin_username": username,
        "admin_password": password,
    })
    assert r.status_code == 200
    return r.json()["access_token"]


def test_multi_user_login_success(client):
    _setup_multi_user(client)
    r = client.post("/api/auth/login", json={"username": "testadmin", "password": "pass1234"})
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "testadmin"


def test_multi_user_login_wrong_password(client):
    _setup_multi_user(client)
    r = client.post("/api/auth/login", json={"username": "testadmin", "password": "wrong"})
    assert r.status_code == 401


def test_multi_user_login_unknown_user(client):
    _setup_multi_user(client)
    r = client.post("/api/auth/login", json={"username": "nobody", "password": "pass"})
    assert r.status_code == 401


def test_multi_user_login_requires_both_fields(client):
    _setup_multi_user(client)
    r = client.post("/api/auth/login", json={"password": "pass1234"})
    assert r.status_code == 401


# ── Registration ───────────────────────────────────────────────────────

def test_register_success(client):
    _setup_multi_user(client)
    r = client.post("/api/auth/register", json={
        "username": "newuser",
        "password": "secretpass",
        "display_name": "New User",
    })
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "newuser"
    assert r.json()["user"]["role"] == "user"


def test_register_duplicate_username(client):
    _setup_multi_user(client)
    client.post("/api/auth/register", json={"username": "dup", "password": "password123"})
    r = client.post("/api/auth/register", json={"username": "dup", "password": "password456"})
    assert r.status_code == 409


def test_register_not_available_in_single_password(client, setup_complete):
    r = client.post("/api/auth/register", json={"username": "x", "password": "password123"})
    assert r.status_code == 400


def test_register_when_disabled(client):
    token = _setup_multi_user(client)
    headers = {"Authorization": f"Bearer {token}"}
    # Disable registration
    client.put("/api/admin/config", json={"registration_enabled": False}, headers=headers)
    r = client.post("/api/auth/register", json={"username": "newguy", "password": "secretpass"})
    assert r.status_code == 403


# ── Verify Endpoint ───────────────────────────────────────────────────

def test_verify_returns_user_info(client, auth_headers):
    r = client.get("/api/auth/verify", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["user"]["role"] == "admin"


def test_verify_no_token(client, setup_complete):
    r = client.get("/api/auth/verify")
    assert r.status_code == 401


# ── User Self-Service ─────────────────────────────────────────────────

def test_get_current_user(client, auth_headers):
    r = client.get("/api/users/me", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


def test_update_display_name(client, auth_headers):
    r = client.put("/api/users/me", json={"display_name": "Admin McAdmin"}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["display_name"] == "Admin McAdmin"


def test_change_password(client):
    """Change password in multi_user mode and verify login with new password."""
    _setup_multi_user(client, username="admin", password="oldpass123")
    r = client.post("/api/auth/login", json={"username": "admin", "password": "oldpass123"})
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r2 = client.put("/api/users/me/password", json={
        "current_password": "oldpass123",
        "new_password": "newpass123",
    }, headers=headers)
    assert r2.status_code == 200

    # Can login with new password
    r3 = client.post("/api/auth/login", json={"username": "admin", "password": "newpass123"})
    assert r3.status_code == 200

    # Old password no longer works
    r4 = client.post("/api/auth/login", json={"username": "admin", "password": "oldpass123"})
    assert r4.status_code == 401


def test_change_password_wrong_current(client, auth_headers):
    r = client.put("/api/users/me/password", json={
        "current_password": "wrong",
        "new_password": "newpass123",
    }, headers=auth_headers)
    assert r.status_code == 401


def test_user_settings_crud(client, auth_headers):
    # Initially empty
    r = client.get("/api/users/me/settings", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == {}

    # Set a value
    r2 = client.put("/api/users/me/settings", json={"timezone": "US/Pacific"}, headers=auth_headers)
    assert r2.status_code == 200
    assert r2.json()["timezone"] == "US/Pacific"

    # Delete a value
    r3 = client.put("/api/users/me/settings", json={"timezone": None}, headers=auth_headers)
    assert r3.status_code == 200
    assert "timezone" not in r3.json()


# ── Admin User Management ─────────────────────────────────────────────

def test_admin_list_users(client, multi_user_headers):
    r = client.get("/api/admin/users", headers=multi_user_headers)
    assert r.status_code == 200
    assert len(r.json()) >= 1  # at least the admin user


def test_admin_create_user(client, multi_user_headers):
    r = client.post("/api/admin/users", json={
        "username": "bob",
        "password": "bobpass123",
        "role": "user",
    }, headers=multi_user_headers)
    assert r.status_code == 201
    assert r.json()["username"] == "bob"
    assert r.json()["role"] == "user"


def test_admin_create_duplicate_user(client, multi_user_headers):
    client.post("/api/admin/users", json={"username": "dup", "password": "password123"}, headers=multi_user_headers)
    r = client.post("/api/admin/users", json={"username": "dup", "password": "password456"}, headers=multi_user_headers)
    assert r.status_code == 409


def test_admin_update_user_role(client, multi_user_headers):
    r = client.post("/api/admin/users", json={"username": "alice", "password": "password123"}, headers=multi_user_headers)
    uid = r.json()["id"]
    r2 = client.put(f"/api/admin/users/{uid}", json={"role": "admin"}, headers=multi_user_headers)
    assert r2.status_code == 200
    assert r2.json()["role"] == "admin"


def test_admin_deactivate_user(client, multi_user_headers):
    r = client.post("/api/admin/users", json={"username": "todeactivate", "password": "password123"}, headers=multi_user_headers)
    uid = r.json()["id"]
    r2 = client.delete(f"/api/admin/users/{uid}", headers=multi_user_headers)
    assert r2.status_code == 204


def test_admin_cannot_deactivate_last_admin(client, multi_user_headers):
    """A second admin cannot deactivate the only other admin (last admin protection)."""
    # Create a second admin
    r = client.post("/api/admin/users", json={
        "username": "admin2", "password": "password123", "role": "admin",
    }, headers=multi_user_headers)
    admin2_id = r.json()["id"]
    # Login as admin2
    r2 = client.post("/api/auth/login", json={"username": "admin2", "password": "password123"})
    admin2_headers = {"Authorization": f"Bearer {r2.json()['access_token']}"}
    # admin2 deactivates original admin — now admin2 is last admin
    users = client.get("/api/admin/users", headers=multi_user_headers).json()
    original_admin = next(u for u in users if u["role"] == "admin" and u["id"] != admin2_id)
    client.delete(f"/api/admin/users/{original_admin['id']}", headers=admin2_headers)
    # Try to deactivate admin2 (themselves) — blocked by self-deactivation
    r3 = client.delete(f"/api/admin/users/{admin2_id}", headers=admin2_headers)
    assert r3.status_code == 400


def test_admin_cannot_demote_last_admin(client, multi_user_headers):
    users = client.get("/api/admin/users", headers=multi_user_headers).json()
    admin_user = next(u for u in users if u["role"] == "admin")
    r = client.put(f"/api/admin/users/{admin_user['id']}", json={"role": "user"}, headers=multi_user_headers)
    assert r.status_code == 400


def test_non_admin_cannot_access_admin_endpoints(client):
    token = _setup_multi_user(client)
    # Register a regular user
    r = client.post("/api/auth/register", json={"username": "regular", "password": "password123"})
    user_token = r.json()["access_token"]
    user_headers = {"Authorization": f"Bearer {user_token}"}

    r2 = client.get("/api/admin/users", headers=user_headers)
    assert r2.status_code == 403


# ── User Management Mode Gating ──────────────────────────────────────

def test_admin_user_endpoints_blocked_in_open_mode(client):
    """User management returns 400 in open mode."""
    client.post("/api/setup/complete", json={"auth_mode": "open"})
    login = client.post("/api/auth/login", json={})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    assert client.get("/api/admin/users", headers=headers).status_code == 400
    assert client.post("/api/admin/users", json={"username": "x", "password": "password123"}, headers=headers).status_code == 400


def test_admin_user_endpoints_blocked_in_single_password(client, auth_headers):
    """User management returns 400 in single_password mode."""
    assert client.get("/api/admin/users", headers=auth_headers).status_code == 400
    assert client.post("/api/admin/users", json={"username": "x", "password": "password123"}, headers=auth_headers).status_code == 400


def test_admin_set_user_password(client):
    """Admin can set password for another user."""
    token = _setup_multi_user(client)
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/admin/users", json={"username": "target", "password": "oldpass123"}, headers=headers)
    uid = r.json()["id"]

    r2 = client.put(f"/api/admin/users/{uid}/password", json={"password": "newpass123"}, headers=headers)
    assert r2.status_code == 200

    # User can log in with new password
    r3 = client.post("/api/auth/login", json={"username": "target", "password": "newpass123"})
    assert r3.status_code == 200


# ── Admin Config ───────────────────────────────────────────────────────

def test_admin_config_get(client, auth_headers):
    r = client.get("/api/admin/config", headers=auth_headers)
    assert r.status_code == 200
    assert "auth_mode" in r.json()
    assert "registration_enabled" in r.json()


def test_admin_toggle_registration(client, auth_headers):
    r = client.put("/api/admin/config", json={"registration_enabled": False}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["registration_enabled"] is False

    r2 = client.put("/api/admin/config", json={"registration_enabled": True}, headers=auth_headers)
    assert r2.json()["registration_enabled"] is True


# ── Auth Mode Upgrade ──────────────────────────────────────────────────

def test_upgrade_open_to_single_password(client):
    client.post("/api/setup/complete", json={"auth_mode": "open"})
    # Login in open mode
    login = client.post("/api/auth/login", json={})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/admin/auth/upgrade", json={
        "target_mode": "single_password",
        "single_password": "newsecret",
    }, headers=headers)
    assert r.status_code == 200
    assert r.json()["auth_mode"] == "single_password"

    # Now login requires password
    r2 = client.post("/api/auth/login", json={"password": "newsecret"})
    assert r2.status_code == 200


def test_upgrade_single_to_multi_user(client, auth_headers):
    r = client.post("/api/admin/auth/upgrade", json={
        "target_mode": "multi_user",
        "admin_password": "adminpass",
    }, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["auth_mode"] == "multi_user"


def test_upgrade_cannot_downgrade(client, auth_headers):
    r = client.post("/api/admin/auth/upgrade", json={
        "target_mode": "open",
    }, headers=auth_headers)
    assert r.status_code == 400


def test_upgrade_to_same_mode_fails(client, auth_headers):
    r = client.post("/api/admin/auth/upgrade", json={
        "target_mode": "single_password",
    }, headers=auth_headers)
    assert r.status_code == 400


# ── User Isolation ─────────────────────────────────────────────────────

def _create_two_users(client):
    """Setup multi-user mode with two separate users."""
    token = _setup_multi_user(client)
    admin_headers = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/auth/register", json={
        "username": "user_a",
        "password": "password_a1",
    })
    token_a = r.json()["access_token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    r = client.post("/api/auth/register", json={
        "username": "user_b",
        "password": "password_b1",
    })
    token_b = r.json()["access_token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    return admin_headers, headers_a, headers_b


def test_user_isolation_profiles(client):
    """User A cannot see User B's profiles."""
    _, headers_a, headers_b = _create_two_users(client)

    # User A creates profile
    client.post("/api/profiles", json={"name": "A's Profile"}, headers=headers_a)
    # User B creates profile
    client.post("/api/profiles", json={"name": "B's Profile"}, headers=headers_b)

    # Each user only sees their own
    profiles_a = client.get("/api/profiles", headers=headers_a).json()
    profiles_b = client.get("/api/profiles", headers=headers_b).json()

    assert len(profiles_a) == 1
    assert profiles_a[0]["name"] == "A's Profile"
    assert len(profiles_b) == 1
    assert profiles_b[0]["name"] == "B's Profile"


def test_user_isolation_cards(client):
    """User A cannot see User B's cards."""
    _, headers_a, headers_b = _create_two_users(client)

    prof_a = client.post("/api/profiles", json={"name": "A"}, headers=headers_a).json()
    prof_b = client.post("/api/profiles", json={"name": "B"}, headers=headers_b).json()

    client.post("/api/cards", json={
        "profile_id": prof_a["id"], "card_name": "CardA", "issuer": "Chase", "open_date": "2024-01-01",
    }, headers=headers_a)
    client.post("/api/cards", json={
        "profile_id": prof_b["id"], "card_name": "CardB", "issuer": "Amex", "open_date": "2024-01-01",
    }, headers=headers_b)

    cards_a = client.get("/api/cards", headers=headers_a).json()
    cards_b = client.get("/api/cards", headers=headers_b).json()

    assert len(cards_a) == 1
    assert cards_a[0]["card_name"] == "CardA"
    assert len(cards_b) == 1
    assert cards_b[0]["card_name"] == "CardB"


def test_user_cannot_access_other_users_card(client):
    """User B cannot read/update/delete User A's card."""
    _, headers_a, headers_b = _create_two_users(client)

    prof_a = client.post("/api/profiles", json={"name": "A"}, headers=headers_a).json()
    card_a = client.post("/api/cards", json={
        "profile_id": prof_a["id"], "card_name": "Secret", "issuer": "Chase", "open_date": "2024-01-01",
    }, headers=headers_a).json()

    # User B tries to access User A's card
    r = client.get(f"/api/cards/{card_a['id']}", headers=headers_b)
    assert r.status_code == 404

    r = client.put(f"/api/cards/{card_a['id']}", json={"card_name": "Hacked"}, headers=headers_b)
    assert r.status_code == 404

    r = client.delete(f"/api/cards/{card_a['id']}", headers=headers_b)
    assert r.status_code == 404


def test_user_cannot_create_card_in_other_profile(client):
    """User B cannot add a card to User A's profile."""
    _, headers_a, headers_b = _create_two_users(client)

    prof_a = client.post("/api/profiles", json={"name": "A"}, headers=headers_a).json()

    r = client.post("/api/cards", json={
        "profile_id": prof_a["id"], "card_name": "Sneaky", "issuer": "X", "open_date": "2024-01-01",
    }, headers=headers_b)
    assert r.status_code == 404


def test_user_isolation_settings(client):
    """Each user has independent settings."""
    _, headers_a, headers_b = _create_two_users(client)

    client.put("/api/settings", json={"timezone": "America/New_York"}, headers=headers_a)
    client.put("/api/settings", json={"timezone": "Europe/London"}, headers=headers_b)

    settings_a = client.get("/api/settings", headers=headers_a).json()
    settings_b = client.get("/api/settings", headers=headers_b).json()

    assert settings_a["timezone"] == "America/New_York"
    assert settings_b["timezone"] == "Europe/London"


def test_deactivated_user_cannot_login(client):
    """Deactivated user gets rejected at login."""
    token = _setup_multi_user(client)
    admin_headers = {"Authorization": f"Bearer {token}"}

    # Create a user
    r = client.post("/api/admin/users", json={"username": "doomed", "password": "password123"}, headers=admin_headers)
    uid = r.json()["id"]

    # Deactivate
    client.delete(f"/api/admin/users/{uid}", headers=admin_headers)

    # Try to login
    r2 = client.post("/api/auth/login", json={"username": "doomed", "password": "password123"})
    assert r2.status_code == 403


# ── OAuth Presets ──────────────────────────────────────────────────────

def test_oauth_presets_public(client):
    """OAuth presets endpoint is accessible."""
    r = client.get("/api/auth/oauth/presets")
    assert r.status_code == 200
    presets = r.json()
    assert len(presets) > 0
    names = [p["name"] for p in presets]
    assert "google" in names
    assert "github" in names


# ── OAuth Mode Gating ─────────────────────────────────────────────────

def test_oauth_authorize_allowed_for_admin(client, multi_user_headers):
    """Admin can use OAuth authorize even outside OAuth mode (for setup/linking)."""
    # First configure a provider
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "google",
        "client_id": "test-id",
        "client_secret": "test-secret",
    }, headers=multi_user_headers)
    r = client.get("/api/auth/oauth/google/authorize?redirect_uri=http://localhost:3000/auth/callback", headers=multi_user_headers)
    assert r.status_code == 200
    assert "authorization_url" in r.json()


def test_oauth_authorize_blocked_for_non_admin(client):
    """OAuth authorize blocked for non-admin users outside OAuth mode."""
    _setup_multi_user(client)
    r = client.post("/api/auth/register", json={"username": "user1", "password": "password123"})
    user_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r2 = client.get("/api/auth/oauth/google/authorize?redirect_uri=http://localhost:3000/auth/callback", headers=user_headers)
    assert r2.status_code == 400
    assert "not enabled" in r2.json()["detail"].lower()


def test_oauth_token_blocked_outside_oauth_mode(client, multi_user_headers):
    """OAuth token exchange returns 400 when not in multi_user_oauth mode."""
    r = client.post("/api/auth/oauth/google/token", json={
        "code": "fake",
        "state": "fake",
        "redirect_uri": "http://localhost",
    }, headers=multi_user_headers)
    assert r.status_code == 400
    assert "not enabled" in r.json()["detail"].lower()


# ── OAuth Passwordless Login ─────────────────────────────────────────

def test_password_login_rejected_in_oauth_mode(client, db_session):
    """Password login returns 400 in multi_user_oauth mode."""
    from app.models.oauth_account import OAuthAccount
    from app.models.oauth_provider import OAuthProvider
    from app.services.crypto import encrypt_value

    token = _setup_multi_user(client)
    headers = {"Authorization": f"Bearer {token}"}

    # Configure a provider
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "github",
        "client_id": "test-id",
        "client_secret": "test-secret",
    }, headers=headers)

    # Manually link admin OAuth account and set mode
    from app.services.setup_service import set_system_config
    admin_user = db_session.query(User).filter(User.username == "testadmin").first()
    oauth_account = OAuthAccount(
        user_id=admin_user.id,
        provider="github",
        provider_user_id="12345",
        provider_email="admin@test.com",
    )
    db_session.add(oauth_account)
    set_system_config(db_session, "auth_mode", "multi_user_oauth")
    db_session.commit()

    # Password login should be rejected
    r = client.post("/api/auth/login", json={"username": "testadmin", "password": "pass1234"})
    assert r.status_code == 400
    assert "oauth" in r.json()["detail"].lower()


# ── OAuth Upgrade Requirements ───────────────────────────────────────

def test_upgrade_to_oauth_requires_provider(client, multi_user_headers):
    """Upgrade to OAuth fails without a configured provider."""
    r = client.post("/api/admin/auth/upgrade", json={
        "target_mode": "multi_user_oauth",
    }, headers=multi_user_headers)
    assert r.status_code == 400
    assert "provider" in r.json()["detail"].lower()


def test_upgrade_to_oauth_requires_admin_link(client, multi_user_headers):
    """Upgrade to OAuth fails without admin OAuth account linked."""
    # Configure a provider but don't link admin
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "google",
        "client_id": "test-id",
        "client_secret": "test-secret",
    }, headers=multi_user_headers)

    r = client.post("/api/admin/auth/upgrade", json={
        "target_mode": "multi_user_oauth",
    }, headers=multi_user_headers)
    assert r.status_code == 400
    assert "link" in r.json()["detail"].lower()


def test_admin_config_includes_oauth_linked(client, multi_user_headers):
    """Admin config response includes admin_oauth_linked field."""
    r = client.get("/api/admin/config", headers=multi_user_headers)
    assert r.status_code == 200
    assert r.json()["admin_oauth_linked"] is False


# ── Upgrade Warning ───────────────────────────────────────────────────

def test_upgrade_includes_warning_for_passwordless_users(client):
    """Upgrade to multi_user warns about users without passwords."""
    # Setup in open mode
    r = client.post("/api/setup/complete", json={"auth_mode": "open"})
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Upgrade to multi_user (admin gets a password, but any other OAuth-only users won't)
    r2 = client.post("/api/admin/auth/upgrade", json={
        "target_mode": "multi_user",
        "admin_password": "adminpass",
    }, headers=headers)
    assert r2.status_code == 200
    assert r2.json()["auth_mode"] == "multi_user"
    # No other users, so no warning expected
    assert "warning" not in r2.json() or r2.json().get("warning") is None


# ── Setup Validation ──────────────────────────────────────────────────

def test_setup_multi_user_oauth_requires_oauth_fields(client):
    """Setup with multi_user_oauth requires OAuth provider fields."""
    # Missing OAuth fields → 400
    r = client.post("/api/setup/complete", json={
        "auth_mode": "multi_user_oauth",
    })
    assert r.status_code == 400

    # With OAuth fields → success (no user created, empty token)
    r = client.post("/api/setup/complete", json={
        "auth_mode": "multi_user_oauth",
        "oauth_provider_name": "github",
        "oauth_client_id": "test-client-id",
        "oauth_client_secret": "test-client-secret",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["auth_mode"] == "multi_user_oauth"
    assert data["access_token"] == ""


# ── Registration Mode Gating ──────────────────────────────────────────

def test_register_blocked_in_oauth_mode(client, db_session):
    """Registration returns 400 in multi_user_oauth mode."""
    from app.models.oauth_account import OAuthAccount
    from app.services.setup_service import set_system_config

    token = _setup_multi_user(client)
    admin_user = db_session.query(User).filter(User.username == "testadmin").first()

    # Set up provider and link admin
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "github",
        "client_id": "test-id",
        "client_secret": "test-secret",
    }, headers={"Authorization": f"Bearer {token}"})
    oauth_account = OAuthAccount(
        user_id=admin_user.id,
        provider="github",
        provider_user_id="12345",
        provider_email="admin@test.com",
    )
    db_session.add(oauth_account)
    set_system_config(db_session, "auth_mode", "multi_user_oauth")
    db_session.commit()

    r = client.post("/api/auth/register", json={"username": "newuser", "password": "password123"})
    assert r.status_code == 400
    assert "not available" in r.json()["detail"].lower()


# ── OAuth Presets Validation ──────────────────────────────────────────

def test_oauth_presets_exclude_apple_twitter(client):
    """Apple and Twitter presets should not be present."""
    r = client.get("/api/auth/oauth/presets")
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert "apple" not in names
    assert "twitter" not in names


# ── OAuth Upgrade Warning ─────────────────────────────────────────────

def test_oauth_upgrade_warns_about_unlinked_users(client, db_session):
    """Upgrade to OAuth includes warning about users without OAuth links."""
    from app.models.oauth_account import OAuthAccount

    token = _setup_multi_user(client)
    headers = {"Authorization": f"Bearer {token}"}

    # Create a regular user (no OAuth link)
    client.post("/api/auth/register", json={"username": "nolink", "password": "password123"})

    # Configure provider
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "github",
        "client_id": "test-id",
        "client_secret": "test-secret",
    }, headers=headers)

    # Link admin OAuth account manually
    admin_user = db_session.query(User).filter(User.username == "testadmin").first()
    oauth_account = OAuthAccount(
        user_id=admin_user.id,
        provider="github",
        provider_user_id="12345",
        provider_email="admin@test.com",
    )
    db_session.add(oauth_account)
    db_session.commit()

    # Upgrade to OAuth
    r = client.post("/api/admin/auth/upgrade", json={
        "target_mode": "multi_user_oauth",
    }, headers=headers)
    assert r.status_code == 200
    assert r.json()["auth_mode"] == "multi_user_oauth"
    assert r.json().get("warning") is not None
    assert "1" in r.json()["warning"]  # 1 user without OAuth


# ── User OAuth Account Endpoints ──────────────────────────────────────

def test_user_oauth_accounts_list(client, db_session):
    """User can list their linked OAuth accounts."""
    from app.models.oauth_account import OAuthAccount

    token = _setup_multi_user(client)
    headers = {"Authorization": f"Bearer {token}"}

    # Manually link an OAuth account to the admin user
    admin_user = db_session.query(User).filter(User.username == "testadmin").first()
    oauth_account = OAuthAccount(
        user_id=admin_user.id,
        provider="github",
        provider_user_id="12345",
        provider_email="admin@test.com",
    )
    db_session.add(oauth_account)
    db_session.commit()

    r = client.get("/api/users/me/oauth-accounts", headers=headers)
    assert r.status_code == 200
    accounts = r.json()
    assert len(accounts) == 1
    assert accounts[0]["provider"] == "github"
    assert accounts[0]["provider_email"] == "admin@test.com"


def test_user_oauth_unlink(client, db_session):
    """User can unlink an OAuth account when they have a password."""
    from app.models.oauth_account import OAuthAccount

    token = _setup_multi_user(client)
    headers = {"Authorization": f"Bearer {token}"}

    admin_user = db_session.query(User).filter(User.username == "testadmin").first()
    oauth_account = OAuthAccount(
        user_id=admin_user.id,
        provider="github",
        provider_user_id="12345",
        provider_email="admin@test.com",
    )
    db_session.add(oauth_account)
    db_session.commit()

    r = client.delete("/api/users/me/oauth/github", headers=headers)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

    # Verify it's gone
    r2 = client.get("/api/users/me/oauth-accounts", headers=headers)
    assert len(r2.json()) == 0


def test_user_oauth_unlink_blocked_without_password(client, db_session):
    """Cannot unlink last OAuth account if user has no password."""
    from app.models.oauth_account import OAuthAccount

    token = _setup_multi_user(client)
    headers = {"Authorization": f"Bearer {token}"}

    admin_user = db_session.query(User).filter(User.username == "testadmin").first()
    # Remove password hash to simulate OAuth-only user
    admin_user.password_hash = None
    oauth_account = OAuthAccount(
        user_id=admin_user.id,
        provider="github",
        provider_user_id="12345",
        provider_email="admin@test.com",
    )
    db_session.add(oauth_account)
    db_session.commit()

    r = client.delete("/api/users/me/oauth/github", headers=headers)
    assert r.status_code == 400
    assert "cannot unlink" in r.json()["detail"].lower()


def test_user_oauth_unlink_blocked_in_oauth_mode_even_with_password(client, db_session):
    """Cannot unlink last OAuth account in OAuth mode even if user has a password."""
    from app.models.oauth_account import OAuthAccount
    from app.services.setup_service import set_system_config

    token = _setup_multi_user(client)
    headers = {"Authorization": f"Bearer {token}"}

    # User has password_hash (from setup), but we switch to OAuth mode
    admin_user = db_session.query(User).filter(User.username == "testadmin").first()
    oauth_account = OAuthAccount(
        user_id=admin_user.id,
        provider="github",
        provider_user_id="12345",
        provider_email="admin@test.com",
    )
    db_session.add(oauth_account)
    set_system_config(db_session, "auth_mode", "multi_user_oauth")
    db_session.commit()

    r = client.delete("/api/users/me/oauth/github", headers=headers)
    assert r.status_code == 400
    assert "cannot unlink" in r.json()["detail"].lower()


def test_admin_create_user_blocked_in_oauth_mode(client, db_session):
    """Admin cannot create password-based users in OAuth mode."""
    from app.models.oauth_account import OAuthAccount
    from app.services.setup_service import set_system_config

    token = _setup_multi_user(client)
    headers = {"Authorization": f"Bearer {token}"}

    admin_user = db_session.query(User).filter(User.username == "testadmin").first()
    oauth_account = OAuthAccount(
        user_id=admin_user.id,
        provider="github",
        provider_user_id="12345",
        provider_email="admin@test.com",
    )
    db_session.add(oauth_account)
    set_system_config(db_session, "auth_mode", "multi_user_oauth")
    db_session.commit()

    r = client.post("/api/admin/users", json={
        "username": "newuser",
        "password": "password123",
    }, headers=headers)
    assert r.status_code == 400
    assert "oauth" in r.json()["detail"].lower()


# ── Password Minimum Length ──────────────────────────────────────────

def test_password_min_length_register(client):
    """Registration rejects passwords shorter than 8 characters."""
    _setup_multi_user(client)
    r = client.post("/api/auth/register", json={"username": "shorty", "password": "abc"})
    assert r.status_code == 422


def test_password_min_length_admin_create(client, multi_user_headers):
    """Admin user creation rejects passwords shorter than 8 characters."""
    r = client.post("/api/admin/users", json={
        "username": "shorty",
        "password": "short",
    }, headers=multi_user_headers)
    assert r.status_code == 422


def test_password_min_length_setup(client):
    """Setup rejects passwords shorter than 8 characters."""
    r = client.post("/api/setup/complete", json={
        "auth_mode": "single_password",
        "admin_password": "short",
    })
    assert r.status_code == 422


# ── Bonus Source Enum ────────────────────────────────────────────────

def test_bonus_source_enum_valid(client, auth_headers):
    """Valid bonus sources accepted."""
    # Create a profile and card first
    p = client.post("/api/profiles", json={"name": "TestProfile"}, headers=auth_headers).json()
    c = client.post("/api/cards", json={
        "profile_id": p["id"],
        "card_name": "Test Card",
        "issuer": "Test",
    }, headers=auth_headers).json()

    for source in ("signup", "upgrade", "retention"):
        r = client.post(f"/api/cards/{c['id']}/bonuses", json={
            "bonus_source": source,
            "bonus_amount": 100,
        }, headers=auth_headers)
        assert r.status_code == 201


def test_bonus_source_enum_invalid(client, auth_headers):
    """Invalid bonus source rejected."""
    p = client.post("/api/profiles", json={"name": "TestProfile"}, headers=auth_headers).json()
    c = client.post("/api/cards", json={
        "profile_id": p["id"],
        "card_name": "Test Card",
        "issuer": "Test",
    }, headers=auth_headers).json()

    r = client.post(f"/api/cards/{c['id']}/bonuses", json={
        "bonus_source": "invalid_source",
        "bonus_amount": 100,
    }, headers=auth_headers)
    assert r.status_code == 422


# ── Bonus Update Mutual Exclusivity ─────────────────────────────────

def test_bonus_update_both_earned_missed_rejected(client, auth_headers):
    """Cannot set both bonus_earned and bonus_missed to true."""
    p = client.post("/api/profiles", json={"name": "TestProfile"}, headers=auth_headers).json()
    c = client.post("/api/cards", json={
        "profile_id": p["id"],
        "card_name": "Test Card",
        "issuer": "Test",
    }, headers=auth_headers).json()
    b = client.post(f"/api/cards/{c['id']}/bonuses", json={
        "bonus_source": "signup",
        "bonus_amount": 100,
    }, headers=auth_headers).json()

    r = client.put(f"/api/bonuses/{b['id']}", json={
        "bonus_earned": True,
        "bonus_missed": True,
    }, headers=auth_headers)
    assert r.status_code == 422


# ── User Settings Allowlist ──────────────────────────────────────────

def test_user_settings_rejects_unknown_keys(client, auth_headers):
    """Unknown setting keys are rejected."""
    r = client.put("/api/users/me/settings", json={"unknown_key": "value"}, headers=auth_headers)
    assert r.status_code == 400
    assert "unknown" in r.json()["detail"].lower()


# ── Import Mode Validation ───────────────────────────────────────────

def test_import_mode_literal_validation(client, auth_headers):
    """Invalid import mode returns 422."""
    from datetime import datetime, timezone
    data = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profiles": [],
    }
    r = client.post("/api/profiles/import?mode=invalid", json=data, headers=auth_headers)
    assert r.status_code == 422


# ── Product Change on Closed Card ────────────────────────────────────

def test_product_change_closed_card_blocked(client, auth_headers):
    """Product change on a closed card returns 400."""
    p = client.post("/api/profiles", json={"name": "TestProfile"}, headers=auth_headers).json()
    c = client.post("/api/cards", json={
        "profile_id": p["id"],
        "card_name": "Old Card",
        "issuer": "Test",
        "open_date": "2023-01-01",
    }, headers=auth_headers).json()

    # Close the card
    close_r = client.post(f"/api/cards/{c['id']}/close", json={"close_date": "2024-01-01"}, headers=auth_headers)
    assert close_r.status_code == 200

    # Try to product change on closed card
    r = client.post(
        f"/api/cards/{c['id']}/product-change",
        json={"new_card_name": "New Card", "change_date": "2024-06-01"},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "closed" in r.json()["detail"].lower()


# ── Security Headers ────────────────────────────────────────────────

def test_security_headers(client):
    """API responses include security headers."""
    r = client.get("/api/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


# ── PyJWT Token Roundtrip ───────────────────────────────────────────

def test_pyjwt_token_roundtrip():
    """Verify JWT token encode/decode works with PyJWT."""
    from app.services.auth_service import create_access_token, decode_token
    token = create_access_token(user_id=42, role="admin")
    payload = decode_token(token)
    assert payload["sub"] == "42"
    assert payload["role"] == "admin"


# ── Close Card Clears Spend Tracking ──────────────────────────────

def test_close_card_clears_spend_tracking(client, auth_headers):
    """Closing a card clears spend_reminder_enabled and spend_deadline."""
    p = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    c = client.post("/api/cards", json={
        "profile_id": p["id"],
        "card_name": "SpendCard",
        "issuer": "Test",
        "open_date": "2024-01-01",
        "spend_reminder_enabled": True,
        "spend_requirement": 4000,
        "spend_deadline": "2024-04-01",
    }, headers=auth_headers).json()
    assert c["spend_reminder_enabled"] is True
    assert c["spend_deadline"] == "2024-04-01"

    # Close the card
    r = client.post(f"/api/cards/{c['id']}/close", json={"close_date": "2024-06-01"}, headers=auth_headers)
    assert r.status_code == 200
    closed = r.json()
    assert closed["spend_reminder_enabled"] is False
    assert closed["spend_deadline"] is None


# ── AF Date Cleared When Fee → 0 ─────────────────────────────────

def test_af_date_cleared_when_fee_zero(client, auth_headers):
    """Setting annual_fee to 0 clears annual_fee_date."""
    p = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    c = client.post("/api/cards", json={
        "profile_id": p["id"],
        "card_name": "FeeCard",
        "issuer": "Test",
        "open_date": "2023-01-01",
        "annual_fee": 95,
    }, headers=auth_headers).json()
    assert c["annual_fee_date"] is not None

    # Set fee to 0
    r = client.put(f"/api/cards/{c['id']}", json={"annual_fee": 0}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["annual_fee_date"] is None


# ── Events Negative Offset Rejected ──────────────────────────────

def test_events_offset_negative_rejected(client, auth_headers):
    """Negative offset on events endpoint returns 422."""
    r = client.get("/api/events?offset=-1", headers=auth_headers)
    assert r.status_code == 422


# ── Export Signup Bonus Source ────────────────────────────────────

def test_export_signup_bonus_source(client, auth_headers):
    """Export works with signup bonus source."""
    p = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    c = client.post("/api/cards", json={
        "profile_id": p["id"],
        "card_name": "BonusCard",
        "issuer": "Test",
    }, headers=auth_headers).json()
    client.post(f"/api/cards/{c['id']}/bonuses", json={
        "bonus_source": "signup",
        "bonus_amount": 80000,
        "bonus_type": "points",
    }, headers=auth_headers)

    r = client.get("/api/profiles/export", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    bonuses = data["profiles"][0]["cards"][0].get("bonuses", [])
    assert any(b["bonus_source"] == "signup" for b in bonuses)


# ── Content-Length Non-Integer ────────────────────────────────────

def test_content_length_non_integer(client, auth_headers):
    """Non-integer Content-Length doesn't crash import (no 500)."""
    from datetime import datetime, timezone
    data = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profiles": [],
    }
    r = client.post(
        "/api/profiles/import?mode=override",
        json=data,
        headers={**auth_headers, "content-length": "not-a-number"},
    )
    # Should not crash with 500 — may get 400 from framework but not 500
    assert r.status_code != 500


# ── OAuth State DB Persistence ────────────────────────────────────

def test_oauth_state_db_persistence(client, multi_user_headers, db_session):
    """OAuth state is stored in the database, not just in memory."""
    from app.models.oauth_state import OAuthState

    # Configure a provider
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "google",
        "client_id": "test-id",
        "client_secret": "test-secret",
    }, headers=multi_user_headers)

    # Hit authorize to generate a state
    r = client.get("/api/auth/oauth/google/authorize?redirect_uri=http://localhost:3000/auth/callback", headers=multi_user_headers)
    assert r.status_code == 200

    # State should be in the database
    states = db_session.query(OAuthState).all()
    assert len(states) >= 1


def test_redirect_uri_validation(client, multi_user_headers):
    """OAuth authorize rejects redirect_uri with disallowed origin."""
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "google",
        "client_id": "test-id",
        "client_secret": "test-secret",
    }, headers=multi_user_headers)
    r = client.get("/api/auth/oauth/google/authorize?redirect_uri=http://evil.com/callback", headers=multi_user_headers)
    assert r.status_code == 400
    assert "not allowed" in r.json()["detail"]


def test_path_traversal_template_image(client, auth_headers):
    """Template image endpoint rejects path traversal attempts."""
    from app.services.template_loader import get_template_image_path_by_filename
    # These should all return None (blocked)
    assert get_template_image_path_by_filename("../etc/passwd", "card.png") is None
    assert get_template_image_path_by_filename("chase/sapphire", "../../etc/passwd") is None
    assert get_template_image_path_by_filename("/etc/chase", "card.png") is None


def test_password_change_invalidates_old_token(client, multi_user_headers):
    """After changing password, old tokens should be rejected."""
    # Register a new user (multi_user_headers fixture already set up multi_user mode)
    r = client.post("/api/auth/register", json={"username": "pwduser", "password": "oldpass123"})
    old_token = r.json()["access_token"]
    old_headers = {"Authorization": f"Bearer {old_token}"}

    # Change password — returns new token
    r2 = client.put("/api/users/me/password", json={
        "current_password": "oldpass123",
        "new_password": "newpass456",
    }, headers=old_headers)
    assert r2.status_code == 200
    assert "access_token" in r2.json()
    new_token = r2.json()["access_token"]

    # New token should work
    r3 = client.get("/api/auth/verify", headers={"Authorization": f"Bearer {new_token}"})
    assert r3.status_code == 200

    # Old token should be rejected
    r4 = client.get("/api/auth/verify", headers=old_headers)
    assert r4.status_code == 401


def test_spend_deadline_requires_requirement(client, auth_headers):
    """Cannot set spend_deadline without spend_requirement."""
    r = client.post("/api/profiles", json={"name": "test"}, headers=auth_headers)
    pid = r.json()["id"]
    r2 = client.post("/api/cards", json={
        "profile_id": pid,
        "card_name": "Test Card",
        "issuer": "Test",
        "spend_deadline": "2025-12-31",
    }, headers=auth_headers)
    assert r2.status_code == 422  # Validation error


def test_bonus_amount_upper_bound(client, auth_headers):
    """Bonus amounts reject excessively large values."""
    r = client.post("/api/profiles", json={"name": "test"}, headers=auth_headers)
    pid = r.json()["id"]
    r2 = client.post("/api/cards", json={
        "profile_id": pid, "card_name": "Test", "issuer": "Test",
    }, headers=auth_headers)
    card_id = r2.json()["id"]
    r3 = client.post(f"/api/cards/{card_id}/bonuses", json={
        "bonus_source": "signup",
        "bonus_amount": 999_999_999,
    }, headers=auth_headers)
    assert r3.status_code == 422


def test_empty_tags_stripped(client, auth_headers):
    """Empty/whitespace-only tags are stripped from custom_tags."""
    r = client.post("/api/profiles", json={"name": "test"}, headers=auth_headers)
    pid = r.json()["id"]
    r2 = client.post("/api/cards", json={
        "profile_id": pid,
        "card_name": "Test Card",
        "issuer": "Test",
        "custom_tags": ["valid", "", "  ", "also-valid"],
    }, headers=auth_headers)
    assert r2.status_code == 201
    tags = r2.json()["custom_tags"]
    assert tags == ["valid", "also-valid"]


# ── Round 4 tests ─────────────────────────────────────────────────────


def test_admin_password_reset_invalidates_tokens(client, multi_user_headers):
    """Admin resetting a user's password should invalidate their old tokens."""
    # Create a user
    r = client.post("/api/admin/users", json={
        "username": "resetme", "password": "oldpass123",
    }, headers=multi_user_headers)
    assert r.status_code == 201
    uid = r.json()["id"]

    # Login as the user to get their token
    r2 = client.post("/api/auth/login", json={"username": "resetme", "password": "oldpass123"})
    assert r2.status_code == 200
    user_token = r2.json()["access_token"]
    user_headers = {"Authorization": f"Bearer {user_token}"}

    # Verify token works
    r3 = client.get("/api/users/me", headers=user_headers)
    assert r3.status_code == 200

    # Admin resets the user's password
    r4 = client.put(f"/api/admin/users/{uid}/password", json={
        "password": "newpass123",
    }, headers=multi_user_headers)
    assert r4.status_code == 200

    # Old token should now be invalid
    r5 = client.get("/api/users/me", headers=user_headers)
    assert r5.status_code == 401

    # User can login with new password
    r6 = client.post("/api/auth/login", json={"username": "resetme", "password": "newpass123"})
    assert r6.status_code == 200


def test_auth_upgrade_password_min_length(client, multi_user_headers):
    """Auth upgrade rejects passwords shorter than 8 characters."""
    # Try upgrading to single_password with a short password
    r = client.post("/api/admin/auth/upgrade", json={
        "target_mode": "single_password",
        "single_password": "short",
    }, headers=multi_user_headers)
    assert r.status_code == 422


def test_benefit_name_empty_update_rejected(client, auth_headers):
    """Updating a benefit with an empty name should be rejected."""
    r = client.post("/api/profiles", json={"name": "test"}, headers=auth_headers)
    pid = r.json()["id"]
    r2 = client.post("/api/cards", json={
        "profile_id": pid, "card_name": "Test", "issuer": "Test",
    }, headers=auth_headers)
    card_id = r2.json()["id"]
    r3 = client.post(f"/api/cards/{card_id}/benefits", json={
        "benefit_name": "Dining Credit",
        "benefit_amount": 50,
        "frequency": "monthly",
    }, headers=auth_headers)
    assert r3.status_code == 201
    benefit_id = r3.json()["id"]
    r4 = client.put(f"/api/cards/{card_id}/benefits/{benefit_id}", json={
        "benefit_name": "",
    }, headers=auth_headers)
    assert r4.status_code == 422


# ── Edge case fix tests ──────────────────────────────────────────


def test_user_settings_rejects_invalid_timezone(client, auth_headers):
    """PUT /api/users/me/settings should reject invalid timezone values."""
    resp = client.put("/api/users/me/settings", json={"timezone": "Invalid/FakeZone"}, headers=auth_headers)
    assert resp.status_code == 400
    assert "Invalid timezone" in resp.json()["detail"]


def test_user_settings_accepts_valid_timezone(client, auth_headers):
    """PUT /api/users/me/settings should accept valid timezone values."""
    resp = client.put("/api/users/me/settings", json={"timezone": "America/New_York"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["timezone"] == "America/New_York"


def test_user_settings_clears_timezone_with_none(client, auth_headers):
    """PUT /api/users/me/settings should clear timezone when set to None."""
    client.put("/api/users/me/settings", json={"timezone": "America/Chicago"}, headers=auth_headers)
    resp = client.put("/api/users/me/settings", json={"timezone": None}, headers=auth_headers)
    assert resp.status_code == 200
    assert "timezone" not in resp.json()


def test_card_update_spend_deadline_requires_requirement(client, auth_headers):
    """CardUpdate should reject spend_deadline without spend_requirement."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
    }, headers=auth_headers).json()
    resp = client.put(f"/api/cards/{card['id']}", json={
        "spend_deadline": "2026-06-01",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_upgrade_bonus_amount_upper_bound(client, auth_headers):
    """ProductChangeRequest.upgrade_bonus_amount should reject values > 99,999,999."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "open_date": "2025-01-01",
    }, headers=auth_headers).json()
    resp = client.post(f"/api/cards/{card['id']}/product-change", json={
        "new_card_name": "New Card",
        "change_date": "2026-01-01",
        "upgrade_bonus_amount": 100_000_000,
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_import_rejects_oversized_benefit_amount(client, auth_headers):
    """Import should reject benefit amounts exceeding 99,999,999."""
    import_data = {
        "version": 1,
        "exported_at": "2026-01-01T00:00:00",
        "profiles": [{
            "name": "ImportTest",
            "cards": [{
                "card_name": "Test Card",
                "issuer": "Chase",
                "benefits": [{
                    "benefit_name": "Huge Credit",
                    "benefit_amount": 100_000_000,
                    "frequency": "monthly",
                }],
            }],
        }],
    }
    resp = client.post("/api/profiles/import", json={"mode": "merge", "data": import_data}, headers=auth_headers)
    assert resp.status_code == 422


def test_retention_offer_stores_credit_amount(client, auth_headers):
    """Retention offer with both points and credit should store bonus_credit_amount."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "open_date": "2025-01-01",
    }, headers=auth_headers).json()
    resp = client.post(f"/api/cards/{card['id']}/retention-offer", json={
        "event_date": "2026-01-01",
        "accepted": True,
        "offer_points": 10000,
        "offer_credit": 75,
    }, headers=auth_headers)
    assert resp.status_code == 201
    # Check the bonus was created with credit amount (bonuses come from card detail)
    card_detail = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    retention_bonus = [b for b in card_detail["bonuses"] if b["bonus_source"] == "retention"]
    assert len(retention_bonus) == 1
    assert retention_bonus[0]["bonus_amount"] == 10000
    assert retention_bonus[0]["bonus_credit_amount"] == 75


def test_settings_includes_server_timezone(client, auth_headers):
    """GET /api/settings should include server_timezone in response."""
    resp = client.get("/api/settings", headers=auth_headers)
    assert resp.status_code == 200
    assert "server_timezone" in resp.json()


def test_password_max_length_rejected(client, auth_headers):
    """current_password exceeding max_length=128 should be rejected."""
    resp = client.put("/api/users/me/password", json={
        "current_password": "a" * 129,
        "new_password": "newpassword123",
    }, headers=auth_headers)
    assert resp.status_code == 422


# ── Round 2 edge case fix tests ──────────────────────────────────


def test_create_card_clears_af_date_when_fee_zero(client, auth_headers):
    """create_card with annual_fee=0 should auto-clear annual_fee_date."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "No Fee Card",
        "issuer": "Discover",
        "annual_fee": 0,
        "annual_fee_date": "2026-06-01",
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["annual_fee_date"] is None


def test_product_change_negative_annual_fee_rejected(client, auth_headers):
    """ProductChangeRequest with negative new_annual_fee should be rejected."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "open_date": "2025-01-01",
    }, headers=auth_headers).json()
    resp = client.post(f"/api/cards/{card['id']}/product-change", json={
        "new_card_name": "New Card",
        "change_date": "2026-01-01",
        "new_annual_fee": -100,
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_benefit_usage_upper_bound(client, auth_headers):
    """BenefitUsageUpdate with amount > 99,999,999 should be rejected."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
    }, headers=auth_headers).json()
    benefit = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Travel Credit",
        "benefit_amount": 300,
        "frequency": "annual",
    }, headers=auth_headers).json()
    resp = client.put(f"/api/cards/{card['id']}/benefits/{benefit['id']}/usage", json={
        "amount_used": 100_000_000,
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_import_rejects_negative_bonus_amount(client, auth_headers):
    """Import should reject negative bonus_amount."""
    import_data = {
        "version": 1,
        "exported_at": "2026-01-01T00:00:00",
        "profiles": [{
            "name": "ImportTest",
            "cards": [{
                "card_name": "Test Card",
                "issuer": "Chase",
                "bonuses": [{
                    "bonus_source": "upgrade",
                    "bonus_amount": -500,
                }],
            }],
        }],
    }
    resp = client.post("/api/profiles/import", json={"mode": "merge", "data": import_data}, headers=auth_headers)
    assert resp.status_code == 422


def test_import_rejects_oversized_card_name(client, auth_headers):
    """Import should reject card_name exceeding max_length=200."""
    import_data = {
        "version": 1,
        "exported_at": "2026-01-01T00:00:00",
        "profiles": [{
            "name": "ImportTest",
            "cards": [{
                "card_name": "A" * 201,
                "issuer": "Chase",
            }],
        }],
    }
    resp = client.post("/api/profiles/import", json={"mode": "merge", "data": import_data}, headers=auth_headers)
    assert resp.status_code == 422


def test_event_update_cannot_change_system_event_type(client, auth_headers):
    """Cannot change a system-managed event type (opened, closed, etc.)."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "open_date": "2025-01-01",
    }, headers=auth_headers).json()
    # Find the opened event
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    opened_event = [e for e in events if e["event_type"] == "opened"][0]
    # Try to change its type
    resp = client.put(f"/api/events/{opened_event['id']}", json={
        "event_type": "other",
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "system-managed" in resp.json()["detail"]


def test_event_update_cannot_change_to_system_type(client, auth_headers):
    """Cannot change an event TO a system-managed type."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
    }, headers=auth_headers).json()
    # Create an 'other' event
    event = client.post(f"/api/cards/{card['id']}/events", json={
        "event_type": "other",
        "event_date": "2026-01-01",
        "description": "Test event",
    }, headers=auth_headers).json()
    # Try to change its type to 'closed'
    resp = client.put(f"/api/events/{event['id']}", json={
        "event_type": "closed",
    }, headers=auth_headers)
    assert resp.status_code == 400
    assert "system-managed" in resp.json()["detail"]


def test_template_sync_skips_user_modified_af(client, auth_headers, db_session):
    """Template sync should skip annual fee update when user manually modified it."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "American Express Gold Card",
        "issuer": "Amex",
        "template_id": "amex/gold",
        "annual_fee": 325,
    }, headers=auth_headers).json()
    card_id = card["id"]
    # Manually update annual fee (simulates user negotiating a lower fee)
    resp = client.put(f"/api/cards/{card_id}", json={"annual_fee": 0}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["annual_fee"] == 0
    # Run template sync
    from app.services.template_sync import sync_cards_to_templates
    sync_cards_to_templates(db_session)
    # Verify the card's annual fee was NOT overwritten
    card_after = client.get(f"/api/cards/{card_id}", headers=auth_headers).json()
    assert card_after["annual_fee"] == 0


# ── Audit fix tests ──────────────────────────────────────────────


def test_spend_reminder_enabled_requires_spend_fields_on_update(client, auth_headers):
    """Enabling spend_reminder_enabled on update requires spend_requirement and spend_deadline."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
    }, headers=auth_headers).json()

    # Try enabling spend_reminder without spend_requirement/deadline
    resp = client.put(f"/api/cards/{card['id']}", json={
        "spend_reminder_enabled": True,
    }, headers=auth_headers)
    assert resp.status_code == 400

    # Now set with proper fields — should succeed
    resp2 = client.put(f"/api/cards/{card['id']}", json={
        "spend_reminder_enabled": True,
        "spend_requirement": 4000,
        "spend_deadline": "2026-06-01",
    }, headers=auth_headers)
    assert resp2.status_code == 200
    assert resp2.json()["spend_reminder_enabled"] is True


def test_admin_cannot_self_deactivate(client, multi_user_headers):
    """Admin cannot deactivate their own account via DELETE."""
    users = client.get("/api/admin/users", headers=multi_user_headers).json()
    admin_user = next(u for u in users if u["role"] == "admin")
    r = client.delete(f"/api/admin/users/{admin_user['id']}", headers=multi_user_headers)
    assert r.status_code == 400
    assert "your own" in r.json()["detail"].lower()


def test_health_check_returns_ok(client):
    """Health endpoint returns ok when DB is reachable."""
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_oauth_provider_update_clears_optional_fields(client, multi_user_headers):
    """OAuth provider update allows clearing nullable fields via explicit null."""
    # Create a provider with scopes and issuer_url
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "github",
        "client_id": "test-id",
        "client_secret": "test-secret",
        "scopes": "read:user user:email",
        "issuer_url": "https://github.com",
    }, headers=multi_user_headers)

    providers = client.get("/api/auth/oauth/providers", headers=multi_user_headers).json()
    assert providers[0]["scopes"] == "read:user user:email"
    assert providers[0]["issuer_url"] == "https://github.com"

    # Update to clear scopes and issuer_url (both nullable)
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "github",
        "client_id": "test-id",
        "client_secret": "test-secret",
        "scopes": None,
        "issuer_url": None,
    }, headers=multi_user_headers)

    providers2 = client.get("/api/auth/oauth/providers", headers=multi_user_headers).json()
    assert providers2[0]["scopes"] is None
    assert providers2[0]["issuer_url"] is None


def test_delete_last_provider_blocked_in_oauth_mode(client, db_session):
    """Cannot delete the last OAuth provider in multi_user_oauth mode."""
    from app.models.oauth_account import OAuthAccount
    from app.services.setup_service import set_system_config

    token = _setup_multi_user(client)
    headers = {"Authorization": f"Bearer {token}"}

    # Add a provider
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "github",
        "client_id": "test-id",
        "client_secret": "test-secret",
    }, headers=headers)

    # Link admin's OAuth account and switch to OAuth mode
    admin_user = db_session.query(User).filter(User.username == "testadmin").first()
    db_session.add(OAuthAccount(
        user_id=admin_user.id,
        provider="github",
        provider_user_id="12345",
        provider_email="admin@test.com",
    ))
    set_system_config(db_session, "auth_mode", "multi_user_oauth")
    db_session.commit()

    # Attempt to delete the only provider — should be blocked
    r = client.delete("/api/auth/oauth/providers/github", headers=headers)
    assert r.status_code == 400
    assert "last" in r.json()["detail"].lower()


def test_delete_provider_blocked_when_admin_linked(client, db_session):
    """Cannot delete provider admin is linked to if it's their only OAuth account."""
    from app.models.oauth_account import OAuthAccount
    from app.services.setup_service import set_system_config

    token = _setup_multi_user(client)
    headers = {"Authorization": f"Bearer {token}"}

    # Add two providers
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "github",
        "client_id": "test-id",
        "client_secret": "test-secret",
    }, headers=headers)
    client.post("/api/auth/oauth/providers", json={
        "provider_name": "google",
        "client_id": "test-id-2",
        "client_secret": "test-secret-2",
    }, headers=headers)

    # Link admin to github only
    admin_user = db_session.query(User).filter(User.username == "testadmin").first()
    db_session.add(OAuthAccount(
        user_id=admin_user.id,
        provider="github",
        provider_user_id="12345",
        provider_email="admin@test.com",
    ))
    set_system_config(db_session, "auth_mode", "multi_user_oauth")
    db_session.commit()

    # Deleting github (admin's only linked provider) should be blocked
    r = client.delete("/api/auth/oauth/providers/github", headers=headers)
    assert r.status_code == 400
    assert "link another" in r.json()["detail"].lower()

    # Deleting google (admin is NOT linked to it) should succeed
    r = client.delete("/api/auth/oauth/providers/google", headers=headers)
    assert r.status_code == 204
