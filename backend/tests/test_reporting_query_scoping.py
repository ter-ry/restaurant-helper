"""Square report date/query scoping parity (#315 Milestone D, semantics-preserving).

Hand-computed Toronto (UTC-4) fixture.  Rows far outside the report window must not
change any figure; rows on the exact local-day edges must keep the pre-scoping result.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from backend.extensions import db
from backend.models import (
    PurchaseInvoice,
    RestaurantLocation,
    SquareConnection,
    SquareOrder,
    SquareOrderLine,
    Supplier,
    User,
)
from backend.reporting import build_report
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization


def _order(connection, location, at, gross, *, state="COMPLETED"):
    order = SquareOrder(
        square_connection_id=connection.id, square_order_id=f"o-{uuid4().hex[:10]}", restaurant_location_id=location.id,
        order_state=state, ordered_at=at, closed_at=at,
    )
    order.lines.append(SquareOrderLine(line_uid=f"l-{uuid4().hex[:8]}", name="Latte", quantity=Decimal("1"), gross_amount=Decimal(gross)))
    db.session.add(order)


def _invoice(org, location, supplier, day, total, status="Completed"):
    db.session.add(PurchaseInvoice(
        organization_id=org.id, location_id=location.id, supplier_id=supplier.id, invoice_number=f"INV-{uuid4().hex[:8]}",
        invoice_date=day, total_amount=Decimal(total), status=status,
    ))


def test_scoped_queries_keep_edge_and_prior_period_semantics(app):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    org = make_operational_organization(owner, name=f"Scoping {uuid4().hex[:8]}", location_name="Queen St")
    location = RestaurantLocation.query.filter_by(organization_id=org.id).first()
    location.timezone = "America/Toronto"
    connection = SquareConnection(organization_id=org.id, environment="sandbox", square_merchant_id=f"sq-{uuid4().hex[:6]}", status="connected", sync_status="idle")
    supplier = Supplier(organization_id=org.id, name="Bakery", normalized_name=f"bakery-{uuid4().hex[:6]}")
    db.session.add_all([connection, supplier])
    db.session.flush()

    utc = lambda *a: datetime(*a, tzinfo=timezone.utc)  # noqa: E731
    _order(connection, location, utc(2026, 8, 30, 16, 0), "10.00")     # in day
    _order(connection, location, utc(2026, 8, 31, 3, 59), "5.00")      # 23:59 local, in day
    _order(connection, location, utc(2026, 8, 31, 4, 0), "100.00")     # next local day
    _order(connection, location, utc(2026, 8, 30, 3, 59), "100.00")    # 23:59 local on Aug 29
    _order(connection, location, utc(2025, 1, 5, 16, 0), "100.00")     # far outside
    _order(connection, location, utc(2026, 8, 30, 17, 0), "100.00", state="OPEN")
    _order(connection, location, utc(2026, 8, 20, 16, 0), "40.00")     # prior week
    _invoice(org, location, supplier, date(2026, 8, 30), "50.00")
    _invoice(org, location, supplier, date(2026, 8, 29), "70.00")
    _invoice(org, location, supplier, date(2026, 8, 20), "25.00")
    _invoice(org, location, supplier, date(2026, 1, 1), "999.00")
    _invoice(org, location, supplier, date(2026, 8, 30), "888.00", status="Corrected")
    db.session.commit()

    daily = build_report(location=location, view="daily", start=date(2026, 8, 30))
    assert daily["sales"]["orderCount"] == 2
    assert daily["sales"]["grossItemSales"] == 15.0
    assert daily["purchasing"]["spend"] == 50.0 and daily["purchasing"]["invoiceCount"] == 1

    weekly = build_report(location=location, view="weekly", start=date(2026, 8, 24), end=date(2026, 8, 30))
    assert weekly["sales"]["grossItemSales"] == 15.0 + 100.0  # Aug 29 23:59 local order joins the week
    assert weekly["purchasing"]["spend"] == 120.0
    assert weekly["changes"]["sales"]["prior"] == 40.0
    assert weekly["changes"]["purchaseSpend"]["prior"] == 25.0
