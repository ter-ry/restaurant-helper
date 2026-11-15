"""Unit + SQLite constraint tests for verified-free provenance (#279 Phase A). Pure logic, no endpoints."""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from backend.app import create_app
from backend.extensions import db
from backend.models import InventoryCostVerification, InventoryItem, Organization, RestaurantLocation
from backend.verified_free_cost import (
    STATUS_NO_STOCK, STATUS_PARTIAL_FREE, STATUS_PRICED, STATUS_UNVERIFIED_ZERO, STATUS_VERIFIED_FREE,
    VerificationBatch, VerificationError, classify_cost_basis, idempotent_outcome, validate_correction,
    validate_new_verification, validate_revocation, verification_fingerprint, zero_cost_transfer_decision,
)

D = Decimal


def batch(qty="5", consumed="0", revoked=False, id=1):
    return VerificationBatch(id=id, organization_id=1, location_id=1, item_id=1, quantity=D(qty), consumed_quantity=D(consumed), revoked=revoked)


def test_legacy_zero_cost_is_unverified_not_free():
    basis = classify_cost_basis("10", "0")
    assert basis.status == STATUS_UNVERIFIED_ZERO and basis.unverified_quantity == D("10")
    assert not zero_cost_transfer_decision("10", "0", "1").allowed


def test_verified_partial_and_full_free():
    assert classify_cost_basis("10", "0", [batch("4")]).status == STATUS_PARTIAL_FREE
    partial = classify_cost_basis("10", "0", [batch("4")])
    assert partial.verified_free_quantity == D("4") and partial.unverified_quantity == D("6")
    assert classify_cost_basis("10", "0", [batch("10")]).status == STATUS_VERIFIED_FREE
    # evidence can never exceed physical stock (e.g. stock consumed since)
    assert classify_cost_basis("3", "0", [batch("10")]).verified_free_quantity == D("3")


def test_priced_and_empty_stock_do_not_fabricate_value():
    mixed = classify_cost_basis("10", "2.5", [batch("4")])
    assert mixed.status == STATUS_PRICED and mixed.unit_cost == D("2.5")
    assert classify_cost_basis("0", "0", [batch("4")]).status == STATUS_NO_STOCK


def test_revoked_and_consumed_batches_stop_covering():
    assert classify_cost_basis("5", "0", [batch("5", revoked=True)]).status == STATUS_UNVERIFIED_ZERO
    assert classify_cost_basis("5", "0", [batch("5", consumed="5")]).status == STATUS_UNVERIFIED_ZERO
    assert classify_cost_basis("5", "0", [batch("5", consumed="2")]).status == STATUS_PARTIAL_FREE


def test_zero_cost_transfer_requires_full_coverage():
    assert zero_cost_transfer_decision("10", "0", "4", [batch("4")]).verified_free
    short = zero_cost_transfer_decision("10", "0", "5", [batch("4")])
    assert not short.allowed and short.reason == "unknown_cost_not_verified_free"
    assert zero_cost_transfer_decision("10", "2", "5").unit_cost == D("2") and not zero_cost_transfer_decision("10", "2", "5").verified_free
    assert zero_cost_transfer_decision("2", "0", "5", [batch("9")]).reason == "insufficient_stock"
    assert zero_cost_transfer_decision("2", "0", "0").reason == "quantity_not_positive"


def _args(**over):
    base = dict(organization_id=1, location_id=1, item_organization_id=1, item_location_id=1, on_hand="10", quantity="4",
                evidence_type="donation", evidence_note="Donated by farm, signed slip #12")
    base.update(over)
    return base


def test_new_verification_validation():
    validate_new_verification(**_args())
    cases = [
        ({"item_organization_id": 2}, "cross_tenant"),
        ({"item_location_id": 2}, "cross_location"),
        ({"quantity": "0"}, "quantity_not_positive"),
        ({"evidence_type": "gut_feeling"}, "evidence_type_invalid"),
        ({"evidence_note": "   "}, "evidence_missing"),
        ({"quantity": "11"}, "exceeds_unverified_stock"),
        ({"quantity": "7", "existing_batches": [batch("4")]}, "exceeds_unverified_stock"),
    ]
    for over, code in cases:
        with pytest.raises(VerificationError) as exc:
            validate_new_verification(**_args(**over))
        assert exc.value.code == code


def test_idempotency_outcomes():
    fp = verification_fingerprint(item_id=1, quantity="4.0", evidence_type="donation", source_record_id="r1")
    assert idempotent_outcome(None, fp) == "create"
    assert idempotent_outcome(fp, verification_fingerprint(item_id=1, quantity="4", evidence_type="donation", source_record_id="r1")) == "replay"
    assert idempotent_outcome(fp, verification_fingerprint(item_id=1, quantity="5", evidence_type="donation", source_record_id="r1")) == "conflict"
    noted = verification_fingerprint(item_id=1, quantity="4", evidence_type="donation", evidence_note="slip #12", source_record_id="r1")
    assert idempotent_outcome(noted, verification_fingerprint(item_id=1, quantity="4", evidence_type="donation", evidence_note=" slip #12 ", source_record_id="r1")) == "replay"
    assert idempotent_outcome(noted, verification_fingerprint(item_id=1, quantity="4", evidence_type="donation", evidence_note="different justification", source_record_id="r1")) == "conflict"


def test_revocation_and_correction_rules():
    validate_revocation(batch(), "wrong item")
    for b, reason, code in [(batch(revoked=True), "x", "already_revoked"), (batch(), " ", "revocation_reason_missing")]:
        with pytest.raises(VerificationError) as exc:
            validate_revocation(b, reason)
        assert exc.value.code == code
    validate_correction(batch("5", consumed="2"), "3")
    with pytest.raises(VerificationError) as exc:
        validate_correction(batch("5", consumed="2"), "1")
    assert exc.value.code == "below_consumed_quantity"
    with pytest.raises(VerificationError):
        validate_correction(batch(revoked=True), "3")


@pytest.fixture()
def app():
    application = create_app({"TESTING": True, "SECRET_KEY": "t", "SQLALCHEMY_DATABASE_URI": "sqlite://", "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://"})
    with application.app_context():
        db.create_all()
        yield application
        db.session.remove()


def _item():
    org = Organization(name="Org")
    db.session.add(org)
    db.session.flush()
    loc = RestaurantLocation(organization_id=org.id, name="Main", city="Toronto", region="ON", country="Canada")
    db.session.add(loc)
    db.session.flush()
    item = InventoryItem(organization_id=org.id, location_id=loc.id, name="Flour", normalized_name="flour", current_on_hand=D("10"), average_unit_cost=D("0"))
    db.session.add(item)
    db.session.flush()
    return org, loc, item


def _row(org, loc, item, **over):
    data = dict(organization_id=org.id, location_id=loc.id, inventory_item_id=item.id, quantity=D("4"), evidence_type="donation",
                evidence_note="signed slip", idempotency_key="k1")
    data.update(over)
    return InventoryCostVerification(**data)


def test_model_defaults_do_not_touch_item_cost(app):
    org, loc, item = _item()
    row = _row(org, loc, item)
    db.session.add(row)
    db.session.commit()
    assert row.consumed_quantity == 0 and row.revoked_at is None and row.revoked_reason == ""
    assert db.session.get(InventoryItem, item.id).average_unit_cost == 0  # legacy zero stays unverified


@pytest.mark.parametrize("over", [
    {"quantity": D("0")}, {"consumed_quantity": D("5")}, {"consumed_quantity": D("-1")},
    {"evidence_type": "vibes"}, {"evidence_note": "  "}, {"revoked_at": __import__("datetime").datetime(2026, 1, 1)},
])
def test_db_constraints_reject_bad_rows(app, over):
    org, loc, item = _item()
    db.session.add(_row(org, loc, item, **over))
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()


def test_duplicate_idempotency_key_rejected(app):
    org, loc, item = _item()
    db.session.add(_row(org, loc, item))
    db.session.commit()
    db.session.add(_row(org, loc, item))
    with pytest.raises(IntegrityError):
        db.session.commit()
