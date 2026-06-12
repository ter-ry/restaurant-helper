import io
import tempfile
import unittest
from pathlib import Path

import app as app_module


class JobAssistantTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        app_module.DATA_DIR = Path(self.tmpdir.name)
        app_module.DB_PATH = app_module.DATA_DIR / "test.sqlite"
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_profile_save_and_txt_upload(self):
        response = self.client.post(
            "/api/profile",
            json={
                "name": "Terry",
                "key_skills": "Python, Flask, React, SQL, dashboards",
                "work_authorization": "Legally authorized to work in Canada.",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["name"], "Terry")

        upload = self.client.post(
            "/api/profile/upload",
            data={"file": (io.BytesIO(b"Built Flask dashboards with SQL."), "resume.txt")},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 200)
        self.assertIn("Flask dashboards", upload.get_json()["resume_text"])

    def test_job_create_scores_and_dashboard(self):
        response = self.client.post(
            "/api/jobs",
            json={
                "company": "Northstar",
                "title": "Junior Full Stack Developer",
                "location": "Toronto hybrid",
                "salary": "$70k-$85k",
                "job_description": "Python JavaScript Flask React SQL AWS dashboards APIs internal tools",
            },
        )
        self.assertEqual(response.status_code, 201)
        job = response.get_json()
        self.assertGreaterEqual(job["fit_score"], 70)
        self.assertGreaterEqual(job["skills_match_score"], 70)

        dashboard = self.client.get("/api/dashboard").get_json()
        self.assertEqual(dashboard["jobs_saved"], 1)
        self.assertEqual(dashboard["high_fit"], 1)

    def test_generation_saves_versions_and_exports(self):
        created = self.client.post(
            "/api/jobs",
            json={
                "company": "OpsTools",
                "title": "Implementation Specialist",
                "location": "Remote Canada",
                "job_description": "APIs automation reporting business systems SQL Python",
            },
        ).get_json()
        generated = self.client.post("/api/generate", json={**created, "id": created["id"]})
        self.assertEqual(generated.status_code, 200)
        body = generated.get_json()
        self.assertIn("cover_letter", body)
        self.assertIn("resume_text", body)

        versions = self.client.get(f"/api/jobs/{created['id']}/versions").get_json()
        self.assertGreaterEqual(len(versions), 3)

        txt_export = self.client.get(f"/export/{created['id']}/cover_letter.txt")
        self.assertEqual(txt_export.status_code, 200)
        self.assertIn(b"Implementation Specialist", txt_export.data)

        docx_export = self.client.get(f"/export/{created['id']}/resume.docx")
        self.assertEqual(docx_export.status_code, 200)
        self.assertTrue(docx_export.data.startswith(b"PK"))

    def test_csv_import(self):
        csv_data = b"company,title,location,url,source,salary,description\nAcme,Cloud Support,Toronto,https://example.com,CSV,$60k,Azure SQL APIs\n"
        response = self.client.post(
            "/api/jobs/import-csv",
            data={"file": (io.BytesIO(csv_data), "jobs.csv")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["imported"], 1)
        jobs = self.client.get("/api/jobs").get_json()
        self.assertEqual(jobs[0]["company"], "Acme")


if __name__ == "__main__":
    unittest.main()
