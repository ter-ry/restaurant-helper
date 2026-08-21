from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from invoice_ocr import InvoiceOCRFailure, extract_invoice_document, parse_date_string, normalize_space

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".pdf", ".csv"}
SOURCE_LABELS = {
    "uber_eats": "Uber Eats",
    "doordash": "DoorDash",
    "skip": "Skip",
    "pos": "POS sales report",
    "card": "Card/payment processor",
    "cash": "Cash close record",
}


@dataclass
class FieldResult:
    value: Any
    confidence: float
    needs_review: bool
    evidence: str


def is_supported_reconciliation_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in SUPPORTED_EXTENSIONS


def extract_reconciliation_document(filename: str, content: bytes, content_type: str, source_key: str) -> dict[str, Any]:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise InvoiceOCRFailure(f"Unsupported reconciliation file type: {ext or 'unknown'}")

    if ext == ".csv":
        raw_text = content.decode("utf-8-sig", errors="replace")
        parsed = parse_reconciliation_text(raw_text, source_key, csv_text=raw_text)
        provider = "csv"
    else:
        invoice_result = extract_invoice_document(filename, content, content_type)
        raw_text = invoice_result["rawText"]
        parsed = parse_reconciliation_text(raw_text, source_key)
        provider = invoice_result.get("provider", "ocr.space")

    parsed.update(
        {
            "provider": provider,
            "fileName": Path(filename).name,
            "contentType": content_type or "",
            "sourceKey": source_key,
            "sourceLabel": SOURCE_LABELS.get(source_key, source_key),
            "rawText": raw_text,
        }
    )
    return parsed


def parse_reconciliation_text(raw_text: str, source_key: str, csv_text: str | None = None) -> dict[str, Any]:
    lines = [normalize_space(line) for line in raw_text.splitlines() if normalize_space(line)]
    csv_lines = []
    if csv_text:
        csv_lines = csv_to_labeled_lines(csv_text)
    all_lines = [*csv_lines, *lines]

    business_date = find_date(all_lines)
    order_count = find_count(all_lines, ["order count", "orders", "transactions", "tickets"])
    gross_sales = find_amount(all_lines, ["gross sales", "gross", "sales gross"])
    discounts = find_amount(all_lines, ["discounts", "promotions", "promo", "voucher"])
    refunds = find_amount(all_lines, ["refunds", "cancellations", "chargebacks"])
    tax = find_amount(all_lines, ["tax", "hst", "gst", "vat"])
    tips = find_amount(all_lines, ["tips", "gratuity"])
    fees = find_amount(all_lines, ["fees", "commission", "service fee", "delivery fee"])
    net_sales_or_payout = find_amount(all_lines, ["net sales", "net payout", "payout", "deposit", "net amount"])
    card_batch_total = find_amount(all_lines, ["card batch total", "batch total", "batch payout", "settlement total", "card total"])
    pos_expected_sales = find_amount(all_lines, ["expected pos sales total", "expected sales total", "pos expected sales", "sales total", "total sales", "net sales"])
    cash_total = find_amount(all_lines, ["cash close", "cash total", "cash count", "drawer total"])

    if source_key == "pos":
        suggested_amount = pos_expected_sales if pos_expected_sales.value else gross_sales
        suggested_amount_type = "posExpectedSales"
    elif source_key == "card":
        suggested_amount = card_batch_total if card_batch_total.value else net_sales_or_payout
        suggested_amount_type = "cardBatchTotal"
    elif source_key == "cash":
        suggested_amount = cash_total
        suggested_amount_type = "cashCount"
    else:
        suggested_amount = net_sales_or_payout if net_sales_or_payout.value else gross_sales
        suggested_amount_type = "netSalesOrPayout" if net_sales_or_payout.value else "grossSales"

    fields = {
        "businessDate": field_to_json(business_date),
        "platform": field_to_json(FieldResult(SOURCE_LABELS.get(source_key, source_key), 1.0, False, SOURCE_LABELS.get(source_key, source_key))),
        "orderCount": field_to_json(order_count),
        "grossSales": field_to_json(gross_sales),
        "discounts": field_to_json(discounts),
        "refunds": field_to_json(refunds),
        "tax": field_to_json(tax),
        "tips": field_to_json(tips),
        "fees": field_to_json(fees),
        "netSalesOrPayout": field_to_json(net_sales_or_payout),
        "cardBatchTotal": field_to_json(card_batch_total),
        "posExpectedSales": field_to_json(pos_expected_sales),
        "cashCount": field_to_json(cash_total),
        "suggestedAmount": field_to_json(suggested_amount),
        "suggestedAmountType": field_to_json(FieldResult(suggested_amount_type, 1.0 if suggested_amount.value else 0.4, not bool(suggested_amount.value), suggested_amount_type)),
    }

    warnings = build_warnings(source_key, fields)
    confidence_values = [field["confidence"] for field in fields.values() if field["value"] not in (None, "", 0)]
    overall_confidence = round(sum(confidence_values) / len(confidence_values), 2) if confidence_values else 0.0
    needs_review = any(field["needsReview"] for field in fields.values()) or not bool(suggested_amount.value)

    return {
        "fields": fields,
        "warnings": warnings,
        "overallConfidence": overall_confidence,
        "needsReview": needs_review,
    }


def build_warnings(source_key: str, fields: dict[str, dict[str, Any]]) -> list[str]:
    warnings: list[str] = []
    if not fields["businessDate"]["value"]:
        warnings.append("Business date was not confidently extracted.")
    if not fields["suggestedAmount"]["value"]:
        warnings.append("A clear reconciliation amount was not found.")
    if source_key in {"uber_eats", "doordash", "skip"}:
        if not fields["netSalesOrPayout"]["value"] and not fields["grossSales"]["value"]:
            warnings.append("Gross sales or payout was not clearly identified.")
    if source_key == "card" and not fields["cardBatchTotal"]["value"]:
        warnings.append("Card batch total was not clearly identified.")
    if source_key == "pos" and not fields["posExpectedSales"]["value"]:
        warnings.append("POS expected sales total was not clearly identified.")
    if source_key == "cash" and not fields["cashCount"]["value"]:
        warnings.append("Cash close amount was not clearly identified.")
    return warnings


def field_to_json(field: FieldResult) -> dict[str, Any]:
    return {
        "value": field.value,
        "confidence": round(float(field.confidence), 2),
        "needsReview": bool(field.needs_review),
        "evidence": field.evidence,
    }


def find_date(lines: list[str]) -> FieldResult:
    patterns = [
        re.compile(r"(?:business\s*date|report\s*date|date|batch\s*date|close\s*date)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})", re.I),
        re.compile(r"(?:business\s*date|report\s*date|date|batch\s*date|close\s*date)\s*[:\-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})", re.I),
    ]
    for line in lines:
        for pattern in patterns:
            match = pattern.search(line)
            if match:
                parsed = parse_date_string(match.group(1))
                if parsed:
                    return FieldResult(parsed, 0.96, False, line)

    for line in lines:
        candidate = parse_date_from_line(line)
        if candidate:
            return FieldResult(candidate, 0.72, True, line)

    return FieldResult("", 0.0, True, "Business date not found.")


def parse_date_from_line(line: str) -> str:
    match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", line)
    if match:
        return match.group(1)
    match = re.search(r"\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b", line)
    if match:
        return parse_date_string(match.group(1))
    return ""


def find_count(lines: list[str], labels: list[str]) -> FieldResult:
    for line in lines:
        lowered = line.lower()
        if any(label in lowered for label in labels):
            match = re.search(r"\b(\d{1,6})\b", line)
            if match:
                return FieldResult(int(match.group(1)), 0.9, False, line)
    return FieldResult(0, 0.0, True, "Order count not found.")


def find_amount(lines: list[str], labels: list[str]) -> FieldResult:
    for line in lines:
        lowered = line.lower()
        if any(label in lowered for label in labels):
            amount = extract_last_amount(line)
            if amount is not None:
                confidence = 0.95 if any(label != "sales total" for label in labels if label in lowered) else 0.8
                return FieldResult(amount, confidence, False, line)
    return FieldResult(0.0, 0.0, True, f"Missing {'/'.join(labels)}")


def extract_last_amount(line: str) -> float | None:
    matches = extract_all_amounts(line)
    return matches[-1] if matches else None


def extract_all_amounts(line: str) -> list[float]:
    values: list[float] = []
    for value in re.findall(r"(-?)\$?\s*([0-9][0-9,]*(?:\.\d{2})?)", line):
        sign = -1 if value[0] == "-" else 1
        values.append(sign * float(value[1].replace(",", "")))
    return values


def csv_to_labeled_lines(csv_text: str) -> list[str]:
    try:
        reader = csv.DictReader(io.StringIO(csv_text))
    except csv.Error:
        return []

    rows: list[str] = []
    for row in reader:
        for key, value in row.items():
            if normalize_space(value or ""):
                rows.append(f"{normalize_space(key)}: {normalize_space(value)}")
    return rows
