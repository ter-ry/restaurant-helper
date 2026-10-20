from __future__ import annotations

import json
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from flask import current_app


class CloverRequestError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, code: str = "clover_request_failed"):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def clover_enabled() -> bool:
    return bool(current_app.config.get("CLOVER_ENABLED"))


def clover_environment() -> str:
    return str(current_app.config.get("CLOVER_ENVIRONMENT") or "sandbox").strip().lower()


def clover_region() -> str:
    return str(current_app.config.get("CLOVER_REGION") or "north_america").strip().lower()


def clover_authorize_base() -> str:
    return "https://sandbox.dev.clover.com" if clover_environment() == "sandbox" else "https://www.clover.com"


def clover_api_base() -> str:
    if clover_environment() == "sandbox":
        return "https://apisandbox.dev.clover.com"
    return {"north_america": "https://api.clover.com", "europe": "https://api.eu.clover.com", "latam": "https://api.la.clover.com", "apac": "https://api.apac.clover.com"}.get(clover_region(), "https://api.clover.com")


def clover_authorize_url(*, state: str, client_id: str, redirect_uri: str) -> str:
    query = urlencode({"client_id": client_id, "redirect_uri": redirect_uri, "state": state})
    return f"{clover_authorize_base()}/oauth/v2/authorize?{query}"


def parse_clover_timestamp(value: object) -> datetime | None:
    try:
        if value is None or value == "":
            return None
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


def clover_request(method: str, path: str, *, token: str | None = None, payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(f"{clover_api_base()}{path}", data=body, method=method.upper(), headers={"Accept": "application/json", "Content-Type": "application/json"})
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        raise CloverRequestError("Clover request was rejected.", status_code=exc.code, code="clover_unauthorized" if exc.code in {401, 403} else "clover_request_failed") from exc
    except (URLError, TimeoutError, ValueError) as exc:
        raise CloverRequestError("Clover request could not be completed.", code="clover_unavailable") from exc
