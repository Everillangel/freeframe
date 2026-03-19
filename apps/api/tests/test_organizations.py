"""
Organization endpoint tests.

DB is mocked; get_current_user is overridden via auth_headers fixture.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

from apps.api.models.organization import OrgRole


def _mock_org(name: str = "Test Org", slug: str = "test-org") -> MagicMock:
    o = MagicMock()
    o.id = uuid.uuid4()
    o.name = name
    o.slug = slug
    o.logo_url = None
    o.created_at = datetime.now(timezone.utc)
    o.deleted_at = None
    return o


def _mock_member(org_id: uuid.UUID, user_id: uuid.UUID, role: OrgRole = OrgRole.owner) -> MagicMock:
    m = MagicMock()
    m.id = uuid.uuid4()
    m.org_id = org_id
    m.user_id = user_id
    m.role = role
    m.joined_at = datetime.now(timezone.utc)
    m.deleted_at = None
    return m


def test_create_org(client, auth_headers, mock_db, test_user):
    """POST /organizations — happy path creates org and returns 201."""
    # No slug conflict
    mock_db.first.return_value = None

    def _refresh_side_effect(obj):
        obj.id = uuid.uuid4()
        obj.created_at = datetime.now(timezone.utc)
        obj.deleted_at = None
        obj.logo_url = None

    mock_db.refresh.side_effect = _refresh_side_effect

    resp = client.post(
        "/organizations",
        json={"name": "Test Org", "slug": "test-org"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Test Org"


def test_create_org_slug_conflict(client, auth_headers, mock_db):
    """POST /organizations — 400 when slug already taken."""
    existing_org = _mock_org("Existing", "taken-slug")
    mock_db.first.return_value = existing_org

    resp = client.post(
        "/organizations",
        json={"name": "New Org", "slug": "taken-slug"},
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_get_org(client, auth_headers, mock_db, test_user):
    """GET /organizations/{org_id} — member can fetch org."""
    org = _mock_org()
    member = _mock_member(org.id, test_user.id)

    call_count = 0

    def _first_side_effect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return org   # org lookup
        return member    # membership check

    mock_db.first.side_effect = _first_side_effect

    resp = client.get(f"/organizations/{org.id}", headers=auth_headers)
    assert resp.status_code == 200


def test_get_org_not_member(client, auth_headers, mock_db):
    """GET /organizations/{org_id} — 403 if user is not a member."""
    org = _mock_org()

    call_count = 0

    def _first_side_effect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return org   # org found
        return None      # no membership

    mock_db.first.side_effect = _first_side_effect

    resp = client.get(f"/organizations/{org.id}", headers=auth_headers)
    assert resp.status_code == 403


def test_get_org_not_found(client, auth_headers, mock_db):
    """GET /organizations/{org_id} — 404 if org doesn't exist."""
    mock_db.first.return_value = None

    resp = client.get(f"/organizations/{uuid.uuid4()}", headers=auth_headers)
    assert resp.status_code == 404
