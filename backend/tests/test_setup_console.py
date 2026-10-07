from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from backend.extensions import db
from backend.models import (
    AuditEvent,
    InventoryItem,
    Organization,
    OrganizationModule,
    PlatformRole,
    SquareCatalogMapping,
    SquareCatalogObject,
    SquareConnection,
    SquareDailySalesSummary,
    SquareLocation,
    SquareLocationMapping,
    SquareOrder,
    SquareOrderLine,
    SquareSyncCursor,
    SquareSyncJob,
    SquareWebhookEvent,
    User,
)
from backend.seed import LOCAL_MANAGER_EMAIL, LOCAL_MANAGER_PASSWORD, LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD


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


def test_platform_role_cli_assigns_existing_user_and_is_idempotent(app):
    runner = app.test_cli_runner()

    first = runner.invoke(
        args=["platform-role", "set", "--email", LOCAL_OWNER_EMAIL, "--role", "setup_admin"]
    )
    assert first.exit_code == 0, first.output
    assert f"Assigned platform role setup_admin to {LOCAL_OWNER_EMAIL}" in first.output

    second = runner.invoke(
        args=["platform-role", "set", "--email", LOCAL_OWNER_EMAIL, "--role", "setup_admin"]
    )
    assert second.exit_code == 0, second.output
    assert "already assigned" in second.output

    with app.app_context():
        user = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        assert PlatformRole.query.filter_by(user_id=user.id, role="setup_admin", is_active=True).count() == 1
        assert AuditEvent.query.filter_by(event_type="platform_role_assigned", entity_id=str(user.id)).count() == 1


def test_platform_role_cli_refuses_unknown_user(app):
    result = app.test_cli_runner().invoke(
        args=["platform-role", "set", "--email", "missing@example.com", "--role", "setup_admin"]
    )
    assert result.exit_code != 0
    assert "No existing user found" in result.output


def test_platform_setup_console_can_activate_an_organization(app, client):
    login(client)

    with app.app_context():
        user = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert user is not None
        if PlatformRole.query.filter_by(user_id=user.id).first() is None:
            db.session.add(PlatformRole(user_id=user.id, role="setup_admin", is_active=True))
            db.session.commit()

    create_response = client.post(
        "/api/onboarding/organizations",
        headers=csrf_headers(client),
        json={
            "name": f"Setup Org {uuid4().hex[:6]}",
            "templateKey": "CAFE",
            "locationName": "Setup Kitchen",
            "city": "Toronto",
        },
    )
    assert create_response.status_code == 201
    organization_id = create_response.get_json()["organization"]["id"]

    list_response = client.get("/api/platform/setup/organizations?state=ONBOARDING")
    assert list_response.status_code == 200
    assert any(entry["organization"]["id"] == organization_id for entry in list_response.get_json()["organizations"])
    email_search = client.get(f"/api/platform/setup/organizations?state=ONBOARDING&search={LOCAL_OWNER_EMAIL}")
    assert email_search.status_code == 200
    assert any(entry["organization"]["id"] == organization_id for entry in email_search.get_json()["organizations"])
    location_search = client.get("/api/platform/setup/organizations?state=ONBOARDING&search=Setup%20Kitchen")
    assert location_search.status_code == 200
    assert any(entry["organization"]["id"] == organization_id for entry in location_search.get_json()["organizations"])

    detail_response = client.get(f"/api/platform/setup/organizations/{organization_id}")
    assert detail_response.status_code == 200
    identity = detail_response.get_json()["customerIdentity"]
    assert identity["organizationId"] == organization_id
    assert identity["owner"]["email"] == LOCAL_OWNER_EMAIL
    assert identity["owner"]["role"] == "owner"
    assert identity["locations"][0]["name"] == "Setup Kitchen"
    assert identity["locations"][0]["city"] == "Toronto"
    assert identity["setupRequestedAt"] is None

    rename_response = client.post(
        f"/api/platform/setup/organizations/{organization_id}/name",
        headers=csrf_headers(client),
        json={"name": "  Renamed Setup Org  "},
    )
    assert rename_response.status_code == 200
    assert rename_response.get_json()["organization"]["name"] == "Renamed Setup Org"
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/name",
        headers=csrf_headers(client),
        json={"name": "   "},
    ).status_code == 400
    with app.app_context():
        renamed = Organization.query.filter_by(id=organization_id).one()
        assert renamed.name == "Renamed Setup Org"
        assert AuditEvent.query.filter_by(event_type="setup.organization_name_updated", organization_id=organization_id).count() == 1

    template_response = client.post(
        f"/api/platform/setup/organizations/{organization_id}/template",
        headers=csrf_headers(client),
        json={"templateKey": "CAFE"},
    )
    assert template_response.status_code == 200

    module_response = client.post(
        f"/api/platform/setup/organizations/{organization_id}/modules",
        headers=csrf_headers(client),
        json={
            "modules": [
                {"moduleKey": "PURCHASES", "status": "ENABLED"},
                {"moduleKey": "INVENTORY", "status": "ENABLED"},
                {"moduleKey": "REORDER_PLANS", "status": "ENABLED"},
                {"moduleKey": "STOCK_COUNTS", "status": "ENABLED"},
            ]
        },
    )
    assert module_response.status_code == 200

    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/locations",
        headers=csrf_headers(client),
        json={"locations": [{"id": create_response.get_json()["currentLocationId"], "name": "Setup Kitchen", "city": "Toronto"}]},
    ).status_code == 200

    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/imports",
        headers=csrf_headers(client),
        json={"imports": []},
    ).status_code == 200
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/square",
        headers=csrf_headers(client),
        json={"square": {"required": False, "locationMappings": []}},
    ).status_code == 200
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/custom-fields",
        headers=csrf_headers(client),
        json={"fields": {"supplier": [], "inventoryItem": [], "purchaseInvoice": []}},
    ).status_code == 200
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/notes",
        headers=csrf_headers(client),
        json={"notes": ["Ready for platform review"]},
    ).status_code == 200
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/blockers",
        headers=csrf_headers(client),
        json={"blockers": []},
    ).status_code == 200

    review_response = client.post(f"/api/platform/setup/organizations/{organization_id}/review", headers=csrf_headers(client))
    assert review_response.status_code == 200

    approval_response = client.post(f"/api/platform/setup/organizations/{organization_id}/review/approve", headers=csrf_headers(client))
    assert approval_response.status_code == 200

    state_response = client.post(
        f"/api/platform/setup/organizations/{organization_id}/state",
        headers=csrf_headers(client),
        json={
            "lifecycleStatus": "READY_FOR_REVIEW",
            "setupStatus": "COMPLETE",
            "subscriptionStatus": "ACTIVE",
            "setupFeeStatus": "confirmed",
        },
    )
    assert state_response.status_code == 200
    assert state_response.get_json()["checklist"]["readyForActivation"] is True

    activate_response = client.post(f"/api/platform/setup/organizations/{organization_id}/activate", headers=csrf_headers(client))
    assert activate_response.status_code == 200
    body = activate_response.get_json()
    assert body["organization"]["lifecycleStatus"] == "ACTIVE"
    assert body["organization"]["setupStatus"] == "COMPLETE"
    assert body["organization"]["subscriptionStatus"] == "ACTIVE"

    me_response = client.get("/api/auth/me")
    assert me_response.status_code == 200
    me_body = me_response.get_json()
    assert me_body["currentOrganizationId"] == organization_id
    assert me_body["currentLocationId"] == create_response.get_json()["currentLocationId"]

    dashboard = client.get("/api/pilot/dashboard")
    assert dashboard.status_code == 200

    with app.app_context():
        organization = Organization.query.filter_by(id=organization_id).first()
        assert organization is not None
        assert organization.lifecycle_status == "ACTIVE"
        assert organization.setup_status == "COMPLETE"


def test_platform_setup_console_exposes_optional_modules_without_org_rows(app, client):
    login(client)

    with app.app_context():
        user = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        assert user is not None
        if PlatformRole.query.filter_by(user_id=user.id).first() is None:
            db.session.add(PlatformRole(user_id=user.id, role="setup_admin", is_active=True))
            db.session.commit()

    create_response = client.post(
        "/api/onboarding/organizations",
        headers=csrf_headers(client),
        json={
            "name": f"Setup Org {uuid4().hex[:6]}",
            "templateKey": "CAFE",
            "locationName": "Setup Kitchen",
            "city": "Toronto",
        },
    )
    assert create_response.status_code == 201
    organization_id = create_response.get_json()["organization"]["id"]

    with app.app_context():
        menu_costing = OrganizationModule.query.filter_by(organization_id=organization_id, module_key="MENU_COSTING").first()
        assert menu_costing is None

    detail_response = client.get(f"/api/platform/setup/organizations/{organization_id}")
    assert detail_response.status_code == 200
    detail_body = detail_response.get_json()
    menu_costing = next(entry for entry in detail_body["modules"] if entry["key"] == "MENU_COSTING")
    assert menu_costing["status"] == "DISABLED"
    assert menu_costing["hasOrganizationRow"] is False
    assert menu_costing["backendReady"] is True
    reporting = next(entry for entry in detail_body["modules"] if entry["key"] == "REPORTING")
    assert reporting["status"] == "DISABLED"
    assert reporting["backendReady"] is False
    square = next(entry for entry in detail_body["modules"] if entry["key"] == "SQUARE_INTEGRATION")
    assert square["status"] == "DISABLED"
    assert square["backendReady"] is True

    enable_response = client.post(
        f"/api/platform/setup/organizations/{organization_id}/modules",
        headers=csrf_headers(client),
        json={
            "modules": [
                {"moduleKey": "PURCHASES", "status": "ENABLED"},
                {"moduleKey": "INVENTORY", "status": "ENABLED"},
                {"moduleKey": "MENU_COSTING", "status": "ENABLED"},
                {"moduleKey": "SQUARE_INTEGRATION", "status": "ENABLED"},
            ]
        },
    )
    assert enable_response.status_code == 200
    enable_body = enable_response.get_json()
    menu_costing = next(entry for entry in enable_body["modules"] if entry["key"] == "MENU_COSTING")
    assert menu_costing["status"] == "ENABLED"
    assert menu_costing["hasOrganizationRow"] is True
    assert menu_costing["enabledAt"] is not None
    square = next(entry for entry in enable_body["modules"] if entry["key"] == "SQUARE_INTEGRATION")
    assert square["status"] == "ENABLED"
    assert square["hasOrganizationRow"] is True

    disable_response = client.post(
        f"/api/platform/setup/organizations/{organization_id}/modules",
        headers=csrf_headers(client),
        json={
            "modules": [
                {"moduleKey": "PURCHASES", "status": "ENABLED"},
                {"moduleKey": "INVENTORY", "status": "ENABLED"},
                {"moduleKey": "MENU_COSTING", "status": "DISABLED"},
                {"moduleKey": "SQUARE_INTEGRATION", "status": "DISABLED"},
            ]
        },
    )
    assert disable_response.status_code == 200
    disable_body = disable_response.get_json()
    menu_costing = next(entry for entry in disable_body["modules"] if entry["key"] == "MENU_COSTING")
    assert menu_costing["status"] == "DISABLED"
    assert menu_costing["hasOrganizationRow"] is True
    square = next(entry for entry in disable_body["modules"] if entry["key"] == "SQUARE_INTEGRATION")
    assert square["status"] == "DISABLED"
    assert square["hasOrganizationRow"] is True


def test_non_platform_user_cannot_access_setup_customer_identity(client):
    login(client, LOCAL_MANAGER_EMAIL, LOCAL_MANAGER_PASSWORD)
    response = client.get("/api/platform/setup/organizations")
    assert response.status_code == 403


def test_showcase_usage_diagnostic_is_setup_admin_only_and_get_only(app, client):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        role = PlatformRole.query.filter_by(user_id=owner.id).first()
        if role is None:
            role = PlatformRole(user_id=owner.id, role="setup_admin", is_active=True)
            db.session.add(role)
        else:
            role.role = "setup_admin"
            role.is_active = True
        before_audits = AuditEvent.query.count()
        before_orders = SquareOrder.query.count()
        before_lines = SquareOrderLine.query.count()
        db.session.commit()

    login(client, LOCAL_MANAGER_EMAIL, LOCAL_MANAGER_PASSWORD)
    assert client.get(
        "/api/platform/setup/showcase/usage-diagnostic",
        query_string={"organizationId": 1, "locationId": 1, "startAt": "2026-10-07T17:45:00Z", "endAt": "2026-10-07T18:45:00Z"},
    ).status_code == 403

    login(client)
    response = client.get("/api/platform/setup/showcase/usage-diagnostic")
    assert response.status_code == 400
    with app.app_context():
        assert AuditEvent.query.count() == before_audits
        assert SquareOrder.query.count() == before_orders
        assert SquareOrderLine.query.count() == before_lines


def test_square_credential_diagnostic_is_setup_admin_only_safe_and_non_mutating(app, client, monkeypatch):
    import backend.platform_admin as platform_admin

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        owner_id = owner.id
        role = PlatformRole.query.filter_by(user_id=owner.id).first()
        if role is None:
            db.session.add(PlatformRole(user_id=owner.id, role="setup_admin", is_active=True))
        else:
            role.role = "setup_admin"
            role.is_active = True
        db.session.commit()
        app.config.update(
            FLOWTALLY_ENV="production",
            FLOWTALLY_SHOWCASE_ORGANIZATION_ID="1",
            SQUARE_ENABLED=True,
        )
        before_connections = SquareConnection.query.count()

    monkeypatch.setattr(platform_admin, "run_square_credential_diagnostic", lambda: {
        "classification": "rejected",
        "environment": "production",
        "host": "connect.squareup.com",
        "applicationFingerprint": "safe-fingerprint",
        "applicationSuffix": "PMJA",
        "redirectUri": "https://api.flowtally.ca/api/integrations/square/callback",
        "scopes": ["MERCHANT_PROFILE_READ", "ITEMS_READ", "ORDERS_READ"],
        "statusCode": 401,
        "errorTypes": ["SERVICE_NOT_AUTHORIZED"],
        "requestId": "safe-request-id",
        "client_secret": "must-not-escape",
    })

    assert client.post("/api/platform/setup/square/diagnose-credentials").status_code in {400, 401, 302, 403}
    login(client)
    with app.app_context():
        audit_count_after_login = AuditEvent.query.count()
    wrong_org = client.post(
        "/api/platform/setup/square/diagnose-credentials",
        headers=csrf_headers(client),
        json={"organizationId": "999"},
    )
    assert wrong_org.status_code == 403

    response = client.post(
        "/api/platform/setup/square/diagnose-credentials",
        headers=csrf_headers(client),
        json={"organizationId": "1"},
    )
    assert response.status_code == 200
    body = response.get_json()["diagnostic"]
    assert body["classification"] == "rejected"
    assert body["requestId"] == "safe-request-id"
    assert "client_secret" not in body
    with app.app_context():
        assert AuditEvent.query.count() == audit_count_after_login  # diagnostic writes no audit row
        assert SquareConnection.query.count() == before_connections

        role = PlatformRole.query.filter_by(user_id=owner_id).one()
        role.role = "support"
        db.session.commit()
    assert client.post(
        "/api/platform/setup/square/diagnose-credentials",
        headers=csrf_headers(client),
    ).status_code == 403

    with app.app_context():
        role = PlatformRole.query.filter_by(user_id=owner_id).one()
        role.role = "setup_admin"
        app.config["FLOWTALLY_ENV"] = "staging"
        db.session.commit()
    assert client.post(
        "/api/platform/setup/square/diagnose-credentials",
        headers=csrf_headers(client),
    ).status_code == 403

    with app.app_context():
        app.config.update(FLOWTALLY_ENV="production", SQUARE_ENABLED=False)
    assert client.post(
        "/api/platform/setup/square/diagnose-credentials",
        headers=csrf_headers(client),
    ).status_code == 409

    with app.app_context():
        app.config["SQUARE_ENABLED"] = True
        app.config["FLOWTALLY_SHOWCASE_ORGANIZATION_ID"] = ""
    assert client.post(
        "/api/platform/setup/square/diagnose-credentials",
        headers=csrf_headers(client),
    ).status_code == 503


def test_showcase_square_reset_is_setup_admin_only_scoped_and_idempotent(app, client):
    login(client)
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        owner_id = owner.id
        platform_role = PlatformRole.query.filter_by(user_id=owner.id).first()
        if platform_role is None:
            platform_role = PlatformRole(user_id=owner.id, role="setup_admin", is_active=True)
            db.session.add(platform_role)
        else:
            platform_role.role = "setup_admin"
        showcase = Organization.query.filter_by(name="Flowtally Pilot Restaurant").first()
        if showcase is None:
            showcase = Organization.query.first()
        showcase.name = "Flowtally Showcase"
        app.config.update(FLOWTALLY_ENV="production", FLOWTALLY_SHOWCASE_ORGANIZATION_ID=str(showcase.id), FLOWTALLY_PRODUCTION_DATABASE_NAME="pilot.db", SQUARE_ENVIRONMENT="production")
        other = Organization(name="Other Tenant", lifecycle_status="ACTIVE", setup_status="COMPLETE", subscription_status="ACTIVE", setup_template_key="CAFE", setup_fee_status="confirmed", is_prospect=False)
        db.session.add(other)
        db.session.flush()
        connection = SquareConnection(organization_id=showcase.id, environment="sandbox", status="connected", square_merchant_id="synthetic")
        other_connection = SquareConnection(organization_id=other.id, environment="sandbox", status="connected", square_merchant_id="other")
        db.session.add_all([connection, other_connection])
        db.session.flush()
        location = SquareLocation(square_connection_id=connection.id, square_location_id="synthetic-location")
        other_location = SquareLocation(square_connection_id=other_connection.id, square_location_id="other-location")
        db.session.add_all([location, other_location])
        db.session.flush()
        db.session.add_all([
            SquareLocationMapping(square_location_id=location.id, restaurant_location_id=1),
            SquareCatalogObject(square_connection_id=connection.id, square_object_id="synthetic-catalog"),
            SquareSyncJob(square_connection_id=connection.id, job_type="orders"),
            SquareSyncCursor(square_connection_id=connection.id, cursor_key="orders"),
            SquareWebhookEvent(square_connection_id=connection.id, event_id="synthetic-event", event_type="order.created"),
            SquareDailySalesSummary(square_connection_id=connection.id, square_location_id="synthetic-location", sale_date=datetime.now(timezone.utc).date()),
            SquareOrder(square_connection_id=connection.id, square_order_id="synthetic-order"),
            SquareCatalogObject(square_connection_id=other_connection.id, square_object_id="other-catalog"),
        ])
        db.session.flush()
        catalog = SquareCatalogObject.query.filter_by(square_connection_id=connection.id).first()
        order = SquareOrder.query.filter_by(square_connection_id=connection.id).first()
        db.session.add_all([SquareCatalogMapping(square_catalog_object_id=catalog.id, mapping_type="menu_item"), SquareOrderLine(square_order_id=order.id, line_uid="synthetic-line")])
        inventory_count = InventoryItem.query.filter_by(organization_id=showcase.id).count()
        showcase_id = showcase.id
        db.session.commit()

    response = client.post(f"/api/platform/setup/organizations/{showcase_id}/square/reset-showcase", headers=csrf_headers(client))
    assert response.status_code == 200
    assert sum(response.get_json()["squareReset"]["deleted"].values()) >= 9
    with app.app_context():
        connection = SquareConnection.query.filter_by(organization_id=showcase_id).first()
        assert connection.status == "disconnected"
        assert connection.square_merchant_id == ""
        assert SquareLocation.query.filter_by(square_connection_id=connection.id).count() == 0
        assert SquareOrder.query.filter_by(square_connection_id=connection.id).count() == 0
        assert SquareCatalogObject.query.filter_by(square_connection_id=connection.id).count() == 0
        assert SquareWebhookEvent.query.filter_by(square_connection_id=connection.id).count() == 0
        assert InventoryItem.query.filter_by(organization_id=showcase_id).count() == inventory_count
        assert SquareCatalogObject.query.filter_by(square_object_id="other-catalog").count() == 1
        assert AuditEvent.query.filter_by(event_type="setup.showcase_square_reset", organization_id=showcase_id).count() == 1

    repeat = client.post(f"/api/platform/setup/organizations/{showcase_id}/square/reset-showcase", headers=csrf_headers(client))
    assert repeat.status_code == 200
    assert sum(repeat.get_json()["squareReset"]["deleted"].values()) == 0
    with app.app_context():
        role = PlatformRole.query.filter_by(user_id=owner_id).first()
        role.role = "support"
        db.session.commit()
    assert client.post(f"/api/platform/setup/organizations/{showcase_id}/square/reset-showcase", headers=csrf_headers(client)).status_code == 403


def test_showcase_seed_action_is_setup_admin_only_and_guarded(app, client, monkeypatch):
    import backend.platform_admin as platform_admin

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        organization = Organization(
            name="Flowtally Showcase",
            lifecycle_status="ACTIVE",
            setup_status="COMPLETE",
            subscription_status="ACTIVE",
            setup_fee_status="confirmed",
            setup_template_key="GENERIC_RESTAURANT",
            is_prospect=False,
        )
        db.session.add(organization)
        db.session.flush()
        from backend.models import OrganizationMembership, RestaurantLocation
        location = RestaurantLocation(
            organization_id=organization.id,
            name="Harbour Kitchen",
            city="Toronto",
            region="ON",
            country="Canada",
            timezone="America/Toronto",
        )
        db.session.add_all([
            location,
            OrganizationMembership(
                organization_id=organization.id, user_id=owner.id, role="owner"
            ),
        ])
        db.session.add(PlatformRole(user_id=owner.id, role="setup_admin", is_active=True))
        db.session.commit()
        organization_id = organization.id
        location_id = location.id
        owner_id = owner.id
        app.config.update(
            FLOWTALLY_ENV="production",
            FLOWTALLY_SHOWCASE_ORGANIZATION_ID=str(organization_id),
            FLOWTALLY_PRODUCTION_DATABASE_NAME="flowtally_prod",
            SQLALCHEMY_DATABASE_URI="postgresql://test/flowtally_prod",
        )

    calls = []
    monkeypatch.setattr(platform_admin, "seed_showcase_tenant", lambda **kwargs: calls.append(kwargs))

    unauthenticated = app.test_client()
    assert unauthenticated.post(f"/api/platform/setup/organizations/{organization_id}/seed-showcase").status_code in {400, 401, 302}

    login(client)
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/seed-showcase",
        headers=csrf_headers(client),
    ).status_code == 200
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/seed-showcase",
        headers=csrf_headers(client),
    ).status_code == 200
    assert calls == [
        {"organization_id": organization_id, "location_id": location_id, "owner_id": owner_id},
        {"organization_id": organization_id, "location_id": location_id, "owner_id": owner_id},
    ]

    with app.app_context():
        assert AuditEvent.query.filter_by(event_type="setup.showcase_seeded", organization_id=organization_id).count() == 2

    app.config["SQLALCHEMY_DATABASE_URI"] = "postgresql://test/defaultdb"
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/seed-showcase",
        headers=csrf_headers(client),
    ).status_code == 503
    app.config["SQLALCHEMY_DATABASE_URI"] = "postgresql://test/flowtally_prod"
    with app.app_context():
        Organization.query.filter_by(id=organization_id).one().lifecycle_status = "SUSPENDED"
        db.session.commit()
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/seed-showcase",
        headers=csrf_headers(client),
    ).status_code == 409

    assert client.post(
        f"/api/platform/setup/organizations/{organization_id + 99999}/seed-showcase",
        headers=csrf_headers(client),
    ).status_code == 403
    app.config["FLOWTALLY_SHOWCASE_ORGANIZATION_ID"] = ""
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/seed-showcase",
        headers=csrf_headers(client),
    ).status_code == 403


def test_showcase_seed_action_rejects_ineligible_tenant_and_support_role(app, client):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        organization = Organization(
            name="Flowtally Showcase",
            lifecycle_status="SUSPENDED",
            setup_status="COMPLETE",
            subscription_status="ACTIVE",
            setup_fee_status="confirmed",
            setup_template_key="GENERIC_RESTAURANT",
            is_prospect=False,
        )
        db.session.add(organization)
        db.session.flush()
        from backend.models import OrganizationMembership, RestaurantLocation
        db.session.add_all([
            RestaurantLocation(organization_id=organization.id, name="Harbour Kitchen", city="Toronto", region="ON", country="Canada", timezone="America/Toronto"),
            OrganizationMembership(organization_id=organization.id, user_id=owner.id, role="owner"),
            PlatformRole(user_id=owner.id, role="support", is_active=True),
        ])
        db.session.commit()
        organization_id = organization.id
        app.config.update(
            FLOWTALLY_ENV="production",
            FLOWTALLY_SHOWCASE_ORGANIZATION_ID=str(organization_id),
            FLOWTALLY_PRODUCTION_DATABASE_NAME="flowtally_prod",
            SQLALCHEMY_DATABASE_URI="postgresql://test/flowtally_prod",
        )
    login(client)
    assert client.post(
        f"/api/platform/setup/organizations/{organization_id}/seed-showcase",
        headers=csrf_headers(client),
    ).status_code == 403
    response = client.post(
        "/api/platform/setup/organizations/1/name",
        headers=csrf_headers(client),
        json={"name": "Should Not Change"},
    )
    assert response.status_code == 403
