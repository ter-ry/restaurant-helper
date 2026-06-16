import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import app as app_module
from invoice_ocr import InvoiceOCRFailure, _normalize_file_for_ocr, extract_invoice_document, is_supported_invoice_file, parse_invoice_text


def make_image_bytes(format_name: str, rotate: bool = False) -> bytes:
    image = Image.new("RGB", (240, 160), color="white")
    if rotate:
        image = image.rotate(90, expand=True)
    buffer = io.BytesIO()
    image.save(buffer, format=format_name)
    return buffer.getvalue()


class InvoiceOcrTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        app_module.DATA_DIR = Path(self.tmpdir.name)
        app_module.DB_PATH = app_module.DATA_DIR / "test.sqlite"
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_supported_upload_types(self):
        self.assertTrue(is_supported_invoice_file("invoice.jpg"))
        self.assertTrue(is_supported_invoice_file("invoice.jpeg"))
        self.assertTrue(is_supported_invoice_file("invoice.png"))
        self.assertTrue(is_supported_invoice_file("invoice.webp"))
        self.assertTrue(is_supported_invoice_file("invoice.pdf"))
        self.assertFalse(is_supported_invoice_file("invoice.txt"))

        for filename, format_name in [("invoice.jpg", "JPEG"), ("invoice.png", "PNG"), ("invoice.webp", "PNG")]:
            normalized_content, normalized_type, mode = _normalize_file_for_ocr(filename, make_image_bytes(format_name))
            self.assertTrue(normalized_content)
            self.assertTrue(normalized_type.startswith("image/"))
            self.assertIn(mode, {"JPG", "JPEG", "PNG", "WEBP"})

    def test_parse_clean_pdf_fixture(self):
        raw_text = """
        Northside Foods Ltd.
        Invoice No: NF-1001
        Invoice Date: 2026-06-10
        Flour 10 x 12.50 125.00
        Tomato Sauce 6 x 8.00 48.00
        Subtotal 173.00
        Tax 22.49
        Total 195.49
        """
        parsed = parse_invoice_text(raw_text)
        self.assertEqual(parsed["fields"]["supplier"]["value"], "Northside Foods Ltd.")
        self.assertEqual(parsed["fields"]["invoiceNumber"]["value"], "NF-1001")
        self.assertEqual(parsed["fields"]["invoiceDate"]["value"], "2026-06-10")
        self.assertEqual(parsed["fields"]["tax"]["value"], 22.49)
        self.assertEqual(parsed["fields"]["total"]["value"], 195.49)
        self.assertGreaterEqual(len(parsed["lineItems"]), 2)

    def test_parse_photographed_invoice_fixture(self):
        raw_text = """
        RIVERSIDE PRODUCE
        inv # RP-7813
        date 06/10/2026
        Lettuce 3 x 9.25 27.75
        Cucumber 4 x 4.50 18.00
        subtotal 45.75
        tax 5.95
        total due 51.70
        """
        parsed = parse_invoice_text(raw_text)
        self.assertEqual(parsed["fields"]["supplier"]["value"], "RIVERSIDE PRODUCE")
        self.assertEqual(parsed["fields"]["invoiceNumber"]["value"], "RP-7813")
        self.assertEqual(parsed["fields"]["invoiceDate"]["value"], "2026-06-10")
        self.assertEqual(parsed["fields"]["subtotal"]["value"], 45.75)
        self.assertEqual(parsed["fields"]["total"]["value"], 51.7)

    def test_parse_low_quality_rotated_fixture(self):
        raw_text = """
        BAKERY SUPPLY
        invoice no: BS-2044
        date: 2026-06-12
        croissant 12.00
        butter 2 x 14.00 28.00
        gst 3.64
        total 43.64
        """
        parsed = parse_invoice_text(raw_text)
        self.assertEqual(parsed["fields"]["invoiceNumber"]["value"], "BS-2044")
        self.assertEqual(parsed["fields"]["tax"]["value"], 3.64)
        self.assertEqual(parsed["fields"]["total"]["value"], 43.64)

    def test_parse_invoice_with_tax_and_several_line_items(self):
        raw_text = """
        Harvest Wholesale
        Invoice: HW-9002
        Invoice Date: 2026-06-14
        Rice 2 x 34.00 68.00
        Beans 3 x 12.00 36.00
        Oil 1 x 24.50 24.50
        HST 16.97
        Grand Total 145.47
        """
        parsed = parse_invoice_text(raw_text)
        self.assertEqual(parsed["fields"]["tax"]["value"], 16.97)
        self.assertEqual(parsed["fields"]["total"]["value"], 145.47)
        self.assertGreaterEqual(len(parsed["lineItems"]), 3)

    def test_extract_invoice_document_uses_ocr_response(self):
        ocr_response = {
            "OCRExitCode": 1,
            "ParsedResults": [
                {
                    "ParsedText": "Northside Foods Ltd.\nInvoice No: NF-1001\nInvoice Date: 2026-06-10\nTotal 195.49\n",
                }
            ],
        }

        with patch("invoice_ocr._post_ocr_space", return_value=ocr_response):
            parsed = extract_invoice_document("invoice.pdf", b"%PDF-1.4", "application/pdf")

        self.assertEqual(parsed["provider"], "ocr.space")
        self.assertEqual(parsed["fields"]["total"]["value"], 195.49)
        self.assertEqual(parsed["fields"]["supplier"]["value"], "Northside Foods Ltd.")

    def test_invoice_route_failure_state(self):
        with patch("app.extract_invoice_document", side_effect=InvoiceOCRFailure("OCR service could not process the invoice.")):
            response = self.client.post(
                "/api/invoices/ocr",
                data={"file": (io.BytesIO(b"bad"), "invoice.pdf")},
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 422)
        self.assertIn("OCR service could not process the invoice.", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
