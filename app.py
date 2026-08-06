from __future__ import annotations

import io
import os
from pathlib import Path

from flask import Flask, Response, jsonify, request
from PIL import Image, UnidentifiedImageError
from werkzeug.exceptions import RequestEntityTooLarge

from invoice_ocr import InvoiceOCRFailure, extract_invoice_document
from reconciliation_ocr import InvoiceOCRFailure as ReconciliationOCRFailure, extract_reconciliation_document

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "jobs.sqlite"
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_CONTENT_LENGTH", str(15 * 1024 * 1024)))
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


def parse_allowed_origins() -> set[str]:
    configured = os.environ.get("FLOWTALLY_ALLOWED_ORIGINS", "")
    origins = {origin.strip() for origin in configured.split(",") if origin.strip()}
    return origins or DEFAULT_ALLOWED_ORIGINS


ALLOWED_ORIGINS = parse_allowed_origins()


def json_error(message: str, status_code: int) -> tuple[Response, int]:
    return jsonify({"error": message}), status_code


def validate_upload_content(filename: str, content: bytes, allowed_extensions: set[str]) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix not in allowed_extensions:
        raise ValueError(f"Unsupported file type: {suffix or 'unknown'}")
    if not content:
        raise ValueError("Uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError(f"Uploaded file is too large. Maximum size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    if suffix in ALLOWED_IMAGE_EXTENSIONS:
        try:
            with Image.open(io.BytesIO(content)) as image:  # type: ignore[name-defined]
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


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

    @app.after_request
    def add_cors_headers(response: Response) -> Response:
        if request.path.startswith("/api/"):
            origin = request.headers.get("Origin", "")
            if origin in ALLOWED_ORIGINS:
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Vary"] = "Origin"
            response.headers.setdefault("Access-Control-Allow-Headers", "Content-Type, Accept")
            response.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        return response

    @app.errorhandler(RequestEntityTooLarge)
    def handle_request_too_large(_: RequestEntityTooLarge) -> Response:
        return json_error("Uploaded file is too large.", 413)

    @app.get("/api/health")
    def health() -> Response:
        return jsonify(
            {
                "status": "ok",
                "service": "flowtally-ocr",
                "ocrConfigured": bool(os.environ.get("OCR_SPACE_API_KEY", "").strip()),
                "maxContentLength": MAX_UPLOAD_BYTES,
            }
        )

    @app.route("/api/<path:_path>", methods=["OPTIONS"])
    @app.route("/api", methods=["OPTIONS"])
    def api_options(_path: str = "") -> Response:
        return Response(status=204)

    @app.post("/api/invoices/ocr")
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

    @app.post("/api/reconciliation/extract")
    def reconciliation_extract() -> Response:
        uploaded = request.files.get("file")
        if not uploaded:
            return json_error("No reconciliation file uploaded.", 400)
        source = request.form.get("source", "").strip()
        if not uploaded.filename:
            return json_error("The uploaded file is missing a filename.", 400)
        try:
            content = uploaded.read()
            validate_upload_content(uploaded.filename, content, ALLOWED_RECONCILIATION_EXTENSIONS)
            parsed = extract_reconciliation_document(uploaded.filename, content, uploaded.mimetype or "", source)
        except (ValueError, ReconciliationOCRFailure) as exc:
            return json_error(str(exc), 422 if isinstance(exc, ReconciliationOCRFailure) else 400)
        return jsonify(parsed)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
