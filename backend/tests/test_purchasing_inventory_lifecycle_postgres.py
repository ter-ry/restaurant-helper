"""Milestone B (#315): purchasing -> inventory ledger lifecycle, end to end on PostgreSQL under forced RLS.

One continuous journey per test, through the real endpoints as the non-owner runtime role:

    OCR printed-total mismatch -> save -> reopen (x2) -> receive refused (ledger untouched)
    -> audited override -> receive exactly once -> retry/replay refused
    -> second receipt (weighted-average cost) -> waste -> void with correction draft (compensating movement)
    -> void replay / key conflict / re-receive refused -> correction draft keeps evidence but not the override
    -> corrected receipt -> ledger chain, weighted-average value and audit trail reconcile.

All quantities are hand-calculated (kg). Flour opens at 10 kg @ $2.00 with no ledger history.
Cross-tenant: a second organization can neither see nor mutate any of it.
"""
from __future__ import annotations

import io
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.tests.test_inventory_concurrency_postgres import (  # noqa: F401  (postgres_app is a fixture)
    BASE,
    POSTGRES_URL,
    _invoice,
    _make_world,
    _post,
    _receive,
    _waste,
    postgres_app,
)
from backend.tests.test_invoice_void_postgres import _get, _ledger_state, _rows, _void

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")

RAW_TEXT = "Prairie Mill invoice raw text"
PRINTED_TOTAL = 106.5


def _stub_ocr(monkeypatch, total=PRINTED_TOTAL):
    import backend.pilot_api as pilot_module

    def field(value):
        return {"value": value, "confidence": 0.95, "needsReview": False}

    monkeypatch.setattr(
        pilot_module,
        "extract_invoice_document",
        lambda *_a: {
            "provider": "stub",
            "fileName": "mill.png",
            "contentType": "image/png",
            "rawText": RAW_TEXT,
            "fields": {"subtotal": field(total), "tax": field(0.0), "total": field(total)},
            "lineItems": [],
            "warnings": [],
            "needsReview": True,
        },
    )


def _png() -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), color="white").save(buffer, format="PNG")
    return buffer.getvalue()


def _extract(client) -> dict:
    response = _post(client, "/api/pilot/purchases/ocr", data={"file": (io.BytesIO(_png()), "mill.png")}, content_type="multipart/form-data")
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _ocr_payload(world, item_id: int, token: str, *, kg=5, price_per_kg=3.0, number=None) -> dict:
    total = round(kg * price_per_kg, 2)
    return {
        "supplierName": world.supplier,
        "invoiceNumber": number or f"OCR-{uuid4().hex[:8].upper()}",
        "invoiceDate": "2026-08-20",
        "subtotal": total,
        "tax": 0,
        "totalAmount": total,
        "status": "Ready",
        "extractionStatus": "ocr",
        "extractedText": RAW_TEXT,
        "sourceFileName": "mill.png",
        "sourceFileType": "image/png",
        "ocrEvidenceToken": token,
        "lineItems": [
            {
                "description": "Bread flour 5 kg",
                "inventoryItemId": item_id,
                "purchaseUnit": "kg",
                "inventoryUnit": "kg",
                "conversionFactor": 1,
                "quantity": kg,
                "unitPrice": price_per_kg,
                "lineTotal": total,
                "confidence": 1,
                "needsReview": False,
            }
        ],
    }


def _override(client, invoice_id: int, line_total: float, reason="Supplier confirmed only the flour was delivered"):
    return _post(client, f"/api/pilot/purchases/invoices/{invoice_id}/ocr-override", {"reason": reason, "acknowledgedLineTotal": line_total})


def _audit_count(org_id: int, event_type: str) -> int:
    return _rows("select count(*) from audit_events where organization_id = :o and event_type = :t", o=org_id, t=event_type)[0][0]


def _snapshot(org_id: int):
    return _ledger_state(org_id)


def test_ocr_mismatch_to_receive_void_correction_reconciles_ledger_and_valuation(postgres_app, monkeypatch):
    _stub_ocr(monkeypatch)
    world = _make_world(postgres_app)
    flour = world.items["Flour"]
    client = world.client()
    org = world.org_id

    # --- 1. OCR printed $106.50 vs one captured $15.00 line: saved, but evidence is server-side and blocks receipt.
    extracted = _extract(client)
    created = _post(client, "/api/pilot/purchases/invoices", _ocr_payload(world, flour, extracted["evidenceToken"]))
    assert created.status_code == 201, created.get_data(as_text=True)
    invoice_id = created.get_json()["id"]
    baseline = _snapshot(org)
    for _ in range(2):  # reload + reopen: authoritative server state, not client state
        reopened = _get(client, invoice_id)
        evidence = reopened["ocrEvidence"]
        assert evidence["status"] == "incomplete" and evidence["expectedAmount"] == PRINTED_TOTAL and evidence["difference"] == 91.5
        assert reopened["reviewSummary"]["readyToReceive"] is False
        assert any("printed invoice amount" in blocker for blocker in reopened["reviewSummary"]["blockers"])

    # --- 2. Receive is refused and writes nothing (no movement, stock and cost unchanged).
    blocked = _receive(client, invoice_id)
    assert blocked.status_code == 400
    assert _snapshot(org) == baseline
    world.assert_reconciles(flour, opening="10", expected_on_hand="10", movements=0)

    # --- 3. Audited override: validated, idempotent, exactly one audit row, tied to the $15.00 line total.
    assert _override(client, invoice_id, 15, reason="short").status_code == 400
    assert _override(client, invoice_id, 99).status_code == 409
    assert _override(client, invoice_id, 15).status_code == 200
    assert _override(client, invoice_id, 15).status_code == 200  # replay
    assert _audit_count(org, "purchases.ocr_discrepancy_override") == 1
    assert _get(client, invoice_id)["ocrEvidence"]["status"] == "overridden"

    # --- 4. Valid receive happens exactly once: 10 kg @ $2.00 + 5 kg @ $3.00 -> 15 kg @ $2.333333.
    first = _receive(client, invoice_id)
    assert first.status_code == 200, first.get_data(as_text=True)
    avg, _ = world.assert_reconciles(flour, opening="10", expected_on_hand="15", movements=1)
    assert avg == Decimal("2.333333")  # (10*2 + 5*3) / 15
    after_receipt = _snapshot(org)
    for _ in range(3):  # retries / double-click / concurrent tab
        assert _receive(client, invoice_id).status_code == 409
    assert _snapshot(org) == after_receipt

    # --- 5. A second, plain receipt then waste: weighted average and on-hand keep reconciling.
    second_id = _invoice(world, client, [(flour, 5, 5.0)])  # 5 kg @ $5.00
    assert _receive(client, second_id).status_code == 200
    avg, _ = world.assert_reconciles(flour, opening="10", expected_on_hand="20", movements=2)
    assert avg == Decimal("3.000000")  # (15*2.333333 + 5*5) / 20 = 60 / 20
    assert _waste(client, flour, 4).status_code in {200, 201}
    avg, _ = world.assert_reconciles(flour, opening="10", expected_on_hand="16", movements=3)
    assert avg == Decimal("3.000000")  # waste removes quantity at current average cost

    # --- 6. Void the first invoice with a correction draft: compensating movement, exactly once.
    voided = _void(client, invoice_id, idempotencyKey="b-void-1", createCorrectionDraft=True)
    assert voided.status_code == 200, voided.get_data(as_text=True)
    body = voided.get_json()
    draft_id = body["correctedByInvoiceId"]
    assert body["status"] == "Corrected" and body["replayed"] is False and draft_id
    avg, rows = world.assert_reconciles(flour, opening="10", expected_on_hand="11", movements=4)
    assert rows[3][0] == "invoice correction" and rows[3][2] == Decimal("-5")
    assert avg == Decimal("3.000000")  # (16*3.0 - 5*3.0) / 11: the reversal removes the receipt's own cost
    after_void = _snapshot(org)
    assert _void(client, invoice_id, idempotencyKey="b-void-1").get_json()["replayed"] is True
    assert _void(client, invoice_id, idempotencyKey="different").status_code == 409
    assert _void(client, invoice_id).status_code == 409
    assert _receive(client, invoice_id).status_code == 409  # a voided invoice cannot be received again
    assert _snapshot(org) == after_void
    assert _audit_count(org, "purchases.invoice_corrected") == 1

    # --- 7. The correction draft keeps the printed evidence (still $106.50) but not the override.
    draft = _get(client, draft_id)
    assert draft["ocrEvidence"]["printedTotal"] == PRINTED_TOTAL
    assert draft["ocrEvidence"]["status"] == "incomplete" and draft["ocrEvidence"]["override"] is None
    assert _receive(client, draft_id).status_code == 400
    assert _snapshot(org) == after_void

    # --- 8. Corrected receipt: reviewer acknowledges, receives the corrected 4 kg once; ledger stays one chain.
    draft_line = draft["lineItems"][0]
    corrected_total = 12.0
    patched = client.patch(
        f"/api/pilot/purchases/invoices/{draft_id}",
        base_url=BASE,
        headers={"X-CSRFToken": client.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]},
        json=_ocr_payload(world, flour, extracted["evidenceToken"], kg=4, price_per_kg=3.0, number=draft["invoiceNumber"]),
    )
    assert patched.status_code == 200, patched.get_data(as_text=True)
    assert draft_line["inventoryItemId"] == flour
    assert _receive(client, draft_id).status_code == 400  # edit re-gated by the printed total
    assert _override(client, draft_id, corrected_total).status_code == 200
    assert _receive(client, draft_id).status_code == 200
    assert _receive(client, draft_id).status_code == 409
    avg, rows = world.assert_reconciles(flour, opening="10", expected_on_hand="15", movements=5)
    assert avg == Decimal("3.000000")  # (11*3.0 + 4*3.0) / 15
    keys = world.source_keys(flour)
    assert len(keys) == len(set(keys)) == 5

    # --- 9. Authoritative reads agree with the ledger.
    items = client.get("/api/pilot/inventory", base_url=BASE).get_json()["items"]
    assert next(entry for entry in items if entry["id"] == flour)["currentOnHand"] == 15
    statuses = {row[0]: row[1] for row in _snapshot(org)["invoices"]}
    assert statuses[invoice_id] == "Corrected" and statuses[second_id] == "Completed" and statuses[draft_id] == "Completed"
    assert _audit_count(org, "purchases.ocr_discrepancy_override") == 2


def test_other_tenant_cannot_see_override_receive_or_void_an_invoice_and_ledger_is_untouched(postgres_app, monkeypatch):
    _stub_ocr(monkeypatch)
    owner_world = _make_world(postgres_app)
    other_world = _make_world(postgres_app)
    flour = owner_world.items["Flour"]
    owner_client = owner_world.client()
    other_client = other_world.client()

    extracted = _extract(owner_client)
    invoice_id = _post(owner_client, "/api/pilot/purchases/invoices", _ocr_payload(owner_world, flour, extracted["evidenceToken"])).get_json()["id"]
    assert _override(owner_client, invoice_id, 15).status_code == 200
    assert _receive(owner_client, invoice_id).status_code == 200
    owner_state = _ledger_state(owner_world.org_id)
    other_state = _ledger_state(other_world.org_id)

    path = f"/api/pilot/purchases/invoices/{invoice_id}"
    assert other_client.get(path, base_url=BASE).status_code == 404
    assert _receive(other_client, invoice_id).status_code == 404
    assert _override(other_client, invoice_id, 15).status_code == 404
    assert _void(other_client, invoice_id, idempotencyKey="x").status_code == 404
    listed = other_client.get("/api/pilot/purchases", base_url=BASE).get_json()["invoices"]
    assert all(entry["id"] != invoice_id for entry in listed)
    assert _ledger_state(owner_world.org_id) == owner_state
    assert _ledger_state(other_world.org_id) == other_state
    owner_world.assert_reconciles(flour, opening="10", expected_on_hand="15", movements=1)
    other_world.assert_reconciles(other_world.items["Flour"], opening="10", expected_on_hand="10", movements=0)
