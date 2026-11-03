from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement, RestaurantLocation, StockCountSession, StockCountSessionLine, User
from backend.pos import CLOVER_SALE_SOURCE_TYPES, POS_SALE_SOURCE_TYPES, SQUARE_SALE_SOURCE_TYPES
from backend.seed import LOCAL_OWNER_EMAIL
from backend.square_integration import _usage_basis_inputs
from backend.tests.conftest import make_operational_organization


def test_pos_source_type_sets():
    assert SQUARE_SALE_SOURCE_TYPES == {"square sale consumption", "square sale reversal"}
    assert CLOVER_SALE_SOURCE_TYPES == {"clover sale consumption", "clover sale correction"}
    assert POS_SALE_SOURCE_TYPES == SQUARE_SALE_SOURCE_TYPES | CLOVER_SALE_SOURCE_TYPES


def test_pos_sale_movements_are_excluded_from_variance_movement_net(app):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        org = make_operational_organization(owner, name=f"POS Src {uuid4().hex[:8]}", location_name="Main")
        location = RestaurantLocation.query.filter_by(organization_id=org.id).first()
        item = InventoryItem(organization_id=org.id, location_id=location.id, name="Beans", normalized_name="beans", stock_unit="kg")
        db.session.add(item)
        db.session.flush()
        t0 = datetime(2026, 1, 1, 8, tzinfo=timezone.utc)
        t1 = t0 + timedelta(days=1)
        for i, when in enumerate((t0, t1)):
            session = StockCountSession(organization_id=org.id, location_id=location.id, status="Completed", completed_at=when)
            db.session.add(session)
            db.session.flush()
            db.session.add(StockCountSessionLine(session_id=session.id, inventory_item_id=item.id, line_index=0, item_name_snapshot="Beans", counted_quantity=Decimal("10"), resulting_quantity=Decimal("10")))
        mid = t0 + timedelta(hours=6)
        for source in sorted(POS_SALE_SOURCE_TYPES) + ["manual adjustment"]:
            movement = InventoryMovement(organization_id=org.id, location_id=location.id, inventory_item_id=item.id, quantity_delta=Decimal("-1"), unit="kg", source_type=source)
            db.session.add(movement)
            db.session.flush()
            movement.created_at = mid
        db.session.commit()
        _sessions, movements = _usage_basis_inputs(org.id, location.id, t0, t1)
        # Only the non-POS manual adjustment counts toward movement net.
        assert Decimal(str(movements[item.id])) == Decimal("-1")


def test_inventory_usage_basis_direct_movement_query_excludes_pos_sales(app):
    from backend.square_integration import _inventory_usage_basis

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        org = make_operational_organization(owner, name=f"POS Basis {uuid4().hex[:8]}", location_name="Main")
        location = RestaurantLocation.query.filter_by(organization_id=org.id).first()
        item = InventoryItem(organization_id=org.id, location_id=location.id, name="Milk", normalized_name="milk", stock_unit="L")
        db.session.add(item)
        db.session.flush()
        t0 = datetime(2026, 1, 1, 8, tzinfo=timezone.utc)
        t1 = t0 + timedelta(days=1)
        for when, qty in ((t0, "20"), (t1, "12")):
            session = StockCountSession(organization_id=org.id, location_id=location.id, status="Completed", completed_at=when)
            db.session.add(session)
            db.session.flush()
            db.session.add(StockCountSessionLine(session_id=session.id, inventory_item_id=item.id, line_index=0, item_name_snapshot="Milk", counted_quantity=Decimal(qty), resulting_quantity=Decimal(qty)))
        for source, delta in [(s, "-2") for s in sorted(POS_SALE_SOURCE_TYPES)] + [("invoice receipt", "5"), ("stock count reconciliation", "-3")]:
            movement = InventoryMovement(organization_id=org.id, location_id=location.id, inventory_item_id=item.id, quantity_delta=Decimal(delta), unit="L", source_type=source)
            db.session.add(movement)
            db.session.flush()
            movement.created_at = t0 + timedelta(hours=6)
        db.session.commit()
        # movement_totals=None exercises the direct query path.
        basis = _inventory_usage_basis(org.id, location.id, item.id, t0, t1)
        assert basis["movementNet"] == 5.0
        assert basis["actualUsage"] == 20 + 5 - 12


def test_every_clover_inventory_source_type_is_excluded():
    """Guards future Clover movement types (e.g. refund/void reversals)."""
    import re
    from pathlib import Path

    import backend.clover_inventory as clover_inventory

    text = Path(clover_inventory.__file__).read_text()
    literals = set(re.findall(r'"(clover sale [a-z ]+)"', text))
    assert literals, "expected Clover sale source types in clover_inventory.py"
    assert literals <= CLOVER_SALE_SOURCE_TYPES, literals - CLOVER_SALE_SOURCE_TYPES
