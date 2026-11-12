"""Secretless, offline tests for the trusted reviewer/verifier runtime (issue #286).

No network (sockets are blocked), no real key, no GitHub write: every transport is a fake that
records calls. The positive path runs the real merged collector over recorded-shape responses.
"""
import copy
import json
import socket
import sys
import unittest
from datetime import timedelta
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import trusted_review_attestation as att
import trusted_review_evidence_collector as col
import trusted_review_runtime as rt
from test_trusted_review_attestation import BASE, HEAD, KEY, MAIN, NOW, OTHER_KEY, raw_pub
from test_trusted_review_evidence_collector import N, REPO, RID, ROOT, Fake, commit, ok, world

CODEX_ID, VERIFIER_ID, BOT_ID = 777000, 777, 555
ENV = {rt.ENABLE_VARIABLE: "true", rt.LIVE_WRITES_VARIABLE: "true"}
DRY = {rt.ENABLE_VARIABLE: "true"}


def cfg(**over):
    c = {"repository": REPO, "repo_id": RID, "evaluator_main_sha": MAIN, "bot_user_id": BOT_ID,
         "bot_login": "flowtally-independent-reviewer[bot]", "codex_bot_id": CODEX_ID,
         "codex_bot_login": "chatgpt-codex-connector[bot]", "public_key": raw_pub(KEY), "verifier_app_id": VERIFIER_ID}
    c.update(over)
    return c


def codex_comment(head=HEAD, status="completed", unresolved=False, uid=CODEX_ID, utype="Bot"):
    state = {"code_review": {"commit_sha": head, "has_any_findings": False, "has_unresolved_findings": unresolved, "status": status}}
    return {"user": {"id": uid, "type": utype, "login": "chatgpt-codex-connector[bot]"}, "updated_at": "2026-11-10T11:55:00Z",
            "body": f"<!-- codex-review-state:v1 {json.dumps(state)} -->"}


def reviewer_world(codex=None, **mods):
    w = world()
    w[f"{ROOT}/pulls/{N}/reviews"] = [ok([])]
    w[f"{ROOT}/issues/{N}/comments"] = [ok([codex_comment()] if codex is None else codex)]
    for k, v in mods.items():
        w[k] = v
    return w


class RW(Fake):
    """Read transport plus a recording write sink; reads are served by the merged-collector test world."""
    def __init__(self, w):
        super().__init__(w)
        self.posts = []
        self.post_response = None

    def post(self, path, body):
        self.posts.append((path, body))
        return self.post_response


def collector_for(fake):
    return col.Collector(fake, repository=REPO, repo_id=RID, allowed_bases=["develop"])


class Offline(unittest.TestCase):
    def setUp(self):
        self._orig = socket.socket.connect
        socket.socket.connect = lambda *a, **k: (_ for _ in ()).throw(AssertionError("network blocked"))

    def tearDown(self):
        socket.socket.connect = self._orig


def do_review(w=None, env=ENV, now=NOW, post_response="ok", config=None, session="trusted-review-runtime:1:1", collector=None):
    fake = RW(w or reviewer_world())
    fake.post_response = ({"status": 200, "headers": {}, "body": {"commit_id": HEAD, "state": "APPROVED", "user": {"id": BOT_ID}}}
                          if post_response == "ok" else post_response)
    res = rt.review_pr(N, env=env, collector=collector or collector_for(fake), read=fake, post=fake.post, cfg=config or cfg(),
                       key=KEY, now=now, session_id=session, nonce="nonce-1")
    return res, fake


class ReviewerPositive(Offline):
    def test_live_post_has_exact_request_shape_and_verifies(self):
        res, fake = do_review()
        self.assertEqual(res["action"], "posted", res)
        (path, body), = fake.posts
        self.assertEqual(path, f"/repos/{REPO}/pulls/{N}/reviews")
        self.assertEqual((body["commit_id"], body["event"]), (HEAD, "APPROVE"))
        self.assertEqual(set(body), {"commit_id", "event", "body"})
        ev = collector_for(RW(reviewer_world())).collect(N)
        ev["reviews"] = [{"id": 1, "user": {"id": BOT_ID, "login": "flowtally-independent-reviewer[bot]", "type": "Bot"}, "state": "APPROVED",
                          "commit_id": HEAD, "submitted_at": "2026-11-10T12:00:00Z", "body": body["body"]}]
        r = att.verify(ev, rt.verifier_config(cfg()), NOW, att.NonceStore())
        self.assertTrue(r.verified, r.reasons)
        p = r.attestation
        self.assertEqual((p["base_sha"], p["evaluator_main_sha"], p["reviewer_session_id"]), (BASE, MAIN, "trusted-review-runtime:1:1"))
        self.assertLessEqual((att._ts(p["expires_at"]) - att._ts(p["issued_at"])).total_seconds(), att.MAX_TTL_SECONDS)

    def test_dry_run_when_live_writes_off_posts_nothing(self):
        res, fake = do_review(env=DRY)
        self.assertEqual(res["action"], "dry_run", res)
        self.assertEqual(fake.posts, [])
        self.assertNotIn("sig:", json.dumps(res))  # never print the signed body

    def test_all_reads_are_get_or_query_only(self):
        _, fake = do_review()
        self.assertTrue(all(c[0] in ("GET", "GRAPHQL") for c in fake.calls))

    def test_idempotent_when_valid_approval_exists(self):
        res, fake = do_review()
        body = fake.posts[0][1]["body"]
        w = reviewer_world()
        w[f"{ROOT}/pulls/{N}/reviews"] = [ok([{"id": 1, "user": {"id": BOT_ID, "login": "flowtally-independent-reviewer[bot]", "type": "Bot"},
                                              "state": "APPROVED", "commit_id": HEAD, "submitted_at": "2026-11-10T12:00:00Z", "body": body}])]
        res2, fake2 = do_review(w)
        self.assertEqual((res2["action"], res2["reasons"]), ("skipped", ["already_reviewed"]))
        self.assertEqual(fake2.posts, [])

    def test_expired_approval_is_reissued(self):
        res, fake = do_review()
        body = fake.posts[0][1]["body"]
        w = reviewer_world()
        w[f"{ROOT}/pulls/{N}/reviews"] = [ok([{"id": 1, "user": {"id": BOT_ID, "login": "flowtally-independent-reviewer[bot]", "type": "Bot"},
                                              "state": "APPROVED", "commit_id": HEAD, "submitted_at": "2026-11-10T12:00:00Z", "body": body}])]
        later = NOW + timedelta(seconds=rt.ATTESTATION_TTL_SECONDS + 5)
        res2, _ = do_review(w, now=later)
        self.assertEqual(res2["action"], "posted", res2)


class ReviewerBlocks(Offline):
    def blocked(self, res, fake, reason):
        self.assertEqual(res["action"], "blocked", res)
        self.assertIn(reason, " ".join(res["reasons"]))
        self.assertEqual(fake.posts, [])

    def test_switch_off_makes_no_api_call(self):
        res, fake = do_review(env={})
        self.assertEqual((res["action"], fake.calls), ("skipped", []))
        res, fake = do_review(env={rt.ENABLE_VARIABLE: "True"})
        self.assertEqual((res["action"], fake.calls), ("skipped", []))

    def test_live_writes_without_enable_never_post(self):
        res, fake = do_review(env={rt.LIVE_WRITES_VARIABLE: "true"})
        self.assertEqual((res["action"], fake.posts), ("skipped", []))

    def test_switch_off_in_repository_variable(self):
        w = reviewer_world()
        w[f"{ROOT}/actions/variables/{col.KILL_SWITCH_VARIABLE}"] = [ok({"name": col.KILL_SWITCH_VARIABLE, "value": "false"})]
        res, fake = do_review(w)
        self.assertEqual((res["action"], fake.posts), ("skipped", []))

    def test_no_codex_review_is_never_rubber_stamped(self):
        res, fake = do_review(reviewer_world(codex=[]))
        self.blocked(res, fake, "codex_review_missing")

    def test_shared_owner_account_comment_is_not_review_evidence(self):
        res, fake = do_review(reviewer_world(codex=[codex_comment(uid=131665773, utype="User")]))
        self.blocked(res, fake, "codex_review_missing")

    def test_lookalike_bot_with_other_id_ignored(self):
        res, fake = do_review(reviewer_world(codex=[codex_comment(uid=CODEX_ID + 1)]))
        self.blocked(res, fake, "codex_review_missing")

    def test_codex_review_of_older_head_is_stale(self):
        res, fake = do_review(reviewer_world(codex=[codex_comment(head="d" * 40)]))
        self.blocked(res, fake, "codex_review_stale_head")

    def test_codex_not_completed_or_unresolved(self):
        res, fake = do_review(reviewer_world(codex=[codex_comment(status="in_progress")]))
        self.blocked(res, fake, "codex_review_not_completed")
        res, fake = do_review(reviewer_world(codex=[codex_comment(unresolved=True)]))
        self.blocked(res, fake, "codex_unresolved_findings")

    def test_codex_state_unreadable_and_comments_unavailable(self):
        c = codex_comment()
        c["body"] = "<!-- codex-review-state:v1 {not json} -->"
        res, fake = do_review(reviewer_world(codex=[c]))
        self.blocked(res, fake, "codex_review_unreadable")
        w = reviewer_world()
        w[f"{ROOT}/issues/{N}/comments"] = [{"status": 500, "headers": {}, "body": {}}]
        res, fake = do_review(w)
        self.blocked(res, fake, "codex_comments_missing")

    def test_only_tier0_docs_may_be_approved(self):
        for path in ("backend/x.py", ".github/workflows/ci.yml", "backend/migrations/0001.py", "src/App.tsx", "scripts/trusted_review_runtime.py", "AGENTS.md"):
            w = reviewer_world()
            w[f"{ROOT}/pulls/{N}"][0]["body"]["changed_files"] = 2
            w[f"{ROOT}/pulls/{N}/files"] = [ok([{"filename": "docs/a.md"}, {"filename": path}])]
            res, fake = do_review(w)
            self.blocked(res, fake, "not_tier0_only")

    def test_unresolved_thread_pending_reviewer_and_base(self):
        w = reviewer_world()
        w["graphql"][0]["body"]["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"][0]["isResolved"] = False
        self.blocked(*do_review(w), "unresolved_threads")
        w = reviewer_world()
        w[f"{ROOT}/pulls/{N}/requested_reviewers"] = [ok({"users": [{"login": "x"}], "teams": []})]
        self.blocked(*do_review(w), "pending_requested_reviewers")
        w = reviewer_world()
        w[f"{ROOT}/pulls/{N}"][0]["body"]["base"]["ref"] = "main"
        res, fake = do_review(w)
        self.assertEqual(res["action"], "blocked")
        self.assertEqual(fake.posts, [])

    def test_failed_or_missing_ci_blocks_via_preflight(self):
        w = reviewer_world()
        w[f"{ROOT}/commits/{HEAD}/check-runs"][0]["body"]["check_runs"][0]["conclusion"] = "failure"
        self.blocked(*do_review(w), "preflight_verify_failed")
        w = reviewer_world()
        w[f"{ROOT}/commits/{HEAD}/check-runs"] = [ok({"total_count": 0, "check_runs": []})]
        self.blocked(*do_review(w), "preflight_verify_failed")

    def test_base_sha_not_provable_blocks_instead_of_fabricating(self):
        w = reviewer_world()
        w[f"{ROOT}/actions/runs"] = [ok({"total_count": 0, "workflow_runs": []})]
        res, fake = do_review(w)
        self.assertEqual(res["action"], "blocked")
        self.assertIn("base_sha_unproven", res["reasons"])
        self.assertEqual(fake.posts, [])

    def test_api_caps_and_failures_fail_closed(self):
        w = reviewer_world()
        w[f"{ROOT}/pulls/{N}"][0]["body"]["commits"] = 251  # GitHub's 250-commit cap: count mismatch
        self.blocked(*do_review(w), "incomplete_evidence")
        w = reviewer_world()
        w[f"{ROOT}/pulls/{N}/reviews"] = [{"status": 403, "headers": {}, "body": {}}]
        self.blocked(*do_review(w), "incomplete_evidence")

    def test_cross_session_self_review_blocked(self):
        res, fake = do_review(session="session_CLAUDE-W1")
        self.blocked(res, fake, "author_self_review")

    def test_engine_or_bot_as_author_blocked(self):
        w = reviewer_world()
        w[f"{ROOT}/pulls/{N}/commits"] = [ok([commit(login="chatgpt-codex-connector[bot]")])]
        self.blocked(*do_review(w), "review_engine_is_author")

    def test_missing_author_sessions_blocked(self):
        w = reviewer_world()
        w[f"{ROOT}/pulls/{N}/commits"] = [ok([commit(msg="no trailer")])]
        self.blocked(*do_review(w), "incomplete_evidence")

    def test_head_moved_during_review_posts_nothing(self):
        fake = RW(reviewer_world())
        real = collector_for(fake)
        evs = [real.collect(N)]
        moved = copy.deepcopy(evs[0])
        moved["pr"]["head"]["sha"] = "e" * 40

        class Moving:
            calls = 0

            def collect(self, n):
                Moving.calls += 1
                return copy.deepcopy(evs[0]) if Moving.calls == 1 else copy.deepcopy(moved)

        res, fake2 = do_review(collector=Moving())
        self.blocked(res, fake2, "changed_during_review")

    def test_files_changed_or_base_advanced_during_review(self):
        base = collector_for(RW(reviewer_world())).collect(N)
        for mutate in (lambda e: e.update(changed_files=["docs/a.md", "docs/zzz.md"]), lambda e: e["pr"]["base"].update(sha="f" * 40)):
            other = copy.deepcopy(base)
            mutate(other)

            class Two:
                n = 0

                def collect(self, _):
                    Two.n += 1
                    return copy.deepcopy(base) if Two.n == 1 else copy.deepcopy(other)

            res, fake = do_review(collector=Two())
            self.blocked(res, fake, "changed_during_review")

    def test_unconfirmed_post_is_an_error(self):
        res, fake = do_review(post_response={"status": 422, "headers": {}, "body": {}})
        self.assertEqual((res["action"], res["reasons"]), ("error", ["review_post_unconfirmed"]))
        res, _ = do_review(post_response={"status": 200, "headers": {}, "body": {"commit_id": "9" * 40, "state": "APPROVED", "user": {"id": BOT_ID}}})
        self.assertEqual(res["action"], "error")


def verifier_world(approve=True, **mods):
    w = reviewer_world()
    if approve:
        res, fake = do_review()
        body = fake.posts[0][1]["body"]
        w[f"{ROOT}/pulls/{N}/reviews"] = [ok([{"id": 1, "user": {"id": BOT_ID, "login": "flowtally-independent-reviewer[bot]", "type": "Bot"},
                                              "state": "APPROVED", "commit_id": HEAD, "submitted_at": "2026-11-10T12:00:00Z", "body": body}])]
    for k, v in mods.items():
        w[k] = v
    return w


CHECKS = f"{ROOT}/commits/{HEAD}/check-runs"


def do_verify(w, env=ENV, now=NOW, prior=None, post_response="ok", config=None, collector=None):
    w = copy.deepcopy(w)
    fake = RW(w)
    runs = w[CHECKS][0]["body"]["check_runs"]
    fake.get_orig = fake.get

    def get(path, params):
        if path == CHECKS and params.get("check_name") == att.CHECK_NAME:
            return ok({"total_count": 1 if prior else 0, "check_runs": [prior] if prior else []})
        return fake.get_orig(path, params)

    fake.get = get
    fake.post_response = ({"status": 201, "headers": {}, "body": {"app": {"id": VERIFIER_ID}, "head_sha": HEAD}}
                          if post_response == "ok" else post_response)
    res = rt.verify_pr(N, env=env, collector=collector or collector_for(fake), read=fake, post=fake.post, cfg=config or cfg(), now=now)
    return res, fake


class Verifier(Offline):
    def test_valid_approval_publishes_success_check_from_verifier(self):
        res, fake = do_verify(verifier_world())
        self.assertEqual((res["action"], res["conclusion"]), ("posted", "success"), res)
        (path, body), = fake.posts
        self.assertEqual(path, f"/repos/{REPO}/check-runs")
        self.assertEqual((body["name"], body["head_sha"], body["status"], body["conclusion"]), (att.CHECK_NAME, HEAD, "completed", "success"))
        self.assertEqual(json.loads(body["output"]["summary"])["verifier_app_id"], VERIFIER_ID)

    def test_dry_run_posts_nothing(self):
        res, fake = do_verify(verifier_world(), env=DRY)
        self.assertEqual((res["action"], fake.posts), ("dry_run", []))

    def test_missing_forged_expired_and_wrong_key_are_failure_never_neutral(self):
        cases = {"missing": (verifier_world(approve=False), NOW, cfg()),
                 "expired": (verifier_world(), NOW + timedelta(hours=2), cfg()),
                 "wrong_key": (verifier_world(), NOW, cfg(public_key=raw_pub(OTHER_KEY)))}
        for name, (w, now, c) in cases.items():
            res, fake = do_verify(w, now=now, config=c)
            self.assertEqual((res["action"], res["conclusion"]), ("posted", "failure"), name)
            self.assertEqual(fake.posts[0][1]["conclusion"], "failure")

    def test_forged_comment_or_check_by_other_actor_does_not_satisfy(self):
        w = verifier_world(approve=False)
        w[f"{ROOT}/issues/{N}/comments"] = [ok([{"user": {"login": "ter-ry", "id": 1}, "body": f"APPROVE @ {HEAD}"}])]
        res, _ = do_verify(w)
        self.assertEqual(res["conclusion"], "failure")
        forged = {"name": att.CHECK_NAME, "head_sha": HEAD, "status": "completed", "conclusion": "success", "app": {"id": 1},
                  "output": {"summary": json.dumps({"expires_at": "2099-01-01T00:00:00Z"})}}
        res, fake = do_verify(verifier_world(approve=False), prior=forged)
        self.assertEqual(res["action"], "posted")  # the verifier does not trust or reuse another actor's check
        self.assertEqual(fake.posts[0][1]["conclusion"], "failure")

    def test_kill_switch_off_after_valid_approval_is_failure(self):
        w = verifier_world()
        w[f"{ROOT}/actions/variables/{col.KILL_SWITCH_VARIABLE}"] = [ok({"name": col.KILL_SWITCH_VARIABLE, "value": "false"})]
        res, fake = do_verify(w)
        self.assertEqual(fake.posts[0][1]["conclusion"], "failure")
        self.assertIn("kill_switch_off", json.loads(fake.posts[0][1]["output"]["summary"])["reasons"])

    def test_unreadable_variable_or_api_error_is_failure(self):
        w = verifier_world()
        w[f"{ROOT}/pulls/{N}/requested_reviewers"] = [{"status": 500, "headers": {}, "body": {}}]
        res, fake = do_verify(w)
        self.assertEqual(res["action"] == "posted" and fake.posts[0][1]["conclusion"], "failure")

    def test_idempotent_republish_skips_identical_valid_check(self):
        res, fake = do_verify(verifier_world())
        body = fake.posts[0][1]
        prior = {"name": att.CHECK_NAME, "head_sha": HEAD, "status": "completed", "conclusion": "success", "app": {"id": VERIFIER_ID},
                 "output": body["output"], "completed_at": "2026-11-10T12:00:00Z", "id": 1}
        res2, fake2 = do_verify(verifier_world(), prior=prior)
        self.assertEqual((res2["action"], fake2.posts), ("skipped", []))

    def test_expired_prior_success_is_republished_as_failure(self):
        res, fake = do_verify(verifier_world())
        prior = {"name": att.CHECK_NAME, "head_sha": HEAD, "status": "completed", "conclusion": "success", "app": {"id": VERIFIER_ID},
                 "output": fake.posts[0][1]["output"], "completed_at": "2026-11-10T12:00:00Z", "id": 1}
        res2, fake2 = do_verify(verifier_world(), prior=prior, now=NOW + timedelta(hours=2))
        self.assertEqual(fake2.posts[0][1]["conclusion"], "failure")

    def test_head_moved_while_verifying_posts_nothing(self):
        base = collector_for(RW(verifier_world())).collect(N)
        moved = copy.deepcopy(base)
        moved["pr"]["head"]["sha"] = "e" * 40

        class Moving:
            n = 0

            def collect(self, _):
                Moving.n += 1
                return copy.deepcopy(base) if Moving.n == 1 else copy.deepcopy(moved)

        res, fake = do_verify(verifier_world(), collector=Moving())
        self.assertEqual((res["action"], fake.posts), ("blocked", []))

    def test_unknown_head_publishes_nothing(self):
        w = verifier_world()
        w[f"{ROOT}/pulls/{N}"] = [{"status": 404, "headers": {}, "body": {}}]
        res, fake = do_verify(w)
        self.assertEqual((res["action"], res["reasons"][0], fake.posts), ("blocked", "head_unknown", []))

    def test_check_post_from_wrong_app_is_error(self):
        res, _ = do_verify(verifier_world(), post_response={"status": 201, "headers": {}, "body": {"app": {"id": 1}, "head_sha": HEAD}})
        self.assertEqual(res["action"], "error")

    def test_switch_off_makes_no_call(self):
        res, fake = do_verify(verifier_world(), env={})
        self.assertEqual((res["action"], fake.posts), ("skipped", []))


class Seq:
    """Collector stub returning successive evidence snapshots (the last one repeats)."""
    def __init__(self, *evs):
        self.evs, self.n = list(evs), 0

    def collect(self, _):
        e = self.evs[min(self.n, len(self.evs) - 1)]
        self.n += 1
        return copy.deepcopy(e)


class FreshReads(Offline):
    """Codex findings on 4e702df: the final read must drive the verdict, not the first one."""
    def evs(self, world_fn, mutate):
        first = collector_for(RW(world_fn())).collect(N)
        later = copy.deepcopy(first)
        mutate(later)
        return first, later

    def test_verifier_fresh_unresolved_thread_publishes_failure(self):
        first, later = self.evs(verifier_world, lambda e: e["threads"].append({"is_resolved": False, "is_outdated": False}))
        res, fake = do_verify(verifier_world(), collector=Seq(first, later))
        self.assertEqual(fake.posts[0][1]["conclusion"], "failure")
        self.assertIn("unresolved_threads", res["reasons_found"])

    def test_verifier_fresh_switch_off_or_ci_failure_publishes_failure(self):
        for mutate, reason in ((lambda e: e["variables"].update({att.KILL_SWITCH_VARIABLE: "false"}), "kill_switch_off"),
                               (lambda e: e["check_runs"][0].update(conclusion="failure"), "failed_ci")):
            first, later = self.evs(verifier_world, mutate)
            res, fake = do_verify(verifier_world(), collector=Seq(first, later))
            self.assertEqual(fake.posts[0][1]["conclusion"], "failure")
            self.assertIn(reason, " ".join(res["reasons_found"]))

    def test_verifier_fresh_base_moved_is_not_success(self):
        first, later = self.evs(verifier_world, lambda e: e["pr"]["base"].update(sha="f" * 40))
        res, fake = do_verify(verifier_world(), collector=Seq(first, later))
        self.assertEqual(fake.posts[0][1]["conclusion"], "failure")

    def test_reviewer_final_read_regates_threads_and_switch(self):
        first, later = self.evs(reviewer_world, lambda e: e["threads"].append({"is_resolved": False, "is_outdated": False}))
        res, fake = do_review(collector=Seq(first, later))
        self.assertEqual((res["action"], fake.posts), ("blocked", []))
        first, later = self.evs(reviewer_world, lambda e: e["check_runs"][0].update(conclusion="failure"))
        res, fake = do_review(collector=Seq(first, later))
        self.assertEqual((res["action"], fake.posts), ("blocked", []))


def revoke(prior, post_response="ok", live=True, status=200):
    w = reviewer_world()
    fake = RW(w)
    orig = fake.get

    def get(path, params):
        if path == CHECKS and params.get("check_name") == att.CHECK_NAME:
            return ok({"total_count": 1 if prior else 0, "check_runs": [prior] if prior else []})
        return orig(path, params)

    fake.get = get
    fake.post_response = ({"status": 201, "headers": {}, "body": {"app": {"id": VERIFIER_ID}, "head_sha": HEAD}}
                          if post_response == "ok" else post_response)
    return rt.revoke_pr(N, read=fake, post=fake.post if live else None, cfg=cfg()), fake


SUCCESS_PRIOR = {"name": att.CHECK_NAME, "head_sha": HEAD, "status": "completed", "conclusion": "success", "app": {"id": VERIFIER_ID},
                 "output": {"summary": "{}"}, "completed_at": "2026-11-10T12:00:00Z", "id": 1}


class Revocation(Offline):
    def test_switch_off_turns_published_success_into_failure(self):
        res, fake = revoke(SUCCESS_PRIOR)
        self.assertEqual(res["action"], "posted", res)
        (path, body), = fake.posts
        self.assertEqual((body["conclusion"], body["head_sha"], body["name"]), ("failure", HEAD, att.CHECK_NAME))
        self.assertIn("kill_switch_off", body["output"]["summary"])

    def test_nothing_to_revoke_and_never_writes_success(self):
        res, fake = revoke(None)
        self.assertEqual((res["action"], fake.posts), ("skipped", []))
        res, fake = revoke({**SUCCESS_PRIOR, "conclusion": "failure"})
        self.assertEqual((res["action"], fake.posts), ("skipped", []))

    def test_without_live_writes_blocked_and_unconfirmed_post_is_error(self):
        res, fake = revoke(SUCCESS_PRIOR, live=False)
        self.assertEqual((res["action"], fake.posts), ("blocked", []))
        res, _ = revoke(SUCCESS_PRIOR, post_response={"status": 422, "headers": {}, "body": {}})
        self.assertEqual(res["action"], "error")

    def test_cli_revoke_only_when_live_enabled_with_verifier_key(self):
        calls = []
        orig = rt._common
        base = {rt.LIVE_WRITES_VARIABLE: "true"}
        try:
            rt._common = lambda env, role, now: calls.append(role) or (_ for _ in ()).throw(rt.ConfigError("stop"))
            self.assertEqual(rt.run(["verifier", "--pr", "7"], base, NOW), 0)  # no key: inert, no auth attempted
            self.assertEqual(rt.run(["verifier", "--pr", "7"], {**base, "FLOWTALLY_VERIFIER_APP_PRIVATE_KEY": "k"}, NOW), 1)  # attempted
            self.assertEqual(rt.run(["reviewer", "--pr", "7"], {**base, "FLOWTALLY_VERIFIER_APP_PRIVATE_KEY": "k"}, NOW), 0)  # reviewer never revokes
            self.assertEqual(rt.run(["verifier", "--pr", "7"], {"FLOWTALLY_VERIFIER_APP_PRIVATE_KEY": "k"}, NOW), 0)  # live writes never on
        finally:
            rt._common = orig
        self.assertEqual(calls, ["verifier"])

    def test_workflow_keeps_verifier_job_alive_but_reviewer_gated(self):
        text = (Path(__file__).resolve().parents[2] / ".github/workflows/trusted-review.yml").read_text()
        rev, ver = text.split("  verifier:")
        self.assertIn("vars.FLOWTALLY_TRUSTED_REVIEW_ENABLED == 'true'", rev.split("  reviewer:")[1])
        self.assertNotIn("FLOWTALLY_TRUSTED_REVIEW_ENABLED == 'true'", ver.split("steps:")[0].split("env:")[0])
        self.assertNotIn("pull_request", text.split("\non:")[1].split("\npermissions:")[0])  # no PR-triggered privileged run

    def test_tests_workflow_cannot_pass_on_failing_tests(self):
        text = (Path(__file__).resolve().parents[2] / ".github/workflows/trusted-review-tests.yml").read_text()
        self.assertIn("shell: bash", text)
        self.assertIn("set -euo pipefail", text)
        self.assertNotIn("| tee", text)
        self.assertNotIn("paths:", text)  # a required check must report on every PR


class Targets(Offline):
    def test_all_open_prs_are_processed_not_a_fixed_prefix(self):
        page = [{"number": i, "head": {"repo": {"id": RID}}} for i in range(1, 61)]
        self.assertEqual(rt.list_target_prs(Fake({f"/repos/{REPO}/pulls": [ok(page)]}), REPO, RID), list(range(1, 61)))


class ClockAndCoauthors(Offline):
    """Codex P2 findings on 7b955da."""
    CLAUDE_MSG = ("work\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\n"
                  "Claude-Session: https://claude.ai/code/session_CLAUDE-W1")

    def coauthored_world(self):
        w = reviewer_world()
        w[f"{ROOT}/pulls/{N}/commits"] = [ok([commit(msg=self.CLAUDE_MSG)])]
        return w

    def test_claude_coauthor_trailer_needs_owner_allowlist(self):
        ev = collector_for(RW(self.coauthored_world())).collect(N)
        self.assertIn("commits:coauthor_identity_unresolved", ev["api_errors"])  # default: fail closed
        self.assertEqual(rt.coauthor_allowlist({}), ())
        env = {"TRUSTED_COAUTHOR_EMAILS": " noreply@anthropic.com , "}
        self.assertEqual(rt.coauthor_allowlist(env), ("noreply@anthropic.com",))
        fake = RW(self.coauthored_world())
        res = rt.review_pr(N, env=ENV, collector=rt.build_collector(fake, cfg(), env), read=fake, post=None, cfg=cfg(), key=KEY,
                           now=NOW, session_id="trusted-review-runtime:1:1", nonce="n")
        self.assertEqual(res["action"], "dry_run", res)

    def test_other_unvetted_email_still_fails_closed(self):
        w = self.coauthored_world()
        w[f"{ROOT}/pulls/{N}/commits"] = [ok([commit(msg=self.CLAUDE_MSG.replace("noreply@anthropic.com", "evil@example.com"))])]
        ev = rt.build_collector(RW(w), cfg(), {"TRUSTED_COAUTHOR_EMAILS": "noreply@anthropic.com"}).collect(N)
        self.assertTrue(ev["incomplete"])

    def test_clock_is_reread_so_attestation_cannot_outlive_expiry(self):
        res, fake = do_review()
        prior = {"name": att.CHECK_NAME, "head_sha": HEAD, "status": "completed", "conclusion": "success", "app": {"id": VERIFIER_ID},
                 "output": do_verify(verifier_world())[1].posts[0][1]["output"], "completed_at": "2026-11-10T12:00:00Z", "id": 1}
        res2, fake2 = do_verify(verifier_world(), prior=prior, now=lambda: NOW)
        self.assertEqual((res2["action"], fake2.posts), ("skipped", []))  # still valid at the current time: reused
        res3, fake3 = do_verify(verifier_world(), prior=prior, now=lambda: NOW + timedelta(hours=2))
        # time passed during auth/collection: the expired prior success is not reused and nothing stale is published as success
        self.assertEqual(fake3.posts[0][1]["conclusion"], "failure")

    def test_reviewer_uses_current_time_for_attestation_window(self):
        later = NOW + timedelta(minutes=10)
        res, fake = do_review(now=lambda: later)
        self.assertEqual(res["action"], "posted", res)
        self.assertEqual(att.parse_review_body(fake.posts[0][1]["body"])[0]["issued_at"], "2026-11-10T12:10:00Z")


class Wiring(Offline):
    """Owner reconciliation: names must match the owner's environments and the #270 controller's variables."""
    TRUSTED = {"GITHUB_REPOSITORY": REPO, "GITHUB_REF": "refs/heads/main", "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_SHA": MAIN}

    def test_workflow_uses_owner_environment_names_exactly(self):
        text = (Path(__file__).resolve().parents[2] / ".github/workflows/trusted-review.yml").read_text()
        self.assertIn("environment: flowtally-trusted-reviewer\n", text)
        self.assertIn("environment: flowtally-review-verifier\n", text)
        self.assertNotIn("environment: trusted-review-", text)

    def test_shared_variable_names_with_develop_controller(self):
        text = (Path(__file__).resolve().parents[2] / ".github/workflows/trusted-review.yml").read_text()
        for name in ("FLOWTALLY_REVIEWER_APP_ID", "REVIEWER_BOT_LOGIN", "VERIFIER_APP_ID", "FLOWTALLY_REPO_ID",
                     "REVIEWER_BOT_USER_ID", "TRUSTED_COAUTHOR_EMAILS"):
            self.assertIn(f"vars.{name}", text, name)

    def test_every_workflow_env_name_is_read_by_the_runtime_or_documented(self):
        text = (Path(__file__).resolve().parents[2] / ".github/workflows/trusted-review.yml").read_text()
        code = (Path(__file__).resolve().parents[1] / "trusted_review_runtime.py").read_text()
        import re
        for name in set(re.findall(r"^\s+((?:FLOWTALLY_|TRUSTED_|PR_)[A-Z_]+):", text, re.M)):
            self.assertTrue(name in code or name == "PR_NUMBER", f"{name} is set by the workflow but never read")

    def test_missing_variable_fails_loudly_not_silently(self):
        for role, missing in (("reviewer", "FLOWTALLY_REVIEWER_APP_ID"), ("verifier", "VERIFIER_APP_ID")):
            with self.assertRaises(rt.ConfigError) as cm:
                rt._common({**self.TRUSTED, "FLOWTALLY_REPO_ID": "900"}, role, NOW)
            self.assertEqual(str(cm.exception), f"missing:{missing}")


class Guards(Offline):
    def test_isolation_between_roles(self):
        rt.check_isolation({"FLOWTALLY_REVIEWER_SIGNING_KEY": "x"}, "reviewer")
        rt.check_isolation({"FLOWTALLY_VERIFIER_APP_PRIVATE_KEY": "x"}, "verifier")
        with self.assertRaises(rt.ConfigError):
            rt.check_isolation({"FLOWTALLY_VERIFIER_APP_PRIVATE_KEY": "x"}, "reviewer")
        for name in rt.REVIEWER_ONLY_SECRETS:
            with self.assertRaises(rt.ConfigError):
                rt.check_isolation({name: "x"}, "verifier")

    def test_only_trusted_main_dispatch_or_schedule(self):
        good = {"GITHUB_REPOSITORY": REPO, "GITHUB_REF": "refs/heads/main", "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_SHA": MAIN}
        self.assertEqual(rt.check_trusted_context(good), (REPO, MAIN))
        for k, v in (("GITHUB_EVENT_NAME", "pull_request_target"), ("GITHUB_EVENT_NAME", "pull_request"), ("GITHUB_REF", "refs/pull/7/merge"),
                     ("GITHUB_REF", "refs/heads/develop"), ("GITHUB_REPOSITORY", "evil/restaurant-helper"), ("GITHUB_SHA", "xyz")):
            with self.assertRaises(rt.ConfigError, msg=(k, v)):
                rt.check_trusted_context({**good, k: v})

    def test_runtime_sha_must_be_main_tip(self):
        ok_tip = Fake({f"/repos/{REPO}/branches/main": [ok({"commit": {"sha": MAIN}})]})
        rt.trusted_runtime_sha(ok_tip, REPO, MAIN)
        with self.assertRaises(rt.ConfigError):
            rt.trusted_runtime_sha(ok_tip, REPO, "9" * 40)

    def test_permission_models(self):
        self.assertEqual(rt.verifier_permission_problems({"checks": "write", "actions_variables": "read", "pull_requests": "read"}), [])
        self.assertIn("forbidden_write:pull_requests", rt.verifier_permission_problems({"checks": "write", "actions_variables": "read", "pull_requests": "write"}))
        self.assertIn("forbidden_write:contents", rt.verifier_permission_problems({"checks": "write", "actions_variables": "read", "contents": "write"}))
        self.assertIn("missing:checks_write", rt.verifier_permission_problems({"actions_variables": "read"}))
        self.assertIn("forbidden_write:checks", att.reviewer_permission_problems({"checks": "write", "pull_requests": "write", "actions_variables": "read"}))
        self.assertEqual(att.reviewer_permission_problems(rt.REVIEWER_TOKEN_PERMISSIONS), [])
        self.assertEqual(rt.verifier_permission_problems(rt.VERIFIER_TOKEN_PERMISSIONS), [])

    def test_app_jwt_is_rs256_and_short_lived(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        tok = rt.mint_app_jwt(123, pem, NOW)
        h, b, s = tok.split(".")
        pad = lambda x: x + "=" * (-len(x) % 4)  # noqa: E731
        import base64
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding
        key.public_key().verify(base64.urlsafe_b64decode(pad(s)), f"{h}.{b}".encode(), padding.PKCS1v15(), hashes.SHA256())
        claims = json.loads(base64.urlsafe_b64decode(pad(b)))
        self.assertEqual(claims["iss"], "123")
        self.assertLessEqual(claims["exp"] - claims["iat"], 600)

    def test_installation_token_must_be_single_repo(self):
        class J:
            def __init__(self, repos):
                self.repos, self.posted = repos, None

            def get(self, path, params=None):
                return ok({"id": 9})

            def post(self, path, body):
                self.posted = body
                return {"status": 201, "headers": {}, "body": {"token": "t", "permissions": dict(rt.VERIFIER_TOKEN_PERMISSIONS), "repositories": self.repos}}

        j = J([{"full_name": REPO}])
        self.assertEqual(rt.mint_installation_token(j, REPO, rt.VERIFIER_TOKEN_PERMISSIONS)[0], "t")
        self.assertEqual(j.posted, {"repositories": ["restaurant-helper"]})
        for repos in ([], [{"full_name": REPO}, {"full_name": "ter-ry/other"}], [{"full_name": "ter-ry/other"}]):
            with self.assertRaises(rt.ConfigError):
                rt.mint_installation_token(J(repos), REPO, rt.VERIFIER_TOKEN_PERMISSIONS)

    def _mint(self, status, body, perms=None):
        class J:
            def get(self, path, params=None):
                return ok({"id": 9})

            def post(self, path, payload):
                self.sent = payload
                return {"status": status, "headers": {"Authorization": "Bearer SECRETJWT"}, "body": body}

        j = J()
        return j, rt.mint_installation_token(j, REPO, perms or rt.VERIFIER_TOKEN_PERMISSIONS)

    def test_token_refusals_give_safe_status_and_category(self):
        cases = [(401, {"message": "A JSON web token could not be decoded"}, "http_401:unauthorized_app_jwt"),
                 (404, {"message": "Not Found"}, "http_404:installation_not_found"),
                 (403, {"message": "Resource not accessible by integration"}, "http_403:forbidden:repo_scope_mismatch"),
                 (403, {"message": "This installation has not been approved for the new permissions"}, "http_403:forbidden:installation_not_updated"),
                 (422, {"message": "The permissions requested are not granted to this installation."}, "http_422:unprocessable:installation_not_updated"),
                 (422, {"message": "Validation Failed", "errors": [{"field": "permissions", "code": "invalid"}]}, "http_422:unprocessable:unclassified"),
                 (422, {"message": "variables is not a permitted key"}, "http_422:unprocessable:invalid_permissions"),
                 (500, None, "http_500:github_server_error"), (418, "html", "http_418:unexpected_status")]
        for status, body, expected in cases:
            with self.assertRaises(rt.ConfigError) as cm:
                self._mint(status, body)
            self.assertTrue(str(cm.exception).startswith("installation_token_refused:" + expected), (status, str(cm.exception)))

    def test_refusal_never_leaks_provider_text_or_secrets(self):
        body = {"message": "SECRETJWT ghs_TOKEN -----BEGIN PRIVATE KEY----- permission customer@example.com"}
        with self.assertRaises(rt.ConfigError) as cm:
            self._mint(422, body)
        for needle in ("SECRETJWT", "ghs_", "PRIVATE", "customer", "Bearer"):
            self.assertNotIn(needle, str(cm.exception))

    def test_token_request_has_no_permissions_override_and_one_repo(self):
        """Live 2026-11-12 422: GitHub's token request has no Variables key (neither "variables" nor
        "actions_variables"). Send only the single repository; verify the granted map instead."""
        for perms in (rt.REVIEWER_TOKEN_PERMISSIONS, rt.VERIFIER_TOKEN_PERMISSIONS):
            j, (tok, granted) = self._mint(201, {"token": "t", "repositories": [{"full_name": REPO}], "permissions": dict(perms)}, perms)
            self.assertEqual(j.sent, {"repositories": [REPO.split("/")[1]]})
            self.assertEqual(granted, perms)

    def test_granted_permissions_must_match_allowlist_exactly(self):
        base = dict(rt.VERIFIER_TOKEN_PERMISSIONS)
        bad = {"extra_write": {**base, "contents": "write"},
               "extra_key": {**base, "administration": "read"},
               "higher_level": {**base, "pull_requests": "write"},
               "missing_checks": {k: v for k, v in base.items() if k != "checks"},
               "missing_variables": {k: v for k, v in base.items() if k != "actions_variables"},
               "variables_too_weak": {**base, "actions_variables": "none"}}
        for name, granted in bad.items():
            with self.assertRaises(rt.ConfigError, msg=name) as cm:
                self._mint(201, {"token": "t", "repositories": [{"full_name": REPO}], "permissions": granted})
            self.assertTrue(str(cm.exception).startswith("installation_token_permissions_not_allowlisted:"), (name, str(cm.exception)))
        with self.assertRaises(rt.ConfigError) as cm:  # hostile key text is never echoed
            self._mint(201, {"token": "t", "repositories": [{"full_name": REPO}], "permissions": {**base, "ghs_SECRET token": "read"}})
        self.assertNotIn("ghs_", str(cm.exception))
        self.assertIn("unexpected:invalid_key", str(cm.exception))

    def test_variables_alias_in_granted_map_is_normalized(self):
        granted = {k: v for k, v in rt.VERIFIER_TOKEN_PERMISSIONS.items() if k != "actions_variables"}
        granted["variables"] = "read"
        _, (_, out) = self._mint(201, {"token": "t", "repositories": [{"full_name": REPO}], "permissions": granted})
        self.assertEqual(out["actions_variables"], "read")
        self.assertNotIn("variables", out)

    def test_incomplete_success_response_fails_closed(self):
        for body in (None, {}, {"token": 5}, {"permissions": {}}):
            with self.assertRaises(rt.ConfigError) as cm:
                self._mint(201, body)
            self.assertTrue(str(cm.exception).startswith("installation_token_incomplete_response:http_201"))
        with self.assertRaises(rt.ConfigError):
            self._mint(201, {"token": "t", "repositories": [{"full_name": REPO}]})  # permissions missing

    def test_installation_lookup_failure_is_categorized(self):
        class J:
            def get(self, path, params=None):
                return {"status": 404, "headers": {}, "body": {"message": "Not Found"}}
        with self.assertRaises(rt.ConfigError) as cm:
            rt.mint_installation_token(J(), REPO, rt.VERIFIER_TOKEN_PERMISSIONS)
        self.assertEqual(str(cm.exception), "app_installation_not_found:http_404:installation_not_found")

    def test_successful_token_is_single_repo_and_permissions_unchanged(self):
        for perms in (rt.REVIEWER_TOKEN_PERMISSIONS, rt.VERIFIER_TOKEN_PERMISSIONS):
            j, (tok, granted) = self._mint(201, {"token": "t", "permissions": dict(perms), "repositories": [{"full_name": REPO}]}, perms)
            self.assertEqual((tok, j.sent), ("t", {"repositories": ["restaurant-helper"]}))
        self.assertEqual(rt.VERIFIER_TOKEN_PERMISSIONS["checks"], "write")
        self.assertEqual(rt.REVIEWER_TOKEN_PERMISSIONS["pull_requests"], "write")
        self.assertEqual([k for k, v in rt.REVIEWER_TOKEN_PERMISSIONS.items() if v == "write"], ["pull_requests"])
        self.assertEqual([k for k, v in rt.VERIFIER_TOKEN_PERMISSIONS.items() if v == "write"], ["checks"])

    def test_cli_reports_refusal_status_without_secrets(self):
        env = dict(ENV, **{rt.LIVE_WRITES_VARIABLE: "false"})
        orig = rt._common
        def refuse(*a, **k):
            raise rt.ConfigError("installation_token_refused:http_422:unprocessable:invalid_permissions")
        rt._common = refuse
        try:
            import io, contextlib
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = rt.run(["reviewer"], env)
        finally:
            rt._common = orig
        out = json.loads(buf.getvalue())
        self.assertEqual((code, out["action"], out["reasons"]), (1, "error", ["installation_token_refused:http_422:unprocessable:invalid_permissions"]))

    def test_pr_listing_excludes_forks_and_fails_on_truncation(self):
        page = [{"number": 1, "head": {"repo": {"id": RID}}}, {"number": 2, "head": {"repo": {"id": 5}}}, {"number": 3, "head": {"repo": None}}]
        f = Fake({f"/repos/{REPO}/pulls": [ok(page)]})
        self.assertEqual(rt.list_target_prs(f, REPO, RID), [1])
        full = [{"number": i, "head": {"repo": {"id": RID}}} for i in range(1, 101)]
        with self.assertRaises(rt.ConfigError):
            rt.list_target_prs(Fake({f"/repos/{REPO}/pulls": [ok(full)]}), REPO, RID)

    def test_cli_inactive_when_switch_not_true_and_never_touches_network(self):
        for env in ({}, {rt.ENABLE_VARIABLE: "false"}, {rt.ENABLE_VARIABLE: "TRUE"}):
            self.assertEqual(rt.run(["reviewer", "--pr", "1"], env, NOW), 0)
            self.assertEqual(rt.run(["verifier"], env, NOW), 0)

    def test_cli_fails_closed_on_bad_config_without_network(self):
        base = {rt.ENABLE_VARIABLE: "true"}
        self.assertEqual(rt.run(["reviewer", "--pr", "1"], base, NOW), 1)  # untrusted context and no secrets
        mixed = {**base, "GITHUB_REPOSITORY": REPO, "GITHUB_REF": "refs/heads/main", "GITHUB_EVENT_NAME": "workflow_dispatch",
                 "GITHUB_SHA": MAIN, "FLOWTALLY_VERIFIER_APP_PRIVATE_KEY": "x"}
        self.assertEqual(rt.run(["reviewer", "--pr", "1"], mixed, NOW), 1)
        pr_event = {**mixed, "GITHUB_EVENT_NAME": "pull_request_target"}
        self.assertEqual(rt.run(["verifier", "--pr", "1"], {k: v for k, v in pr_event.items() if k != "FLOWTALLY_VERIFIER_APP_PRIVATE_KEY"}, NOW), 1)

    def test_signing_key_must_be_ed25519(self):
        rsa_pem = rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        with self.assertRaises(rt.ConfigError):
            rt.load_signing_key(rsa_pem)
        with self.assertRaises(rt.ConfigError):
            rt.load_public_key("AAAA")


if __name__ == "__main__":
    unittest.main()
