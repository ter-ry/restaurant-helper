from backend.extensions import db
from backend.models import CloverConnection, CloverLocationMapping, RestaurantLocation, SquareConnection, SquareLocation, SquareLocationMapping, User
from backend.pos import PosProvider
from backend.pos_provider import other_active_provider
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_clover_mapping import _configure, _login


def _square(organization, location, status="connected"):
    connection = SquareConnection(organization_id=organization.id, status=status, square_merchant_id="m")
    db.session.add(connection)
    db.session.flush()
    sq = SquareLocation(square_connection_id=connection.id, square_location_id="L1", name="Main")
    db.session.add(sq)
    db.session.flush()
    db.session.add(SquareLocationMapping(square_location_id=sq.id, restaurant_location_id=location.id))
    db.session.commit()
    return connection


def _clover(organization, location, status="connected"):
    connection = CloverConnection(organization_id=organization.id, merchant_id="cm", status=status, access_token_ciphertext="x")
    db.session.add(connection)
    db.session.flush()
    db.session.add(CloverLocationMapping(clover_connection_id=connection.id, organization_id=organization.id, restaurant_location_id=location.id, clover_merchant_id="cm"))
    db.session.commit()
    return connection


def _setup(app, name):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name=name, location_name="Main")
    return organization, RestaurantLocation.query.filter_by(organization_id=organization.id).first()


def test_active_square_blocks_clover_and_vice_versa(app):
    with app.app_context():
        org, loc = _setup(app, "Exclusive A")
        assert other_active_provider(loc.id, org.id, PosProvider.CLOVER) is None
        _square(org, loc)
        assert other_active_provider(loc.id, org.id, PosProvider.CLOVER) == PosProvider.SQUARE
        assert other_active_provider(loc.id, org.id, PosProvider.SQUARE) is None  # own provider never conflicts
        org2, loc2 = _setup(app, "Exclusive B")
        _clover(org2, loc2)
        assert other_active_provider(loc2.id, org2.id, PosProvider.SQUARE) == PosProvider.CLOVER


def test_disconnected_provider_does_not_block_switching(app):
    with app.app_context():
        org, loc = _setup(app, "Exclusive C")
        _square(org, loc, status="disconnected")
        assert other_active_provider(loc.id, org.id, PosProvider.CLOVER) is None


def test_other_location_is_unaffected(app):
    with app.app_context():
        org, loc = _setup(app, "Exclusive D")
        _square(org, loc)
        other = RestaurantLocation(organization_id=org.id, name="Second", timezone="America/Toronto")
        db.session.add(other)
        db.session.commit()
        assert other_active_provider(other.id, org.id, PosProvider.CLOVER) is None


def test_clover_location_mapping_endpoint_rejects_second_provider(app, client, monkeypatch):
    from types import SimpleNamespace

    with app.app_context():
        org, loc = _setup(app, "Exclusive E")
        _configure(app, org.id)
        db.session.add(CloverConnection(organization_id=org.id, environment="sandbox", merchant_id="cm", status="connected", access_token_ciphertext="x"))
        _square(org, loc)
        monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", lambda _: "token")
        monkeypatch.setattr("backend.clover_integration.CloverCatalogClient.fetch_snapshot", lambda self: SimpleNamespace(items=(), location=None))
        _login(client)
        csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
        response = client.post("/api/integrations/clover/location-mapping", json={"organizationId": org.id, "locationId": loc.id, "cloverLocationId": None, "confirm": True}, headers={"X-CSRFToken": csrf})
        assert response.status_code == 409 and "Square" in response.get_json()["error"]
        assert CloverLocationMapping.query.filter_by(restaurant_location_id=loc.id).count() == 0
