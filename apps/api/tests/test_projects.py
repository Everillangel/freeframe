"""
Project endpoint tests.

DB is mocked; auth is bypassed via auth_headers fixture.
The projects router uses POST /projects (with org_id in body) and GET /projects.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

from apps.api.models.project import ProjectType, ProjectRole


def _mock_project(
    org_id: uuid.UUID,
    created_by: uuid.UUID,
    name: str = "Test Project",
) -> MagicMock:
    p = MagicMock()
    p.id = uuid.uuid4()
    p.org_id = org_id
    p.team_id = None
    p.name = name
    p.description = None
    p.project_type = ProjectType.personal
    p.created_by = created_by
    p.created_at = datetime.now(timezone.utc)
    p.deleted_at = None
    return p


def _mock_project_member(project_id: uuid.UUID, user_id: uuid.UUID, role: ProjectRole = ProjectRole.owner) -> MagicMock:
    m = MagicMock()
    m.id = uuid.uuid4()
    m.project_id = project_id
    m.user_id = user_id
    m.role = role
    m.invited_by = None
    m.deleted_at = None
    return m


def test_create_project(client, auth_headers, mock_db, test_user):
    """POST /projects — happy path returns 201."""
    org_id = uuid.uuid4()

    def _refresh_side_effect(obj):
        obj.id = uuid.uuid4()
        obj.created_at = datetime.now(timezone.utc)
        obj.deleted_at = None
        obj.team_id = None
        obj.description = None
        obj.project_type = ProjectType.personal

    mock_db.refresh.side_effect = _refresh_side_effect

    resp = client.post(
        "/projects",
        json={"name": "Test Project", "org_id": str(org_id)},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Test Project"


def test_list_projects(client, auth_headers, mock_db, test_user):
    """GET /projects — returns list of user's projects."""
    org_id = uuid.uuid4()
    proj = _mock_project(org_id, test_user.id, "Listed Project")

    # Subquery for member_project_ids and then filter by those IDs
    mock_db.subquery.return_value = MagicMock()
    mock_db.all.return_value = [proj]

    resp = client.get("/projects", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


def test_get_project(client, auth_headers, mock_db, test_user):
    """GET /projects/{project_id} — returns project for member."""
    org_id = uuid.uuid4()
    proj = _mock_project(org_id, test_user.id)
    member = _mock_project_member(proj.id, test_user.id)

    call_count = 0

    def _first_side_effect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return proj
        return member

    mock_db.first.side_effect = _first_side_effect

    resp = client.get(f"/projects/{proj.id}", headers=auth_headers)
    assert resp.status_code == 200


def test_get_project_not_member(client, auth_headers, mock_db, test_user):
    """GET /projects/{project_id} — 403 if user is not a member."""
    org_id = uuid.uuid4()
    proj = _mock_project(org_id, test_user.id)

    call_count = 0

    def _first_side_effect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return proj
        return None  # no membership

    mock_db.first.side_effect = _first_side_effect

    resp = client.get(f"/projects/{proj.id}", headers=auth_headers)
    assert resp.status_code == 403


def test_delete_project(client, auth_headers, mock_db, test_user):
    """DELETE /projects/{project_id} — owner can delete, returns 204."""
    org_id = uuid.uuid4()
    proj = _mock_project(org_id, test_user.id)
    member = _mock_project_member(proj.id, test_user.id, ProjectRole.owner)

    call_count = 0

    def _first_side_effect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return proj
        return member

    mock_db.first.side_effect = _first_side_effect

    resp = client.delete(f"/projects/{proj.id}", headers=auth_headers)
    assert resp.status_code == 204


def test_update_project(client, auth_headers, mock_db, test_user):
    """PATCH /projects/{project_id} — owner can update name."""
    org_id = uuid.uuid4()
    proj = _mock_project(org_id, test_user.id, "Old Name")
    member = _mock_project_member(proj.id, test_user.id, ProjectRole.owner)

    call_count = 0

    def _first_side_effect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return proj  # _get_project
        return member    # _require_project_owner

    mock_db.first.side_effect = _first_side_effect

    def _refresh_side_effect(obj):
        obj.name = "New Name"

    mock_db.refresh.side_effect = _refresh_side_effect

    resp = client.patch(
        f"/projects/{proj.id}",
        json={"name": "New Name"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"
