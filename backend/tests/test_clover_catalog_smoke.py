from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from backend.clover import CloverRequestError
from backend.clover_catalog import CloverCatalogIncomplete, normalize_catalog
from scripts import clover_catalog_smoke as smoke


def _snapshot():
    return normalize_catalog(
        merchant={
            "id": "V7SXJVSGY5051",
            "name": "Flowtally Test Kitchen",
            "location": {"id": "sandbox-location", "name": "Sandbox"},
        },
        items=[
            {
                "id": smoke.EXPECTED_TEST_ITEM_ID,
                "name": smoke.EXPECTED_TEST_ITEM_NAME,
                "price": smoke.EXPECTED_TEST_ITEM_PRICE_CENTS,
                "available": True,
                "categories": {"elements": [{"id": "cat-1", "name": "Burgers"}]},
                "options": {"elements": [{"id": "option-1", "name": "Base"}]},
                "modifierGroups": {
                    "elements": [
                        {
                            "id": "mods-1",
                            "name": "Toppings",
                            "modifiers": {"elements": [{"id": "mod-1", "name": "Pickles", "price": 0}]},
                        }
                    ]
                },
            }
        ],
    )


def test_summary_and_expected_test_burger_are_safe_and_credential_free():
    snapshot = _snapshot()
    smoke.verify_test_burger(snapshot)
    summary = smoke.build_summary(snapshot)
    assert summary["merchant"] == {"id": "V7SXJVSGY5051", "name": "Flowtally Test Kitchen"}
    assert summary["items"][0]["id"] == "TE0BYZH7B28AJ"
    assert summary["items"][0]["priceCents"] == 1800
    assert summary["items"][0]["optionIds"] == ["option-1"]
    assert summary["items"][0]["modifiers"][0]["name"] == "Pickles"
    assert "CLOVER_SANDBOX_API_TOKEN" not in json.dumps(summary)


def test_sandbox_requester_forces_fixed_host_and_get(monkeypatch):
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return b'{"id":"merchant-1"}'

    def opener(request, timeout):
        captured["url"] = request.full_url
        captured["method"] = request.get_method()
        captured["auth"] = request.get_header("Authorization")
        captured["timeout"] = timeout
        return Response()

    result = smoke.sandbox_requester(
        "GET",
        "/v3/merchants/merchant-1",
        token="sandbox-token",
        opener=opener,
    )
    assert result == {"id": "merchant-1"}
    assert captured == {
        "url": "https://apisandbox.dev.clover.com/v3/merchants/merchant-1",
        "method": "GET",
        "auth": "Bearer sandbox-token",
        "timeout": 15,
    }

    with pytest.raises(CloverRequestError) as error:
        smoke.sandbox_requester("POST", "/v3/merchants/merchant-1", token="sandbox-token", opener=opener)
    assert error.value.code == "clover_catalog_smoke_read_only"


def test_main_uses_existing_client_and_reports_normalized_summary(monkeypatch, capsys):
    snapshot = _snapshot()

    class FakeClient:
        def __init__(self, **kwargs):
            assert kwargs["merchant_id"] == "V7SXJVSGY5051"
            assert kwargs["token"] == "sandbox-token"
            assert kwargs["requester"] is smoke.sandbox_requester

        def fetch_snapshot(self):
            return snapshot

    monkeypatch.setenv(smoke.MERCHANT_ENV, "V7SXJVSGY5051")
    monkeypatch.setenv(smoke.TOKEN_ENV, "sandbox-token")
    monkeypatch.setattr(smoke, "CloverCatalogClient", FakeClient)
    assert smoke.main([]) == 0
    captured = capsys.readouterr()
    assert '"priceCents": 1800' in captured.out
    assert "sandbox-token" not in captured.out
    assert "Verified Test Burger TE0BYZH7B28AJ at 1800 cents" in captured.err


def test_main_reports_missing_credentials_without_calling_client(monkeypatch, capsys):
    monkeypatch.delenv(smoke.MERCHANT_ENV, raising=False)
    monkeypatch.delenv(smoke.TOKEN_ENV, raising=False)
    assert smoke.main([]) == 2
    assert "CLOVER_SANDBOX_MERCHANT_ID" in capsys.readouterr().err


def test_main_reports_incomplete_catalog(monkeypatch, capsys):
    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def fetch_snapshot(self):
            raise CloverCatalogIncomplete("bounded response")

    monkeypatch.setenv(smoke.MERCHANT_ENV, "merchant-1")
    monkeypatch.setenv(smoke.TOKEN_ENV, "sandbox-token")
    monkeypatch.setattr(smoke, "CloverCatalogClient", FakeClient)
    assert smoke.main([]) == 3
    assert "INCOMPLETE" in capsys.readouterr().err


def test_module_invocation_starts_from_repository_root_without_network(monkeypatch):
    environment = os.environ.copy()
    environment.pop(smoke.MERCHANT_ENV, None)
    environment.pop(smoke.TOKEN_ENV, None)
    environment.pop("CLOVER_CATALOG_ENABLED", None)
    repository_root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [sys.executable, "-m", "scripts.clover_catalog_smoke"],
        cwd=repository_root,
        env=environment,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 2
    assert smoke.MERCHANT_ENV in result.stderr
    assert "Traceback" not in result.stderr
