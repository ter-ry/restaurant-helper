from __future__ import annotations

import io
import json
import mimetypes
import os
import re
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError

OCR_ENDPOINT = os.environ.get("OCR_SPACE_ENDPOINT", "https://api.ocr.space/parse/image")
OCR_API_KEY = os.environ.get("OCR_SPACE_API_KEY", "")
OCR_LANGUAGE = os.environ.get("OCR_SPACE_LANGUAGE", "eng")
OCR_ENGINE = os.environ.get("OCR_SPACE_ENGINE", "2")
OCR_TIMEOUT_SECONDS = float(os.environ.get("OCR_SPACE_TIMEOUT", "90"))

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".pdf"}
SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}


class InvoiceOCRFailure(RuntimeError):
    pass


@dataclass
class FieldResult:
    value: Any
    confidence: float
    needs_review: bool
    evidence: str = ""


def is_supported_invoice_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in SUPPORTED_EXTENSIONS


def _normalize_file_for_ocr(filename: str, content: bytes, content_type: str = "") -> tuple[bytes, str, str]:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise InvoiceOCRFailure(f"Unsupported invoice file type: {ext or 'unknown'}")

    if ext == ".pdf":
        return content, "application/pdf", "PDF"

    if ext in SUPPORTED_IMAGE_EXTENSIONS:
        try:
            with Image.open(io.BytesIO(content)) as image:
                image.load()
                if image.mode not in {"RGB", "L"}:
                    image = image.convert("RGB")
                output = io.BytesIO()
                image.save(output, format="PNG" if ext == ".webp" else (image.format or "PNG"))
                normalized_content = output.getvalue()
                normalized_type = "image/png" if ext == ".webp" else (content_type or mimetypes.guess_type(filename)[0] or "image/png")
                return normalized_content, normalized_type, "PNG" if ext == ".webp" else (Path(filename).suffix.lstrip(".").upper() or "PNG")
        except UnidentifiedImageError as exc:
            raise InvoiceOCRFailure("The uploaded image could not be read. Try a clearer JPG, PNG, or WEBP invoice photo.") from exc

    raise InvoiceOCRFailure(f"Unsupported invoice file type: {ext}")


def _build_multipart_body(fields: dict[str, str], file_field_name: str, filename: str, file_content: bytes, content_type: str) -> tuple[bytes, str]:
    boundary = f"----Flowtally{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    def add_part(name: str, value: str) -> None:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(value.encode("utf-8"))
        chunks.append(b"\r\n")

    for key, value in fields.items():
        add_part(key, value)

    chunks.append(f"--{boundary}\r\n".encode("utf-8"))
    chunks.append(
        (
            f'Content-Disposition: form-data; name="{file_field_name}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type or 'application/octet-stream'}\r\n\r\n"
        ).encode("utf-8")
    )
    chunks.append(file_content)
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _post_ocr_space(filename: str, content: bytes, content_type: str = "") -> dict[str, Any]:
    if not OCR_API_KEY or OCR_API_KEY.strip().lower() == "helloworld":
        raise InvoiceOCRFailure("OCR_SPACE_API_KEY is not configured on the server.")
    normalized_content, normalized_content_type, filetype = _normalize_file_for_ocr(filename, content, content_type)
    payload, multipart_type = _build_multipart_body(
        {
            "apikey": OCR_API_KEY,
            "language": OCR_LANGUAGE,
            "OCREngine": OCR_ENGINE,
            "detectOrientation": "true",
            "scale": "true",
            "isTable": "true",
            "isOverlayRequired": "false",
            "filetype": filetype,
        },
        "file",
        Path(filename).name,
        normalized_content,
        normalized_content_type,
    )

    request = urllib.request.Request(
        OCR_ENDPOINT,
        data=payload,
        headers={
            "Content-Type": multipart_type,
            "Accept": "application/json",
            "User-Agent": "Flowtally/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=OCR_TIMEOUT_SECONDS) as response:
            response_body = response.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as exc:
        raise InvoiceOCRFailure(f"OCR service request failed: {exc.reason if hasattr(exc, 'reason') else exc}") from exc

    try:
        data = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise InvoiceOCRFailure("OCR service returned an unreadable response.") from exc

    if data.get("IsErroredOnProcessing"):
        error_message = data.get("ErrorMessage") or data.get("ErrorDetails") or "OCR service could not process the invoice."
        if isinstance(error_message, list):
            error_message = "; ".join(str(item) for item in error_message)
        raise InvoiceOCRFailure(str(error_message))

    return data


def extract_invoice_document(filename: str, content: bytes, content_type: str = "") -> dict[str, Any]:
    ocr_response = _post_ocr_space(filename, content, content_type)
    raw_text = "\n".join(
        text.strip()
        for text in (
            parsed.get("ParsedText", "")
            for parsed in ocr_response.get("ParsedResults", [])
            if isinstance(parsed, dict)
        )
        if text.strip()
    ).strip()

    if not raw_text:
        raise InvoiceOCRFailure("OCR completed, but no readable text was extracted. Try a clearer photo or a cleaner PDF scan.")

    parsed = parse_invoice_text(raw_text)
    parsed.update(
        {
            "provider": "ocr.space",
            "fileName": Path(filename).name,
            "contentType": content_type or mimetypes.guess_type(filename)[0] or "",
            "ocrExitCode": ocr_response.get("OCRExitCode"),
            "isParsed": bool(raw_text.strip()),
        }
    )
    return parsed


def parse_invoice_text(raw_text: str) -> dict[str, Any]:
    lines = [normalize_space(line) for line in raw_text.splitlines()]
    lines = [line for line in lines if line]
    supplier = guess_supplier(lines)
    invoice_date = find_date(lines)
    invoice_number = find_invoice_number(lines)
    subtotal = find_amount(lines, ["subtotal", "sub total", "sub-total"])
    tax = find_amount(lines, ["tax", "gst", "hst", "vat", "sales tax", "iva"])
    total = find_total(lines)
    line_items = extract_line_items(lines)

    if not subtotal.value and total.value and tax.value:
        subtotal = FieldResult(round(float(total.value) - float(tax.value), 2), 0.45, True, "Subtotal was inferred from total minus tax.")

    warnings = build_warnings(supplier, invoice_date, invoice_number, subtotal, tax, total, line_items)
    confidence_values = [field.confidence for field in [supplier, invoice_date, invoice_number, subtotal, tax, total] if field.value not in (None, "", 0)]
    if line_items:
        confidence_values.extend(item["confidence"] for item in line_items)
    overall_confidence = round(sum(confidence_values) / len(confidence_values), 2) if confidence_values else 0.0
    needs_review = any(field.needs_review for field in [supplier, invoice_date, invoice_number, subtotal, tax, total]) or any(item["needsReview"] for item in line_items)

    return {
        "rawText": raw_text,
        "fields": {
            "supplier": field_to_json(supplier),
            "invoiceDate": field_to_json(invoice_date),
            "invoiceNumber": field_to_json(invoice_number),
            "subtotal": field_to_json(subtotal),
            "tax": field_to_json(tax),
            "total": field_to_json(total),
        },
        "lineItems": line_items,
        "warnings": warnings,
        "overallConfidence": overall_confidence,
        "needsReview": needs_review,
    }


def field_to_json(field: FieldResult) -> dict[str, Any]:
    return {
        "value": field.value,
        "confidence": round(float(field.confidence), 2),
        "needsReview": bool(field.needs_review),
        "evidence": field.evidence,
    }


def build_warnings(
    supplier: FieldResult,
    invoice_date: FieldResult,
    invoice_number: FieldResult,
    subtotal: FieldResult,
    tax: FieldResult,
    total: FieldResult,
    line_items: list[dict[str, Any]],
) -> list[str]:
    warnings: list[str] = []
    if supplier.needs_review:
        warnings.append("Supplier name was uncertain and should be confirmed.")
    if invoice_date.needs_review:
        warnings.append("Invoice date was uncertain and should be confirmed.")
    if invoice_number.needs_review:
        warnings.append("Invoice number was uncertain and should be confirmed.")
    if subtotal.needs_review:
        warnings.append("Subtotal was inferred or uncertain.")
    if tax.needs_review:
        warnings.append("Tax amount was inferred or uncertain.")
    if total.needs_review:
        warnings.append("Total amount was inferred or uncertain.")
    if not line_items:
        warnings.append("No line items were confidently extracted.")
    return warnings


def guess_supplier(lines: list[str]) -> FieldResult:
    if not lines:
        return FieldResult("", 0.0, True, "No text lines were available.")

    label_patterns = [
        re.compile(r"^(?:supplier|vendor|from)\s*[:\-]\s*(.+)$", re.I),
        re.compile(r"^(?:bill to|sold by)\s*[:\-]\s*(.+)$", re.I),
    ]
    generic_skip = {"invoice", "tax invoice", "receipt", "bill", "statement", "purchase order"}

    for line in lines[:12]:
        for pattern in label_patterns:
            match = pattern.match(line)
            if match:
                value = clean_supplier_name(match.group(1))
                if value:
                    return FieldResult(value, 0.97, False, line)

    for line in lines[:8]:
        lowered = line.lower()
        if lowered in generic_skip:
            continue
        if any(keyword in lowered for keyword in ["invoice", "total", "subtotal", "tax", "date", "number", "phone", "email", "address"]):
            continue
        if len(line) >= 3 and len(line) <= 80 and any(ch.isalpha() for ch in line):
            value = clean_supplier_name(line)
            if value:
                return FieldResult(value, 0.72, True, line)

    return FieldResult("", 0.0, True, "Supplier not found.")


def clean_supplier_name(value: str) -> str:
    cleaned = normalize_space(value)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip(" -:;")


def find_invoice_number(lines: list[str]) -> FieldResult:
    patterns = [
        re.compile(r"invoice\s*(?:number|no\.?|#|id)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)", re.I),
        re.compile(r"inv\s*(?:no\.?|#|id)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)", re.I),
        re.compile(r"bill\s*(?:no\.?|#|id)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]+)", re.I),
    ]
    for line in lines:
        for pattern in patterns:
            match = pattern.search(line)
            if match:
                return FieldResult(match.group(1).strip(), 0.95, False, line)

    for line in lines[:12]:
        if re.search(r"\b(?:inv|invoice|bill)[\s#:-]*[A-Z0-9\-\/]{4,}\b", line, re.I):
            guess = re.sub(r"^(?:invoice|inv|bill)[\s#:-]*", "", line, flags=re.I).strip()
            if guess:
                return FieldResult(guess[:30], 0.65, True, line)

    return FieldResult("", 0.0, True, "Invoice number not found.")


def find_date(lines: list[str]) -> FieldResult:
    label_patterns = [
        re.compile(r"(?:invoice\s*date|date)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})", re.I),
        re.compile(r"(?:invoice\s*date|date)\s*[:\-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})", re.I),
    ]
    for line in lines:
        for pattern in label_patterns:
            match = pattern.search(line)
            if match:
                parsed = parse_date_string(match.group(1))
                if parsed:
                    return FieldResult(parsed, 0.96, False, line)

    for line in lines[:20]:
        candidate = parse_date_from_line(line)
        if candidate:
            return FieldResult(candidate, 0.74, True, line)

    return FieldResult("", 0.0, True, "Invoice date not found.")


def parse_date_from_line(line: str) -> str:
    match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", line)
    if match:
        return match.group(1)
    match = re.search(r"\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b", line)
    if match:
        return parse_date_string(match.group(1))
    return ""


def parse_date_string(value: str) -> str:
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            return value
        parts = re.split(r"[\/.-]", value)
        if len(parts) != 3:
            return ""
        first, second, third = (int(parts[0]), int(parts[1]), int(parts[2]))
        year = third if len(parts[2]) == 4 else 2000 + third
        month = second if first > 12 else first
        day = first if first > 12 else second
        parsed = datetime(year, month, day)
        return parsed.date().isoformat()
    except ValueError:
        return ""


def find_amount(lines: list[str], labels: list[str]) -> FieldResult:
    for line in lines:
        lowered = line.lower()
        if any(label in lowered for label in labels):
            amount = extract_last_amount(line)
            if amount is not None:
                return FieldResult(amount, 0.95, False, line)
    return FieldResult(0.0, 0.0, True, f"Missing {'/'.join(labels)}")


def find_total(lines: list[str]) -> FieldResult:
    priority_labels = ["grand total", "invoice total", "amount due", "balance due", "total due", "total"]
    for line in reversed(lines):
        lowered = line.lower()
        if any(label in lowered for label in priority_labels):
            amount = extract_last_amount(line)
            if amount is not None:
                confidence = 0.96 if any(label != "total" and label in lowered for label in priority_labels) else 0.9
                return FieldResult(amount, confidence, False, line)

    amounts = [amount for line in lines for amount in extract_all_amounts(line)]
    if amounts:
        largest = max(amounts)
        return FieldResult(largest, 0.42, True, "Total inferred from the largest amount on the invoice.")
    return FieldResult(0.0, 0.0, True, "Total not found.")


def extract_last_amount(line: str) -> float | None:
    matches = extract_all_amounts(line)
    return matches[-1] if matches else None


def extract_all_amounts(line: str) -> list[float]:
    return [parse_money(value) for value in re.findall(r"\$?\s*([0-9][0-9,]*(?:\.\d{2})?)", line)]


def parse_money(value: str) -> float:
    return float(value.replace(",", ""))


def extract_line_items(lines: list[str]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for line in lines:
        if is_summary_line(line):
            continue
        amounts = extract_all_amounts(line)
        if not amounts:
            continue
        item = parse_line_item(line, amounts)
        if item:
            items.append(item)

    deduped: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for item in items:
        key = item["comparisonKey"]
        if key not in seen_keys:
            deduped.append(item)
            seen_keys.add(key)
    return deduped


def is_summary_line(line: str) -> bool:
    return bool(re.search(r"\b(subtotal|tax|hst|gst|vat|total|balance due|amount due|invoice total|grand total)\b", line, re.I))


def parse_line_item(line: str, amounts: list[float]) -> dict[str, Any] | None:
    text_part = strip_line_item_noise(line)
    if len(text_part) < 2:
        return None

    quantity, quantity_confidence = parse_quantity(line)
    unit = parse_unit(line)
    line_total = round(amounts[-1], 2)
    unit_price = round(amounts[-2], 2) if len(amounts) >= 2 else round(line_total / quantity, 2) if quantity else line_total
    if quantity and len(amounts) >= 2 and quantity > 0:
        unit_price = round(amounts[-2], 2)

    if quantity and len(amounts) == 1 and quantity > 1:
        unit_price = round(line_total / quantity, 2)

    confidence = 0.55
    if quantity_confidence > 0:
        confidence += 0.12
    if len(amounts) >= 2:
        confidence += 0.18
    if unit and unit != "each":
        confidence += 0.05
    if len(text_part) > 8:
        confidence += 0.08
    confidence = min(confidence, 0.96)
    needs_review = confidence < 0.82 or not unit_price or not line_total

    return {
        "originalDescription": normalize_space(line),
        "comparisonKey": normalize_item_comparison_key(text_part),
        "itemName": text_part,
        "quantity": quantity or 1,
        "unit": unit or "each",
        "unitPrice": unit_price,
        "lineTotal": line_total,
        "confidence": round(confidence, 2),
        "needsReview": needs_review,
    }


def strip_line_item_noise(line: str) -> str:
    text = re.sub(r"\b(?:qty|quantity)\s*[:\-]?\s*\d+(?:\.\d+)?\b", " ", line, flags=re.I)
    text = re.sub(r"\b\d+(?:\.\d+)?\s*(?:x|X|@)\b", " ", text)
    text = re.sub(r"\$?\s*[0-9][0-9,]*(?:\.\d{2})?", " ", text)
    text = re.sub(r"\b(?:subtotal|tax|gst|hst|vat|balance|due|invoice|amount|paid|total)\b", " ", text, flags=re.I)
    text = re.sub(r"[|·•×]", " ", text)
    text = normalize_space(text)
    return text.strip(" -:;")


def parse_quantity(line: str) -> tuple[float, float]:
    match = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:x|X|@)\b", line)
    if match:
        return float(match.group(1)), 0.9
    match = re.search(r"\bqty\s*[:\-]?\s*(\d+(?:\.\d+)?)\b", line, re.I)
    if match:
        return float(match.group(1)), 0.92
    return 1.0, 0.0


def parse_unit(line: str) -> str:
    lowered = line.lower()
    if any(unit in lowered for unit in ["case", "cs"]):
        return "case"
    if any(unit in lowered for unit in ["dozen", "dz"]):
        return "dozen"
    if any(unit in lowered for unit in ["kg", "kilogram"]):
        return "kg"
    if any(unit in lowered for unit in [" g ", " gram"]):
        return "g"
    if any(unit in lowered for unit in ["lb", "pound"]):
        return "lb"
    if any(unit in lowered for unit in ["litre", "liter", " l "]):
        return "L"
    if "ml" in lowered:
        return "mL"
    if any(unit in lowered for unit in ["box", "bx"]):
        return "box"
    return "each"


def normalize_item_comparison_key(description: str) -> str:
    normalized = normalize_space(description).lower()
    normalized = re.sub(r"\b(?:qty|quantity|x|case|cs|pack|pkg)\b", " ", normalized)
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    normalized = normalize_space(normalized)
    return normalized


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()
