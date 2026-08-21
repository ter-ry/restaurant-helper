from __future__ import annotations

import hashlib
from uuid import uuid4

from backend.extensions import db
from backend.models import OrganizationInvitation, OrganizationMembership, User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD


def login(client, email: str = LOCAL_OWNER_EMAIL, password: str = LOCAL_OWNER_PASSWORD):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 200


def csrf_headers(client):
    return {"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]}


def test_owner_can_create_cancel_and_list_invitation(app, client):
    login(client)
    invite_email = f"{uuid4().hex[:8]}@example.com"

    create_response = client.post(
        "/api/organization-invitations",
        headers=csrf_headers(client),
        json={"email": invite_email, "role": "manager"},
    )
    assert create_response.status_code == 201
    body = create_response.get_json()
    raw_token = body["invitationUrl"].split("/invite/", 1)[1]

    with app.app_context():
        invitation = OrganizationInvitation.query.filter_by(invited_email=invite_email).first()
        assert invitation is not None
        assert invitation.token == hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        assert invitation.status == "pending"

    list_response = client.get("/api/organization-invitations")
    assert list_response.status_code == 200
    assert list_response.get_json()["invitations"][0]["invitedEmail"] == invite_email

    cancel_response = client.post(f"/api/organization-invitations/{raw_token}/cancel", headers=csrf_headers(client))
    assert cancel_response.status_code == 200
    assert cancel_response.get_json()["invitation"]["status"] == "revoked"

    repeat_cancel = client.post(f"/api/organization-invitations/{raw_token}/cancel", headers=csrf_headers(client))
    assert repeat_cancel.status_code == 409


def test_owner_can_cancel_invitation_by_id(app, client):
    login(client)
    invite_email = f"{uuid4().hex[:8]}@example.com"

    create_response = client.post(
        "/api/organization-invitations",
        headers=csrf_headers(client),
        json={"email": invite_email, "role": "manager"},
    )
    body = create_response.get_json()
    invitation_id = body["invitation"]["id"]

    cancel_response = client.post(f"/api/organization-invitations/{invitation_id}/cancel", headers=csrf_headers(client))
    assert cancel_response.status_code == 200
    assert cancel_response.get_json()["invitation"]["status"] == "revoked"


def test_invitation_accept_requires_matching_email_and_is_single_use(app, client):
    login(client)
    invite_email = f"{uuid4().hex[:8]}@example.com"

    create_response = client.post(
        "/api/organization-invitations",
        headers=csrf_headers(client),
        json={"email": invite_email, "role": "manager"},
    )
    raw_token = create_response.get_json()["invitationUrl"].split("/invite/", 1)[1]

    with app.app_context():
        invitee = User(email=invite_email, is_active=True)
        invitee.set_password("Invitee123!")
        db.session.add(invitee)
        db.session.commit()

    logout_response = client.post("/api/auth/logout", headers=csrf_headers(client))
    assert logout_response.status_code == 200

    login_response = client.post(
        "/api/auth/login",
        json={"email": invite_email, "password": "Invitee123!"},
        headers=csrf_headers(client),
    )
    assert login_response.status_code == 200, login_response.get_data(as_text=True)

    accept_response = client.post(
        f"/api/organization-invitations/{raw_token}/accept",
        headers=csrf_headers(client),
    )
    assert accept_response.status_code == 200
    assert accept_response.get_json()["accepted"] is True

    with app.app_context():
        membership = OrganizationMembership.query.join(User).filter(User.email == invite_email).first()
        assert membership is not None
        assert membership.role == "manager"

    repeat_accept = client.post(f"/api/organization-invitations/{raw_token}/accept", headers=csrf_headers(client))
    assert repeat_accept.status_code == 409
