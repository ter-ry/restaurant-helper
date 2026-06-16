from __future__ import annotations

import csv
import html
import io
import json
import os
import re
import sqlite3
import urllib.error
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from flask import Flask, Response, g, jsonify, render_template, request
from PIL import Image, UnidentifiedImageError
from invoice_ocr import InvoiceOCRFailure, extract_invoice_document
from reconciliation_ocr import InvoiceOCRFailure as ReconciliationOCRFailure, extract_reconciliation_document
from sources.jobspy_source import fetch_jobspy_jobs
from werkzeug.exceptions import RequestEntityTooLarge


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "jobs.sqlite"
MAX_FETCH_BYTES = 1_200_000
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

STATUSES = ["Saved", "Drafting", "Applied", "Interview", "Offer", "Rejected", "Archived"]
ROLE_TYPES = ["full-stack developer", "software developer", "cloud support", "technical support engineer", "implementation specialist", "analyst", "intern", "new grad", "other"]
REWARD_KEYWORDS = ["python", "javascript", "flask", "react", "sql", "cloud", "aws", "azure", "dashboards", "dashboard", "automation", "scraping", "apis", "api", "internal tools", "reporting", "business systems", "technical support engineer", "implementation specialist", "full-stack developer", "full stack developer", "cloud support", "analyst"]
ROLE_KEYWORDS = ["junior", "intern", "internship", "new grad", "entry level", "full-stack", "full stack", "cloud support", "technical support engineer", "implementation specialist", "analyst", "software developer", "software engineer", "developer"]
LOCATION_KEYWORDS = ["toronto", "remote", "hybrid", "gta", "ontario", "canada"]
PENALTY_KEYWORDS = ["senior", "5+ years", "6+ years", "7+ years", "advanced algorithms", "competitive programming", "distributed systems at scale", "data structures and algorithms", "unpaid", "commission only", "commission-only"]
CODING_RISK_KEYWORDS = ["leetcode", "hackerrank", "codility", "advanced algorithms", "competitive programming", "data structures", "whiteboard"]
EFFORT_KEYWORDS = ["portfolio", "take-home", "cover letter required", "assessment", "work sample"]
JOBSPY_SOURCES = ["linkedin", "indeed", "google", "zip_recruiter"]
DEFAULT_SEARCH_SOURCES = "linkedin,indeed,google,zip_recruiter"

SAVED_SEARCH_COLUMNS = {
    "search_name": "TEXT NOT NULL DEFAULT ''",
    "keywords": "TEXT NOT NULL DEFAULT ''",
    "location": "TEXT NOT NULL DEFAULT 'Toronto, Ontario'",
    "distance": "INTEGER NOT NULL DEFAULT 50",
    "remote_preference": "TEXT NOT NULL DEFAULT ''",
    "minimum_salary": "INTEGER NOT NULL DEFAULT 0",
    "target_roles": "TEXT NOT NULL DEFAULT ''",
    "excluded_title_keywords": "TEXT NOT NULL DEFAULT 'senior,staff,principal,director,lead,architect,manager'",
    "maximum_experience": "INTEGER NOT NULL DEFAULT 3",
    "posted_within_days": "INTEGER NOT NULL DEFAULT 7",
    "enabled_sources": f"TEXT NOT NULL DEFAULT '{DEFAULT_SEARCH_SOURCES}'",
    "max_results_per_source": "INTEGER NOT NULL DEFAULT 10",
    "country_indeed": "TEXT NOT NULL DEFAULT 'Canada'",
}

DISCOVERY_COLUMNS = {
    "saved_search_id": "INTEGER NOT NULL DEFAULT 0",
    "source": "TEXT NOT NULL DEFAULT ''",
    "source_job_id": "TEXT NOT NULL DEFAULT ''",
    "title": "TEXT NOT NULL DEFAULT ''",
    "company": "TEXT NOT NULL DEFAULT ''",
    "location": "TEXT NOT NULL DEFAULT ''",
    "city": "TEXT NOT NULL DEFAULT ''",
    "state_province": "TEXT NOT NULL DEFAULT ''",
    "remote_type": "TEXT NOT NULL DEFAULT ''",
    "job_type": "TEXT NOT NULL DEFAULT ''",
    "salary_min": "REAL",
    "salary_max": "REAL",
    "salary_interval": "TEXT NOT NULL DEFAULT ''",
    "salary_text": "TEXT NOT NULL DEFAULT ''",
    "job_url": "TEXT NOT NULL DEFAULT ''",
    "application_url": "TEXT NOT NULL DEFAULT ''",
    "description": "TEXT NOT NULL DEFAULT ''",
    "posted_date": "TEXT NOT NULL DEFAULT ''",
    "company_url": "TEXT NOT NULL DEFAULT ''",
    "experience_requirement": "TEXT NOT NULL DEFAULT ''",
    "required_skills": "TEXT NOT NULL DEFAULT ''",
    "preferred_skills": "TEXT NOT NULL DEFAULT ''",
    "fetched_at": "TEXT NOT NULL DEFAULT ''",
    "raw_data": "TEXT NOT NULL DEFAULT '{}'",
    "canonical_key": "TEXT NOT NULL DEFAULT ''",
    "status": "TEXT NOT NULL DEFAULT 'new'",
    "rejection_reason": "TEXT NOT NULL DEFAULT ''",
    "risk_flags": "TEXT NOT NULL DEFAULT ''",
    "fit_score": "INTEGER NOT NULL DEFAULT 0",
    "score_breakdown": "TEXT NOT NULL DEFAULT '{}'",
    "last_seen_at": "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
}

JOB_COLUMNS = {
    "company": "TEXT NOT NULL DEFAULT ''",
    "title": "TEXT NOT NULL DEFAULT ''",
    "location": "TEXT NOT NULL DEFAULT ''",
    "url": "TEXT NOT NULL DEFAULT ''",
    "source": "TEXT NOT NULL DEFAULT ''",
    "salary": "TEXT NOT NULL DEFAULT ''",
    "deadline": "TEXT NOT NULL DEFAULT ''",
    "fit_score": "INTEGER NOT NULL DEFAULT 0",
    "status": "TEXT NOT NULL DEFAULT 'Saved'",
    "notes": "TEXT NOT NULL DEFAULT ''",
    "date_added": "TEXT NOT NULL DEFAULT ''",
    "date_applied": "TEXT NOT NULL DEFAULT ''",
    "job_description": "TEXT NOT NULL DEFAULT ''",
    "remote_type": "TEXT NOT NULL DEFAULT ''",
    "role_type": "TEXT NOT NULL DEFAULT ''",
    "seniority_level": "TEXT NOT NULL DEFAULT ''",
    "required_skills": "TEXT NOT NULL DEFAULT ''",
    "preferred_skills": "TEXT NOT NULL DEFAULT ''",
    "responsibilities": "TEXT NOT NULL DEFAULT ''",
    "application_url": "TEXT NOT NULL DEFAULT ''",
    "skills_match_score": "INTEGER NOT NULL DEFAULT 0",
    "role_match_score": "INTEGER NOT NULL DEFAULT 0",
    "location_score": "INTEGER NOT NULL DEFAULT 0",
    "remote_score": "INTEGER NOT NULL DEFAULT 0",
    "salary_score": "INTEGER NOT NULL DEFAULT 0",
    "seniority_score": "INTEGER NOT NULL DEFAULT 0",
    "coding_risk_score": "INTEGER NOT NULL DEFAULT 0",
    "application_effort_score": "INTEGER NOT NULL DEFAULT 0",
    "score_breakdown": "TEXT NOT NULL DEFAULT '{}'",
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


def validate_source_key(source_key: str) -> str:
    allowed_sources = {"uber_eats", "doordash", "skip", "pos", "card", "cash"}
    normalized = text(source_key)
    if normalized not in allowed_sources:
        raise ValueError("Unsupported reconciliation source.")
    return normalized


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

    @app.before_request
    def ensure_database() -> None:
        init_db()

    @app.teardown_appcontext
    def close_connection(_: Exception | None = None) -> None:
        db = g.pop("db", None)
        if db is not None:
            db.close()

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
                "service": "flowtally-backend",
                "ocrConfigured": bool(os.environ.get("OCR_SPACE_API_KEY", "").strip()),
                "maxContentLength": MAX_UPLOAD_BYTES,
            }
        )

    @app.route("/api/<path:_path>", methods=["OPTIONS"])
    @app.route("/api", methods=["OPTIONS"])
    def api_options(_path: str = "") -> Response:
        return Response(status=204)

    @app.get("/")
    def index() -> str:
        return render_template("index.html", statuses=STATUSES, role_types=ROLE_TYPES)

    @app.get("/api/profile")
    def get_profile() -> Response:
        return jsonify(load_profile())

    @app.post("/api/profile")
    def save_profile() -> Response:
        upsert_profile(normalize_profile_payload(request.get_json(force=True)))
        return jsonify(load_profile())

    @app.post("/api/profile/upload")
    def upload_profile_file() -> Response:
        uploaded = request.files.get("file")
        if not uploaded:
            return jsonify({"error": "No file uploaded"}), 400
        try:
            extracted = extract_uploaded_text(uploaded.filename or "resume.txt", uploaded.read())
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        profile = load_profile()
        profile["resume_text"] = extracted
        upsert_profile(profile)
        return jsonify({"resume_text": extracted})

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
            result = extract_invoice_document(uploaded.filename, content, uploaded.mimetype or "")
        except ValueError as exc:
            return json_error(str(exc), 400)
        except InvoiceOCRFailure as exc:
            return json_error(str(exc), 422)
        return jsonify(result)

    @app.post("/api/reconciliation/extract")
    def reconciliation_extract() -> Response:
        uploaded = request.files.get("file")
        source_key = text(request.form.get("source"))
        if not uploaded:
            return json_error("No reconciliation file uploaded.", 400)
        if not uploaded.filename:
            return json_error("The uploaded file is missing a filename.", 400)
        if not source_key:
            return json_error("A source key is required.", 400)
        try:
            validated_source = validate_source_key(source_key)
            content = uploaded.read()
            validate_upload_content(uploaded.filename, content, ALLOWED_RECONCILIATION_EXTENSIONS)
            result = extract_reconciliation_document(uploaded.filename, content, uploaded.mimetype or "", validated_source)
        except ValueError as exc:
            return json_error(str(exc), 400)
        except ReconciliationOCRFailure as exc:
            return json_error(str(exc), 422)
        return jsonify(result)

    @app.get("/api/jobs")
    def list_jobs() -> Response:
        rows = query_db("SELECT * FROM jobs ORDER BY date_added DESC, id DESC")
        return jsonify([job_to_dict(row) for row in rows])

    @app.post("/api/jobs")
    def create_job() -> Response:
        clean = normalize_job_payload(request.get_json(force=True))
        cursor = get_db().execute(
            f"INSERT INTO jobs ({', '.join(JOB_COLUMNS.keys())}) VALUES ({', '.join(['?'] * len(JOB_COLUMNS))})",
            tuple(clean[column] for column in JOB_COLUMNS),
        )
        get_db().commit()
        return jsonify(job_to_dict(query_db("SELECT * FROM jobs WHERE id = ?", [cursor.lastrowid], one=True))), 201

    @app.put("/api/jobs/<int:job_id>")
    def update_job(job_id: int) -> Response:
        existing = query_db("SELECT * FROM jobs WHERE id = ?", [job_id], one=True)
        if existing is None:
            return jsonify({"error": "Job not found"}), 404
        merged = job_to_dict(existing)
        merged.update(request.get_json(force=True))
        clean = normalize_job_payload(merged)
        assignments = ", ".join([f"{column} = ?" for column in JOB_COLUMNS])
        get_db().execute(f"UPDATE jobs SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (*[clean[column] for column in JOB_COLUMNS], job_id))
        get_db().commit()
        return jsonify(job_to_dict(query_db("SELECT * FROM jobs WHERE id = ?", [job_id], one=True)))

    @app.delete("/api/jobs/<int:job_id>")
    def delete_job(job_id: int) -> Response:
        get_db().execute("DELETE FROM jobs WHERE id = ?", [job_id])
        get_db().commit()
        return jsonify({"ok": True})

    @app.post("/api/jobs/from-description")
    def job_from_description() -> Response:
        payload = request.get_json(force=True)
        description = text(payload.get("job_description"))
        details = extract_job_details(description, text(payload.get("source")) or "Pasted description")
        details["job_description"] = description
        return jsonify(details)

    @app.post("/api/jobs/from-url")
    def job_from_url() -> Response:
        url = text(request.get_json(force=True).get("url"))
        if not url:
            return jsonify({"error": "URL is required"}), 400
        try:
            page_text = fetch_public_page_text(url)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        details = extract_job_details(page_text, source_from_url(url))
        details.update({"url": url, "application_url": url, "job_description": page_text[:20000]})
        return jsonify(details)

    @app.post("/api/jobs/import-csv")
    def import_jobs_csv() -> Response:
        uploaded = request.files.get("file")
        if not uploaded:
            return jsonify({"error": "No CSV file uploaded"}), 400
        imported = import_csv_jobs(uploaded.read().decode("utf-8-sig", errors="replace"))
        return jsonify({"imported": imported})

    @app.post("/api/discovery/search")
    def discovery_search() -> Response:
        payload = request.get_json(force=True)
        keywords = text(payload.get("keywords"))
        location = text(payload.get("location"))
        rows = query_db(
            """
            SELECT * FROM jobs
            WHERE (? = '' OR lower(title || ' ' || company || ' ' || job_description) LIKE ?)
            AND (? = '' OR lower(location) LIKE ?)
            ORDER BY fit_score DESC, date_added DESC
            """,
            [keywords, f"%{keywords.lower()}%", location, f"%{location.lower()}%"],
        )
        return jsonify({"message": "Local saved-job search is active. Public ATS connectors can be added later.", "results": [job_to_dict(row) for row in rows]})

    @app.get("/api/saved-searches")
    def list_saved_searches() -> Response:
        return jsonify([saved_search_to_dict(row) for row in query_db("SELECT * FROM saved_searches ORDER BY updated_at DESC, id DESC")])

    @app.post("/api/saved-searches")
    def create_saved_search() -> Response:
        clean = normalize_saved_search_payload(request.get_json(force=True))
        cursor = get_db().execute(f"INSERT INTO saved_searches ({', '.join(SAVED_SEARCH_COLUMNS.keys())}) VALUES ({', '.join(['?'] * len(SAVED_SEARCH_COLUMNS))})", tuple(clean[column] for column in SAVED_SEARCH_COLUMNS))
        get_db().commit()
        return jsonify(saved_search_to_dict(query_db("SELECT * FROM saved_searches WHERE id = ?", [cursor.lastrowid], one=True))), 201

    @app.put("/api/saved-searches/<int:search_id>")
    def update_saved_search(search_id: int) -> Response:
        existing = query_db("SELECT * FROM saved_searches WHERE id = ?", [search_id], one=True)
        if existing is None:
            return jsonify({"error": "Saved search not found"}), 404
        merged = saved_search_to_dict(existing)
        merged.update(request.get_json(force=True))
        clean = normalize_saved_search_payload(merged)
        assignments = ", ".join([f"{column} = ?" for column in SAVED_SEARCH_COLUMNS])
        get_db().execute(f"UPDATE saved_searches SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (*[clean[column] for column in SAVED_SEARCH_COLUMNS], search_id))
        get_db().commit()
        return jsonify(saved_search_to_dict(query_db("SELECT * FROM saved_searches WHERE id = ?", [search_id], one=True)))

    @app.delete("/api/saved-searches/<int:search_id>")
    def delete_saved_search(search_id: int) -> Response:
        get_db().execute("DELETE FROM saved_searches WHERE id = ?", [search_id])
        get_db().commit()
        return jsonify({"ok": True})

    @app.post("/api/saved-searches/<int:search_id>/run")
    def run_saved_search_endpoint(search_id: int) -> Response:
        saved = query_db("SELECT * FROM saved_searches WHERE id = ?", [search_id], one=True)
        if saved is None:
            return jsonify({"error": "Saved search not found"}), 404
        return jsonify(run_saved_search(saved_search_to_dict(saved)))

    @app.get("/api/discovery/results")
    def list_discovery_results() -> Response:
        clauses = []
        args: list[Any] = []
        for field, arg_name in [("saved_search_id", "saved_search_id"), ("status", "status")]:
            if text(request.args.get(arg_name)):
                clauses.append(f"{field} = ?")
                args.append(text(request.args.get(arg_name)))
        if text(request.args.get("rejection_reason")):
            clauses.append("rejection_reason LIKE ?")
            args.append(f"%{text(request.args.get('rejection_reason'))}%")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = query_db(f"SELECT * FROM discovery_results {where} ORDER BY status = 'rejected', fit_score DESC, posted_date DESC, id DESC", args)
        return jsonify([discovery_to_dict(row) for row in rows])

    @app.post("/api/discovery/results/<int:result_id>/ignore")
    def ignore_discovery_result(result_id: int) -> Response:
        get_db().execute("UPDATE discovery_results SET status = 'ignored' WHERE id = ?", [result_id])
        get_db().commit()
        return jsonify({"ok": True})

    @app.post("/api/discovery/results/<int:result_id>/save")
    def save_discovery_result(result_id: int) -> Response:
        row = query_db("SELECT * FROM discovery_results WHERE id = ?", [result_id], one=True)
        if row is None:
            return jsonify({"error": "Discovery result not found"}), 404
        clean = normalize_job_payload(discovery_to_job_payload(discovery_to_dict(row)))
        cursor = get_db().execute(f"INSERT INTO jobs ({', '.join(JOB_COLUMNS.keys())}) VALUES ({', '.join(['?'] * len(JOB_COLUMNS))})", tuple(clean[column] for column in JOB_COLUMNS))
        get_db().execute("UPDATE discovery_results SET status = 'saved' WHERE id = ?", [result_id])
        get_db().commit()
        return jsonify(job_to_dict(query_db("SELECT * FROM jobs WHERE id = ?", [cursor.lastrowid], one=True))), 201

    @app.post("/api/generate")
    def generate_materials() -> Response:
        payload = request.get_json(force=True)
        job = normalize_job_payload(payload)
        result = generate_application_materials(job, load_profile())
        job_id = clamp_int(payload.get("id") or payload.get("job_id"), 0, 10**9)
        if job_id:
            save_version(job_id, "resume", result["resume_text"])
            save_version(job_id, "cover_letter", result["cover_letter"])
            save_version(job_id, "answers", answers_to_text(result["short_answers"]))
        return jsonify(result)

    @app.post("/api/jobs/<int:job_id>/versions")
    def save_job_version(job_id: int) -> Response:
        payload = request.get_json(force=True)
        return jsonify({"id": save_version(job_id, text(payload.get("kind")) or "note", text(payload.get("content")))})

    @app.get("/api/jobs/<int:job_id>/versions")
    def list_job_versions(job_id: int) -> Response:
        rows = query_db("SELECT * FROM generated_versions WHERE job_id = ? ORDER BY created_at DESC, id DESC", [job_id])
        return jsonify([dict(row) for row in rows])

    @app.post("/api/follow-up")
    def follow_up() -> Response:
        payload = request.get_json(force=True)
        return jsonify({"message": generate_follow_up(payload.get("company") or "the hiring team", payload.get("title") or "the role", payload.get("date_applied") or "")})

    @app.get("/api/dashboard")
    def dashboard() -> Response:
        return jsonify(build_dashboard([job_to_dict(row) for row in query_db("SELECT * FROM jobs")]))

    @app.get("/export.csv")
    def export_csv() -> Response:
        rows = [job_to_dict(row) for row in query_db("SELECT * FROM jobs ORDER BY date_added DESC, id DESC")]
        fields = ["company", "title", "location", "remote_type", "role_type", "url", "source", "salary", "deadline", "fit_score", "skills_match_score", "role_match_score", "location_score", "remote_score", "salary_score", "seniority_score", "coding_risk_score", "application_effort_score", "status", "notes", "date_added", "date_applied"]
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})
        return download_response(output.getvalue(), "job-applications.csv", "text/csv")

    @app.get("/export/<int:job_id>/<kind>.<fmt>")
    def export_generated(job_id: int, kind: str, fmt: str) -> Response:
        if kind not in {"resume", "cover_letter", "answers"} or fmt not in {"txt", "docx"}:
            return jsonify({"error": "Unsupported export type"}), 400
        row = query_db("SELECT * FROM generated_versions WHERE job_id = ? AND kind = ? ORDER BY created_at DESC, id DESC", [job_id, kind], one=True)
        if row is None:
            return jsonify({"error": "No saved version found. Generate materials first."}), 404
        filename = f"job-{job_id}-{kind}.{fmt}"
        if fmt == "txt":
            return download_response(row["content"], filename, "text/plain")
        return Response(make_docx(row["content"]), mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers={"Content-Disposition": f"attachment; filename={filename}"})

    return app


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        DATA_DIR.mkdir(exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


def init_db() -> None:
    db = get_db()
    db.execute("CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    ensure_columns("jobs", JOB_COLUMNS)
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            location TEXT NOT NULL DEFAULT '',
            preferred_roles TEXT NOT NULL DEFAULT '',
            preferred_locations TEXT NOT NULL DEFAULT '',
            work_authorization TEXT NOT NULL DEFAULT '',
            key_skills TEXT NOT NULL DEFAULT '',
            projects TEXT NOT NULL DEFAULT '',
            education TEXT NOT NULL DEFAULT '',
            work_experience TEXT NOT NULL DEFAULT '',
            resume_text TEXT NOT NULL DEFAULT '',
            cover_letter_template TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS generated_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
        )
        """
    )
    db.execute("CREATE TABLE IF NOT EXISTS saved_searches (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    ensure_columns("saved_searches", SAVED_SEARCH_COLUMNS)
    db.execute("CREATE TABLE IF NOT EXISTS discovery_results (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    ensure_columns("discovery_results", DISCOVERY_COLUMNS)
    db.execute("CREATE TABLE IF NOT EXISTS discovery_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, saved_search_id INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT '{}', source_errors TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    db.commit()


def ensure_columns(table: str, columns: dict[str, str]) -> None:
    existing = {row["name"] for row in get_db().execute(f"PRAGMA table_info({table})")}
    for name, definition in columns.items():
        if name not in existing:
            get_db().execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


def query_db(query: str, args: list[Any] | None = None, one: bool = False) -> Any:
    cursor = get_db().execute(query, args or [])
    rows = cursor.fetchall()
    cursor.close()
    return (rows[0] if rows else None) if one else rows


def split_csv(value: Any) -> list[str]:
    return [item.strip() for item in text(value).split(",") if item.strip()]


def normalize_saved_search_payload(payload: dict[str, Any]) -> dict[str, Any]:
    enabled = payload.get("enabled_sources")
    enabled_sources = ",".join([source for source in enabled if source in JOBSPY_SOURCES]) if isinstance(enabled, list) else text(enabled) or DEFAULT_SEARCH_SOURCES
    return {
        "search_name": text(payload.get("search_name")) or text(payload.get("name")) or "JobSpy Search",
        "keywords": text(payload.get("keywords")) or "junior software developer",
        "location": text(payload.get("location")) or "Toronto, Ontario",
        "distance": clamp_int(payload.get("distance"), 0, 500),
        "remote_preference": text(payload.get("remote_preference")),
        "minimum_salary": clamp_int(payload.get("minimum_salary"), 0, 1_000_000),
        "target_roles": text(payload.get("target_roles")),
        "excluded_title_keywords": text(payload.get("excluded_title_keywords")) or "senior,staff,principal,director,lead,architect,manager",
        "maximum_experience": clamp_int(payload.get("maximum_experience"), 0, 50),
        "posted_within_days": clamp_int(payload.get("posted_within_days"), 1, 365),
        "enabled_sources": enabled_sources,
        "max_results_per_source": clamp_int(payload.get("max_results_per_source"), 1, 100),
        "country_indeed": text(payload.get("country_indeed")) or "Canada",
    }


def saved_search_to_dict(row: sqlite3.Row | None) -> dict[str, Any]:
    data = dict(row) if row else {}
    data["enabled_sources_list"] = split_csv(data.get("enabled_sources"))
    return data


def discovery_to_dict(row: sqlite3.Row | None) -> dict[str, Any]:
    data = dict(row) if row else {}
    data["score_breakdown"] = parse_json_object(data.get("score_breakdown"))
    data["raw_data"] = parse_json_object(data.get("raw_data"))
    return data


def run_saved_search(saved: dict[str, Any], fetch_func: Any | None = None) -> dict[str, Any]:
    summary = {"new": 0, "updated": 0, "duplicated": 0, "rejected": 0, "failed": 0, "closed": 0, "source_counts": {}, "source_errors": {}}
    fetched = (fetch_func or fetch_jobspy_jobs)(keywords=saved["keywords"], location=saved["location"], distance=int(saved["distance"] or 50), job_type=None, remote_preference=saved.get("remote_preference"), results_wanted=int(saved["max_results_per_source"] or 10), hours_old=int(saved["posted_within_days"] or 7) * 24, enabled_sources=[source for source in split_csv(saved.get("enabled_sources")) if source in JOBSPY_SOURCES], country_indeed=saved.get("country_indeed") or "Canada")
    summary["source_errors"] = fetched.get("errors", {})
    summary["failed"] = len(summary["source_errors"])
    seen_ids: list[int] = []
    for normalized in fetched.get("jobs", []):
        summary["source_counts"][normalized.get("source") or "unknown"] = summary["source_counts"].get(normalized.get("source") or "unknown", 0) + 1
        result, action = upsert_discovery_result(saved, normalized)
        summary[action] += 1
        if result.get("status") == "rejected":
            summary["rejected"] += 1
        if result.get("id"):
            seen_ids.append(int(result["id"]))
    if seen_ids:
        placeholders = ",".join(["?"] * len(seen_ids))
        summary["closed"] = get_db().execute(f"UPDATE discovery_results SET status = 'closed' WHERE saved_search_id = ? AND status IN ('new','reviewed') AND id NOT IN ({placeholders})", [saved["id"], *seen_ids]).rowcount
    get_db().execute("INSERT INTO discovery_runs (saved_search_id, summary, source_errors) VALUES (?, ?, ?)", [saved["id"], json.dumps(summary), json.dumps(summary["source_errors"])])
    get_db().commit()
    return summary


def upsert_discovery_result(saved: dict[str, Any], normalized: dict[str, Any]) -> tuple[dict[str, Any], str]:
    canonical = canonical_discovery_key(normalized)
    existing = find_existing_discovery(normalized, canonical)
    rejected, reason, flags = apply_initial_rejection_filters(normalized, saved)
    scored = score_discovery_job(normalized)
    row = {"saved_search_id": saved["id"], "source": text(normalized.get("source")), "source_job_id": text(normalized.get("source_job_id")), "title": text(normalized.get("title")), "company": text(normalized.get("company")), "location": text(normalized.get("location")), "city": text(normalized.get("city")), "state_province": text(normalized.get("state_province")), "remote_type": text(normalized.get("remote_type")), "job_type": text(normalized.get("job_type")), "salary_min": normalized.get("salary_min"), "salary_max": normalized.get("salary_max"), "salary_interval": text(normalized.get("salary_interval")), "salary_text": text(normalized.get("salary_text")), "job_url": canonicalize_url(normalized.get("job_url")), "application_url": canonicalize_url(normalized.get("application_url")), "description": text(normalized.get("description")), "posted_date": text(normalized.get("posted_date")), "company_url": text(normalized.get("company_url")), "experience_requirement": text(normalized.get("experience_requirement")), "required_skills": text(normalized.get("required_skills")), "preferred_skills": text(normalized.get("preferred_skills")), "fetched_at": text(normalized.get("fetched_at")) or datetime.now(timezone.utc).isoformat(), "raw_data": json.dumps(normalized.get("raw", {}), default=str), "canonical_key": canonical, "status": "rejected" if rejected else (existing["status"] if existing and existing["status"] in {"ignored", "saved"} else "new"), "rejection_reason": reason, "risk_flags": ", ".join(flags), "fit_score": scored["fit_score"], "score_breakdown": json.dumps(scored["score_breakdown"]), "last_seen_at": datetime.now(timezone.utc).isoformat()}
    if existing:
        if int(existing.get("id") or 0) == 0:
            row["id"] = 0
            row["status"] = "saved"
            return row, "duplicated"
        assignments = ", ".join([f"{column} = ?" for column in DISCOVERY_COLUMNS])
        get_db().execute(f"UPDATE discovery_results SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (*[row[column] for column in DISCOVERY_COLUMNS], existing["id"]))
        row["id"] = existing["id"]
        return row, "duplicated" if existing.get("canonical_key") == canonical else "updated"
    cursor = get_db().execute(f"INSERT INTO discovery_results ({', '.join(DISCOVERY_COLUMNS.keys())}) VALUES ({', '.join(['?'] * len(DISCOVERY_COLUMNS))})", tuple(row[column] for column in DISCOVERY_COLUMNS))
    row["id"] = cursor.lastrowid
    return row, "new"


def find_existing_discovery(job: dict[str, Any], canonical: str) -> dict[str, Any] | None:
    clauses = ["canonical_key = ?", "job_url = ?", "application_url = ?"]
    args: list[Any] = [canonical, canonicalize_url(job.get("job_url")), canonicalize_url(job.get("application_url"))]
    if text(job.get("source_job_id")):
        clauses.append("source_job_id = ?")
        args.append(text(job.get("source_job_id")))
    candidates = query_db(f"SELECT * FROM discovery_results WHERE {' OR '.join(clauses)}", args)
    if candidates:
        return discovery_to_dict(candidates[0])
    norm = normalized_identity(job)
    for row in query_db("SELECT * FROM discovery_results"):
        existing = discovery_to_dict(row)
        if SequenceMatcher(None, norm, normalized_identity(existing)).ratio() >= 0.92:
            return existing
    for row in query_db("SELECT * FROM jobs"):
        existing_job = job_to_dict(row)
        if canonicalize_url(job.get("job_url")) and canonicalize_url(job.get("job_url")) in {canonicalize_url(existing_job.get("url")), canonicalize_url(existing_job.get("application_url"))}:
            return {"id": 0, "status": "saved", "canonical_key": canonical}
    return None


def canonical_discovery_key(job: dict[str, Any]) -> str:
    return canonicalize_url(job.get("job_url")) or canonicalize_url(job.get("application_url")) or normalized_identity(job)


def canonicalize_url(value: Any) -> str:
    return text(value).split("?")[0].rstrip("/").lower()


def normalized_identity(job: dict[str, Any]) -> str:
    return normalize_space(f"{job.get('company', '')} {job.get('title', '')} {job.get('location', '')}").lower()


def apply_initial_rejection_filters(job: dict[str, Any], saved: dict[str, Any]) -> tuple[bool, str, list[str]]:
    title = text(job.get("title")).lower()
    content = " ".join([text(job.get("title")), text(job.get("description")), text(job.get("location")), text(job.get("salary_text"))]).lower()
    reasons: list[str] = []
    flags: list[str] = []
    for keyword in split_csv(saved.get("excluded_title_keywords")):
        if keyword.lower() in title:
            reasons.append(f"excluded title keyword: {keyword}")
            break
    max_exp = int(saved.get("maximum_experience") or 0)
    exp_years = extract_years_number(text(job.get("experience_requirement")) or content)
    if max_exp and exp_years and exp_years > max_exp:
        reasons.append(f"experience requirement {exp_years}+ years exceeds max {max_exp}")
    if "us only" in content or "authorized to work in the united states" in content or "u.s. work authorization" in content:
        reasons.append("US-only work authorization")
    remote_pref = text(saved.get("remote_preference")).lower()
    location_pref = text(saved.get("location")).lower()
    job_location = text(job.get("location")).lower()
    remote_type = text(job.get("remote_type")).lower()
    if remote_pref and remote_pref not in {"any", "remote"} and remote_pref not in remote_type:
        flags.append(f"remote preference mismatch: {remote_pref}")
    if "remote" not in remote_type and location_pref and not loose_location_match(location_pref, job_location):
        reasons.append("outside selected location")
    if "unpaid" in content or "commission only" in content or "commission-only" in content:
        reasons.append("unpaid or commission-only")
    if "intern" in title and "current student" in content:
        reasons.append("internship requires current student status")
    target_roles = [role.lower() for role in split_csv(saved.get("target_roles"))]
    if target_roles and not any(role in title or role in content for role in target_roles):
        reasons.append("unrelated to selected target roles")
    salary_max = job.get("salary_max")
    min_salary = int(saved.get("minimum_salary") or 0)
    if min_salary and salary_max and float(salary_max) < min_salary:
        reasons.append("below minimum salary")
    return bool(reasons), "; ".join(reasons), flags


def loose_location_match(preferred: str, actual: str) -> bool:
    if not actual:
        return True
    tokens = [token.strip() for token in re.split(r"[,/]", preferred) if token.strip()]
    return any(token in actual for token in tokens) or any(term in actual for term in ["remote", "canada", "ontario"] if term in preferred)


def extract_years_number(value: str) -> int:
    match = re.search(r"(\d+)\+?\s*(?:-\s*\d+\s*)?(?:years|yrs)", value or "", re.I)
    return int(match.group(1)) if match else 0


def score_discovery_job(job: dict[str, Any]) -> dict[str, Any]:
    base = score_job(discovery_to_job_payload(job), load_profile())
    freshness = posting_freshness_score(text(job.get("posted_date")))
    years = extract_years_number(text(job.get("experience_requirement")))
    experience = 100 if not years else max(20, 100 - years * 12)
    title_relevance = exact_title_relevance(text(job.get("title")))
    source_confidence = {"linkedin": 88, "indeed": 86, "google": 72, "zip_recruiter": 70}.get(text(job.get("source")).lower(), 65)
    fit = round(base["fit_score"] * 0.78 + freshness * 0.06 + experience * 0.06 + title_relevance * 0.06 + source_confidence * 0.04)
    return {"fit_score": clamp_int(fit, 0, 100), "score_breakdown": {**base["breakdown"], "base_fit_score": base["fit_score"], "posting_freshness_score": freshness, "experience_requirement_score": experience, "exact_title_relevance": title_relevance, "source_confidence": source_confidence}}


def discovery_to_job_payload(job: dict[str, Any]) -> dict[str, Any]:
    return {"company": text(job.get("company")), "title": text(job.get("title")), "location": text(job.get("location")), "url": text(job.get("job_url")) or text(job.get("url")), "application_url": text(job.get("application_url")), "source": text(job.get("source")), "salary": text(job.get("salary_text")) or salary_from_bounds(job.get("salary_min"), job.get("salary_max")), "remote_type": text(job.get("remote_type")), "role_type": guess_role_type(f"{job.get('title', '')} {job.get('description', '')}"), "seniority_level": guess_seniority(f"{job.get('title', '')} {job.get('description', '')}"), "required_skills": text(job.get("required_skills")), "preferred_skills": text(job.get("preferred_skills")), "responsibilities": "", "job_description": text(job.get("description")), "status": "Saved"}


def salary_from_bounds(min_value: Any, max_value: Any) -> str:
    if min_value and max_value:
        return f"${int(float(min_value)):,}-${int(float(max_value)):,}"
    if min_value:
        return f"${int(float(min_value)):,}"
    if max_value:
        return f"${int(float(max_value)):,}"
    return ""


def posting_freshness_score(posted_date: str) -> int:
    if not posted_date:
        return 60
    try:
        posted = datetime.fromisoformat(posted_date.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            posted = datetime.strptime(posted_date[:10], "%Y-%m-%d").date()
        except ValueError:
            return 60
    age = (date.today() - posted).days
    return 100 if age <= 1 else 88 if age <= 7 else 65 if age <= 30 else 35


def exact_title_relevance(title: str) -> int:
    lowered = title.lower()
    if any(term in lowered for term in ["junior software developer", "new grad", "entry level"]):
        return 100
    if any(term in lowered for term in ["software developer", "full stack", "cloud support", "implementation specialist", "analyst"]):
        return 86
    if any(term in lowered for term in ["senior", "lead", "principal", "manager"]):
        return 30
    return 62


def normalize_profile_payload(payload: dict[str, Any]) -> dict[str, str]:
    fields = ["name", "email", "phone", "location", "preferred_roles", "preferred_locations", "work_authorization", "key_skills", "projects", "education", "work_experience", "resume_text", "cover_letter_template"]
    return {field: text(payload.get(field)) for field in fields}


def load_profile() -> dict[str, str]:
    row = query_db("SELECT * FROM profile WHERE id = 1", one=True)
    if row is None:
        profile = normalize_profile_payload({})
        profile.update({"preferred_roles": "junior developer, full-stack developer, cloud support, analyst, implementation specialist", "preferred_locations": "Toronto, remote, hybrid, Ontario", "key_skills": "Python, JavaScript, Flask, React, SQL, cloud, AWS, Azure, dashboards, automation, APIs, reporting"})
        upsert_profile(profile)
        return profile
    return normalize_profile_payload(dict(row))


def upsert_profile(profile: dict[str, str]) -> None:
    fields = list(normalize_profile_payload(profile).keys())
    values = [profile.get(field, "") for field in fields]
    assignments = ", ".join([f"{field} = excluded.{field}" for field in fields])
    get_db().execute(f"INSERT INTO profile (id, {', '.join(fields)}) VALUES (1, {', '.join(['?'] * len(fields))}) ON CONFLICT(id) DO UPDATE SET {assignments}, updated_at = CURRENT_TIMESTAMP", values)
    get_db().commit()


def normalize_job_payload(payload: dict[str, Any]) -> dict[str, Any]:
    today = date.today().isoformat()
    extracted = extract_job_details(text(payload.get("job_description")), text(payload.get("source")), existing=payload)
    clean = {column: text(payload.get(column, extracted.get(column, ""))) for column in JOB_COLUMNS}
    clean["date_added"] = text(payload.get("date_added")) or today
    clean["status"] = clean["status"] if clean["status"] in STATUSES else "Saved"
    scoring = score_job({**extracted, **clean}, load_profile())
    for key, value in scoring.items():
        if key.endswith("_score") or key == "fit_score":
            clean[key] = value
    clean["score_breakdown"] = json.dumps(scoring["breakdown"])
    return clean


def job_to_dict(row: sqlite3.Row | None) -> dict[str, Any]:
    if row is None:
        return {}
    data = dict(row)
    data["score_breakdown"] = parse_json_object(data.get("score_breakdown"))
    return data


def text(value: Any) -> str:
    return str(value or "").strip()


def clamp_int(value: Any, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = low
    return max(low, min(high, number))


def parse_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return date.min


def parse_json_object(value: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def contains_phrase(content: str, phrase: str) -> bool:
    return phrase.lower() in content.lower()


def keyword_hits(content: str, keywords: list[str]) -> list[str]:
    return [keyword for keyword in keywords if contains_phrase(content, keyword)]


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def extract_job_details(content: str, source: str = "", existing: dict[str, Any] | None = None) -> dict[str, str]:
    existing = existing or {}
    compact = normalize_space(content)
    lines = [line.strip(" -*\t") for line in content.splitlines() if line.strip()]
    title = text(existing.get("title")) or guess_title(lines)
    return {
        "company": text(existing.get("company")) or guess_company(lines),
        "title": title,
        "location": text(existing.get("location")) or guess_location(compact),
        "remote_type": text(existing.get("remote_type")) or guess_remote_type(compact),
        "salary": text(existing.get("salary")) or guess_salary(compact),
        "required_skills": text(existing.get("required_skills")) or ", ".join(keyword_hits(compact, REWARD_KEYWORDS)),
        "preferred_skills": text(existing.get("preferred_skills")) or extract_section(content, ["preferred", "nice to have", "bonus"]),
        "responsibilities": text(existing.get("responsibilities")) or extract_section(content, ["responsibilities", "what you will do", "about the role"]),
        "seniority_level": text(existing.get("seniority_level")) or guess_seniority(f"{title} {compact}"),
        "application_url": text(existing.get("application_url")) or text(existing.get("url")),
        "source": source or text(existing.get("source")),
        "role_type": text(existing.get("role_type")) or guess_role_type(f"{title} {compact}"),
    }


def guess_title(lines: list[str]) -> str:
    for line in lines[:8]:
        if 4 <= len(line) <= 90 and any(word in line.lower() for word in ["developer", "engineer", "analyst", "support", "specialist", "intern"]):
            return line
    return lines[0][:90] if lines else ""


def guess_company(lines: list[str]) -> str:
    for line in lines[:10]:
        match = re.search(r"(?:company|employer)[:\-]\s*(.+)", line, re.I)
        if match:
            return match.group(1)[:80]
    return ""


def guess_location(content: str) -> str:
    for keyword in LOCATION_KEYWORDS:
        if contains_phrase(content, keyword):
            return "Toronto / GTA" if keyword in {"toronto", "gta"} else keyword.title()
    return ""


def guess_salary(content: str) -> str:
    for pattern in [r"\$ ?\d{2,3}(?:,\d{3})?(?:k|K)?\s*(?:-|to|–)\s*\$? ?\d{2,3}(?:,\d{3})?(?:k|K)?", r"\$ ?\d{2,3},\d{3}", r"\$ ?\d{2,3}k"]:
        match = re.search(pattern, content)
        if match:
            return match.group(0)
    return ""


def guess_remote_type(content: str) -> str:
    lowered = content.lower()
    if "hybrid" in lowered:
        return "Hybrid"
    if "remote" in lowered:
        return "Remote"
    if "on-site" in lowered or "onsite" in lowered:
        return "On-site"
    return ""


def guess_role_type(content: str) -> str:
    lowered = content.lower()
    for role_type in ROLE_TYPES:
        if role_type != "other" and role_type in lowered:
            return role_type
    if "full stack" in lowered or "full-stack" in lowered:
        return "full-stack developer"
    if "support" in lowered and "cloud" in lowered:
        return "cloud support"
    return "other"


def guess_seniority(content: str) -> str:
    lowered = content.lower()
    if "intern" in lowered:
        return "Intern"
    if any(term in lowered for term in ["junior", "new grad", "entry level"]):
        return "Junior/New Grad"
    if "senior" in lowered or re.search(r"\b[5-9]\+ years", lowered):
        return "Senior"
    if "lead" in lowered or "principal" in lowered:
        return "Lead"
    return "Not specified"


def extract_section(content: str, headings: list[str]) -> str:
    lines = [line.rstrip() for line in content.splitlines()]
    capture: list[str] = []
    active = False
    for line in lines:
        lower = line.lower().strip(" :")
        if any(heading in lower for heading in headings):
            active = True
            continue
        if active and len(capture) > 2 and re.match(r"^[A-Z][A-Za-z /&-]{3,40}:?$", line.strip()):
            break
        if active:
            capture.append(line.strip())
        if len(capture) >= 10:
            break
    return normalize_space("\n".join([line for line in capture if line]))[:1600]


def score_job(job: dict[str, Any], profile: dict[str, str]) -> dict[str, Any]:
    content = " ".join([text(job.get(k)) for k in ["title", "location", "remote_type", "salary", "required_skills", "preferred_skills", "responsibilities", "job_description"]]).lower()
    profile_text = " ".join(profile.values()).lower()
    matches = keyword_hits(content, REWARD_KEYWORDS)
    supported = [hit for hit in matches if contains_phrase(profile_text, hit) or hit in REWARD_KEYWORDS]
    penalties = keyword_hits(content, PENALTY_KEYWORDS)
    coding_hits = keyword_hits(content, CODING_RISK_KEYWORDS)
    effort_hits = keyword_hits(content, EFFORT_KEYWORDS)
    skills_score = clamp_int(35 + len(supported) * 6 - len(penalties) * 4, 0, 100)
    role_score = clamp_int(45 + len(keyword_hits(content, ROLE_KEYWORDS)) * 7, 0, 100)
    location_score = 96 if "remote" in content else 94 if "toronto" in content or "gta" in content else 88 if "hybrid" in content else 70
    remote_score = 96 if "remote" in content else 88 if "hybrid" in content else 55 if "on-site" in content or "onsite" in content else 70
    salary_score = score_salary(text(job.get("salary")), content)
    seniority_score = 30 if "senior" in content or re.search(r"\b[5-9]\+ years", content) else 95 if any(term in content for term in ["junior", "intern", "new grad", "entry level"]) else 76
    coding_risk_score = clamp_int(100 - len(coding_hits) * 22, 0, 100)
    effort_score = clamp_int(92 - len(effort_hits) * 12, 0, 100)
    suspicion_penalty = 12 if ((not text(job.get("company")) and not text(job.get("salary"))) or "commission only" in content) else 0
    overall = round(skills_score * 0.24 + role_score * 0.18 + location_score * 0.14 + remote_score * 0.1 + salary_score * 0.1 + seniority_score * 0.1 + coding_risk_score * 0.07 + effort_score * 0.07 - suspicion_penalty)
    return {
        "skills_match_score": skills_score,
        "role_match_score": role_score,
        "location_score": location_score,
        "remote_score": remote_score,
        "salary_score": salary_score,
        "seniority_score": seniority_score,
        "coding_risk_score": coding_risk_score,
        "application_effort_score": effort_score,
        "fit_score": clamp_int(overall, 0, 100),
        "breakdown": {"matched_keywords": matches, "penalty_keywords": penalties, "coding_risk_keywords": coding_hits, "application_effort_flags": effort_hits, "notes": score_notes(matches, penalties, coding_hits, effort_hits, suspicion_penalty)},
    }


def score_salary(salary: str, content: str) -> int:
    if not salary:
        return 55
    lowered = f"{salary} {content}".lower()
    if "unpaid" in lowered or "commission only" in lowered or "commission-only" in lowered:
        return 5
    numbers = [int(num.replace(",", "")) for num in re.findall(r"\$?\s*(\d{2,3}(?:,\d{3})?)", salary)]
    if numbers and max(numbers) < 1000:
        numbers = [number * 1000 for number in numbers]
    if numbers and max(numbers) >= 70000:
        return 90
    if numbers and max(numbers) >= 50000:
        return 75
    return 62


def score_notes(matches: list[str], penalties: list[str], coding_hits: list[str], effort_hits: list[str], suspicion_penalty: int) -> list[str]:
    notes = []
    if matches:
        notes.append(f"Rewarded matches: {', '.join(matches[:8])}")
    if penalties:
        notes.append(f"Penalized risk terms: {', '.join(penalties[:5])}")
    if coding_hits:
        notes.append(f"Coding assessment risk: {', '.join(coding_hits[:5])}")
    if effort_hits:
        notes.append(f"Application effort flags: {', '.join(effort_hits[:5])}")
    if suspicion_penalty:
        notes.append("Penalized vague company or suspicious compensation signals")
    return notes


def generate_application_materials(job: dict[str, Any], profile: dict[str, str]) -> dict[str, Any]:
    profile_text = " ".join(profile.values())
    job_text = " ".join([text(job.get("title")), text(job.get("job_description")), text(job.get("required_skills"))])
    scoring = score_job(job, profile)
    matched = keyword_hits(job_text, REWARD_KEYWORDS)
    supported = [word for word in matched if contains_phrase(profile_text, word)]
    unsupported = [word for word in matched if word not in supported]
    missing_truthful = [word for word in REWARD_KEYWORDS if contains_phrase(profile_text, word) and not contains_phrase(job_text, word)][:8]
    focus = supported[:4] or keyword_hits(profile_text, REWARD_KEYWORDS)[:4] or ["practical software tools"]
    bullets = source_backed_bullets(profile, focus)
    summary = f"Software and cloud-focused developer with practical experience across {', '.join(focus[:4])}. Interested in {text(job.get('title')) or 'the role'} because it connects useful engineering, business workflows, and maintainable internal tools."
    skills_section = ", ".join(dict.fromkeys([*focus, *missing_truthful[:5]]))
    cover_letter = build_cover_letter(profile, job, focus)
    answers = build_answers(profile, job, focus)
    resume_text = f"Suggested summary\n{summary}\n\nSuggested skills section\n{skills_section}\n\nSuggested bullet rewrites\n" + "\n".join([f"- {line}" for line in bullets]) + f"\n\nMissing keywords you can truthfully add\n{', '.join(missing_truthful) or 'None found from saved profile.'}\n\nKeywords not supported by profile\n{', '.join(unsupported) or 'None from the current posting.'}"
    return {"fit_score": scoring["fit_score"], "score_breakdown": scoring, "matched_keywords": matched, "supported_keywords": supported, "missing_keywords": missing_truthful, "unsupported_keywords": unsupported, "summary": summary, "skills_section": skills_section, "resume_bullets": bullets, "resume_text": resume_text, "cover_letter": cover_letter, "short_answers": answers}


def source_backed_bullets(profile: dict[str, str], focus: list[str]) -> list[str]:
    source = normalize_space(" ".join([profile.get("projects", ""), profile.get("work_experience", ""), profile.get("resume_text", "")]))
    snippets = [part.strip(" -") for part in re.split(r"(?<=[.!?])\s+|\n+", source) if len(part.strip()) > 30]
    if not snippets:
        return ["Add project or work-experience detail in Profile first so rewrites stay grounded in your real experience."]
    return [f"Reframe existing experience around {next((item for item in focus if contains_phrase(snippet, item)), focus[0])}: {snippet}" for snippet in snippets[:5]]


def build_cover_letter(profile: dict[str, str], job: dict[str, Any], focus: list[str]) -> str:
    company = text(job.get("company")) or "your team"
    title = text(job.get("title")) or "the role"
    return f"Dear {company} Hiring Team,\n\nI am writing about the {title} role. I like building useful systems that make everyday work clearer and faster. This position stood out because it touches practical work I enjoy: {', '.join(focus[:4])}, business workflows, and tools that help teams move with less friction.\n\nMy saved profile points to hands-on experience with software projects, dashboards, automation, cloud-aware development, APIs, and database-backed applications. I would bring clear communication, readable implementation, and a bias toward tools that solve real operational problems.\n\nThank you for considering my application. I would welcome the chance to discuss how my background fits the work at {company}.\n\nSincerely,\n{profile.get('name', '')}"


def build_answers(profile: dict[str, str], job: dict[str, Any], focus: list[str]) -> list[dict[str, str]]:
    company = text(job.get("company")) or "the company"
    title = text(job.get("title")) or "this role"
    auth = profile.get("work_authorization") or "Yes, I am legally authorized to work in Canada."
    return [
        {"question": "Why are you interested in this role?", "answer": f"I am interested in {title} because it combines {', '.join(focus[:3])} with practical software that supports real users and business workflows."},
        {"question": "Why this company?", "answer": f"{company} stood out because the role appears connected to useful product or internal systems work where reliable execution and clear communication matter."},
        {"question": "Tell us about your relevant experience.", "answer": "My relevant experience includes building software projects with backend logic, frontend interfaces, data persistence, APIs, dashboards, automation, and cloud-oriented deployment thinking."},
        {"question": "Are you legally authorized to work in Canada?", "answer": auth},
        {"question": "What are your salary expectations?", "answer": "I am open to discussing compensation based on the scope of the role, growth expectations, and total package."},
        {"question": "When can you start?", "answer": "I can discuss a start date based on the interview timeline and team needs."},
        {"question": "Anything else you want us to know?", "answer": "I am especially interested in roles where I can build practical tools, learn quickly, and help teams simplify operational work through good software."},
    ]


def answers_to_text(answers: list[dict[str, str]]) -> str:
    return "\n\n".join([f"{item['question']}\n{item['answer']}" for item in answers])


def save_version(job_id: int, kind: str, content: str) -> int:
    cursor = get_db().execute("INSERT INTO generated_versions (job_id, kind, content) VALUES (?, ?, ?)", [job_id, kind, content])
    get_db().commit()
    return int(cursor.lastrowid)


def generate_follow_up(company: str, title: str, date_applied: str) -> str:
    date_line = f" I applied on {date_applied}." if date_applied else ""
    return f"Subject: Following up on {title}\n\nHello {company} Hiring Team,\n\nI hope you are doing well.{date_line} I wanted to follow up on my application for the {title} role and reaffirm my interest. The role looks aligned with my experience building practical software tools, dashboards, automation, cloud-aware applications, and internal systems.\n\nPlease let me know if there is any additional information I can provide.\n\nBest,\n"


def build_dashboard(jobs: list[dict[str, Any]]) -> dict[str, Any]:
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    applied = [job for job in jobs if job["status"] == "Applied"]
    return {
        "jobs_saved": len(jobs),
        "applications_this_week": sum(1 for job in jobs if job["date_applied"] and parse_date(job["date_applied"]) >= week_start),
        "follow_ups_needed": sum(1 for job in applied if job["date_applied"] and parse_date(job["date_applied"]) <= today - timedelta(days=7)),
        "high_fit": sum(1 for job in jobs if int(job["fit_score"] or 0) >= 75),
        "average_fit_score": round(sum(int(job["fit_score"] or 0) for job in jobs) / len(jobs), 1) if jobs else 0,
        "by_role_type": count_by(jobs, "role_type"),
        "by_source": count_by(jobs, "source"),
        "interview_rate": round(sum(1 for job in jobs if job["status"] == "Interview") / len(applied) * 100, 1) if applied else 0,
        "rejection_rate": round(sum(1 for job in jobs if job["status"] == "Rejected") / len(applied) * 100, 1) if applied else 0,
        "missing_salary": sum(1 for job in jobs if not job["salary"]),
        "high_coding_risk": sum(1 for job in jobs if int(job["coding_risk_score"] or 100) < 60),
        "pending": sum(1 for job in jobs if job["status"] in {"Saved", "Drafting", "Applied", "Interview"}),
    }


def count_by(rows: list[dict[str, Any]], field: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        key = text(row.get(field)) or "Unspecified"
        counts[key] = counts.get(key, 0) + 1
    return counts


def fetch_public_page_text(url: str) -> str:
    if not re.match(r"^https?://", url):
        raise ValueError("Only http and https URLs are supported.")
    if any(host in url.lower() for host in ["linkedin.com", "indeed.com"]):
        raise ValueError("Direct scraping of restricted job platforms is intentionally disabled. Paste the job text or import a CSV link instead.")
    request_obj = urllib.request.Request(url, headers={"User-Agent": "LocalJobAssistant/1.0"})
    try:
        with urllib.request.urlopen(request_obj, timeout=8) as response:
            content_type = response.headers.get("Content-Type", "")
            raw = response.read(MAX_FETCH_BYTES)
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ValueError(f"Could not read that public URL: {exc}") from exc
    if "text/html" not in content_type and "text/plain" not in content_type:
        raise ValueError("That URL did not return readable text or HTML.")
    return html_to_text(raw.decode("utf-8", errors="replace"))


def html_to_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", markup)
    markup = re.sub(r"(?i)<br\s*/?>", "\n", markup)
    markup = re.sub(r"(?i)</(p|div|li|h[1-6])>", "\n", markup)
    return normalize_space(html.unescape(re.sub(r"<[^>]+>", " ", markup)))


def source_from_url(url: str) -> str:
    match = re.search(r"https?://(?:www\.)?([^/]+)", url)
    return match.group(1) if match else "Public URL"


def import_csv_jobs(content: str) -> int:
    reader = csv.DictReader(io.StringIO(content))
    imported = 0
    for row in reader:
        if not any(row.values()):
            continue
        payload = {"company": row.get("company") or row.get("Company") or "", "title": row.get("title") or row.get("Title") or "", "location": row.get("location") or row.get("Location") or "", "url": row.get("url") or row.get("URL") or row.get("link") or row.get("Link") or "", "source": row.get("source") or row.get("Source") or "CSV import", "salary": row.get("salary") or row.get("Salary") or "", "job_description": row.get("job_description") or row.get("description") or ""}
        clean = normalize_job_payload(payload)
        get_db().execute(f"INSERT INTO jobs ({', '.join(JOB_COLUMNS.keys())}) VALUES ({', '.join(['?'] * len(JOB_COLUMNS))})", tuple(clean[column] for column in JOB_COLUMNS))
        imported += 1
    get_db().commit()
    return imported


def extract_uploaded_text(filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".txt":
        return content.decode("utf-8", errors="replace")
    if suffix == ".docx":
        return extract_docx_text(content)
    if suffix == ".pdf":
        return extract_pdf_text(content)
    raise ValueError("Supported uploads are .txt, .docx, and basic text-readable .pdf files.")


def extract_docx_text(content: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            xml = archive.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile) as exc:
        raise ValueError("Could not read that .docx file.") from exc
    root = ElementTree.fromstring(xml)
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs = []
    for paragraph in root.iter(f"{namespace}p"):
        texts = [node.text or "" for node in paragraph.iter(f"{namespace}t")]
        if texts:
            paragraphs.append("".join(texts))
    return "\n".join(paragraphs)


def extract_pdf_text(content: bytes) -> str:
    decoded = content.decode("latin-1", errors="ignore")
    chunks = re.findall(r"\(([^()]{2,})\)\s*Tj", decoded) or re.findall(r"\(([^()]{2,})\)", decoded)
    cleaned = "\n".join(html.unescape(chunk.replace("\\n", "\n").replace("\\(", "(").replace("\\)", ")")) for chunk in chunks)
    if not cleaned.strip():
        raise ValueError("Could not extract text from this PDF. Paste the resume text manually instead.")
    return cleaned


def download_response(content: str, filename: str, mimetype: str) -> Response:
    return Response(content, mimetype=mimetype, headers={"Content-Disposition": f"attachment; filename={filename}"})


def make_docx(content: str) -> bytes:
    paragraphs = "".join(f"<w:p><w:r><w:t xml:space=\"preserve\">{html.escape(line)}</w:t></w:r></w:p>" for line in content.splitlines())
    document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paragraphs + "</w:body></w:document>"
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", DOCX_CONTENT_TYPES)
        archive.writestr("_rels/.rels", DOCX_RELS)
        archive.writestr("word/document.xml", document)
    return output.getvalue()


DOCX_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

DOCX_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""


app = create_app()


if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)
