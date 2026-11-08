"""PostgreSQL / forced-RLS acceptance for the received-invoice void/correction workflow (#232, owner decision #168).

Real endpoints, run as the non-owner runtime role. All quantities are hand-calculated (kg).
World: Flour opens at 10 kg @ $2.00 with no ledger history (``_make_world``). A receipt of ``(item, kg, $/kg)``
adds ``kg`` at ``$/kg``.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text

from backend.extensions import db
from backend.tests.test_inventory_concurrency_postgres import (  # noqa: F401  (postgres_app is a fixture)
    BASE,
    POSTGRES_URL,
    _adjust,
    _admin_engine,
    _invoice,
    _make_world,
    _post,
    _receive,
    _waste,
    postgres_app,
    race,
)

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")


def _void(client, invoice_id: int, **payload):
    payload.setdefault("reason", "supplier credit note")
    return _post(client, f"/api/pilot/purchases/invoices/{invoice_id}/void", payload)


def _get(client, invoice_id: int) -> dict:
    response = client.get(f"/api/pilot/purchases/invoices/{invoice_id}", base_url=BASE)
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _received(world, client, lines):
    invoice_id = _invoice(world, client, lines)
    assert _receive(client, invoice_id).status_code == 200
    return invoice_id


def _rows(sql: str, **params):
    engine = _admin_engine()
    try:
        with engine.connect() as connection:
            return [tuple(row) for row in connection.execute(text(sql), params)]
    finally:
        engine.dispose()


def _ledger_state(org_id: int):
    return {
        "movements": _rows("select id, inventory_item_id, source_type, source_record_id, source_line_id, quantity_before, quantity_delta, quantity_after, unit, reason from inventory_movements where organization_id = :o order by id", o=org_id),
        "items": _rows("select id, current_on_hand, average_unit_cost, latest_purchase_price from inventory_items where organization_id = :o order by id", o=org_id),
        "invoices": _rows("select id, status, voided_at, void_reason, corrects_invoice_id from purchase_invoices where organization_id = :o order by id", o=org_id),
    }


def test_receive_then_void_appends_compensating_movement_and_restores_stock_and_cost(postgres_app):
    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    client = world.client()
    invoice_id = _received(world, client, [(flour, 5, 4.0)])  # 10 -> 15 kg; avg (10*2 + 5*4) / 15 = 2.666667
    avg_after_receipt, _ = world.assert_reconciles(flour, opening="10", expected_on_hand="15", movements=1)
    assert avg_after_receipt == Decimal("2.666667")
    original_receipt = _rows("select * from inventory_movements where inventory_item_id = :i order by id", i=flour)

    response = _void(client, invoice_id, idempotencyKey="void-1")

    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body["status"] == "Corrected" and body["replayed"] is False
    assert body["voidReason"] == "supplier credit note" and body["voidedAt"] and body["correctedByInvoiceId"] is None
    avg_cost, rows = world.assert_reconciles(flour, opening="10", expected_on_hand="10", movements=2)
    assert rows[1][0] == "invoice correction" and rows[1][1:] == (Decimal("15"), Decimal("-5"), Decimal("10"))
    assert avg_cost == pytest.approx(Decimal("2"), abs=Decimal("0.00001"))  # (15*2.666667 - 5*4) / 10
    # Append-only: the original receipt row is byte-for-byte unchanged and the compensating row is linked to it.
    assert _rows("select * from inventory_movements where inventory_item_id = :i order by id limit 1", i=flour) == original_receipt
    keys = world.source_keys(flour)
    assert keys == [("invoice receipt", str(invoice_id), keys[0][2]), ("invoice correction", str(invoice_id), keys[0][2])]
    # Authoritative reads reflect the void.
    assert _get(client, invoice_id)["status"] == "Corrected"
    items = client.get("/api/pilot/inventory", base_url=BASE).get_json()["items"]
    assert next(entry for entry in items if entry["id"] == flour)["currentOnHand"] == 10
    audit = _rows("select metadata_json from audit_events where organization_id = :o and event_type = 'purchases.invoice_corrected'", o=world.org_id)
    assert len(audit) == 1 and audit[0][0]["idempotencyKey"] == "void-1"


def test_repeat_void_is_exactly_once_replay_with_same_key_conflict_without(postgres_app):
    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    client = world.client()
    invoice_id = _received(world, client, [(flour, 5, 4.0)])
    assert _void(client, invoice_id, idempotencyKey="k").status_code == 200
    state = _ledger_state(world.org_id)

    replay = _void(client, invoice_id, idempotencyKey="k")
    conflict = _void(client, invoice_id, idempotencyKey="other")
    keyless = _void(client, invoice_id)

    assert replay.status_code == 200 and replay.get_json()["replayed"] is True
    assert conflict.status_code == 409 and keyless.status_code == 409
    assert _ledger_state(world.org_id) == state
    world.assert_reconciles(flour, opening="10", expected_on_hand="10", movements=2)
    # Receiving a voided invoice again is refused too.
    assert _receive(client, invoice_id).status_code == 409
    assert _ledger_state(world.org_id) == state


def test_void_with_correction_draft_links_lineage_and_is_received_as_a_new_transaction(postgres_app):
    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    client = world.client()
    invoice_id = _received(world, client, [(flour, 5, 4.0)])
    original = _get(client, invoice_id)

    voided = _void(client, invoice_id, createCorrectionDraft=True, idempotencyKey="d1")

    assert voided.status_code == 200, voided.get_data(as_text=True)
    draft_id = voided.get_json()["correctedByInvoiceId"]
    assert draft_id and draft_id != invoice_id
    draft = _get(client, draft_id)
    assert draft["status"] == "Draft" and draft["correctsInvoiceId"] == invoice_id
    assert draft["invoiceNumber"] == f"{original['invoiceNumber']}-C1"
    assert draft["supplierId"] == original["supplierId"] and draft["totalAmount"] == original["totalAmount"]
    assert [line["description"] for line in draft["lineItems"]] == [line["description"] for line in original["lineItems"]]
    assert all(line["needsReview"] for line in draft["lineItems"])
    world.assert_reconciles(flour, opening="10", expected_on_hand="10", movements=2)  # drafting moves no stock

    # Replaying the void neither creates a second draft nor a second movement.
    again = _void(client, invoice_id, createCorrectionDraft=True, idempotencyKey="d1")
    assert again.status_code == 200 and again.get_json()["correctedByInvoiceId"] == draft_id
    assert _rows("select count(*) from purchase_invoices where corrects_invoice_id = :i", i=invoice_id) == [(1,)]

    # The corrected copy is reviewed (price fixed to $5/kg) and received once, as a new valid transaction.
    edited_line = {**draft["lineItems"][0], "unitPrice": 25, "lineTotal": 25, "needsReview": False}
    patch_payload = {
        "supplierName": draft["supplier"]["name"], "invoiceNumber": draft["invoiceNumber"], "invoiceDate": draft["invoiceDate"],
        "subtotal": 25, "tax": 0, "totalAmount": 25, "notes": draft["notes"], "status": "Ready", "lineItems": [edited_line],
    }
    patched = client.patch(f"/api/pilot/purchases/invoices/{draft_id}", headers={"X-CSRFToken": client.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]}, base_url=BASE, json=patch_payload)
    assert patched.status_code == 200, patched.get_data(as_text=True)
    assert _receive(client, draft_id).status_code == 200
    assert _receive(client, draft_id).status_code == 409
    avg_cost, rows = world.assert_reconciles(flour, opening="10", expected_on_hand="15", movements=3)
    assert rows[2][0] == "invoice receipt" and world.source_keys(flour)[2][1] == str(draft_id)
    assert avg_cost == Decimal("3.000000")  # (10*2 + 5*5) / 15 -- the original $4/kg price no longer counts
    assert _get(client, invoice_id)["correctedByInvoiceId"] == draft_id and _get(client, draft_id)["correctsInvoiceId"] == invoice_id
    # A completed corrected copy can itself be voided later (its own lineage, once).
    assert _void(client, draft_id).status_code == 200
    world.assert_reconciles(flour, opening="10", expected_on_hand="10", movements=4)


def test_void_refused_when_later_consumption_leaves_too_little_stock_and_writes_nothing(postgres_app):
    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    client = world.client()
    invoice_id = _received(world, client, [(flour, 5, 4.0)])  # 15 kg
    assert _waste(client, flour, 12).status_code in {200, 201}  # later use: 3 kg left, less than the 5 kg received
    state = _ledger_state(world.org_id)

    refused = _void(client, invoice_id, createCorrectionDraft=True)

    assert refused.status_code == 409, refused.get_data(as_text=True)
    body = refused.get_json()
    assert "stock has already moved" in body["error"] and "Flour" in next(iter(body["errors"].values()))
    assert _ledger_state(world.org_id) == state  # no movement, no status change, no correction draft
    assert _rows("select count(*) from purchase_invoices where corrects_invoice_id is not null and organization_id = :o", o=world.org_id) == [(0,)]
    world.assert_reconciles(flour, opening="10", expected_on_hand="3", movements=2)

    # Once stock covers the receipt again the same void succeeds (3 + 4 - 5 = 2 kg).
    assert _adjust(client, flour, 4).status_code == 201
    assert _void(client, invoice_id).status_code == 200
    world.assert_reconciles(flour, opening="10", expected_on_hand="2", movements=4)


def test_void_after_partial_consumption_keeps_value_of_remaining_stock(postgres_app):
    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    client = world.client()
    invoice_id = _received(world, client, [(flour, 5, 4.0)])  # 15 kg @ 2.666667 (value 40.000005)
    assert _waste(client, flour, 4).status_code in {200, 201}  # 11 kg left, waste does not reprice

    assert _void(client, invoice_id).status_code == 200  # remove 5 kg @ $4 from value: (11*2.666667 - 20) / 6
    avg_cost, _ = world.assert_reconciles(flour, opening="10", expected_on_hand="6", movements=3)
    assert avg_cost == pytest.approx(Decimal("1.555556"), abs=Decimal("0.00001"))


def test_cost_is_not_zeroed_when_remaining_stock_would_have_no_value(postgres_app):
    """A dear receipt is voided after cheaper stock arrived: keep the current average rather than inventing $0."""
    world = _make_world(postgres_app, on_hand="1", avg_cost="1.00")
    flour = world.items["Flour"]
    client = world.client()
    dear = _received(world, client, [(flour, 20, 100.0)])  # 21 kg @ (1*1 + 20*100) / 21 = 95.285714
    _received(world, client, [(flour, 20, 1.0)])  # 41 kg @ (21*95.285714 + 20*1) / 41 = 49.292683
    assert _waste(client, flour, 11).status_code in {200, 201}  # 30 kg left, waste does not reprice
    assert world.state(flour)[1] == Decimal("49.292683")

    assert _void(client, dear).status_code == 200  # 10 kg left; 30 * 49.29 - 20 * 100 < 0, so the formula has no value to give
    avg_cost, _ = world.assert_reconciles(flour, opening="1", expected_on_hand="10", movements=4)
    assert avg_cost == Decimal("49.292683")  # unchanged, never 0


def test_multi_line_invoice_is_all_or_nothing_across_lines_of_one_item(postgres_app):
    world = _make_world(postgres_app, item_names=("Flour", "Sugar"))
    flour, sugar = world.items["Flour"], world.items["Sugar"]
    client = world.client()
    invoice_id = _received(world, client, [(flour, 3, 4.0), (sugar, 2, 3.0), (flour, 2, 4.0)])  # Flour 15, Sugar 12
    assert _waste(client, flour, 11).status_code in {200, 201}  # Flour 4 < 5 received across two lines; Sugar untouched
    state = _ledger_state(world.org_id)

    assert _void(client, invoice_id).status_code == 409
    assert _ledger_state(world.org_id) == state  # Sugar's line did not get reversed on its own

    assert _adjust(client, flour, 1).status_code == 201  # Flour 5 covers both lines exactly
    assert _void(client, invoice_id).status_code == 200
    world.assert_reconciles(flour, opening="10", expected_on_hand="0", movements=6)
    world.assert_reconciles(sugar, opening="10", expected_on_hand="10", movements=2)


def test_unit_change_after_receipt_is_refused(postgres_app):
    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    client = world.client()
    invoice_id = _received(world, client, [(flour, 5, 4.0)])
    _rows("select 1")  # keep the admin engine warm
    engine = _admin_engine()
    with engine.begin() as connection:
        connection.execute(text("update inventory_items set stock_unit = 'lb' where id = :i"), {"i": flour})
    engine.dispose()
    state = _ledger_state(world.org_id)

    refused = _void(client, invoice_id)

    assert refused.status_code == 409 and "stock unit changed" in refused.get_json()["error"]
    assert _ledger_state(world.org_id) == state


def test_validation_state_and_permissions(postgres_app):
    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    other = _make_world(postgres_app)
    client = world.client()
    draft_id = _invoice(world, client, [(flour, 5, 4.0)])
    received_id = _received(world, client, [(flour, 2, 4.0)])
    state = _ledger_state(world.org_id)

    assert _void(client, received_id, reason="  ").status_code == 400  # reason required
    assert _void(client, draft_id).status_code == 409  # never received: nothing to void
    assert _void(client, 99999999).status_code == 404
    assert _post(client, f"/api/pilot/purchases/invoices/{received_id}/void", {"reason": "x" * 5, "idempotencyKey": "k" * 200}).status_code == 400
    assert _ledger_state(world.org_id) == state

    # Another organization cannot see or void this invoice (forced RLS + explicit org scope), and nothing changes.
    foreign = other.client()
    assert _void(foreign, received_id).status_code == 404
    assert _ledger_state(world.org_id) == state
    assert client.post(f"/api/pilot/purchases/invoices/{received_id}/void", json={"reason": "no csrf"}, base_url=BASE).status_code in {400, 401, 403}
    assert _ledger_state(world.org_id) == state

    anonymous = postgres_app.test_client()
    assert anonymous.post(f"/api/pilot/purchases/invoices/{received_id}/void", json={"reason": "x"}, base_url=BASE).status_code in {400, 401}


def test_void_excludes_the_invoice_from_spend_and_price_history(postgres_app):
    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    client = world.client()
    kept = _received(world, client, [(flour, 5, 4.0)])  # $20.00
    voided = _received(world, client, [(flour, 5, 6.0)])  # $30.00
    before = client.get("/api/pilot/dashboard", base_url=BASE).get_json()["summary"]
    assert before["monthlyInvoiceSpend"] == pytest.approx(50.0)

    assert _void(client, voided).status_code == 200

    after = client.get("/api/pilot/dashboard", base_url=BASE).get_json()["summary"]
    assert after["monthlyInvoiceSpend"] == pytest.approx(20.0) and after["monthlyInvoiceCount"] == before["monthlyInvoiceCount"] - 1
    # The latest purchase price falls back to the surviving receipt ($4/kg), not the voided $6/kg.
    detail = client.get(f"/api/pilot/inventory/items/{flour}", base_url=BASE).get_json()
    assert detail["item"]["latestPurchasePrice"] == pytest.approx(20.0)
    assert _get(client, kept)["status"] == "Completed"


def test_failure_after_writing_rolls_everything_back(postgres_app, monkeypatch):
    import backend.pilot_api as pilot_api

    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    client = world.client()
    invoice_id = _received(world, client, [(flour, 5, 4.0)])
    state = _ledger_state(world.org_id)

    def boom(**kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr(pilot_api, "record_audit_event", boom)
    postgres_app.config["PROPAGATE_EXCEPTIONS"] = False
    failed = _void(client, invoice_id, createCorrectionDraft=True)
    assert failed.status_code == 500
    monkeypatch.undo()
    assert _ledger_state(world.org_id) == state  # movement, status and draft were not committed

    assert _void(client, invoice_id, createCorrectionDraft=True).status_code == 200  # a clean retry still works, once
    world.assert_reconciles(flour, opening="10", expected_on_hand="10", movements=2)


def test_concurrent_duplicate_voids_write_one_movement_and_one_draft(postgres_app):
    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    setup = world.client()
    invoice_id = _received(world, setup, [(flour, 5, 4.0)])
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(
        lambda: _void(client_a, invoice_id, createCorrectionDraft=True, idempotencyKey="same"),
        lambda: _void(client_b, invoice_id, createCorrectionDraft=True, idempotencyKey="same"),
    )

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    codes = sorted([run_a.result.status_code, run_b.result.status_code])
    assert codes == [200, 200]  # same key: the loser replays the winner's committed result
    assert {run_a.result.get_json()["replayed"], run_b.result.get_json()["replayed"]} == {True, False}
    world.assert_reconciles(flour, opening="10", expected_on_hand="10", movements=2)
    assert _rows("select count(*) from purchase_invoices where corrects_invoice_id = :i", i=invoice_id) == [(1,)]


def test_void_racing_manual_consumption_serializes_on_the_item_lock(postgres_app):
    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    setup = world.client()
    invoice_id = _received(world, setup, [(flour, 5, 4.0)])  # 15 kg
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: _void(client_a, invoice_id), lambda: _waste(client_b, flour, 11))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    _, rows = world.assert_reconciles(flour, opening="10", expected_on_hand=str(world.state(flour)[0]))
    on_hand = world.state(flour)[0]
    assert on_hand >= 0  # whichever wins, stock never goes negative
    if run_a.result.status_code == 200:
        assert run_b.result.status_code in {200, 201, 400, 409}
    else:
        assert run_a.result.status_code == 409 and on_hand == Decimal("4")  # waste won; the void was refused
