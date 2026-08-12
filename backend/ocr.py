from __future__ import annotations

import io
import os
from pathlib import Path

from flask import Blueprint, Response, current_app, jsonify, request
from PIL import Image, UnidentifiedImageError
from werkzeug.exceptions import RequestEntityTooLarge

from invoice_ocr import InvoiceOCRFailure, extract_invoice_document
from reconciliation_ocr import InvoiceOCRFailure as ReconciliationOCRFailure, extract_reconciliation_document

from .utils import json_error


bp = Blueprint("ocr", __name__)
ALLOWED_INVOICE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
ALLOWED_RECONCILIATION_EXTENSIONS = {".csv", ".jpg", ".jpeg", ".png", ".webp", ".pdf"}
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
DEFAULT_ALLOWED_ORIGINS = {
    "https://flowtally.ca",
    "https://www.flowtally.ca",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
}


def _max_upload_bytes() -> int:
    configured = current_app.config.get("MAX_CONTENT_LENGTH")
    if isinstance(configured, int) and configured > 0:
        return configured
    return 15 * 1024 * 1024


def _allowed_origins() -> set[str]:
    configured = current_app.config.get("ALLOWED_ORIGINS")
    if isinstance(configured, list) and configured:
        return {str(origin) for origin in configured if str(origin).strip()}
    return set(DEFAULT_ALLOWED_ORIGINS)


def validate_upload_content(filename: str, content: bytes, allowed_extensions: set[str]) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix not in allowed_extensions:
        raise ValueError(f"Unsupported file type: {suffix or 'unknown'}")
    if not content:
        raise ValueError("Uploaded file is empty.")
    if len(content) > _max_upload_bytes():
        raise ValueError(f"Uploaded file is too large. Maximum size is {_max_upload_bytes() // (1024 * 1024)} MB.")
    if suffix in ALLOWED_IMAGE_EXTENSIONS:
        try:
            with Image.open(io.BytesIO(content)) as image:
                image.verify()
        except UnidentifiedImageError as exc:
            raise ValueError("The uploaded image could not be read. Try a clearer JPG, PNG, or WEBP file.") from exc
    elif suffix == ".pdf":
        if not content.lstrip().startswith(b"%PDF"):
            raise ValueError("The uploaded PDF file could not be verified.")
    elif suffix == ".csv":
        sample = content[:2048].decode("utf-8-sig", errors="replace")
        if not sample.strip():
            raise ValueError("The uploaded CSV file is empty or unreadable.")


@bp.errorhandler(RequestEntityTooLarge)
def handle_request_too_large(_: RequestEntityTooLarge) -> Response:
    return json_error("Uploaded file is too large.", 413)


@bp.post("/api/invoices/ocr")
def invoice_ocr() -> Response:
    uploaded = request.files.get("file")
    if not uploaded:
        return json_error("No invoice file uploaded.", 400)
    if not uploaded.filename:
        return json_error("The uploaded file is missing a filename.", 400)
    try:
        content = uploaded.read()
        validate_upload_content(uploaded.filename, content, ALLOWED_INVOICE_EXTENSIONS)
        parsed = extract_invoice_document(uploaded.filename, content, uploaded.mimetype or "")
    except (ValueError, InvoiceOCRFailure) as exc:
        return json_error(str(exc), 422)
    return jsonify(parsed)


@bp.post("/api/reconciliation/extract")
def reconciliation_extract() -> Response:
    uploaded = request.files.get("file")
    if not uploaded:
        return json_error("No reconciliation file uploaded.", 400)
    if not uploaded.filename:
        return json_error("The uploaded file is missing a filename.", 400)
    source_key = request.form.get("source", "").strip().lower()
    if source_key not in {"uber_eats", "doordash", "skip", "pos", "card", "cash"}:
        return json_error("Unsupported reconciliation source.", 400)
    try:
        content = uploaded.read()
        validate_upload_content(uploaded.filename, content, ALLOWED_RECONCILIATION_EXTENSIONS)
        parsed = extract_reconciliation_document(uploaded.filename, content, uploaded.mimetype or "", source_key)
    except (ValueError, ReconciliationOCRFailure) as exc:
        return json_error(str(exc), 422)
    return jsonify(parsed)
