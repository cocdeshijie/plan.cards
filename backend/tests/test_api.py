from datetime import date, datetime, timedelta, timezone

from app.schemas.export_import import ExportData, ExportProfile, ExportCard, ExportEvent, ExportBenefit, ExportBonus
from tests.conftest import TEST_PASSWORD


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_login_success(client, setup_complete):
    response = client.post("/api/auth/login", json={"password": TEST_PASSWORD})
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["role"] == "admin"


def test_login_failure(client, setup_complete):
    response = client.post("/api/auth/login", json={"password": "wrong"})
    assert response.status_code == 401


def test_unauthorized(client, setup_complete):
    response = client.get("/api/profiles")
    assert response.status_code == 401


def test_create_profile(client, auth_headers):
    response = client.post("/api/profiles", json={"name": "John"}, headers=auth_headers)
    assert response.status_code == 201
    assert response.json()["name"] == "John"


def test_list_profiles(client, auth_headers):
    client.post("/api/profiles", json={"name": "Alice"}, headers=auth_headers)
    client.post("/api/profiles", json={"name": "Bob"}, headers=auth_headers)
    response = client.get("/api/profiles", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_create_card(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    today = date.today()
    recent_date = (today - timedelta(days=90)).isoformat()
    card_data = {
        "profile_id": profile["id"],
        "card_name": "Sapphire Preferred",
        "issuer": "Chase",
        "network": "Visa",
        "card_type": "personal",
        "open_date": recent_date,
        "annual_fee": 95,
    }
    response = client.post("/api/cards", json=card_data, headers=auth_headers)
    assert response.status_code == 201
    card = response.json()
    assert card["card_name"] == "Sapphire Preferred"
    assert card["issuer"] == "Chase"
    # Should auto-create an "opened" event + AF event at open_date (open_date <= today)
    event_types = [e["event_type"] for e in card["events"]]
    assert "opened" in event_types


def test_close_card(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Freedom",
        "issuer": "Chase",
        "open_date": "2023-06-01",
    }, headers=auth_headers).json()

    response = client.post(f"/api/cards/{card['id']}/close", json={"close_date": "2025-01-01"}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "closed"
    assert response.json()["close_date"] == "2025-01-01"


def test_product_change(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "American Express Gold Card",
        "issuer": "Amex",
        "template_id": "amex/gold",
        "open_date": "2023-01-01",
    }, headers=auth_headers).json()

    response = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_template_id": "amex/green",
            "new_card_name": "American Express Green Card",
            "change_date": "2025-02-01",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    result = response.json()
    assert result["card_name"] == "American Express Green Card"
    assert result["template_id"] == "amex/green"
    # Should have both opened and product_change events
    event_types = [e["event_type"] for e in result["events"]]
    assert "opened" in event_types
    assert "product_change" in event_types


def test_524_count(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    today = date.today()

    # Add 3 personal cards in last 24 months
    for i in range(3):
        open_date = today - timedelta(days=30 * (i + 1))
        client.post("/api/cards", json={
            "profile_id": profile["id"],
            "card_name": f"Card {i}",
            "issuer": "Chase",
            "card_type": "personal",
            "open_date": open_date.isoformat(),
        }, headers=auth_headers)

    # Add 1 business card (should not count)
    client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Ink Preferred",
        "issuer": "Chase",
        "card_type": "business",
        "open_date": today.isoformat(),
    }, headers=auth_headers)

    # Add 1 old personal card (should not count)
    old_date = today - timedelta(days=800)
    client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Old Card",
        "issuer": "Chase",
        "card_type": "personal",
        "open_date": old_date.isoformat(),
    }, headers=auth_headers)

    response = client.get(f"/api/profiles/{profile['id']}/524", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 3
    assert data["status"] == "green"


def test_card_filters(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    today = date.today()

    client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Card A",
        "issuer": "Chase",
        "card_type": "personal",
        "status": "active",
        "open_date": today.isoformat(),
    }, headers=auth_headers)
    client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Card B",
        "issuer": "Amex",
        "card_type": "business",
        "status": "closed",
        "open_date": today.isoformat(),
    }, headers=auth_headers)

    # Filter by status
    active = client.get("/api/cards?status=active", headers=auth_headers).json()
    assert len(active) == 1
    assert active[0]["card_name"] == "Card A"

    # Filter by type
    biz = client.get("/api/cards?card_type=business", headers=auth_headers).json()
    assert len(biz) == 1
    assert biz[0]["card_name"] == "Card B"

    # Filter by issuer
    chase = client.get("/api/cards?issuer=Chase", headers=auth_headers).json()
    assert len(chase) == 1


def test_create_card_with_spend_reminder(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card_data = {
        "profile_id": profile["id"],
        "card_name": "Sapphire Preferred",
        "issuer": "Chase",
        "network": "Visa",
        "card_type": "personal",
        "open_date": "2024-01-15",
        "annual_fee": 95,
        "spend_reminder_enabled": True,
        "spend_requirement": 4000,
        "spend_deadline": "2024-04-15",
        "spend_reminder_notes": "Need to hit $4k in 3 months",
    }
    response = client.post("/api/cards", json=card_data, headers=auth_headers)
    assert response.status_code == 201
    card = response.json()
    assert card["spend_reminder_enabled"] is True
    assert card["spend_requirement"] == 4000
    assert card["spend_deadline"] == "2024-04-15"
    assert card["spend_reminder_notes"] == "Need to hit $4k in 3 months"


def test_templates_endpoint(client):
    response = client.get("/api/templates")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def _create_card_with_benefit(client, auth_headers):
    """Helper: create a profile + card and add a benefit."""
    profile = client.post("/api/profiles", json={"name": "BenefitTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2024-01-15",
    }, headers=auth_headers).json()
    return card


def test_create_and_list_benefit(client, auth_headers):
    card = _create_card_with_benefit(client, auth_headers)
    # Create a benefit
    resp = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Travel Credit",
        "benefit_amount": 300,
        "frequency": "annual",
        "reset_type": "cardiversary",
    }, headers=auth_headers)
    assert resp.status_code == 201
    benefit = resp.json()
    assert benefit["benefit_name"] == "Travel Credit"
    assert benefit["benefit_amount"] == 300
    assert benefit["amount_used"] == 0
    assert benefit["period_end"] is not None
    assert benefit["days_until_reset"] is not None

    # List benefits
    resp = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_update_benefit(client, auth_headers):
    card = _create_card_with_benefit(client, auth_headers)
    benefit = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Airline Credit",
        "benefit_amount": 200,
        "frequency": "annual",
    }, headers=auth_headers).json()

    resp = client.put(f"/api/cards/{card['id']}/benefits/{benefit['id']}", json={
        "benefit_name": "Updated Credit",
        "benefit_amount": 250,
    }, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["benefit_name"] == "Updated Credit"
    assert resp.json()["benefit_amount"] == 250


def test_delete_benefit(client, auth_headers):
    card = _create_card_with_benefit(client, auth_headers)
    benefit = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Airline Credit",
        "benefit_amount": 200,
        "frequency": "annual",
    }, headers=auth_headers).json()

    resp = client.delete(f"/api/cards/{card['id']}/benefits/{benefit['id']}", headers=auth_headers)
    assert resp.status_code == 204

    resp = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers)
    assert len(resp.json()) == 0


def test_update_usage(client, auth_headers):
    card = _create_card_with_benefit(client, auth_headers)
    benefit = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Uber Cash",
        "benefit_amount": 15,
        "frequency": "monthly",
    }, headers=auth_headers).json()

    resp = client.put(f"/api/cards/{card['id']}/benefits/{benefit['id']}/usage", json={
        "amount_used": 10,
    }, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["amount_used"] == 10


def test_period_reset_on_read(client, auth_headers):
    """Create a benefit with a stale period_start; reading should reset amount_used."""
    card = _create_card_with_benefit(client, auth_headers)
    benefit = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Dining Credit",
        "benefit_amount": 10,
        "frequency": "monthly",
        "reset_type": "calendar",
    }, headers=auth_headers).json()

    # Set usage
    client.put(f"/api/cards/{card['id']}/benefits/{benefit['id']}/usage", json={
        "amount_used": 8,
    }, headers=auth_headers)

    # Manually set the period_start to a past month via direct DB manipulation
    from app.models.card_benefit import CardBenefit
    from app.database import get_db
    from app.main import app
    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    b = db.get(CardBenefit, benefit["id"])
    b.period_start = date(2020, 1, 1)
    b.amount_used = 8
    db.commit()

    # Now reading should reset it
    resp = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers)
    assert resp.status_code == 200
    benefits = resp.json()
    assert len(benefits) == 1
    assert benefits[0]["amount_used"] == 0  # Reset!


def test_auto_populate_from_template(client, auth_headers):
    """Creating a card from a template with credits should auto-create benefits."""
    profile = client.post("/api/profiles", json={"name": "TemplateTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Amex Platinum",
        "issuer": "Amex",
        "template_id": "amex/platinum",
        "open_date": "2024-06-01",
    }, headers=auth_headers).json()

    resp = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers)
    assert resp.status_code == 200
    benefits = resp.json()
    # Amex Platinum has 12 credits
    assert len(benefits) == 12
    names = {b["benefit_name"] for b in benefits}
    assert "Uber Cash" in names
    assert "Airline Fee Credit" in names
    assert "Resy Dining Credit" in names


def test_populate_endpoint(client, auth_headers):
    """Populate endpoint should add template credits to an existing card."""
    profile = client.post("/api/profiles", json={"name": "PopulateTest"}, headers=auth_headers).json()
    # Create card without template first, then set template_id
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "American Express Platinum Card",
        "issuer": "Amex",
        "template_id": "amex/platinum",
        "open_date": "2024-01-01",
    }, headers=auth_headers).json()

    # Delete auto-populated benefits first
    existing = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers).json()
    for b in existing:
        client.delete(f"/api/cards/{card['id']}/benefits/{b['id']}", headers=auth_headers)

    # Now populate — Amex Platinum has 12 credits
    resp = client.post(f"/api/cards/{card['id']}/benefits/populate", headers=auth_headers)
    assert resp.status_code == 200
    benefits = resp.json()
    assert len(benefits) == 12
    names = {b["benefit_name"] for b in benefits}
    assert "Uber Cash" in names
    assert "Airline Fee Credit" in names

    # Populate again — should not create duplicates
    resp = client.post(f"/api/cards/{card['id']}/benefits/populate", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 0  # nothing new added

    all_benefits = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers).json()
    assert len(all_benefits) == 12  # still the same


def test_auto_populate_sets_from_template(client, auth_headers):
    """Benefits auto-created from template should have from_template=True."""
    profile = client.post("/api/profiles", json={"name": "FromTemplateTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Amex Gold",
        "issuer": "Amex",
        "template_id": "amex/gold",
        "open_date": "2024-06-01",
    }, headers=auth_headers).json()

    resp = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers)
    assert resp.status_code == 200
    benefits = resp.json()
    assert len(benefits) > 0
    for b in benefits:
        assert b["from_template"] is True
        assert b["retired"] is False


def test_card_creation_sets_version_id(client, auth_headers):
    """Creating a card from a template should set template_version_id."""
    profile = client.post("/api/profiles", json={"name": "VersionTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "American Express Platinum Card",
        "issuer": "Amex",
        "template_id": "amex/platinum",
        "open_date": "2024-01-01",
    }, headers=auth_headers).json()

    assert card["template_version_id"] == "amex_plat_2025_1"


def test_card_creation_with_card_image(client, auth_headers):
    """Creating a card with card_image should persist the image choice."""
    profile = client.post("/api/profiles", json={"name": "ImageTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Amex Platinum",
        "issuer": "Amex",
        "template_id": "amex/platinum",
        "open_date": "2024-01-01",
        "card_image": "card_black.png",
    }, headers=auth_headers).json()

    assert card["card_image"] == "card_black.png"


def test_template_versions_endpoint(client):
    """Version listing endpoint should return current version."""
    resp = client.get("/api/templates/amex/platinum/versions")
    assert resp.status_code == 200
    versions = resp.json()
    assert len(versions) >= 1
    current = [v for v in versions if v["is_current"]]
    assert len(current) == 1
    assert current[0]["version_id"] == "amex_plat_2025_1"


def test_template_version_detail_current(client):
    """Getting current version detail should work."""
    resp = client.get("/api/templates/amex/platinum/versions/amex_plat_2025_1")
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["version_id"] == "amex_plat_2025_1"
    assert detail["is_current"] is True
    assert detail["name"] == "American Express Platinum Card"


def test_template_version_detail_not_found(client):
    """Getting a nonexistent version should return 404."""
    resp = client.get("/api/templates/amex/platinum/versions/nonexistent_v1")
    assert resp.status_code == 404


def test_product_change_updates_version(client, auth_headers):
    """Product change should update template_version_id."""
    profile = client.post("/api/profiles", json={"name": "PCVersionTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "American Express Gold Card",
        "issuer": "Amex",
        "template_id": "amex/gold",
        "open_date": "2023-01-01",
    }, headers=auth_headers).json()

    assert card["template_version_id"] == "amex_gold_2024_1"

    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_template_id": "amex/green",
            "new_card_name": "American Express Green Card",
            "change_date": "2025-02-01",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    result = resp.json()
    assert result["template_version_id"] == "amex_green_2025_1"


def test_create_card_with_old_version(client, auth_headers):
    """Creating a card with a specific old template_version_id should use old version benefits."""
    profile = client.post("/api/profiles", json={"name": "OldVersionTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Amex Platinum",
        "issuer": "Amex",
        "template_id": "amex/platinum",
        "template_version_id": "amex_plat_2021_1",
        "open_date": "2024-06-01",
        "annual_fee": 695,
    }, headers=auth_headers).json()

    assert card["template_version_id"] == "amex_plat_2021_1"

    # Old version (2021) has 8 credits (not 12 like current)
    resp = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers)
    benefits = resp.json()
    assert len(benefits) == 8
    names = {b["benefit_name"] for b in benefits}
    assert "Uber Cash" in names
    assert "Saks Credit" in names
    # Should NOT have current-only credits
    assert "Resy Dining Credit" not in names


def test_auto_generate_past_af_events(client, auth_headers):
    """Creating a card opened >1 year ago with annual_fee should auto-generate past AF events."""
    profile = client.post("/api/profiles", json={"name": "PastAFTest"}, headers=auth_headers).json()
    today = date.today()
    # Open date 3 years ago
    three_years_ago = today.replace(year=today.year - 3)
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Old Platinum",
        "issuer": "Amex",
        "open_date": three_years_ago.isoformat(),
        "annual_fee": 695,
    }, headers=auth_headers).json()

    events = card["events"]
    af_events = [e for e in events if e["event_type"] == "annual_fee_posted"]
    # Should have AF events from open_date through today (open_date, +1yr, +2yr, +3yr)
    assert len(af_events) >= 3
    # Should include metadata_json with annual_fee
    assert af_events[0]["metadata_json"]["annual_fee"] == 695
    # annual_fee_date should be auto-set to next anniversary
    assert card["annual_fee_date"] is not None


def test_no_past_af_events_for_recent_card(client, auth_headers):
    """Creating a card opened <1 year ago should generate only the initial AF at open_date."""
    profile = client.post("/api/profiles", json={"name": "RecentCardTest"}, headers=auth_headers).json()
    today = date.today()
    six_months_ago = today.replace(month=today.month - 6) if today.month > 6 else today.replace(year=today.year - 1, month=today.month + 6)
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Recent Card",
        "issuer": "Chase",
        "open_date": six_months_ago.isoformat(),
        "annual_fee": 95,
    }, headers=auth_headers).json()

    events = card["events"]
    af_events = [e for e in events if e["event_type"] == "annual_fee_posted"]
    # open_date <= today, so one AF event is generated at open_date
    assert len(af_events) == 1
    assert af_events[0]["metadata_json"]["annual_fee"] == 95


def test_benefit_notes_crud(client, auth_headers):
    """Benefit notes should be creatable, readable, and updatable."""
    card = _create_card_with_benefit(client, auth_headers)

    # Create with notes
    resp = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Travel Credit",
        "benefit_amount": 300,
        "frequency": "annual",
        "reset_type": "cardiversary",
        "notes": "Used for hotel booking",
    }, headers=auth_headers)
    assert resp.status_code == 201
    benefit = resp.json()
    assert benefit["notes"] == "Used for hotel booking"

    # Read
    resp = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers)
    benefits = resp.json()
    assert benefits[0]["notes"] == "Used for hotel booking"

    # Update notes
    resp = client.put(f"/api/cards/{card['id']}/benefits/{benefit['id']}", json={
        "notes": "Updated: Used for flight",
    }, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["notes"] == "Updated: Used for flight"


def test_benefit_notes_export_import(client, auth_headers):
    """Benefit notes should round-trip through export/import."""
    profile = client.post("/api/profiles", json={"name": "NotesExportTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2024-01-15",
    }, headers=auth_headers).json()
    client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Credit A",
        "benefit_amount": 100,
        "frequency": "monthly",
        "notes": "My important note",
    }, headers=auth_headers)

    # Export
    resp = client.get(f"/api/profiles/export?profile_id={profile['id']}", headers=auth_headers)
    assert resp.status_code == 200
    export_data = resp.json()
    exported_benefit = export_data["profiles"][0]["cards"][0]["benefits"][0]
    assert exported_benefit["notes"] == "My important note"

    # Import as new
    resp = client.post("/api/profiles/import?mode=new", json=export_data, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["benefits_imported"] == 1

    # Find the imported profile and verify notes
    profiles = client.get("/api/profiles", headers=auth_headers).json()
    imported = [p for p in profiles if "NotesExportTest" in p["name"] and p["id"] != profile["id"]][0]
    cards = client.get(f"/api/cards?profile_id={imported['id']}", headers=auth_headers).json()
    benefits = client.get(f"/api/cards/{cards[0]['id']}/benefits", headers=auth_headers).json()
    assert benefits[0]["notes"] == "My important note"


def test_import_triggers_template_sync(client, auth_headers):
    """Importing a card with a stale template_version_id should sync it to current."""
    import_data = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profiles": [
            {
                "name": "ImportSyncTest",
                "cards": [
                    {
                        "template_id": "amex/platinum",
                        "template_version_id": "amex_plat_2021_1",
                        "card_name": "American Express Platinum Card",
                        "issuer": "Amex",
                        "network": "Amex",
                        "card_type": "personal",
                        "status": "active",
                        "open_date": "2024-01-01",
                        "annual_fee": 695,
                        "events": [
                            {"event_type": "opened", "event_date": "2024-01-01"}
                        ],
                        "benefits": [
                            {
                                "benefit_name": "Uber Cash",
                                "benefit_amount": 15,
                                "frequency": "monthly",
                                "reset_type": "calendar",
                                "from_template": True,
                            },
                            {
                                "benefit_name": "CLEAR Plus Credit",
                                "benefit_amount": 189,
                                "frequency": "annual",
                                "reset_type": "calendar",
                                "from_template": True,
                            },
                            {
                                "benefit_name": "Airline Fee Credit",
                                "benefit_amount": 200,
                                "frequency": "annual",
                                "reset_type": "calendar",
                                "from_template": True,
                            },
                        ],
                    }
                ],
            }
        ],
    }

    resp = client.post("/api/profiles/import?mode=new", json=import_data, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["cards_imported"] == 1

    # Fetch the imported card — should be synced to current template
    cards = client.get("/api/cards?issuer=Amex", headers=auth_headers).json()
    card = [c for c in cards if c["card_name"] == "American Express Platinum Card"][0]

    assert card["template_version_id"] == "amex_plat_2025_1"
    assert card["annual_fee"] == 895

    # Benefits should reflect current template (12 credits)
    benefits = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers).json()
    active_benefits = [b for b in benefits if not b["retired"]]
    assert len(active_benefits) == 12
    active_names = {b["benefit_name"] for b in active_benefits}
    assert "Uber Cash" in active_names
    assert "Airline Fee Credit" in active_names
    # CLEAR Plus Credit from old version should be retired (renamed to CLEAR+ Credit)
    retired = [b for b in benefits if b["retired"]]
    retired_names = {b["benefit_name"] for b in retired}
    assert "CLEAR Plus Credit" in retired_names


def test_version_aware_af_uses_old_fee(client, auth_headers):
    """Amex Plat opened in 2022 should use $695 for early AF events and $895 for 2025+."""
    profile = client.post("/api/profiles", json={"name": "VersionAFTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Amex Platinum",
        "issuer": "Amex",
        "template_id": "amex/platinum",
        "open_date": "2022-04-01",
        "annual_fee": 895,
    }, headers=auth_headers).json()

    events = card["events"]
    af_events = sorted(
        [e for e in events if e["event_type"] == "annual_fee_posted"],
        key=lambda e: e["event_date"],
    )

    # Should have AF events at open_date(2022), 2023, 2024, 2025 (and possibly 2026)
    assert len(af_events) >= 4

    # 2022 open_date event: latest version ≤ 2022 is amex_plat_2021_1 → $695
    # AF events start at open_date, so first is 2022-04-01
    assert af_events[0]["metadata_json"]["annual_fee"] == 695

    # 2023 anniversary: still amex_plat_2021_1 → $695
    assert af_events[1]["metadata_json"]["annual_fee"] == 695

    # 2024 anniversary: still amex_plat_2021_1 → $695
    assert af_events[2]["metadata_json"]["annual_fee"] == 695

    # 2025 anniversary: version amex_plat_2025_1 → $895
    assert af_events[3]["metadata_json"]["annual_fee"] == 895


def test_af_fallback_no_template(client, auth_headers):
    """Card without template_id should use flat annual_fee for all AF events."""
    profile = client.post("/api/profiles", json={"name": "NoTemplateAFTest"}, headers=auth_headers).json()
    today = date.today()
    three_years_ago = today.replace(year=today.year - 3)
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Custom Card",
        "issuer": "Test",
        "open_date": three_years_ago.isoformat(),
        "annual_fee": 250,
    }, headers=auth_headers).json()

    af_events = [e for e in card["events"] if e["event_type"] == "annual_fee_posted"]
    # open_date + 3 anniversaries = 4 events (open_date counts as first AF)
    assert len(af_events) >= 3
    for e in af_events:
        assert e["metadata_json"]["annual_fee"] == 250


def test_update_event(client, auth_headers):
    """PUT /api/events/{id} should update event fields."""
    profile = client.post("/api/profiles", json={"name": "UpdateEventTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2024-01-15",
    }, headers=auth_headers).json()

    event = client.post(f"/api/cards/{card['id']}/events", json={
        "event_type": "other",
        "event_date": "2024-06-01",
        "description": "Original description",
    }, headers=auth_headers).json()

    resp = client.put(f"/api/events/{event['id']}", json={
        "description": "Updated description",
        "event_date": "2024-07-01",
    }, headers=auth_headers)
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["description"] == "Updated description"
    assert updated["event_date"] == "2024-07-01"
    assert updated["event_type"] == "other"  # unchanged


def test_update_event_not_found(client, auth_headers):
    """PUT /api/events/{id} should return 404 for nonexistent event."""
    resp = client.put("/api/events/99999", json={
        "description": "Does not exist",
    }, headers=auth_headers)
    assert resp.status_code == 404


# ─── Validation Tests ────────────────────────────────────────────────


def test_reject_empty_card_name(client, auth_headers):
    """CardCreate with empty card_name should be rejected."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "",
        "issuer": "Chase",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_empty_issuer(client, auth_headers):
    """CardCreate with empty issuer should be rejected."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_invalid_card_type(client, auth_headers):
    """CardCreate with invalid card_type should be rejected."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "card_type": "corporate",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_invalid_status(client, auth_headers):
    """CardCreate with invalid status should be rejected."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "status": "pending",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_negative_annual_fee(client, auth_headers):
    """CardCreate with negative annual_fee should be rejected."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "annual_fee": -100,
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_negative_credit_limit(client, auth_headers):
    """CardCreate with negative credit_limit should be rejected."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "credit_limit": -5000,
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_invalid_last_digits(client, auth_headers):
    """CardCreate with less than 4 digits should be rejected."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "last_digits": "12",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_accept_valid_last_digits(client, auth_headers):
    """CardCreate with valid 4-digit last_digits should succeed."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "last_digits": "1234",
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["last_digits"] == "1234"


def test_accept_five_digit_last_digits(client, auth_headers):
    """CardCreate with valid 5-digit last_digits should succeed (Amex cards)."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Amex Platinum",
        "issuer": "Amex",
        "last_digits": "31005",
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["last_digits"] == "31005"


def test_reject_negative_benefit_amount(client, auth_headers):
    """CardBenefitCreate with negative benefit_amount should be rejected."""
    card = _create_card_with_benefit(client, auth_headers)
    resp = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Bad Benefit",
        "benefit_amount": -50,
        "frequency": "monthly",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_invalid_frequency(client, auth_headers):
    """CardBenefitCreate with invalid frequency should be rejected."""
    card = _create_card_with_benefit(client, auth_headers)
    resp = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Bad Benefit",
        "benefit_amount": 100,
        "frequency": "biweekly",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_invalid_reset_type(client, auth_headers):
    """CardBenefitCreate with invalid reset_type should be rejected."""
    card = _create_card_with_benefit(client, auth_headers)
    resp = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Bad Benefit",
        "benefit_amount": 100,
        "frequency": "monthly",
        "reset_type": "anniversary",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_invalid_event_type(client, auth_headers):
    """CardEventCreate with invalid event_type should be rejected."""
    card = _create_card_with_benefit(client, auth_headers)
    resp = client.post(f"/api/cards/{card['id']}/events", json={
        "event_type": "invalid_type",
        "event_date": "2024-06-01",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_close_date_before_open_date(client, auth_headers):
    """Closing a card with close_date before open_date should be rejected."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "open_date": "2024-06-01",
    }, headers=auth_headers).json()

    resp = client.post(f"/api/cards/{card['id']}/close", json={"close_date": "2024-01-01"}, headers=auth_headers)
    assert resp.status_code == 400


def test_reject_product_change_date_before_open_date(client, auth_headers):
    """Product change with change_date before open_date should be rejected."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "open_date": "2024-06-01",
    }, headers=auth_headers).json()

    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_template_id": "fake/nonexistent",
            "new_card_name": "Freedom",
            "change_date": "2024-01-01",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_zero_annual_fee_accepted(client, auth_headers):
    """CardCreate with annual_fee=0 should succeed (no-fee cards)."""
    profile = client.post("/api/profiles", json={"name": "ValTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "No Fee Card",
        "issuer": "Discover",
        "annual_fee": 0,
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["annual_fee"] == 0


# ---------- Signup Bonus Tracker ----------

def test_create_card_with_signup_bonus(client, auth_headers):
    """Card can be created with signup bonus fields."""
    profile = client.post("/api/profiles", json={"name": "BonusTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Sapphire Preferred",
        "issuer": "Chase",
        "open_date": "2024-01-15",
        "spend_reminder_enabled": True,
        "spend_requirement": 4000,
        "spend_deadline": "2024-04-15",
        "signup_bonus_amount": 60000,
        "signup_bonus_type": "Ultimate Rewards",
    }, headers=auth_headers)
    assert resp.status_code == 201
    card = resp.json()
    assert card["signup_bonus_amount"] == 60000
    assert card["signup_bonus_type"] == "Ultimate Rewards"
    assert card["signup_bonus_earned"] is False


def test_mark_signup_bonus_earned(client, auth_headers):
    """Signup bonus can be marked as earned via card update."""
    profile = client.post("/api/profiles", json={"name": "EarnedTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold Card",
        "issuer": "Amex",
        "signup_bonus_amount": 60000,
        "signup_bonus_type": "Membership Rewards",
    }, headers=auth_headers).json()

    resp = client.put(f"/api/cards/{card['id']}", json={
        "signup_bonus_earned": True,
    }, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["signup_bonus_earned"] is True


def test_signup_bonus_defaults_when_not_provided(client, auth_headers):
    """Cards without signup bonus fields get null/false defaults."""
    profile = client.post("/api/profiles", json={"name": "DefaultTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Basic Card",
        "issuer": "Chase",
    }, headers=auth_headers)
    assert resp.status_code == 201
    card = resp.json()
    assert card["signup_bonus_amount"] is None
    assert card["signup_bonus_type"] is None
    assert card["signup_bonus_earned"] is False


def test_signup_bonus_export_import(client, auth_headers):
    """Signup bonus fields survive export/import round-trip."""
    profile = client.post("/api/profiles", json={"name": "BonusExport"}, headers=auth_headers).json()
    client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Export Card",
        "issuer": "Chase",
        "signup_bonus_amount": 80000,
        "signup_bonus_type": "Ultimate Rewards",
        "signup_bonus_earned": True,
    }, headers=auth_headers)

    export_resp = client.get(
        f"/api/profiles/export?profile_id={profile['id']}", headers=auth_headers
    )
    export_data = export_resp.json()
    exported_card = export_data["profiles"][0]["cards"][0]
    assert exported_card["signup_bonus_amount"] == 80000
    assert exported_card["signup_bonus_type"] == "Ultimate Rewards"
    assert exported_card["signup_bonus_earned"] is True

    import_resp = client.post(
        "/api/profiles/import?mode=new", json=export_data, headers=auth_headers
    )
    assert import_resp.status_code == 200

    # Verify imported card has the bonus fields
    cards = client.get("/api/cards", headers=auth_headers).json()
    imported = [c for c in cards if c["card_name"] == "Export Card" and c["id"] != exported_card.get("id")]
    assert len(imported) >= 1
    assert imported[0]["signup_bonus_amount"] == 80000
    assert imported[0]["signup_bonus_earned"] is True


# ---------- Spend Threshold (benefit_type) ----------

def test_create_spend_threshold_benefit(client, auth_headers):
    """Benefits can be created with benefit_type=spend_threshold."""
    profile = client.post("/api/profiles", json={"name": "ThreshTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Hyatt Card",
        "issuer": "Chase",
        "open_date": "2024-01-01",
    }, headers=auth_headers).json()

    resp = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Free Night Award",
        "benefit_amount": 15000,
        "frequency": "annual",
        "reset_type": "cardiversary",
        "benefit_type": "spend_threshold",
    }, headers=auth_headers)
    assert resp.status_code == 201
    benefit = resp.json()
    assert benefit["benefit_type"] == "spend_threshold"
    assert benefit["benefit_amount"] == 15000


def test_default_benefit_type_is_credit(client, auth_headers):
    """Benefits default to benefit_type=credit."""
    profile = client.post("/api/profiles", json={"name": "CreditDefault"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "open_date": "2024-01-01",
    }, headers=auth_headers).json()

    resp = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Travel Credit",
        "benefit_amount": 300,
        "frequency": "annual",
    }, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["benefit_type"] == "credit"


def test_benefit_type_export_import(client, auth_headers):
    """benefit_type survives export/import round-trip."""
    profile = client.post("/api/profiles", json={"name": "BenTypeExport"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Threshold Export Card",
        "issuer": "Chase",
        "open_date": "2024-01-01",
    }, headers=auth_headers).json()
    client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Free Night",
        "benefit_amount": 15000,
        "frequency": "annual",
        "benefit_type": "spend_threshold",
    }, headers=auth_headers)

    export_resp = client.get(
        f"/api/profiles/export?profile_id={profile['id']}", headers=auth_headers
    )
    export_data = export_resp.json()
    exported_benefit = export_data["profiles"][0]["cards"][0]["benefits"][0]
    assert exported_benefit["benefit_type"] == "spend_threshold"

    import_resp = client.post(
        "/api/profiles/import?mode=new", json=export_data, headers=auth_headers
    )
    assert import_resp.status_code == 200
    assert import_resp.json()["benefits_imported"] == 1


# ---------- Reopen Card ----------

def test_reopen_closed_card(client, auth_headers):
    """Reopening a closed card should set status=active and add a reopened event."""
    profile = client.post("/api/profiles", json={"name": "ReopenTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Freedom Flex",
        "issuer": "Chase",
        "open_date": "2023-06-01",
    }, headers=auth_headers).json()

    # Close the card first
    client.post(f"/api/cards/{card['id']}/close", json={"close_date": "2025-01-01"}, headers=auth_headers)

    # Reopen
    resp = client.post(f"/api/cards/{card['id']}/reopen", headers=auth_headers)
    assert resp.status_code == 200
    result = resp.json()
    assert result["status"] == "active"
    assert result["close_date"] is None
    event_types = [e["event_type"] for e in result["events"]]
    assert "reopened" in event_types


def test_reopen_active_card_fails(client, auth_headers):
    """Reopening an active card should fail with 400."""
    profile = client.post("/api/profiles", json={"name": "ReopenFail"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
    }, headers=auth_headers).json()

    resp = client.post(f"/api/cards/{card['id']}/reopen", headers=auth_headers)
    assert resp.status_code == 400


# ---------- Product Change with Benefit Sync ----------

def test_product_change_with_benefit_sync(client, auth_headers):
    """Product change with sync_benefits=true should retire old and populate new."""
    profile = client.post("/api/profiles", json={"name": "SyncTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "American Express Platinum Card",
        "issuer": "Amex",
        "template_id": "amex/platinum",
        "open_date": "2023-01-01",
    }, headers=auth_headers).json()

    # Get initial benefits count
    initial_benefits = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers).json()
    initial_count = len(initial_benefits)
    assert initial_count > 0

    # Product change with sync_benefits
    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_template_id": "amex/green",
            "new_card_name": "American Express Green Card",
            "change_date": "2025-02-01",
            "sync_benefits": True,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200

    # Old benefits should be retired, new ones created
    all_benefits = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers).json()
    retired = [b for b in all_benefits if b["retired"]]
    active = [b for b in all_benefits if not b["retired"]]
    assert len(retired) >= initial_count


def test_product_change_without_benefit_sync(client, auth_headers):
    """Product change without sync_benefits should keep existing benefits."""
    profile = client.post("/api/profiles", json={"name": "NoSyncTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "American Express Platinum Card",
        "issuer": "Amex",
        "template_id": "amex/platinum",
        "open_date": "2023-01-01",
    }, headers=auth_headers).json()

    initial_benefits = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers).json()

    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_template_id": "amex/green",
            "new_card_name": "American Express Green Card",
            "change_date": "2025-02-01",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200

    # Benefits should be unchanged
    all_benefits = client.get(f"/api/cards/{card['id']}/benefits", headers=auth_headers).json()
    retired = [b for b in all_benefits if b["retired"]]
    assert len(retired) == 0


# ---------- Settings ----------

def test_get_settings(client, auth_headers):
    """GET /api/settings should return current settings."""
    resp = client.get("/api/settings", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), dict)


def test_set_timezone(client, auth_headers):
    """Setting a valid timezone should persist it."""
    resp = client.put("/api/settings", json={"timezone": "America/New_York"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json().get("timezone") == "America/New_York"

    # Read it back
    resp = client.get("/api/settings", headers=auth_headers)
    assert resp.json()["timezone"] == "America/New_York"


def test_invalid_timezone_rejected(client, auth_headers):
    """Setting an invalid timezone should be rejected."""
    resp = client.put("/api/settings", json={"timezone": "Invalid/FakeZone"}, headers=auth_headers)
    assert resp.status_code == 400


def test_clear_timezone(client, auth_headers):
    """Setting timezone to empty string should clear it."""
    # Set first
    client.put("/api/settings", json={"timezone": "America/Chicago"}, headers=auth_headers)
    # Clear
    resp = client.put("/api/settings", json={"timezone": ""}, headers=auth_headers)
    assert resp.status_code == 200
    assert "timezone" not in resp.json()


# ---------- Input Length Validation ----------

def test_reject_long_card_name(client, auth_headers):
    """Card name exceeding max length (200) should be rejected."""
    profile = client.post("/api/profiles", json={"name": "LenTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "A" * 201,
        "issuer": "Chase",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_long_notes(client, auth_headers):
    """Card notes exceeding max length should be rejected."""
    profile = client.post("/api/profiles", json={"name": "LenTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test",
        "issuer": "Chase",
        "custom_notes": "A" * 5001,
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_too_many_tags(client, auth_headers):
    """Card with more than 20 tags should be rejected."""
    profile = client.post("/api/profiles", json={"name": "LenTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test",
        "issuer": "Chase",
        "custom_tags": [f"tag{i}" for i in range(21)],
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_long_tag(client, auth_headers):
    """Card tag exceeding 50 chars should be rejected."""
    profile = client.post("/api/profiles", json={"name": "LenTest"}, headers=auth_headers).json()
    resp = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test",
        "issuer": "Chase",
        "custom_tags": ["A" * 51],
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_long_benefit_name(client, auth_headers):
    """Benefit name exceeding max length should be rejected."""
    card = _create_card_with_benefit(client, auth_headers)
    resp = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "A" * 101,
        "benefit_amount": 100,
        "frequency": "monthly",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_long_event_description(client, auth_headers):
    """Event description exceeding max length should be rejected."""
    card = _create_card_with_benefit(client, auth_headers)
    resp = client.post(f"/api/cards/{card['id']}/events", json={
        "event_type": "other",
        "event_date": "2024-06-01",
        "description": "A" * 1001,
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_reject_long_profile_name(client, auth_headers):
    """Profile name exceeding max length should be rejected."""
    resp = client.post("/api/profiles", json={"name": "A" * 101}, headers=auth_headers)
    assert resp.status_code == 422


# ---------- Edge Case Fixes (Phase 1-2) ----------

def test_duplicate_profile_name_rejected(client, auth_headers):
    """Creating a profile with an existing name (case-insensitive) should be rejected."""
    client.post("/api/profiles", json={"name": "Alice"}, headers=auth_headers)
    resp = client.post("/api/profiles", json={"name": "alice"}, headers=auth_headers)
    assert resp.status_code == 409


def test_update_card_negative_annual_fee_rejected(client, auth_headers):
    """Updating a card with negative annual_fee should be rejected."""
    profile = client.post("/api/profiles", json={"name": "UpdateValTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "annual_fee": 95,
    }, headers=auth_headers).json()

    resp = client.put(f"/api/cards/{card['id']}", json={"annual_fee": -1}, headers=auth_headers)
    assert resp.status_code == 422


def test_update_card_zero_spend_requirement_rejected(client, auth_headers):
    """Updating a card with spend_requirement=0 should be rejected (must be > 0)."""
    profile = client.post("/api/profiles", json={"name": "SpendValTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
    }, headers=auth_headers).json()

    resp = client.put(f"/api/cards/{card['id']}", json={"spend_requirement": 0}, headers=auth_headers)
    assert resp.status_code == 422


def test_update_benefit_negative_amount_rejected(client, auth_headers):
    """Updating a benefit with negative amount should be rejected."""
    card = _create_card_with_benefit(client, auth_headers)
    benefit = client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Test Credit",
        "benefit_amount": 100,
        "frequency": "monthly",
    }, headers=auth_headers).json()

    resp = client.put(f"/api/cards/{card['id']}/benefits/{benefit['id']}", json={
        "benefit_amount": -5,
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_af_backfill_on_open_date_update(client, auth_headers):
    """Setting open_date on a card that didn't have one should backfill AF events."""
    profile = client.post("/api/profiles", json={"name": "BackfillTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "No Date Card",
        "issuer": "Chase",
        "annual_fee": 95,
    }, headers=auth_headers).json()

    # No AF events yet (no open_date)
    assert len([e for e in card["events"] if e["event_type"] == "annual_fee_posted"]) == 0

    # Now set open_date to 2 years ago
    today = date.today()
    two_years_ago = today.replace(year=today.year - 2)
    resp = client.put(f"/api/cards/{card['id']}", json={
        "open_date": two_years_ago.isoformat(),
    }, headers=auth_headers)
    assert resp.status_code == 200

    # Refetch to see events
    card_resp = client.get(f"/api/cards/{card['id']}", headers=auth_headers)
    assert card_resp.status_code == 200
    updated = card_resp.json()
    af_events = [e for e in updated["events"] if e["event_type"] == "annual_fee_posted"]
    assert len(af_events) >= 2  # open_date + at least 1 anniversary
    assert updated["annual_fee_date"] is not None


def test_product_change_same_template_blocked(client, auth_headers):
    """Product change to the same template should be rejected."""
    profile = client.post("/api/profiles", json={"name": "SameTemplateTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "American Express Gold Card",
        "issuer": "Amex",
        "template_id": "amex/gold",
        "open_date": "2023-01-01",
    }, headers=auth_headers).json()

    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_template_id": "amex/gold",
            "new_card_name": "American Express Gold Card",
            "change_date": "2025-02-01",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 400


# ---------- Round 2 Edge Cases ----------


def test_update_card_status_ignored(client, auth_headers):
    """PUT /api/cards/{id} with status field should be ignored (status not in CardUpdate)."""
    profile = client.post("/api/profiles", json={"name": "StatusIgnored"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
    }, headers=auth_headers).json()
    assert card["status"] == "active"

    # Try to close via update — should be ignored
    resp = client.put(f"/api/cards/{card['id']}", json={
        "status": "closed",
        "card_name": "Updated Name",
    }, headers=auth_headers)
    assert resp.status_code == 200
    result = resp.json()
    assert result["status"] == "active"  # status unchanged
    assert result["card_name"] == "Updated Name"  # other fields still work


def test_product_change_null_template(client, auth_headers):
    """Product change with no template_id should make the card a custom card."""
    profile = client.post("/api/profiles", json={"name": "NullTemplatePC"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "American Express Gold Card",
        "issuer": "Amex",
        "template_id": "amex/gold",
        "open_date": "2023-01-01",
    }, headers=auth_headers).json()
    assert card["template_id"] == "amex/gold"

    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Custom Card",
            "change_date": "2025-02-01",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    result = resp.json()
    assert result["card_name"] == "Custom Card"
    assert result["template_id"] is None
    assert result["template_version_id"] is None
    event_types = [e["event_type"] for e in result["events"]]
    assert "product_change" in event_types


def test_import_case_insensitive_profile_names(client, auth_headers):
    """Importing a profile with a case-different existing name should get a suffix."""
    # Create a profile named "John"
    client.post("/api/profiles", json={"name": "John"}, headers=auth_headers)

    # Import data with profile named "john" (lowercase)
    import_data = {
        "version": 1,
        "exported_at": "2025-01-01T00:00:00",
        "profiles": [
            {
                "name": "john",
                "cards": [],
            }
        ],
    }
    resp = client.post("/api/profiles/import?mode=new", json=import_data, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["profiles_imported"] == 1

    # The imported profile should have been renamed
    profiles = client.get("/api/profiles", headers=auth_headers).json()
    names = [p["name"] for p in profiles]
    assert "John" in names  # original unchanged
    # The imported "john" should get a suffix like "john (2)"
    suffixed = [n for n in names if n != "John" and "john" in n.lower()]
    assert len(suffixed) == 1
    assert "(2)" in suffixed[0]


# ---------- Product Change Template Selector ----------


def test_product_change_updates_issuer(client, auth_headers):
    """Product change to a template from a different issuer should update the card's issuer."""
    profile = client.post("/api/profiles", json={"name": "IssuerPCTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "American Express Gold Card",
        "issuer": "Amex",
        "template_id": "amex/gold",
        "open_date": "2023-01-01",
    }, headers=auth_headers).json()
    assert card["issuer"] == "Amex"

    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_template_id": "amex/platinum",
            "new_card_name": "American Express Platinum Card",
            "change_date": "2025-02-01",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    result = resp.json()
    assert result["card_name"] == "American Express Platinum Card"
    assert result["template_id"] == "amex/platinum"
    assert result["issuer"] == "Amex"


def test_product_change_resets_card_image(client, auth_headers):
    """Product change should reset card_image to the provided value (or null)."""
    profile = client.post("/api/profiles", json={"name": "ImagePCTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "American Express Platinum Card",
        "issuer": "Amex",
        "template_id": "amex/platinum",
        "card_image": "card_alt.png",
        "open_date": "2023-01-01",
    }, headers=auth_headers).json()
    assert card["card_image"] == "card_alt.png"

    # PC with empty new_card_image → resets to null
    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_template_id": "amex/green",
            "new_card_name": "American Express Green Card",
            "change_date": "2025-02-01",
            "new_card_image": "",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["card_image"] is None


def test_product_change_with_network(client, auth_headers):
    """Product change with new_network should update the card's network."""
    profile = client.post("/api/profiles", json={"name": "NetworkPCTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Chase",
        "network": "Visa",
        "open_date": "2023-01-01",
    }, headers=auth_headers).json()
    assert card["network"] == "Visa"

    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "New Card",
            "change_date": "2025-02-01",
            "new_network": "Mastercard",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["network"] == "Mastercard"


def test_product_change_creates_af_event_at_change_date(client, auth_headers):
    """PC to a card with AF should create an annual_fee_posted event at the change date."""
    profile = client.post("/api/profiles", json={"name": "PCAF"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Freedom",
        "issuer": "Chase",
        "network": "Visa",
        "open_date": "2023-06-01",
        "annual_fee": 0,
    }, headers=auth_headers).json()

    # No AF events should exist for a $0 card
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events = [e for e in events if e["event_type"] == "annual_fee_posted"]
    assert len(af_events) == 0

    # Product change to a card with AF
    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Sapphire Preferred",
            "change_date": "2025-01-15",
            "new_annual_fee": 95,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["annual_fee"] == 95

    # Should have an AF event at the change date
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events = [e for e in events if e["event_type"] == "annual_fee_posted"]
    assert len(af_events) >= 1
    pc_af = [e for e in af_events if e["event_date"] == "2025-01-15"]
    assert len(pc_af) == 1
    assert pc_af[0]["metadata_json"]["annual_fee"] == 95
    assert pc_af[0]["metadata_json"]["approximate_date"] is True


def test_product_change_af_to_zero_cleans_up_events(client, auth_headers):
    """PC from AF card to $0 AF should clean up future approximate AF events."""
    profile = client.post("/api/profiles", json={"name": "AFtoZero"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Sapphire Preferred",
        "issuer": "Chase",
        "network": "Visa",
        "open_date": "2023-01-01",
        "annual_fee": 95,
    }, headers=auth_headers).json()

    # Should have AF events generated at creation
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events = [e for e in events if e["event_type"] == "annual_fee_posted"]
    assert len(af_events) > 0

    # Product change to $0 AF card
    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Freedom Unlimited",
            "change_date": "2025-02-01",
            "new_annual_fee": 0,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["annual_fee"] == 0
    assert resp.json()["annual_fee_date"] is None

    # No approximate AF events should remain after the change date
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events_after = [
        e for e in events
        if e["event_type"] == "annual_fee_posted"
        and e["event_date"] > "2025-02-01"
        and e.get("metadata_json", {}).get("approximate_date")
    ]
    assert len(af_events_after) == 0


def test_product_change_zero_to_af_generates_future_events(client, auth_headers):
    """PC from $0 AF to AF card should generate future AF events at anniversaries."""
    profile = client.post("/api/profiles", json={"name": "ZeroToAF"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Freedom",
        "issuer": "Chase",
        "network": "Visa",
        "open_date": "2022-06-01",
        "annual_fee": 0,
    }, headers=auth_headers).json()

    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Sapphire Reserve",
            "change_date": "2024-03-01",
            "new_annual_fee": 550,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200

    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events = [e for e in events if e["event_type"] == "annual_fee_posted"]
    # Should have: AF event at 2024-03-01 (PC date) + AF events at PC-date anniversaries
    # PC-date anniversaries: 2025-03-01, 2026-03-01, ...
    # 2025-03-01 is in the past (today is 2026-02-12), so it should be generated
    pc_date_events = [e for e in af_events if e["event_date"] == "2024-03-01"]
    assert len(pc_date_events) == 1
    assert pc_date_events[0]["metadata_json"]["annual_fee"] == 550

    # Should have anniversary AF events at change_date + 1yr (2025-03-01)
    after_change = [e for e in af_events if e["event_date"] > "2024-03-01"]
    assert len(after_change) >= 1
    # Verify the anniversary is at the PC date, not the old open_date
    anniversary_dates = [e["event_date"] for e in after_change]
    assert "2025-03-01" in anniversary_dates

    # annual_fee_date should be change_date anniversary in the future (2026-03-01)
    updated = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert updated["annual_fee_date"] == "2026-03-01"


def test_product_change_af_to_af_resets_anniversary(client, auth_headers):
    """PC from $X AF to $Y AF should reset the AF anniversary to the PC date."""
    profile = client.post("/api/profiles", json={"name": "AFtoAF"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold Card",
        "issuer": "Amex",
        "network": "Amex",
        "open_date": "2023-07-01",
        "annual_fee": 325,
    }, headers=auth_headers).json()

    # Before PC: annual_fee_date should be open + 13mo, then +12mo (2026-08-01)
    assert card["annual_fee_date"] == "2026-08-01"

    # Verify AF events exist at open_date anniversaries before PC (+13mo first, +12mo after)
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events_before = [e for e in events if e["event_type"] == "annual_fee_posted"]
    open_date_anniversaries = [e for e in af_events_before if e["event_date"] in ("2023-07-01", "2024-08-01", "2025-08-01")]
    assert len(open_date_anniversaries) == 3

    # PC to Platinum on 2025-06-15
    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Platinum Card",
            "change_date": "2025-06-15",
            "new_annual_fee": 695,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["annual_fee"] == 695

    # annual_fee_date should now be based on change_date, not open_date
    # change_date + 1yr = 2026-06-15 (in the future), so that's the next AF date
    assert data["annual_fee_date"] == "2026-06-15"

    # Verify events
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events = [e for e in events if e["event_type"] == "annual_fee_posted"]

    # AF event at PC date should exist
    pc_af = [e for e in af_events if e["event_date"] == "2025-06-15"]
    assert len(pc_af) == 1
    assert pc_af[0]["metadata_json"]["annual_fee"] == 695

    # Old open_date anniversary events before PC date should be preserved
    old_events = [e for e in af_events if e["event_date"] < "2025-06-15"]
    assert len(old_events) >= 2  # 2023-07-01 and 2024-07-01 at minimum

    # Old approximate events AFTER PC date should be deleted (e.g., 2025-08-01)
    old_anniversary_after_pc = [e for e in af_events if e["event_date"] == "2025-08-01"]
    assert len(old_anniversary_after_pc) == 0


def test_product_change_preserves_manual_events(client, auth_headers):
    """PC should NOT delete manually-entered (non-approximate) AF events."""
    profile = client.post("/api/profiles", json={"name": "ManualAF"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Sapphire Preferred",
        "issuer": "Chase",
        "network": "Visa",
        "open_date": "2023-01-01",
        "annual_fee": 95,
    }, headers=auth_headers).json()

    # Add a manual AF event (no approximate_date flag) after the future PC date
    manual_event = client.post(f"/api/cards/{card['id']}/events", json={
        "event_type": "annual_fee_posted",
        "event_date": "2025-09-01",
        "description": "Prorated refund",
        "metadata_json": {"annual_fee": -50},
    }, headers=auth_headers).json()

    # PC on 2025-06-01
    resp = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Sapphire Reserve",
            "change_date": "2025-06-01",
            "new_annual_fee": 550,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200

    # Manual event should still exist (it has no approximate_date flag)
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    manual_matches = [
        e for e in events
        if e["event_type"] == "annual_fee_posted"
        and e["event_date"] == "2025-09-01"
        and e.get("description") == "Prorated refund"
    ]
    assert len(manual_matches) == 1
    assert manual_matches[0]["metadata_json"]["annual_fee"] == -50


def test_product_change_with_upgrade_bonus(client, auth_headers):
    """Product change with upgrade bonus creates a CardBonus record."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold Card",
        "issuer": "American Express",
        "open_date": "2024-07-01",
        "annual_fee": 325,
    }, headers=auth_headers).json()

    response = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Platinum Card",
            "change_date": "2026-02-08",
            "new_annual_fee": 695,
            "upgrade_bonus_amount": 150000,
            "upgrade_bonus_type": "points",
            "upgrade_spend_requirement": 6000,
            "upgrade_spend_deadline": "2026-08-08",
            "upgrade_spend_reminder_notes": "Use for travel",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["card_name"] == "Platinum Card"
    assert len(data["bonuses"]) == 1
    bonus = data["bonuses"][0]
    assert bonus["bonus_source"] == "upgrade"
    assert bonus["bonus_amount"] == 150000
    assert bonus["bonus_type"] == "points"
    assert bonus["bonus_earned"] is False
    assert bonus["spend_requirement"] == 6000
    assert bonus["spend_deadline"] == "2026-08-08"
    assert bonus["spend_reminder_enabled"] is True
    assert bonus["spend_reminder_notes"] == "Use for travel"
    assert "Upgrade bonus: Gold Card to Platinum Card" in bonus["description"]


def test_product_change_without_upgrade_bonus(client, auth_headers):
    """Product change without upgrade bonus has empty bonuses list."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold Card",
        "issuer": "American Express",
        "open_date": "2024-07-01",
        "annual_fee": 325,
    }, headers=auth_headers).json()

    response = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Platinum Card",
            "change_date": "2026-02-08",
            "new_annual_fee": 695,
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert len(response.json()["bonuses"]) == 0


def test_multiple_product_changes_keep_all_bonuses(client, auth_headers):
    """Successive PCs each add a new bonus; old bonuses are preserved."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Green Card",
        "issuer": "American Express",
        "open_date": "2023-01-01",
        "annual_fee": 150,
    }, headers=auth_headers).json()

    # First PC: Green -> Gold with upgrade bonus
    response = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Gold Card",
            "change_date": "2024-06-01",
            "new_annual_fee": 325,
            "upgrade_bonus_amount": 50000,
            "upgrade_bonus_type": "points",
            "upgrade_spend_requirement": 4000,
            "upgrade_spend_deadline": "2024-12-01",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    card_data = response.json()
    assert len(card_data["bonuses"]) == 1

    # Second PC: Gold -> Platinum with another upgrade bonus
    response = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Platinum Card",
            "change_date": "2025-06-01",
            "new_annual_fee": 695,
            "upgrade_bonus_amount": 100000,
            "upgrade_bonus_type": "points",
            "upgrade_spend_requirement": 6000,
            "upgrade_spend_deadline": "2025-12-01",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    card_data = response.json()
    assert len(card_data["bonuses"]) == 2
    amounts = sorted([b["bonus_amount"] for b in card_data["bonuses"]])
    assert amounts == [50000, 100000]


def test_update_bonus_mark_earned(client, auth_headers):
    """Marking a bonus as earned via PUT /api/bonuses/{id}."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold Card",
        "issuer": "American Express",
        "open_date": "2024-07-01",
        "annual_fee": 325,
    }, headers=auth_headers).json()

    pc_response = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Platinum Card",
            "change_date": "2026-02-08",
            "new_annual_fee": 695,
            "upgrade_bonus_amount": 150000,
            "upgrade_bonus_type": "points",
            "upgrade_spend_requirement": 6000,
            "upgrade_spend_deadline": "2026-08-08",
        },
        headers=auth_headers,
    )
    bonus_id = pc_response.json()["bonuses"][0]["id"]

    response = client.put(
        f"/api/bonuses/{bonus_id}",
        json={"bonus_earned": True, "spend_reminder_enabled": False},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["bonus_earned"] is True
    assert response.json()["spend_reminder_enabled"] is False


def test_delete_bonus(client, auth_headers):
    """Deleting a bonus via DELETE /api/bonuses/{id}."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold Card",
        "issuer": "American Express",
        "open_date": "2024-07-01",
        "annual_fee": 325,
    }, headers=auth_headers).json()

    pc_response = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Platinum Card",
            "change_date": "2026-02-08",
            "new_annual_fee": 695,
            "upgrade_bonus_amount": 150000,
            "upgrade_bonus_type": "points",
        },
        headers=auth_headers,
    )
    bonus_id = pc_response.json()["bonuses"][0]["id"]

    response = client.delete(f"/api/bonuses/{bonus_id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify bonus is gone
    card_response = client.get(f"/api/cards/{card['id']}", headers=auth_headers)
    assert len(card_response.json()["bonuses"]) == 0


def test_export_import_with_bonuses(client, auth_headers):
    """Bonuses are included in export and restored on import."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold Card",
        "issuer": "American Express",
        "open_date": "2024-07-01",
        "annual_fee": 325,
    }, headers=auth_headers).json()

    # Add upgrade bonus via PC
    client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Platinum Card",
            "change_date": "2026-02-08",
            "new_annual_fee": 695,
            "upgrade_bonus_amount": 150000,
            "upgrade_bonus_type": "points",
            "upgrade_spend_requirement": 6000,
            "upgrade_spend_deadline": "2026-08-08",
        },
        headers=auth_headers,
    )

    # Export
    export_response = client.get(f"/api/profiles/export?profile_id={profile['id']}", headers=auth_headers)
    assert export_response.status_code == 200
    export_data = export_response.json()
    assert len(export_data["profiles"][0]["cards"][0]["bonuses"]) == 1
    exported_bonus = export_data["profiles"][0]["cards"][0]["bonuses"][0]
    assert exported_bonus["bonus_amount"] == 150000
    assert exported_bonus["bonus_source"] == "upgrade"

    # Import into new profile
    import_response = client.post(
        "/api/profiles/import?mode=new",
        json=export_data,
        headers=auth_headers,
    )
    assert import_response.status_code == 200
    result = import_response.json()
    assert result["bonuses_imported"] == 1


# ── Retention Offer Tests ────────────────────────────────────────────


def test_retention_offer_basic(client, auth_headers):
    """Create a basic retention offer (accepted, no spend requirement)."""
    profile = client.post("/api/profiles", json={"name": "Ret"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Sapphire Reserve",
        "issuer": "Chase",
        "open_date": "2023-01-15",
    }, headers=auth_headers).json()

    response = client.post(f"/api/cards/{card['id']}/retention-offer", json={
        "event_date": "2026-01-10",
        "offer_points": 30000,
        "offer_credit": 75,
        "accepted": True,
        "description": "Called retention line",
    }, headers=auth_headers)
    assert response.status_code == 201
    event = response.json()
    assert event["event_type"] == "retention_offer"
    assert event["metadata_json"]["offer_points"] == 30000
    assert event["metadata_json"]["offer_credit"] == 75
    assert event["metadata_json"]["accepted"] is True
    assert event["description"] == "Called retention line"

    # Bonus is created for accepted offer with points/credit (even without spend requirement)
    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 1
    bonus = card_data["bonuses"][0]
    assert bonus["bonus_source"] == "retention"
    assert bonus["bonus_amount"] == 30000
    assert bonus["spend_requirement"] is None


def test_retention_offer_declined(client, auth_headers):
    """Create a declined retention offer."""
    profile = client.post("/api/profiles", json={"name": "RetDecl"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Platinum Card",
        "issuer": "American Express",
        "open_date": "2022-06-01",
    }, headers=auth_headers).json()

    response = client.post(f"/api/cards/{card['id']}/retention-offer", json={
        "event_date": "2026-02-01",
        "offer_points": 20000,
        "accepted": False,
    }, headers=auth_headers)
    assert response.status_code == 201
    event = response.json()
    assert event["metadata_json"]["accepted"] is False


def test_retention_offer_with_spend_requirement(client, auth_headers):
    """Accepted retention offer with spend creates a CardBonus."""
    profile = client.post("/api/profiles", json={"name": "RetSpend"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold Card",
        "issuer": "American Express",
        "open_date": "2023-03-01",
        "annual_fee": 325,
    }, headers=auth_headers).json()

    response = client.post(f"/api/cards/{card['id']}/retention-offer", json={
        "event_date": "2026-02-05",
        "offer_points": 30000,
        "accepted": True,
        "spend_requirement": 3000,
        "spend_deadline": "2026-05-05",
        "spend_reminder_notes": "Organic spend only",
    }, headers=auth_headers)
    assert response.status_code == 201

    # Verify bonus was created
    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 1
    bonus = card_data["bonuses"][0]
    assert bonus["bonus_source"] == "retention"
    assert bonus["bonus_amount"] == 30000
    assert bonus["spend_requirement"] == 3000
    assert bonus["spend_deadline"] == "2026-05-05"
    assert bonus["spend_reminder_enabled"] is True
    assert bonus["spend_reminder_notes"] == "Organic spend only"
    assert bonus["bonus_earned"] is False

    # Mark bonus as earned
    mark_response = client.put(f"/api/bonuses/{bonus['id']}", json={
        "bonus_earned": True,
        "spend_reminder_enabled": False,
    }, headers=auth_headers)
    assert mark_response.status_code == 200
    assert mark_response.json()["bonus_earned"] is True


def test_retention_offer_declined_no_bonus(client, auth_headers):
    """Declined retention offer with spend requirement does NOT create a bonus."""
    profile = client.post("/api/profiles", json={"name": "RetDecl2"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Sapphire Preferred",
        "issuer": "Chase",
        "open_date": "2024-01-01",
    }, headers=auth_headers).json()

    response = client.post(f"/api/cards/{card['id']}/retention-offer", json={
        "event_date": "2026-02-01",
        "offer_points": 10000,
        "accepted": False,
        "spend_requirement": 1500,
        "spend_deadline": "2026-05-01",
    }, headers=auth_headers)
    assert response.status_code == 201

    # No bonus since declined
    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 0


def test_retention_offer_delete_cascades_bonus(client, auth_headers):
    """Deleting a retention offer event auto-deletes the linked CardBonus."""
    profile = client.post("/api/profiles", json={"name": "RetDel"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold Card",
        "issuer": "American Express",
        "open_date": "2023-03-01",
        "annual_fee": 325,
    }, headers=auth_headers).json()

    # Create retention offer with spend requirement → creates bonus
    event_resp = client.post(f"/api/cards/{card['id']}/retention-offer", json={
        "event_date": "2026-02-01",
        "offer_points": 20000,
        "accepted": True,
        "spend_requirement": 2000,
        "spend_deadline": "2026-05-01",
    }, headers=auth_headers)
    assert event_resp.status_code == 201
    event_id = event_resp.json()["id"]

    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 1

    # Delete the retention event
    del_resp = client.delete(f"/api/events/{event_id}", headers=auth_headers)
    assert del_resp.status_code == 204

    # Bonus should be gone
    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 0


def test_retention_offer_edit_to_declined_deletes_bonus(client, auth_headers):
    """Editing a retention offer from accepted→declined auto-deletes the linked bonus."""
    profile = client.post("/api/profiles", json={"name": "RetEdit"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Platinum Card",
        "issuer": "American Express",
        "open_date": "2023-01-01",
        "annual_fee": 695,
    }, headers=auth_headers).json()

    event_resp = client.post(f"/api/cards/{card['id']}/retention-offer", json={
        "event_date": "2026-01-15",
        "offer_credit": 200,
        "accepted": True,
        "spend_requirement": 4000,
        "spend_deadline": "2026-04-15",
    }, headers=auth_headers)
    assert event_resp.status_code == 201
    event_id = event_resp.json()["id"]

    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 1

    # Edit event metadata to declined
    edit_resp = client.put(f"/api/events/{event_id}", json={
        "metadata_json": {"offer_credit": 200, "accepted": False},
    }, headers=auth_headers)
    assert edit_resp.status_code == 200

    # Bonus should be deleted
    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 0


def test_retention_offer_credit_only_bonus(client, auth_headers):
    """Credit-only retention offer stores credit as bonus_amount with bonus_type='credit'."""
    profile = client.post("/api/profiles", json={"name": "RetCredit"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Sapphire Reserve",
        "issuer": "Chase",
        "open_date": "2022-06-01",
        "annual_fee": 550,
    }, headers=auth_headers).json()

    response = client.post(f"/api/cards/{card['id']}/retention-offer", json={
        "event_date": "2026-02-10",
        "offer_credit": 75,
        "accepted": True,
        "spend_requirement": 1500,
        "spend_deadline": "2026-05-10",
    }, headers=auth_headers)
    assert response.status_code == 201

    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 1
    bonus = card_data["bonuses"][0]
    assert bonus["bonus_amount"] == 75
    assert bonus["bonus_type"] == "credit"
    assert bonus["bonus_source"] == "retention"


def test_export_import_override_bonuses_count(client, auth_headers):
    """Override import mode correctly counts bonuses (regression for 4-value tuple unpack)."""
    # Create profile with a card that has a retention bonus
    profile = client.post("/api/profiles", json={"name": "ExpBonus"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold Card",
        "issuer": "American Express",
        "open_date": "2023-01-01",
        "annual_fee": 325,
    }, headers=auth_headers).json()

    client.post(f"/api/cards/{card['id']}/retention-offer", json={
        "event_date": "2026-01-01",
        "offer_points": 25000,
        "accepted": True,
        "spend_requirement": 2500,
        "spend_deadline": "2026-04-01",
    }, headers=auth_headers)

    # Export
    export_resp = client.get(f"/api/profiles/export?profile_id={profile['id']}", headers=auth_headers)
    assert export_resp.status_code == 200
    export_data = export_resp.json()
    assert len(export_data["profiles"][0]["cards"][0]["bonuses"]) == 1

    # Override import back into the same profile
    import_resp = client.post(
        f"/api/profiles/import?mode=override&target_profile_id={profile['id']}",
        json=export_data,
        headers=auth_headers,
    )
    assert import_resp.status_code == 200
    result = import_resp.json()
    assert result["bonuses_imported"] == 1
    assert result["cards_imported"] == 1


def test_multiple_retention_offers_on_same_card(client, auth_headers):
    """Multiple retention offers on the same card are tracked independently."""
    profile = client.post("/api/profiles", json={"name": "MultiRet"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Platinum Card",
        "issuer": "American Express",
        "open_date": "2022-01-01",
        "annual_fee": 695,
    }, headers=auth_headers).json()

    # First retention offer — accepted with spend
    resp1 = client.post(f"/api/cards/{card['id']}/retention-offer", json={
        "event_date": "2025-01-15",
        "offer_points": 30000,
        "accepted": True,
        "spend_requirement": 3000,
        "spend_deadline": "2025-04-15",
    }, headers=auth_headers)
    assert resp1.status_code == 201

    # Second retention offer — credit only, accepted with spend
    resp2 = client.post(f"/api/cards/{card['id']}/retention-offer", json={
        "event_date": "2026-01-15",
        "offer_credit": 150,
        "accepted": True,
        "spend_requirement": 4000,
        "spend_deadline": "2026-04-15",
    }, headers=auth_headers)
    assert resp2.status_code == 201

    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()

    # 2 retention events
    ret_events = [e for e in card_data["events"] if e["event_type"] == "retention_offer"]
    assert len(ret_events) == 2

    # 2 independent bonuses
    assert len(card_data["bonuses"]) == 2
    sources = {b["bonus_source"] for b in card_data["bonuses"]}
    assert sources == {"retention"}
    amounts = sorted([b["bonus_amount"] for b in card_data["bonuses"]])
    assert amounts == [150, 30000]

    # Delete first event — only its bonus should be deleted
    event1_id = resp1.json()["id"]
    client.delete(f"/api/events/{event1_id}", headers=auth_headers)

    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 1
    assert card_data["bonuses"][0]["bonus_amount"] == 150


# ── Reopen card restores AF tracking ──────────────────


def test_reopen_card_restores_af_tracking(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    open_date = (date.today() - timedelta(days=400)).isoformat()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Platinum",
        "issuer": "Amex",
        "card_type": "personal",
        "open_date": open_date,
        "annual_fee": 695,
    }, headers=auth_headers).json()

    # Card should have annual_fee_date set
    assert card["annual_fee_date"] is not None
    original_af_date = card["annual_fee_date"]

    # Close the card
    card = client.post(
        f"/api/cards/{card['id']}/close",
        json={"close_date": date.today().isoformat()},
        headers=auth_headers,
    ).json()
    assert card["status"] == "closed"
    assert card["annual_fee_date"] is None

    # Reopen the card
    card = client.post(f"/api/cards/{card['id']}/reopen", headers=auth_headers).json()
    assert card["status"] == "active"
    # AF date should be restored
    assert card["annual_fee_date"] is not None

    # Should have a reopened event
    reopened_events = [e for e in card["events"] if e["event_type"] == "reopened"]
    assert len(reopened_events) == 1


# ── Bonus missed status ──────────────────


def test_bonus_missed_status(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "CSR",
        "issuer": "Chase",
        "card_type": "personal",
    }, headers=auth_headers).json()

    # Create a bonus
    bonus = client.post(f"/api/cards/{card['id']}/bonuses", json={
        "bonus_source": "upgrade",
        "bonus_amount": 50000,
        "bonus_type": "points",
        "spend_requirement": 4000,
        "spend_deadline": "2025-01-01",
        "spend_reminder_enabled": True,
    }, headers=auth_headers).json()

    assert bonus["bonus_missed"] is False

    # Mark as missed
    updated = client.put(f"/api/bonuses/{bonus['id']}", json={
        "bonus_missed": True,
        "spend_reminder_enabled": False,
    }, headers=auth_headers).json()
    assert updated["bonus_missed"] is True
    assert updated["spend_reminder_enabled"] is False


# ── Cascade delete bonuses with events ──────────────────


def test_cascade_delete_bonus_with_event(client, auth_headers):
    """Deleting a non-system event cascades to linked bonuses; system events cannot be deleted."""
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold",
        "issuer": "Amex",
        "card_type": "personal",
    }, headers=auth_headers).json()

    # Create a retention offer with a bonus (non-system event)
    resp = client.post(
        f"/api/cards/{card['id']}/retention-offer",
        json={
            "event_date": date.today().isoformat(),
            "offer_points": 50000,
            "accepted": True,
            "spend_requirement": 3000,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    event_id = resp.json()["id"]

    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 1
    assert card_data["bonuses"][0]["event_id"] == event_id

    # Delete the retention offer event — bonus should cascade
    resp = client.delete(f"/api/events/{event_id}", headers=auth_headers)
    assert resp.status_code == 204

    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 0


# ── Product change with reset_af_anniversary=false ──────────────────


def test_product_change_no_af_reset(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    open_date = (date.today() - timedelta(days=400)).isoformat()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold",
        "issuer": "Amex",
        "card_type": "personal",
        "open_date": open_date,
        "annual_fee": 250,
    }, headers=auth_headers).json()
    original_af_date = card["annual_fee_date"]

    # Product change WITHOUT resetting AF anniversary
    card = client.post(
        f"/api/cards/{card['id']}/product-change",
        json={
            "new_card_name": "Platinum",
            "change_date": date.today().isoformat(),
            "new_annual_fee": 695,
            "reset_af_anniversary": False,
        },
        headers=auth_headers,
    ).json()

    # AF date should remain unchanged from original
    assert card["annual_fee_date"] == original_af_date


# ── Import merge duplicate skipping ──────────────────


def test_import_merge_skips_duplicates(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    open_date = "2024-06-01"
    client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "CSP",
        "issuer": "Chase",
        "card_type": "personal",
        "open_date": open_date,
    }, headers=auth_headers)

    # Import with merge mode containing the same card
    import_data = ExportData(
        version=1,
        exported_at=datetime.now(timezone.utc),
        profiles=[ExportProfile(
            name="Test",
            cards=[
                ExportCard(card_name="CSP", issuer="Chase", open_date=date(2024, 6, 1)),
                ExportCard(card_name="CSR", issuer="Chase", open_date=date(2024, 7, 1)),
            ],
        )],
    )
    result = client.post(
        f"/api/profiles/import?mode=merge&target_profile_id={profile['id']}",
        json=import_data.model_dump(mode="json"),
        headers=auth_headers,
    ).json()

    assert result["cards_imported"] == 1  # Only CSR
    assert result["cards_skipped"] == 1   # CSP skipped

    # Profile should have 2 cards total
    cards = client.get(f"/api/cards?profile_id={profile['id']}", headers=auth_headers).json()
    assert len(cards) == 2


# ── Settings export/import round-trip ──────────────────


def test_settings_export_import(client, auth_headers):
    # Set timezone
    client.put("/api/settings", json={"timezone": "America/New_York"}, headers=auth_headers)

    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()

    # Export
    export = client.get(f"/api/profiles/export?profile_id={profile['id']}", headers=auth_headers).json()
    assert export["settings"] is not None
    assert export["settings"]["timezone"] == "America/New_York"

    # Clear timezone
    client.put("/api/settings", json={"timezone": ""}, headers=auth_headers)
    settings = client.get("/api/settings", headers=auth_headers).json()
    assert "timezone" not in settings

    # Import with settings
    result = client.post(
        "/api/profiles/import?mode=new",
        json=export,
        headers=auth_headers,
    ).json()
    assert result["profiles_imported"] == 1

    # Timezone should be restored
    settings = client.get("/api/settings", headers=auth_headers).json()
    assert settings["timezone"] == "America/New_York"


# ── Cascade delete card deletes events, benefits, bonuses ──────────────────


def test_cascade_delete_card(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "CSP",
        "issuer": "Chase",
        "card_type": "personal",
        "open_date": date.today().isoformat(),
    }, headers=auth_headers).json()

    # Add a benefit
    client.post(f"/api/cards/{card['id']}/benefits", json={
        "benefit_name": "Travel Credit",
        "benefit_amount": 50,
        "frequency": "annual",
    }, headers=auth_headers)

    # Add a bonus
    client.post(f"/api/cards/{card['id']}/bonuses", json={
        "bonus_source": "upgrade",
        "bonus_amount": 50000,
        "bonus_type": "points",
    }, headers=auth_headers)

    # Delete card
    resp = client.delete(f"/api/cards/{card['id']}", headers=auth_headers)
    assert resp.status_code == 204

    # Card should be gone
    resp = client.get(f"/api/cards/{card['id']}", headers=auth_headers)
    assert resp.status_code == 404


# ── Bonus CRUD ──────────────────


def test_bonus_crud(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "CSR",
        "issuer": "Chase",
        "card_type": "personal",
    }, headers=auth_headers).json()

    # Create
    bonus = client.post(f"/api/cards/{card['id']}/bonuses", json={
        "bonus_source": "upgrade",
        "bonus_amount": 75000,
        "bonus_type": "points",
        "spend_requirement": 4000,
        "spend_deadline": "2026-06-01",
        "spend_reminder_enabled": True,
    }, headers=auth_headers).json()
    assert bonus["bonus_amount"] == 75000
    assert bonus["bonus_source"] == "upgrade"
    assert bonus["bonus_missed"] is False

    # Update
    updated = client.put(f"/api/bonuses/{bonus['id']}", json={
        "bonus_earned": True,
        "spend_reminder_enabled": False,
    }, headers=auth_headers).json()
    assert updated["bonus_earned"] is True

    # Delete
    resp = client.delete(f"/api/bonuses/{bonus['id']}", headers=auth_headers)
    assert resp.status_code == 204

    # Verify deleted
    card_data = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert len(card_data["bonuses"]) == 0


# ── Bonus missed in export/import ──────────────────


def test_bonus_missed_export_import(client, auth_headers):
    profile = client.post("/api/profiles", json={"name": "Test"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Gold",
        "issuer": "Amex",
        "card_type": "personal",
    }, headers=auth_headers).json()

    # Create a missed bonus
    bonus = client.post(f"/api/cards/{card['id']}/bonuses", json={
        "bonus_source": "retention",
        "bonus_amount": 30000,
        "bonus_type": "points",
        "bonus_missed": True,
    }, headers=auth_headers).json()
    assert bonus["bonus_missed"] is True

    # Export
    export = client.get(f"/api/profiles/export?profile_id={profile['id']}", headers=auth_headers).json()
    exported_bonus = export["profiles"][0]["cards"][0]["bonuses"][0]
    assert exported_bonus["bonus_missed"] is True

    # Import into new profile
    result = client.post(
        "/api/profiles/import?mode=new",
        json=export,
        headers=auth_headers,
    ).json()
    assert result["cards_imported"] == 1

    # Verify bonus_missed preserved
    cards = client.get("/api/cards", headers=auth_headers).json()
    imported_card = [c for c in cards if c["card_name"] == "Gold" and c["id"] != card["id"]][0]
    assert len(imported_card["bonuses"]) == 1
    assert imported_card["bonuses"][0]["bonus_missed"] is True


def test_bonus_mutual_exclusivity(client, auth_headers):
    """Setting bonus_earned=True clears bonus_missed, and vice versa."""
    profile = client.post("/api/profiles", json={"name": "MutexTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "TestCard",
        "issuer": "TestIssuer",
    }, headers=auth_headers).json()

    bonus = client.post(f"/api/cards/{card['id']}/bonuses", json={
        "bonus_source": "signup",
        "bonus_amount": 50000,
        "bonus_type": "points",
    }, headers=auth_headers).json()

    # Mark as missed
    resp = client.put(f"/api/bonuses/{bonus['id']}", json={"bonus_missed": True}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["bonus_missed"] is True
    assert resp.json()["bonus_earned"] is False

    # Mark as earned — should clear missed
    resp = client.put(f"/api/bonuses/{bonus['id']}", json={"bonus_earned": True}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["bonus_earned"] is True
    assert resp.json()["bonus_missed"] is False

    # Mark as missed — should clear earned
    resp = client.put(f"/api/bonuses/{bonus['id']}", json={"bonus_missed": True}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["bonus_missed"] is True
    assert resp.json()["bonus_earned"] is False


def test_bonus_create_both_true_fails(client, auth_headers):
    """Cannot create a bonus with both earned and missed set to True."""
    profile = client.post("/api/profiles", json={"name": "BothTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "TestCard",
        "issuer": "TestIssuer",
    }, headers=auth_headers).json()

    resp = client.post(f"/api/cards/{card['id']}/bonuses", json={
        "bonus_source": "signup",
        "bonus_amount": 50000,
        "bonus_earned": True,
        "bonus_missed": True,
    }, headers=auth_headers)
    assert resp.status_code == 422  # Validation error


def test_card_update_last_digits_validation(client, auth_headers):
    """CardUpdate rejects invalid last_digits."""
    profile = client.post("/api/profiles", json={"name": "ValidatorTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "TestCard",
        "issuer": "TestIssuer",
        "last_digits": "1234",
    }, headers=auth_headers).json()

    # Invalid: not digits
    resp = client.put(f"/api/cards/{card['id']}", json={"last_digits": "abcd"}, headers=auth_headers)
    assert resp.status_code == 422

    # Invalid: too short
    resp = client.put(f"/api/cards/{card['id']}", json={"last_digits": "123"}, headers=auth_headers)
    assert resp.status_code == 422

    # Valid: 4 digits
    resp = client.put(f"/api/cards/{card['id']}", json={"last_digits": "5678"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["last_digits"] == "5678"

    # Valid: 5 digits
    resp = client.put(f"/api/cards/{card['id']}", json={"last_digits": "12345"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["last_digits"] == "12345"


def test_card_update_date_validation(client, auth_headers):
    """CardUpdate rejects close_date before open_date."""
    profile = client.post("/api/profiles", json={"name": "DateValidTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "TestCard",
        "issuer": "TestIssuer",
        "open_date": "2024-06-01",
    }, headers=auth_headers).json()

    # Invalid: close_date before open_date
    resp = client.put(f"/api/cards/{card['id']}", json={
        "open_date": "2024-06-01",
        "close_date": "2024-01-01",
    }, headers=auth_headers)
    assert resp.status_code == 422


def test_import_merge_case_insensitive(client, auth_headers):
    """Merge skips duplicates even when card_name/issuer differ in case."""
    profile = client.post("/api/profiles", json={"name": "CaseTest"}, headers=auth_headers).json()
    client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Sapphire Preferred",
        "issuer": "Chase",
        "open_date": "2024-01-15",
    }, headers=auth_headers)

    # Import with different casing
    export_data = {
        "version": "1.0",
        "exported_at": "2024-06-01T00:00:00Z",
        "profiles": [{
            "name": "CaseTest",
            "cards": [{
                "card_name": "sapphire preferred",  # lowercase
                "issuer": "chase",  # lowercase
                "card_type": "personal",
                "status": "active",
                "open_date": "2024-01-15",
                "events": [],
                "benefits": [],
                "bonuses": [],
            }],
        }],
    }
    result = client.post(
        f"/api/profiles/import?mode=merge&target_profile_id={profile['id']}",
        json=export_data,
        headers=auth_headers,
    ).json()

    assert result["cards_skipped"] == 1
    assert result["cards_imported"] == 0


def test_import_merge_allows_reimport_of_soft_deleted_card(client, auth_headers):
    """Merge import should not count soft-deleted cards as duplicates."""
    profile = client.post("/api/profiles", json={"name": "SoftDelTest"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "CSP",
        "issuer": "Chase",
        "open_date": "2024-06-01",
    }, headers=auth_headers).json()

    # Soft-delete the card
    r = client.delete(f"/api/cards/{card['id']}", headers=auth_headers)
    assert r.status_code == 204

    # Import the same card via merge — should succeed since original is soft-deleted
    import_data = ExportData(
        version=1,
        exported_at=datetime.now(timezone.utc),
        profiles=[ExportProfile(
            name="SoftDelTest",
            cards=[
                ExportCard(card_name="CSP", issuer="Chase", open_date=date(2024, 6, 1)),
            ],
        )],
    )
    result = client.post(
        f"/api/profiles/import?mode=merge&target_profile_id={profile['id']}",
        json=import_data.model_dump(mode="json"),
        headers=auth_headers,
    ).json()

    assert result["cards_imported"] == 1
    assert result["cards_skipped"] == 0


def test_edit_close_event_date(client, setup_complete, auth_headers):
    """Editing the date of a system-managed 'closed' event should work."""
    # Create profile and card
    profile = client.post("/api/profiles", json={"name": "P"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2024-01-01",
        "annual_fee": 95,
    }, headers=auth_headers).json()

    # Close the card
    client.post(f"/api/cards/{card['id']}/close", json={"close_date": "2025-01-15"}, headers=auth_headers)

    # Find the closed event
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    close_event = next(e for e in events if e["event_type"] == "closed")

    # Edit the close event's date — should succeed, not "Cannot modify system-managed event type"
    r = client.put(f"/api/events/{close_event['id']}", json={
        "event_type": "closed",
        "event_date": "2025-02-01",
    }, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["event_date"] == "2025-02-01"


def test_old_card_gets_historical_annual_fee_events(client, setup_complete, auth_headers):
    """Adding a card opened in 2022 using Hilton Aspire template should have $450 AF for 2022, $550 after."""
    profile = client.post("/api/profiles", json={"name": "P"}, headers=auth_headers).json()

    # Create card from Hilton Aspire template opened in 2022
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "template_id": "amex/hilton_aspire",
        "card_name": "Hilton Aspire",
        "issuer": "Amex",
        "open_date": "2022-06-15",
        "annual_fee": 550,
    }, headers=auth_headers).json()

    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events = sorted(
        [e for e in events if e["event_type"] == "annual_fee_posted"],
        key=lambda e: e["event_date"],
    )

    # Should have multiple AF events
    assert len(af_events) >= 3  # 2022, 2023, 2024 at minimum

    # 2022 event should have $450 (from amex_aspire_2020_1 version)
    af_2022 = next(e for e in af_events if e["event_date"].startswith("2022"))
    assert af_2022["metadata_json"]["annual_fee"] == 450

    # 2023+ events should have $550 (from amex_aspire_2023_1 version)
    af_2023 = next(e for e in af_events if e["event_date"].startswith("2023"))
    assert af_2023["metadata_json"]["annual_fee"] == 550


# ── Exact date anchoring ───────────────────────────────────


def test_edit_af_event_to_exact_date_updates_annual_fee_date(client, setup_complete, auth_headers):
    """Editing the most recent AF event to an exact date should update annual_fee_date to +12 months."""
    profile = client.post("/api/profiles", json={"name": "P"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2024-06-15",
        "annual_fee": 95,
    }, headers=auth_headers).json()

    # Find the most recent AF event (approximate)
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events = sorted(
        [e for e in events if e["event_type"] == "annual_fee_posted"],
        key=lambda e: e["event_date"],
    )
    latest_af = af_events[-1]
    assert latest_af["metadata_json"].get("approximate_date") is True

    # Edit it to an exact date (strips approximate_date)
    r = client.put(f"/api/events/{latest_af['id']}", json={
        "event_date": "2025-07-22",
        "metadata_json": {"annual_fee": 95},
    }, headers=auth_headers)
    assert r.status_code == 200

    # annual_fee_date should now be exact date + 12 months
    updated_card = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert updated_card["annual_fee_date"] == "2026-07-22"


def test_add_af_event_updates_annual_fee_date(client, setup_complete, auth_headers):
    """Adding a new AF event that becomes the most recent should update annual_fee_date."""
    profile = client.post("/api/profiles", json={"name": "P"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2024-01-01",
        "annual_fee": 250,
    }, headers=auth_headers).json()

    original_af_date = card["annual_fee_date"]

    # Add a new AF event with a date later than all existing ones
    r = client.post(f"/api/cards/{card['id']}/events", json={
        "event_type": "annual_fee_posted",
        "event_date": "2026-02-20",
        "metadata_json": {"annual_fee": 250},
    }, headers=auth_headers)
    assert r.status_code == 201

    # annual_fee_date should update to new event + 12 months
    updated_card = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert updated_card["annual_fee_date"] == "2027-02-20"
    assert updated_card["annual_fee_date"] != original_af_date


# ── AF event deletion recalculates annual_fee_date ──────────


def test_delete_exact_af_event_falls_back_to_schedule(client, setup_complete, auth_headers):
    """Deleting an exact (user-anchored) AF event should fall back to the approximate schedule."""
    profile = client.post("/api/profiles", json={"name": "P"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2024-06-15",
        "annual_fee": 95,
    }, headers=auth_headers).json()

    schedule_af_date = card["annual_fee_date"]  # from +13mo/+12mo schedule

    # Add an exact (user-entered) AF event later than all auto-generated ones
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events = sorted(
        [e for e in events if e["event_type"] == "annual_fee_posted"],
        key=lambda e: e["event_date"],
    )
    latest_approx = af_events[-1]

    # Add exact event after the latest approximate one
    r = client.post(f"/api/cards/{card['id']}/events", json={
        "event_type": "annual_fee_posted",
        "event_date": "2026-02-10",
        "metadata_json": {"annual_fee": 95},
    }, headers=auth_headers)
    assert r.status_code == 201
    exact_event_id = r.json()["id"]

    # annual_fee_date should be anchored to exact event + 12mo
    anchored = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert anchored["annual_fee_date"] == "2027-02-10"

    # Delete the exact event
    r = client.delete(f"/api/events/{exact_event_id}", headers=auth_headers)
    assert r.status_code == 204

    # annual_fee_date should fall back to the approximate schedule
    updated = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert updated["annual_fee_date"] == schedule_af_date


def test_delete_all_af_events_recalculates_from_open_date(client, setup_complete, auth_headers):
    """Deleting all AF events should recalculate annual_fee_date from open_date schedule."""
    profile = client.post("/api/profiles", json={"name": "P"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2025-06-01",
        "annual_fee": 95,
    }, headers=auth_headers).json()

    # Should have 1 AF event (at open_date, since it's recent)
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events = [e for e in events if e["event_type"] == "annual_fee_posted"]
    assert len(af_events) >= 1

    # Delete all AF events
    for af in af_events:
        r = client.delete(f"/api/events/{af['id']}", headers=auth_headers)
        assert r.status_code == 204

    # annual_fee_date should recalculate from open_date (+13mo = 2026-07-01)
    updated = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert updated["annual_fee_date"] == "2026-07-01"


def test_delete_non_latest_af_event_keeps_date(client, setup_complete, auth_headers):
    """Deleting a non-most-recent AF event should not change annual_fee_date."""
    profile = client.post("/api/profiles", json={"name": "P"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2024-01-01",
        "annual_fee": 95,
    }, headers=auth_headers).json()

    original_af_date = card["annual_fee_date"]

    # Find the oldest AF event (not the most recent)
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events = sorted(
        [e for e in events if e["event_type"] == "annual_fee_posted"],
        key=lambda e: e["event_date"],
    )
    assert len(af_events) >= 2
    oldest = af_events[0]

    # Delete the oldest AF event
    r = client.delete(f"/api/events/{oldest['id']}", headers=auth_headers)
    assert r.status_code == 204

    # annual_fee_date should remain unchanged
    updated = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert updated["annual_fee_date"] == original_af_date


def test_delete_af_refund_no_recalculation(client, setup_complete, auth_headers):
    """Deleting an AF refund event should not affect annual_fee_date."""
    profile = client.post("/api/profiles", json={"name": "P"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2024-06-15",
        "annual_fee": 95,
    }, headers=auth_headers).json()

    original_af_date = card["annual_fee_date"]

    # Add a refund event
    r = client.post(f"/api/cards/{card['id']}/events", json={
        "event_type": "annual_fee_refund",
        "event_date": "2025-07-01",
        "metadata_json": {"annual_fee": 95},
    }, headers=auth_headers)
    assert r.status_code == 201
    refund_id = r.json()["id"]

    # Delete the refund
    r = client.delete(f"/api/events/{refund_id}", headers=auth_headers)
    assert r.status_code == 204

    # annual_fee_date should remain unchanged
    updated = client.get(f"/api/cards/{card['id']}", headers=auth_headers).json()
    assert updated["annual_fee_date"] == original_af_date


# ── Close card cleans up approximate AF events ──────────────


def test_close_card_deletes_approximate_af_events_after_close_date(client, setup_complete, auth_headers):
    """Closing a card should delete approximate AF events after the close date."""
    profile = client.post("/api/profiles", json={"name": "P"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2021-02-03",
        "annual_fee": 150,
    }, headers=auth_headers).json()

    # Should have multiple AF events spanning 2021-2026
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events = [e for e in events if e["event_type"] == "annual_fee_posted"]
    assert len(af_events) >= 4

    # Close the card on 2024-01-09
    card = client.post(
        f"/api/cards/{card['id']}/close",
        json={"close_date": "2024-01-09"},
        headers=auth_headers,
    ).json()

    # AF events after close date should be deleted
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    af_events_after = [
        e for e in events
        if e["event_type"] == "annual_fee_posted" and e["event_date"] > "2024-01-09"
    ]
    assert len(af_events_after) == 0

    # AF events before close date should still exist
    af_events_before = [
        e for e in events
        if e["event_type"] == "annual_fee_posted" and e["event_date"] <= "2024-01-09"
    ]
    assert len(af_events_before) >= 3  # 2021, 2022, 2023


def test_cannot_delete_system_events(client, setup_complete, auth_headers):
    """System-managed events (opened, closed, product_change, reopened) cannot be deleted."""
    profile = client.post("/api/profiles", json={"name": "P"}, headers=auth_headers).json()
    card = client.post("/api/cards", json={
        "profile_id": profile["id"],
        "card_name": "Test Card",
        "issuer": "Test",
        "open_date": "2024-01-01",
    }, headers=auth_headers).json()

    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    opened_event = next(e for e in events if e["event_type"] == "opened")

    # Cannot delete opened event
    resp = client.delete(f"/api/events/{opened_event['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "system-managed" in resp.json()["detail"]

    # Close the card, then try to delete the closed event
    client.post(f"/api/cards/{card['id']}/close", json={"close_date": "2025-01-01"}, headers=auth_headers)
    events = client.get(f"/api/cards/{card['id']}/events", headers=auth_headers).json()
    closed_event = next(e for e in events if e["event_type"] == "closed")

    resp = client.delete(f"/api/events/{closed_event['id']}", headers=auth_headers)
    assert resp.status_code == 400
    assert "system-managed" in resp.json()["detail"]
