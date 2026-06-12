import tempfile
import unittest
from pathlib import Path

import app as app_module
from sources.jobspy_source import fetch_jobspy_jobs, normalize_jobspy_row


class JobSpyIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        app_module.DATA_DIR = Path(self.tmpdir.name)
        app_module.DB_PATH = app_module.DATA_DIR / "test.sqlite"
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_jobspy_row_normalization_and_missing_fields(self):
        normalized = normalize_jobspy_row({"title": "Junior Software Developer", "company": "Acme", "location": "Toronto, ON", "job_url": "https://example.com/job?x=1", "min_amount": 70000, "max_amount": 85000, "interval": "yearly", "description": "Python React SQL 2 years", "site": "indeed"})
        self.assertEqual(normalized["title"], "Junior Software Developer")
        self.assertEqual(normalized["salary_min"], 70000)
        self.assertEqual(normalized["experience_requirement"], "2 years")
        missing = normalize_jobspy_row({})
        self.assertEqual(missing["title"], "")
        self.assertEqual(missing["salary_text"], "")

    def test_saved_search_persistence(self):
        created = self.client.post("/api/saved-searches", json={"search_name": "Toronto junior", "keywords": "junior software developer", "enabled_sources": ["linkedin", "indeed"]})
        self.assertEqual(created.status_code, 201)
        item = created.get_json()
        self.assertEqual(item["search_name"], "Toronto junior")
        self.assertEqual(item["enabled_sources_list"], ["linkedin", "indeed"])

    def test_one_source_failure_while_others_succeed(self):
        def fake_scrape_jobs(**kwargs):
            if kwargs["site_name"] == "indeed":
                raise RuntimeError("blocked")
            return FakeFrame([{"title": "Junior Software Developer", "company": "Acme", "location": "Toronto", "job_url": "https://example.com/1", "description": "Python Flask SQL", "site": kwargs["site_name"]}])

        result = fetch_jobspy_jobs(keywords="junior software developer", location="Toronto", enabled_sources=["linkedin", "indeed"], scrape_jobs_func=fake_scrape_jobs)
        self.assertEqual(len(result["jobs"]), 1)
        self.assertIn("indeed", result["errors"])

    def test_dedup_refresh_and_scoring(self):
        saved = self.client.post("/api/saved-searches", json={"search_name": "Toronto junior", "keywords": "junior software developer", "location": "Toronto", "enabled_sources": ["linkedin"], "target_roles": "software developer"}).get_json()
        normalized = {"title": "Junior Software Developer", "company": "Acme", "location": "Toronto", "remote_type": "Hybrid", "salary_text": "$70,000-$85,000", "salary_min": 70000, "salary_max": 85000, "source": "linkedin", "source_job_id": "abc123", "job_url": "https://linkedin.com/jobs/view/abc123", "application_url": "https://linkedin.com/jobs/view/abc123", "description": "Python JavaScript Flask React SQL dashboards APIs", "posted_date": "2026-06-12", "fetched_at": "2026-06-12T10:00:00Z", "raw": {}}

        def fake_fetch(**_kwargs):
            return {"jobs": [normalized], "errors": {}}

        with app_module.app.app_context():
            app_module.init_db()
            summary1 = app_module.run_saved_search(saved, fetch_func=fake_fetch)
            summary2 = app_module.run_saved_search(saved, fetch_func=fake_fetch)

        self.assertEqual(summary1["new"], 1)
        self.assertEqual(summary2["duplicated"], 1)
        results = self.client.get("/api/discovery/results").get_json()
        self.assertEqual(len(results), 1)
        self.assertGreaterEqual(results[0]["fit_score"], 70)
        self.assertIn("posting_freshness_score", results[0]["score_breakdown"])

    def test_initial_rejection_filters(self):
        saved = {"maximum_experience": 3, "location": "Toronto", "remote_preference": "", "target_roles": "software developer", "excluded_title_keywords": "senior,lead"}
        rejected, reason, _flags = app_module.apply_initial_rejection_filters({"title": "Senior Software Developer", "location": "Toronto", "description": "Requires 5+ years of experience", "salary_text": "", "remote_type": ""}, saved)
        self.assertTrue(rejected)
        self.assertIn("excluded title keyword", reason)
        self.assertIn("experience requirement", reason)


class FakeFrame:
    def __init__(self, rows):
        self.rows = rows

    def to_dict(self, _orient):
        return self.rows


if __name__ == "__main__":
    unittest.main()
