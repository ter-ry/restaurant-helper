import copy
import json
import socket
import sys
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import develop_automerge_controller as dc
import trusted_review_attestation as t
from test_trusted_review_attestation import BASE, HEAD, NOW
from test_trusted_review_evidence_collector import BOT, N, REPO, RID, ROOT, ok, world

CFG = dc.Config(repository=REPO, repo_id=RID, reviewer_bot_user_id=555, reviewer_login=BOT["login"],
                verifier_app_id=777, enabled=True, live_writes=True)
PROTECTION = {
    "required_status_checks": {"strict": True, "contexts": ["backend", "frontend", "trusted-review-verified"]},
    "required_pull_request_reviews": {"required_approving_review_count": 1, "dismiss_stale_reviews": True},
    "enforce_admins": {"enabled": True}, "required_conversation_resolution": {"enabled": True},
    "allow_force_pushes": {"enabled": False}, "allow_deletions": {"enabled": False},
}
VERIFIER = {"name": "trusted-review-verified", "head_sha": HEAD, "status": "completed", "conclusion": "success",
            "app": {"id": 777}, "output": {"summary": json.dumps({"expires_at": "2026-11-10T12:30:00Z"})}}


def clock():
    return NOW


class Fake:
    """Transport double: GET/GraphQL served statically; PUT recorded (or forbidden)."""

    def __init__(self, w=None, put_ok=True, forbid_put=False):
        self.w = w if w is not None else build()
        self.calls, self.puts, self.put_ok, self.forbid_put = [], [], put_ok, forbid_put

    def _serve(self, key):
        q = self.w[key]
        r = q.pop(0) if len(q) > 1 else q[0]
        if isinstance(r, Exception):
            raise r
        return copy.deepcopy(r)

    def get(self, path, params):
        self.calls.append(("GET", path, params))
        if path == f"{ROOT}/commits/{HEAD}/check-runs" and (params or {}).get("check_name"):
            return self._serve("verifier")
        return self._serve(path) if path in self.w else {"status": 404, "headers": {}, "body": {}}

    def graphql(self, query, variables):
        self.calls.append(("GRAPHQL", query, variables))
        return self._serve("graphql")

    def put(self, path, body):
        if self.forbid_put:
            raise AssertionError("write attempted")
        self.puts.append((path, body))
        if self.put_ok:
            self.w[f"{ROOT}/pulls/{N}"] = [ok(dict(PR, merged=True, merge_commit_sha="d" * 40))]
        return {"status": 200 if self.put_ok else 405, "headers": {}, "body": {}}


PR = {}


def build():
    global PR
    w = world()
    PR = w[f"{ROOT}/pulls/{N}"][0]["body"]
    PR.update({"changed_files": 2, "mergeable": True, "mergeable_state": "clean", "body": "Does docs.\n\nCloses #50\n"})
    w[f"{ROOT}/pulls/{N}"] = [ok(PR)]
    w[f"{ROOT}/branches/develop"] = [ok({"commit": {"sha": BASE}})]
    w[f"{ROOT}/branches/develop/protection"] = [ok(copy.deepcopy(PROTECTION))]
    w["verifier"] = [ok({"total_count": 1, "check_runs": [copy.deepcopy(VERIFIER)]})]
    w[f"{ROOT}/issues/50"] = [ok({"state": "open", "body": "Depends on: #49", "labels": [{"name": "status:review-ready"}, {"name": "unattended-ok"}]})]
    w[f"{ROOT}/issues/49"] = [ok({"state": "closed", "state_reason": "completed", "labels": []})]
    w[f"{ROOT}/issues/49/timeline"] = [ok([{"event": "cross-referenced", "source": {"issue": {
        "pull_request": {"merged_at": "2026-11-01T00:00:00Z"}, "repository": {"full_name": REPO}}}}])]
    w[f"{ROOT}/pulls"] = [ok([{"number": N}])]
    # the collector's reviewer is user id 555 (BOT) and its body is not an attestation; the controller
    # relies on the verifier check + pinned formal approval, so that is enough here.
    return w


def mutate(fn):
    w = build()
    fn(w)
    return w


class Base(unittest.TestCase):
    def setUp(self):
        self._orig = socket.socket.connect
        socket.socket.connect = lambda *a, **k: (_ for _ in ()).throw(AssertionError("network blocked"))

    def tearDown(self):
        socket.socket.connect = self._orig

    def run_(self, w=None, cfg=CFG, **kw):
        f = Fake(w, **kw)
        return dc.run_once(f, cfg, clock), f

    def assertNoMerge(self, w=None, cfg=CFG, reason=None):
        rep, f = self.run_(w, cfg)
        self.assertIsNone(rep.merged, rep.as_dict())
        self.assertEqual(f.puts, [])
        if reason:
            self.assertIn(reason, json.dumps(rep.as_dict()))
        return rep


class Happy(Base):
    def test_all_gates_merge_once_pinned_to_head_squash(self):
        rep, f = self.run_()
        self.assertEqual(rep.errors, [], rep.as_dict())
        self.assertEqual(f.puts, [(f"{ROOT}/pulls/{N}/merge", {"sha": HEAD, "merge_method": "squash"})])
        self.assertTrue(rep.merged["merged_confirmed"])

    def test_dry_run_never_calls_write_transport(self):
        rep, f = self.run_(cfg=replace(CFG, live_writes=False), forbid_put=True)
        self.assertEqual(rep.plans[0]["action"], "MERGE")
        self.assertIsNone(rep.merged)

    def test_replan_before_write_aborts_if_head_moves(self):
        w = build()
        moved = copy.deepcopy(PR)
        moved["head"]["sha"] = "e" * 40
        n_first = [ok(PR)] * 4 + [ok(moved)]  # first evaluation reads 4x; the re-plan sees a moved head
        w[f"{ROOT}/pulls/{N}"] = n_first
        rep, f = self.run_(w)
        self.assertEqual(f.puts, [])


class Gates(Base):
    def test_disabled_by_default(self):
        rep, f = self.run_(cfg=replace(CFG, enabled=False), forbid_put=True)
        self.assertEqual(f.calls, [])
        self.assertIn("AUTO_MERGE_DISABLED", rep.errors)

    def test_trusted_review_kill_switch_off(self):
        self.assertNoMerge(mutate(lambda w: w.update({f"{ROOT}/actions/variables/FLOWTALLY_TRUSTED_REVIEW_ENABLED": [ok({"name": "FLOWTALLY_TRUSTED_REVIEW_ENABLED", "value": "false"})]})), reason="TRUSTED_REVIEW_DISABLED")

    def test_missing_verifier_check(self):
        self.assertNoMerge(mutate(lambda w: w.update({"verifier": [ok({"total_count": 0, "check_runs": []})]})), reason="VERIFIER_PROOF_MISSING_OR_INVALID")

    def test_verifier_check_wrong_app(self):
        def m(w): w["verifier"][0]["body"]["check_runs"][0]["app"]["id"] = 1
        self.assertNoMerge(mutate(m), reason="VERIFIER_PROOF_MISSING_OR_INVALID")

    def test_verifier_check_expired(self):
        def m(w): w["verifier"][0]["body"]["check_runs"][0]["output"]["summary"] = json.dumps({"expires_at": "2026-11-10T11:00:00Z"})
        self.assertNoMerge(mutate(m), reason="VERIFIER_PROOF_MISSING_OR_INVALID")

    def test_verifier_check_failure(self):
        def m(w): w["verifier"][0]["body"]["check_runs"][0]["conclusion"] = "failure"
        self.assertNoMerge(mutate(m), reason="VERIFIER_PROOF_MISSING_OR_INVALID")

    def test_duplicate_verifier_checks_ambiguous(self):
        def m(w): w["verifier"][0]["body"]["check_runs"].append(copy.deepcopy(VERIFIER))
        self.assertNoMerge(mutate(m))

    def test_no_formal_approval_at_head(self):
        def m(w): w[f"{ROOT}/pulls/{N}/reviews"][0]["body"][0]["state"] = "COMMENTED"
        self.assertNoMerge(mutate(m), reason="NO_FORMAL_APPROVAL_AT_HEAD")

    def test_stale_approval(self):
        def m(w): w[f"{ROOT}/pulls/{N}/reviews"][0]["body"][0]["commit_id"] = "f" * 40
        self.assertNoMerge(mutate(m), reason="NO_FORMAL_APPROVAL_AT_HEAD")

    def test_approval_from_unpinned_account(self):
        def m(w): w[f"{ROOT}/pulls/{N}/reviews"][0]["body"][0]["user"] = {"id": 1, "login": "ter-ry", "type": "User"}
        self.assertNoMerge(mutate(m), reason="NO_FORMAL_APPROVAL_AT_HEAD")

    def test_base_not_develop(self):
        def m(w): PR["base"]["ref"] = "main"
        self.assertNoMerge(mutate(m), reason="BASE_NOT_DEVELOP")

    def test_never_targets_main_even_if_listed(self):
        w = build()
        PR["base"]["ref"] = "main"
        rep, f = self.run_(w)
        self.assertEqual(f.puts, [])

    def test_fork_head(self):
        def m(w): PR["head"]["repo"] = {"full_name": "evil/fork", "id": 1}
        self.assertNoMerge(mutate(m), reason="FORK_HEAD")

    def test_draft(self):
        def m(w): PR["draft"] = True
        self.assertNoMerge(mutate(m))

    def test_merge_conflict_or_unknown_mergeability(self):
        for val in ("dirty", "behind", "blocked", "unstable"):
            def m(w, v=val): PR["mergeable_state"] = v
            self.assertNoMerge(mutate(m))

    def test_mergeable_null_still_computing(self):
        def m(w): PR["mergeable"] = None
        self.assertNoMerge(mutate(m))

    def test_changed_files_outside_tier0(self):
        for path in ("backend/app.py", ".github/workflows/x.yml", "src/App.jsx", "AGENTS.md", "docs/DEVELOP_MERGE_POLICY.md"):
            def m(w, p=path): w[f"{ROOT}/pulls/{N}/files"][0]["body"][0]["filename"] = p
            self.assertNoMerge(mutate(m))

    def test_rename_out_of_tier2_path_is_visible(self):
        def m(w): w[f"{ROOT}/pulls/{N}/files"][0]["body"][0].update({"filename": "docs/x.md", "previous_filename": ".github/workflows/x.yml"})
        self.assertNoMerge(mutate(m))

    def test_failing_or_missing_ci(self):
        def m(w): w[f"{ROOT}/commits/{HEAD}/check-runs"][0]["body"]["check_runs"][0]["conclusion"] = "failure"
        self.assertNoMerge(mutate(m))

    def test_unresolved_thread(self):
        def m(w): w["graphql"][0]["body"]["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"][0]["isResolved"] = False
        self.assertNoMerge(mutate(m))

    def test_pending_requested_reviewer(self):
        def m(w): w[f"{ROOT}/pulls/{N}/requested_reviewers"][0]["body"]["users"].append({"login": "someone"})
        self.assertNoMerge(mutate(m))

    def test_api_failure_during_collection_fails_closed(self):
        self.assertNoMerge(mutate(lambda w: w.update({f"{ROOT}/pulls/{N}/commits": [{"status": 500, "headers": {}, "body": {}}]})))

    def test_rate_limit_fails_closed(self):
        self.assertNoMerge(mutate(lambda w: w.update({f"{ROOT}/pulls/{N}/reviews": [{"status": 403, "headers": {}, "body": {}}]})))

    def test_transport_exception_fails_closed(self):
        self.assertNoMerge(mutate(lambda w: w.update({f"{ROOT}/branches/develop": [RuntimeError("boom")]})))


class IssueGates(Base):
    def test_no_linked_issue(self):
        def m(w): PR["body"] = "no link"
        self.assertNoMerge(mutate(m))

    def test_multiple_linked_issues(self):
        def m(w): PR["body"] = "Closes #50\nCloses #51"
        self.assertNoMerge(mutate(m))

    def test_needs_owner_label(self):
        def m(w): w[f"{ROOT}/issues/50"][0]["body"]["labels"].append({"name": "needs-owner"})
        self.assertNoMerge(mutate(m))

    def test_not_unattended_ok(self):
        def m(w): w[f"{ROOT}/issues/50"][0]["body"]["labels"] = [{"name": "status:review-ready"}]
        self.assertNoMerge(mutate(m))

    def test_open_dependency(self):
        def m(w): w[f"{ROOT}/issues/49"][0]["body"]["state"] = "open"
        self.assertNoMerge(mutate(m))

    def test_file_overlap_with_other_open_pr(self):
        def m(w):
            w[f"{ROOT}/pulls"] = [ok([{"number": N}, {"number": 99}])]
            w[f"{ROOT}/pulls/99/files"] = [ok([{"filename": "docs/notes.md"}])]
        self.assertNoMerge(mutate(m))

    def test_non_overlapping_other_pr_is_fine(self):
        w = build()
        w[f"{ROOT}/pulls"] = [ok([{"number": N}, {"number": 99}])]
        w[f"{ROOT}/pulls/99/files"] = [ok([{"filename": "docs/unrelated.md"}])]
        rep, f = self.run_(w)
        self.assertEqual(len(f.puts), 1, rep.as_dict())


class ReviewFindings(Base):
    def test_closed_not_planned_dependency_is_not_satisfied(self):
        def m(w): w[f"{ROOT}/issues/49"][0]["body"]["state_reason"] = "not_planned"
        self.assertNoMerge(mutate(m))

    def test_closed_dependency_without_merged_pr_is_not_satisfied(self):
        for tl in ([], [{"event": "cross-referenced", "source": {"issue": {"pull_request": {"merged_at": None}, "repository": {"full_name": REPO}}}}],
                   [{"event": "cross-referenced", "source": {"issue": {"pull_request": {"merged_at": "2026-11-01T00:00:00Z"}, "repository": {"full_name": "evil/x"}}}}]):
            self.assertNoMerge(mutate(lambda w, tl=tl: w.update({f"{ROOT}/issues/49/timeline": [ok(tl)]})))

    def test_collection_failure_turns_run_red_not_silent(self):
        w = mutate(lambda w: w.update({f"{ROOT}/pulls/{N}/reviews": [{"status": 403, "headers": {}, "body": {}}]}))
        rep, f = self.run_(w)
        self.assertEqual(f.puts, [])
        self.assertTrue(any(e.startswith("INFRA_ERROR") for e in rep.errors), rep.as_dict())

    def test_extras_failure_turns_run_red(self):
        rep, f = self.run_(mutate(lambda w: w.update({f"{ROOT}/branches/develop/protection": [{"status": 403, "headers": {}, "body": None}]})))
        self.assertTrue(any(e.startswith("INFRA_ERROR") for e in rep.errors), rep.as_dict())

    def test_ordinary_blocker_is_not_an_error(self):
        def m(w): PR["draft"] = True
        rep, f = self.run_(mutate(m))
        self.assertEqual(rep.errors, [])

    def test_retargeted_after_replan_is_not_merged(self):
        w = build()
        moved = copy.deepcopy(PR)
        moved["base"]["ref"] = "main"
        w[f"{ROOT}/pulls/{N}"] = [ok(PR)] * 8 + [ok(moved)]  # 2 evaluations x4 reads, then the pre-PUT read
        rep, f = self.run_(w)
        self.assertEqual(f.puts, [])
        self.assertTrue(any(e.startswith("PRE_MERGE_IDENTITY_MISMATCH") for e in rep.errors), rep.as_dict())

    def test_plan_rejects_live_identity_mismatch(self):
        for k, v in (("base_ref", "main"), ("head_sha", "e" * 40), ("base_sha", "e" * 40), ("state", "closed")):
            f = Fake()
            ev = dc.Collector(dc._ReadOnly(f), repository=REPO, repo_id=RID, allowed_bases=("develop",)).collect(N)
            ex = dc.gather_extras(f, CFG, ev)
            self.assertEqual(dc.plan(ev, ex, CFG, NOW).action, "MERGE")
            ex["fresh_pr"][k] = v
            p = dc.plan(ev, ex, CFG, NOW)
            self.assertEqual(p.action, "NONE")
            self.assertIn("LIVE_PR_IDENTITY_MISMATCH", p.reasons)

    def test_overlap_checked_against_prs_targeting_any_base(self):
        w = build()
        w[f"{ROOT}/pulls"] = [ok([{"number": N}, {"number": 99}])]
        w[f"{ROOT}/pulls/99/files"] = [ok([{"filename": "docs/notes.md"}])]
        rep, f = self.run_(w)
        self.assertEqual(f.puts, [])
        listing_calls = [c for c in f.calls if c[1] == f"{ROOT}/pulls" and c[2].get("state") == "open"]
        self.assertTrue(any("base" not in c[2] for c in listing_calls))  # overlap query is not base-filtered

# Shapes captured from GitHub's live REST API for this repository on 2026-11-13 (GET /rules/branches/develop
# and GET /rulesets/{id}); `develop` is guarded by a RULESET and classic protection answers 404 "Branch not
# protected". LIVE_* is the ruleset exactly as it stood then (it does not yet satisfy this actuator).
_RS = 26858821
LIVE_RULES = [
    {"type": "deletion", "ruleset_source_type": "Repository", "ruleset_source": REPO, "ruleset_id": _RS},
    {"type": "non_fast_forward", "ruleset_source_type": "Repository", "ruleset_source": REPO, "ruleset_id": _RS},
    {"type": "required_linear_history", "ruleset_source_type": "Repository", "ruleset_source": REPO, "ruleset_id": _RS},
    {"type": "pull_request", "parameters": {"required_approving_review_count": 0, "dismiss_stale_reviews_on_push": False,
     "required_reviewers": [], "require_code_owner_review": False, "require_last_push_approval": False,
     "required_review_thread_resolution": True, "require_extra_approval_for_unattributed_changes": False,
     "allowed_merge_methods": ["squash"]}, "ruleset_source_type": "Repository", "ruleset_source": REPO, "ruleset_id": _RS},
    {"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": True, "do_not_enforce_on_create": False,
     "required_status_checks": [{"context": "frontend", "integration_id": 15368}, {"context": "backend", "integration_id": 15368}]},
     "ruleset_source_type": "Repository", "ruleset_source": REPO, "ruleset_id": _RS},
]
LIVE_DETAIL = {"id": _RS, "name": "Protect Develop", "enforcement": "active", "bypass_actors": [], "current_user_can_bypass": "never",
               "conditions": {"ref_name": {"exclude": [], "include": ["refs/heads/develop"]}}}
LIVE_RULESET = {"rules": LIVE_RULES, "rulesets": {str(_RS): LIVE_DETAIL}}


def hardened_ruleset():
    p = copy.deepcopy(LIVE_RULESET)
    for r in p["rules"]:
        if r["type"] == "pull_request":
            r["parameters"].update(required_approving_review_count=1, dismiss_stale_reviews_on_push=True)
        if r["type"] == "required_status_checks":
            r["parameters"]["required_status_checks"].append({"context": "trusted-review-verified", "integration_id": 777})
            r["parameters"]["required_status_checks"].append({"context": "trusted-review-security-tests", "integration_id": 15368})
    return p


class Protection(Base):
    def test_good_protection_has_no_problems(self):
        self.assertEqual(dc.protection_problems(PROTECTION), [])

    def test_each_weakening_is_detected(self):
        cases = {
            "PROTECTION_NOT_STRICT": lambda p: p["required_status_checks"].update(strict=False),
            "PROTECTION_MISSING_REQUIRED_CONTEXTS": lambda p: p["required_status_checks"].update(contexts=["backend", "frontend"]),
            "PROTECTION_NO_REQUIRED_CHECKS": lambda p: p.pop("required_status_checks"),
            "PROTECTION_NO_REQUIRED_REVIEW": lambda p: p.pop("required_pull_request_reviews"),
            "PROTECTION_REVIEW_COUNT_TOO_LOW": lambda p: p["required_pull_request_reviews"].update(required_approving_review_count=0),
            "PROTECTION_STALE_REVIEWS_NOT_DISMISSED": lambda p: p["required_pull_request_reviews"].update(dismiss_stale_reviews=False),
            "PROTECTION_REVIEW_BYPASS_ALLOWED": lambda p: p["required_pull_request_reviews"].update(bypass_pull_request_allowances={"users": [{"login": "x"}]}),
            "PROTECTION_ADMINS_NOT_ENFORCED": lambda p: p.update(enforce_admins={"enabled": False}),
            "PROTECTION_CONVERSATIONS_NOT_REQUIRED": lambda p: p.pop("required_conversation_resolution"),
            "PROTECTION_FORCE_PUSH_ALLOWED": lambda p: p.update(allow_force_pushes={"enabled": True}),
            "PROTECTION_DELETION_ALLOWED": lambda p: p.pop("allow_deletions"),
        }
        for reason, fn in cases.items():
            p = copy.deepcopy(PROTECTION)
            fn(p)
            self.assertIn(reason, dc.protection_problems(p), reason)
            w = build()
            w[f"{ROOT}/branches/develop/protection"] = [ok(p)]
            self.assertNoMerge(w, reason=reason)

    def test_protection_unreadable(self):
        self.assertNoMerge(mutate(lambda w: w.update({f"{ROOT}/branches/develop/protection": [{"status": 403, "headers": {}, "body": None}]})), reason="PROTECTION_UNAVAILABLE")

    def test_checks_listed_in_checks_array_form(self):
        p = copy.deepcopy(PROTECTION)
        p["required_status_checks"] = {"strict": True, "checks": [{"context": c} for c in dc.REQUIRED_CONTEXTS]}
        self.assertEqual(dc.protection_problems(p), [])


class Rulesets(Base):
    def test_live_develop_ruleset_is_correctly_insufficient(self):
        # Verified live: no approval required, stale reviews kept, and the verifier check is not required.
        self.assertEqual(dc.ruleset_problems(LIVE_RULESET, 777), [
            "RULESET_REVIEW_COUNT_TOO_LOW", "RULESET_STALE_REVIEWS_NOT_DISMISSED", "RULESET_MISSING_REQUIRED_CONTEXTS"])

    def test_hardened_ruleset_has_no_problems(self):
        self.assertEqual(dc.ruleset_problems(hardened_ruleset(), 777), [])

    def test_each_ruleset_weakening_is_detected(self):
        def rule(p, t):
            return next(r for r in p["rules"] if r["type"] == t)
        cases = {
            "RULESET_UNAVAILABLE": lambda p: p.update(rules=[]),
            "RULESET_FORCE_PUSH_ALLOWED": lambda p: p.update(rules=[r for r in p["rules"] if r["type"] != "non_fast_forward"]),
            "RULESET_DELETION_ALLOWED": lambda p: p.update(rules=[r for r in p["rules"] if r["type"] != "deletion"]),
            "RULESET_NO_REQUIRED_REVIEW": lambda p: p.update(rules=[r for r in p["rules"] if r["type"] != "pull_request"]),
            "RULESET_REVIEW_COUNT_TOO_LOW": lambda p: rule(p, "pull_request")["parameters"].update(required_approving_review_count=0),
            "RULESET_STALE_REVIEWS_NOT_DISMISSED": lambda p: rule(p, "pull_request")["parameters"].update(dismiss_stale_reviews_on_push=False),
            "RULESET_CONVERSATIONS_NOT_REQUIRED": lambda p: rule(p, "pull_request")["parameters"].update(required_review_thread_resolution=False),
            "RULESET_MERGE_METHOD_NOT_ALLOWED": lambda p: rule(p, "pull_request")["parameters"].update(allowed_merge_methods=["merge", "rebase"]),
            "RULESET_NO_REQUIRED_CHECKS": lambda p: p.update(rules=[r for r in p["rules"] if r["type"] != "required_status_checks"]),
            "RULESET_NOT_STRICT": lambda p: rule(p, "required_status_checks")["parameters"].update(strict_required_status_checks_policy=False),
            "RULESET_MISSING_REQUIRED_CONTEXTS": lambda p: rule(p, "required_status_checks")["parameters"].update(
                required_status_checks=[{"context": "backend", "integration_id": 15368}]),
            "RULESET_VERIFIER_SOURCE_NOT_PINNED": lambda p: [c.update(integration_id=999) for c in rule(p, "required_status_checks")["parameters"]["required_status_checks"] if c["context"] == "trusted-review-verified"],
            "RULESET_NOT_ACTIVE": lambda p: p["rulesets"][str(_RS)].update(enforcement="evaluate"),
            "RULESET_BYPASS_ACTORS_PRESENT": lambda p: p["rulesets"][str(_RS)].update(bypass_actors=[{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}]),
            "RULESET_DETAIL_UNAVAILABLE": lambda p: p["rulesets"].clear(),
        }
        for reason, fn in cases.items():
            p = hardened_ruleset()
            fn(p)
            self.assertIn(reason, dc.ruleset_problems(p, 777), reason)
        p = hardened_ruleset()
        p["rulesets"][str(_RS)].pop("bypass_actors")      # unknown bypass list is treated as present
        self.assertIn("RULESET_BYPASS_ACTORS_PRESENT", dc.ruleset_problems(p, 777))
        self.assertIn("RULESET_VERIFIER_SOURCE_NOT_PINNED", dc.ruleset_problems(hardened_ruleset(), None))
        for junk in (None, [], "x", {"rules": "x", "rulesets": {}}, {"rules": [1], "rulesets": {}}):
            self.assertEqual(dc.ruleset_problems(junk, 777), ["RULESET_UNAVAILABLE"])

    def _ruleset_world(self, rs):
        w = build()
        w[f"{ROOT}/branches/develop/protection"] = [{"status": 404, "headers": {}, "body": {"message": "Branch not protected"}}]
        w[f"{ROOT}/rules/branches/develop"] = [ok(rs["rules"])]
        w[f"{ROOT}/rulesets/{_RS}"] = [ok(rs["rulesets"][str(_RS)])]
        return w

    def test_classic_404_falls_back_to_hardened_ruleset_and_merges(self):
        rep, f = self.run_(self._ruleset_world(hardened_ruleset()))
        self.assertEqual(rep.errors, [], rep.as_dict())
        self.assertEqual(len(f.puts), 1)

    def test_classic_404_with_the_live_ruleset_does_not_merge(self):
        self.assertNoMerge(self._ruleset_world(LIVE_RULESET), reason="RULESET_REVIEW_COUNT_TOO_LOW")

    def test_classic_404_and_rules_unreadable_fails_closed_and_red(self):
        w = build()
        w[f"{ROOT}/branches/develop/protection"] = [{"status": 404, "headers": {}, "body": {}}]
        rep = self.assertNoMerge(w, reason="PROTECTION_UNAVAILABLE")
        self.assertTrue(rep.errors)   # infra error: the run goes red, never silently green

    def test_bypass_actor_on_ruleset_blocks_merge(self):
        rs = hardened_ruleset()
        rs["rulesets"][str(_RS)]["bypass_actors"] = [{"actor_id": 1, "actor_type": "OrganizationAdmin", "bypass_mode": "always"}]
        self.assertNoMerge(self._ruleset_world(rs), reason="RULESET_BYPASS_ACTORS_PRESENT")

    def test_ruleset_is_not_read_when_classic_protection_is_sufficient(self):
        _, f = self.run_()
        self.assertFalse([c for c in f.calls if "/rules" in c[1]])


class Actuator(Base):
    def test_at_most_one_merge_per_run(self):
        w = build()
        w[f"{ROOT}/pulls"] = [ok([{"number": N}, {"number": N}])]
        rep, f = self.run_(w)
        self.assertEqual(len(f.puts), 1)

    def test_rejected_put_is_not_retried_and_reported(self):
        rep, f = self.run_(put_ok=False)
        self.assertEqual(len(f.puts), 1)
        self.assertFalse(rep.merged["merged_confirmed"])
        self.assertTrue(any(e.startswith("MERGE_NOT_CONFIRMED") for e in rep.errors))

    def test_forbidden_or_unprocessable_put_is_not_retried(self):
        for status in (403, 422, 409):
            f = Fake()
            f.put = lambda path, body, st=status, calls=[]: (calls.append(1), {"status": st, "headers": {}, "body": {}})[1]
            rep = dc.run_once(f, CFG, clock)
            self.assertFalse(rep.merged["merged_confirmed"])
            self.assertEqual(rep.merged["put_status"], status)

    def test_env_contract_matches_trusted_review_runtime(self):
        import os, re
        wf = (Path(__file__).resolve().parents[2] / ".github/workflows/develop-automerge.yml").read_text()
        for name in ("FLOWTALLY_REPO_ID", "REVIEWER_BOT_USER_ID", "REVIEWER_BOT_LOGIN", "VERIFIER_APP_ID", "TRUSTED_COAUTHOR_EMAILS",
                     "FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED", "FLOWTALLY_DEVELOP_AUTO_MERGE_LIVE_WRITES"):
            self.assertIn(f"{name}: ${{{{ vars.{name} }}}}", wf)
        self.assertNotIn("FLOWTALLY_REVIEWER_", wf)

    def test_approval_matched_by_user_id_not_app_id(self):
        # an App id (e.g. 5684233) must never be accepted in place of the pinned bot user id
        self.assertNoMerge(cfg=replace(CFG, reviewer_bot_user_id=5684233), reason="NO_FORMAL_APPROVAL_AT_HEAD")

    def test_put_exception_reconciles_with_server_state(self):
        f = Fake()
        f.put = lambda path, body: (_ for _ in ()).throw(OSError("reset"))
        rep = dc.run_once(f, CFG, clock)
        self.assertFalse(rep.merged["merged_confirmed"])
        self.assertTrue(rep.errors)

    def test_listing_failure(self):
        rep, f = self.run_(mutate(lambda w: w.update({f"{ROOT}/pulls": [{"status": 500, "headers": {}, "body": None}]})), forbid_put=True)
        self.assertTrue(rep.errors)

    def test_collector_never_receives_write_method(self):
        ro = dc._ReadOnly(Fake())
        self.assertFalse(hasattr(ro, "put"))

    def test_planner_never_raises(self):
        for bad in (None, [], {"pr": 5}, {"pr": {"number": 1}}):
            self.assertEqual(dc.plan(bad, {}, CFG, NOW).action, "NONE")

    def test_main_disabled_exits_zero_without_env(self):
        import os
        old = dict(os.environ)
        try:
            os.environ.pop(dc.ENABLE_VARIABLE, None)
            self.assertEqual(dc.main([]), 0)
            os.environ[dc.ENABLE_VARIABLE] = "true"
            for k in ("GITHUB_REPOSITORY", "GITHUB_TOKEN"):
                os.environ.pop(k, None)
            self.assertEqual(dc.main([]), 1)  # armed but misconfigured: fail loudly, no network
        finally:
            os.environ.clear()
            os.environ.update(old)


if __name__ == "__main__":
    unittest.main()
