import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import app as app_module
from reconciliation_ocr import extract_reconciliation_document, is_supported_reconciliation_file, parse_reconciliation_text


def make_image_bytes(format_name: str = "PNG") -> bytes:
    image = Image.new("RGB", (240, 160), color="white")
    buffer = io.BytesIO()
    image.save(buffer, format=format_name)
    return buffer.getvalue()


class ReconciliationOcrTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        app_module.DATA_DIR = Path(self.tmpdir.name)
        app_module.DB_PATH = app_module.DATA_DIR / "test.sqlite"
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_supported_upload_types(self):
        self.assertTrue(is_supported_reconciliation_file("uber.csv"))
        self.assertTrue(is_supported_reconciliation_file("uber.pdf"))
        self.assertTrue(is_supported_reconciliation_file("uber.jpg"))
        self.assertTrue(is_supported_reconciliation_file("uber.png"))
        self.assertFalse(is_supported_reconciliation_file("uber.txt"))

    def test_parse_uber_eats_fixture(self):
        raw_text = """
        Uber Eats Daily Summary
        Business Date 2026-06-14
        Orders 18
        Gross Sales 245.50
        Discounts -12.00
        Refunds -5.00
        Tax 31.00
        Tips 18.25
        Fees 42.10
        Net Sales 227.15
        Payout 220.25
        """
        parsed = parse_reconciliation_text(raw_text, "uber_eats")
        self.assertEqual(parsed["fields"]["businessDate"]["value"], "2026-06-14")
        self.assertEqual(parsed["fields"]["orderCount"]["value"], 18)
        self.assertEqual(parsed["fields"]["grossSales"]["value"], 245.5)
        self.assertEqual(parsed["fields"]["netSalesOrPayout"]["value"], 227.15)
        self.assertEqual(parsed["fields"]["suggestedAmountType"]["value"], "netSalesOrPayout")

    def test_parse_pos_and_card_fixtures(self):
        pos_text = """
        POS Close Report
        Report Date 2026-06-14
        Expected POS Sales Total 3278.44
        """
        card_text = """
        Card Processor Settlement
        Batch Date 2026-06-14
        Card Batch Total 2588.80
        """
        pos_parsed = parse_reconciliation_text(pos_text, "pos")
        card_parsed = parse_reconciliation_text(card_text, "card")
        self.assertEqual(pos_parsed["fields"]["suggestedAmount"]["value"], 3278.44)
        self.assertEqual(card_parsed["fields"]["suggestedAmount"]["value"], 2588.8)
        self.assertEqual(card_parsed["fields"]["suggestedAmountType"]["value"], "cardBatchTotal")

    def test_csv_upload_and_image_upload_route(self):
        csv_data = (
            "Business Date,Orders,Gross Sales,Net Sales,Payout\n"
            "2026-06-14,18,245.50,227.15,220.25\n"
        ).encode("utf-8")
        csv_response = self.client.post(
            "/api/reconciliation/extract",
            data={"file": (io.BytesIO(csv_data), "ubereats.csv"), "source": "uber_eats"},
            content_type="multipart/form-data",
        )
        self.assertEqual(csv_response.status_code, 200)
        csv_body = csv_response.get_json()
        self.assertEqual(csv_body["fields"]["businessDate"]["value"], "2026-06-14")
        self.assertEqual(csv_body["fields"]["suggestedAmount"]["value"], 227.15)

        ocr_response = {
            "OCRExitCode": 1,
            "ParsedResults": [
                {
                    "ParsedText": "DoorDash Summary\nBusiness Date 2026-06-14\nOrders 12\nGross Sales 182.30\nNet Sales 171.10\nPayout 166.55\n",
                }
            ],
        }
        with patch("reconciliation_ocr.extract_invoice_document", return_value={"rawText": ocr_response["ParsedResults"][0]["ParsedText"], "provider": "ocr.space"}):
            image_response = self.client.post(
                "/api/reconciliation/extract",
                data={"file": (io.BytesIO(make_image_bytes("PNG")), "doordash.png"), "source": "doordash"},
                content_type="multipart/form-data",
            )
        self.assertEqual(image_response.status_code, 200)
        image_body = image_response.get_json()
        self.assertEqual(image_body["fields"]["orderCount"]["value"], 12)
        self.assertEqual(image_body["fields"]["suggestedAmount"]["value"], 171.1)

    def test_malformed_file_rejected(self):
        response = self.client.post(
            "/api/reconciliation/extract",
            data={"file": (io.BytesIO(b"bad"), "report.txt"), "source": "uber_eats"},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
