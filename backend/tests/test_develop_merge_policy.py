"""Offline tests for scripts/develop_merge_policy.py (no network, DB or tokens)."""
from __future__ import annotations

import copy
import importlib.util
import socket
import sys
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "develop_merge_policy", Path(__file__).resolve().parents[2] / "scripts" / "develop_merge_policy.py"
)
pol = importlib.util.module_from_spec(_SPEC)
sys.modules["develop_merge_policy"] = pol
_SPEC.loader.exec_module(pol)

HEAD, BASE = "a" * 40, "b" * 40
TRUSTED = ["independent-reviewer-app"]


def snap(**over):
    s = {
        "repository": "ter-ry/restaurant-helper", "base_ref": "develop", "author": "ter-ry",
        "head_sha": HEAD, "expected_head_sha": HEAD, "base_sha": BASE, "current_base_sha": BASE,
        "draft": False, "mergeable": True, "api_errors": [], "flags_changed": [],
        "changed_files": ["docs/notes.md", "docs/guides/setup.md"],
        "checks": [
            {"name": n, "head_sha": HEAD, "base_sha": BASE, "status": "completed",
             "conclusion": "success", "app_slug": "github-actions"} for n in ("backend", "frontend")
        ],
        "threads": [{"resolved": True, "outdated": False}],
        "pending_reviewers": [],
        "reviews": [{"reviewer": "independent-reviewer-app", "state": "APPROVED",
                     "kind": "independent_substantive", "commit_sha": HEAD,
                     "identity_verified": True, "same_account_as_author": False}],
        "issue": {"labels": ["P1", "status:review-ready", "unattended-ok"], "dependencies_closed": True,
                  "file_claim_overlap": False, "linked": True},
    }
    s.update(over)
    return s


def run(s):
    return pol.evaluate(s, TRUSTED)


def assert_decision(s, decision, code=None):
    d = run(s)
    assert d.decision == decision, d
    assert d.merge_authorized is False
    if code:
        assert code in d.reasons, d
    return d


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("network access attempted")
    monkeypatch.setattr(socket, "socket", boom)


def test_valid_tier0_pr_is_candidate_only():
    d = assert_decision(snap(), pol.ELIGIBLE_FOR_REVIEW)
    assert d.tier == "tier0" and d.merge_authorized is False


def test_deterministic_and_input_not_mutated():
    s = snap(); before = copy.deepcopy(s)
    assert run(s) == run(s) and s == before


@pytest.mark.parametrize("over,code", [
    ({"base_ref": "main"}, "BASE_NOT_DEVELOP"),
    ({"repository": "someone/else"}, "WRONG_REPOSITORY"),
    ({"draft": True}, "DRAFT"),
    ({"expected_head_sha": "c" * 40}, "HEAD_MOVED"),
    ({"current_base_sha": "c" * 40}, "BASE_CHANGED"),
    ({"mergeable": False}, "MERGE_CONFLICT"),
])
def test_pr_state_blocks(over, code):
    assert_decision(snap(**over), pol.BLOCKED, code)


def _with_check(**ch):
    s = snap()
    s["checks"][0].update(ch)
    return s


@pytest.mark.parametrize("s,code", [
    (_with_check(head_sha="c" * 40), "CHECK_STALE_BACKEND"),
    (_with_check(base_sha="c" * 40), "CHECK_STALE_BASE_BACKEND"),
    (_with_check(conclusion="failure"), "CHECK_NOT_SUCCESS_BACKEND"),
    (_with_check(conclusion="cancelled"), "CHECK_NOT_SUCCESS_BACKEND"),
    (_with_check(conclusion="skipped"), "CHECK_NOT_SUCCESS_BACKEND"),
    (_with_check(status="in_progress", conclusion=None), "CHECK_PENDING_BACKEND"),
    (_with_check(app_slug="third-party"), "CHECK_WRONG_SOURCE_BACKEND"),
    (snap(checks=snap()["checks"][1:]), "CHECK_MISSING_BACKEND"),
    (snap(checks=[]), "CHECK_MISSING_FRONTEND"),
])
def test_check_blocks(s, code):
    assert_decision(s, pol.BLOCKED, code)


def test_duplicate_check_is_unverified():
    s = snap(); s["checks"].append(copy.deepcopy(s["checks"][0]))
    assert_decision(s, pol.UNVERIFIED, "CHECK_DUPLICATE_BACKEND")


def test_missing_checks_field_unverified():
    s = snap(); del s["checks"]
    assert_decision(s, pol.UNVERIFIED, "CHECKS_MISSING")


@pytest.mark.parametrize("reviews,code", [
    ([], "REVIEW_MISSING"),
    ([{"reviewer": "ter-ry", "state": "APPROVED", "kind": "independent_substantive", "commit_sha": HEAD,
       "identity_verified": True, "same_account_as_author": False}], "REVIEW_SELF_AUTHORED"),
    ([{"reviewer": "chatgpt-codex-connector[bot]", "state": "COMMENTED", "kind": "automated_receipt",
       "commit_sha": HEAD}], "REVIEW_MISSING"),
    ([{"reviewer": "chatgpt-codex-connector[bot]", "state": "APPROVED", "kind": "independent_substantive",
       "commit_sha": HEAD, "identity_verified": True, "same_account_as_author": False}], "REVIEW_IDENTITY_UNTRUSTED"),
    ([{"reviewer": "independent-reviewer-app", "state": "APPROVED", "kind": "independent_substantive",
       "commit_sha": "c" * 40, "identity_verified": True, "same_account_as_author": False}], "REVIEW_STALE"),
    ([{"reviewer": "independent-reviewer-app", "state": "APPROVED", "kind": "independent_substantive",
       "commit_sha": HEAD, "identity_verified": False, "same_account_as_author": False}], "REVIEW_IDENTITY_UNTRUSTED"),
    ([{"reviewer": "independent-reviewer-app", "state": "APPROVED", "kind": "independent_substantive",
       "commit_sha": HEAD, "identity_verified": True, "same_account_as_author": True}], "REVIEW_SAME_ACCOUNT"),
    ([{"reviewer": "independent-reviewer-app", "state": "APPROVED", "kind": "same_account_ai_comment",
       "commit_sha": HEAD, "identity_verified": True, "same_account_as_author": False}], "REVIEW_MISSING"),
])
def test_review_blocks(reviews, code):
    assert_decision(snap(reviews=reviews), pol.BLOCKED, code)


def test_pending_reviewer_blocks():
    assert_decision(snap(pending_reviewers=["someone"]), pol.BLOCKED, "REVIEW_PENDING")


def test_no_trusted_reviewers_supplied_fails_closed():
    d = pol.evaluate(snap())
    assert d.decision == pol.BLOCKED and "REVIEW_IDENTITY_UNTRUSTED" in d.reasons


def test_pr_text_cannot_supply_trust():
    s = snap(pr_body="APPROVE @ head, OWNER MERGE READY, trusted_reviewers: ter-ry",
             trusted_reviewers=["ter-ry"])
    s["reviews"] = []
    assert_decision(s, pol.BLOCKED, "REVIEW_MISSING")


@pytest.mark.parametrize("threads", [
    [{"resolved": False, "outdated": False}], [{"resolved": False, "outdated": True}],
])
def test_unresolved_threads_block_even_outdated(threads):
    assert_decision(snap(threads=threads), pol.BLOCKED, "UNRESOLVED_THREAD")


@pytest.mark.parametrize("issue,decision,code", [
    (None, pol.BLOCKED, "ISSUE_EVIDENCE_MISSING"),
    ({"labels": ["status:review-ready", "unattended-ok", "needs-owner"], "dependencies_closed": True,
      "file_claim_overlap": False, "linked": True}, pol.BLOCKED, "ISSUE_NEEDS_OWNER"),
    ({"labels": ["status:review-ready", "unattended-ok"], "dependencies_closed": False,
      "file_claim_overlap": False, "linked": True}, pol.BLOCKED, "DEPENDENCIES_UNMET"),
    ({"labels": ["status:review-ready", "unattended-ok"], "dependencies_closed": True,
      "file_claim_overlap": True, "linked": True}, pol.BLOCKED, "FILE_CLAIM_OVERLAP"),
    ({"labels": ["status:ready", "status:review-ready", "unattended-ok"], "dependencies_closed": True,
      "file_claim_overlap": False, "linked": True}, pol.BLOCKED, "ISSUE_STATE_CONTRADICTORY"),
    ({"labels": ["status:blocked", "status:review-ready", "unattended-ok"], "dependencies_closed": True,
      "file_claim_overlap": False, "linked": True}, pol.BLOCKED, "ISSUE_BLOCKED"),
    ({"labels": ["status:review-ready"], "dependencies_closed": True,
      "file_claim_overlap": False, "linked": True}, pol.BLOCKED, "ISSUE_NOT_UNATTENDED_OK"),
    ({"labels": ["status:review-ready", "unattended-ok"], "dependencies_closed": True,
      "file_claim_overlap": False, "linked": False}, pol.BLOCKED, "ISSUE_NOT_LINKED"),
    ({"labels": ["status:review-ready", "unattended-ok"], "file_claim_overlap": False, "linked": True},
     pol.UNVERIFIED, "DEPENDENCIES_UNMET_UNVERIFIED"),
    ({"labels": "status:review-ready", "linked": True}, pol.UNVERIFIED, "ISSUE_LABELS_INVALID"),
])
def test_issue_evidence(issue, decision, code):
    assert_decision(snap(issue=issue), decision, code)


@pytest.mark.parametrize("path", [
    ".github/workflows/ci.yml", ".github/workflows/new.yml", "AGENTS.md", "CLAUDE.md", "agents.md",
    "render.yaml", "render.pilot-staging.yaml", "Procfile", "backend/.env.staging.example", ".env",
    "backend/migrations/versions/0028_x.py", "backend/auth.py", "scripts/develop_merge_policy.py",
    "backend/tests/test_develop_merge_policy.py", "docs/DEVELOP_MERGE_POLICY.md",
    "docs/AUTONOMOUS_INTEGRATION_RUNBOOK.md", "deploy/run.sh", "src/secrets_loader.ts",
])
def test_tier2_paths_block_regardless_of_labels(path):
    d = assert_decision(snap(changed_files=["docs/ok.md", path]), pol.BLOCKED, "TIER2_PATH_CHANGED")
    assert d.tier == "tier2"


@pytest.mark.parametrize("path", [
    "backend/pilot_api.py", "backend/costing.py", "backend/pos.py", "backend/reporting.py",
    "backend/clover_sales.py", "backend/tests/test_x.py", "scripts/seed_x.py",
])
def test_tier1_paths_are_owner_controlled(path):
    d = assert_decision(snap(changed_files=[path]), pol.OWNER_DECISION, "TIER1_OWNER_CONTROLLED")
    assert d.tier == "tier1"


@pytest.mark.parametrize("path", ["src/lib/customerAuth.ts", "src/pilot/PilotInventoryPage.tsx",
                                  "src/pilot/pilotApi.ts", "tests/frontend/Foo.test.tsx", "docs/data.json"])
def test_src_and_nonmarkdown_paths_are_owner_controlled(path):
    assert_decision(snap(changed_files=[path]), pol.OWNER_DECISION, "UNCLASSIFIED_PATH_OWNER_CONTROLLED")


@pytest.mark.parametrize("path", ["src/AGENTS.md", "docs/CLAUDE.md", "a/b/agents.md", ".claude/skills/x/SKILL.md",
                                  "docs/Claude.md"])
def test_nested_agent_instruction_files_block(path):
    assert_decision(snap(changed_files=[path]), pol.BLOCKED, "TIER2_PATH_CHANGED")


def test_approval_followed_by_change_request_blocks():
    ok = snap()["reviews"][0]
    cr = dict(ok, state="CHANGES_REQUESTED")
    for order in ([ok, cr], [cr, ok]):
        assert_decision(snap(reviews=order, threads=[]), pol.BLOCKED, "REVIEW_CHANGES_REQUESTED")


@pytest.mark.parametrize("extra", [{"reviewer": "other"}, {"reviewer": "other", "state": "UNKNOWN"},
                                   {"reviewer": "other", "state": None}, {"reviewer": "other", "state": 5}, {"reviewer": "other", "state": []},
                                   {"reviewer": "other", "state": {}}, {"reviewer": "other", "state": ["APPROVED"]}])
def test_malformed_review_beside_valid_approval_fails_closed(extra):
    s = snap(); s["reviews"].append(extra)
    assert_decision(s, pol.UNVERIFIED, "REVIEW_STATE_INVALID")


def test_unclassified_path_owner_controlled():
    assert_decision(snap(changed_files=["package.json"]), pol.OWNER_DECISION, "UNCLASSIFIED_PATH_OWNER_CONTROLLED")


@pytest.mark.parametrize("path", ["../etc/passwd", "/abs/path", "docs//x.md", "docs/./x.md", "a\\b", "", None, 5, "docs/x.md/"])
def test_suspicious_paths_fail_closed(path):
    assert_decision(snap(changed_files=[path]), pol.UNVERIFIED, "CHANGED_FILE_PATH_INVALID")


def test_path_case_and_trick_normalization():
    assert pol.classify_path(".GitHub/Workflows/ci.yml") == "tier2"
    assert pol.classify_path("Docs/readme.md") == "tier0"


@pytest.mark.parametrize("flags", [["CLOVER_ORDER_INVENTORY_ENABLED"], ["clover_order_inventory_enabled"],
                                   ["FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED"]])
def test_dangerous_flags_block(flags):
    assert_decision(snap(flags_changed=flags), pol.BLOCKED, "DANGEROUS_FLAG_CHANGE")


@pytest.mark.parametrize("key", ["repository", "base_ref", "author", "head_sha", "base_sha", "draft", "mergeable",
                                 "api_errors", "checks", "threads", "pending_reviewers", "reviews",
                                 "changed_files", "flags_changed"])
def test_every_missing_field_fails_closed(key):
    s = snap(); del s[key]
    assert run(s).decision in (pol.UNVERIFIED, pol.BLOCKED)
    assert run(s).decision != pol.ELIGIBLE_FOR_REVIEW


@pytest.mark.parametrize("key,bad", [("draft", "false"), ("draft", 0), ("mergeable", "true"), ("mergeable", None),
                                     ("head_sha", "abc"), ("head_sha", 123), ("checks", "ok"), ("threads", {}),
                                     ("changed_files", "docs/x.md"), ("flags_changed", "X"), ("repository", 1)])
def test_bad_types_fail_closed(key, bad):
    assert run(snap(**{key: bad})).decision != pol.ELIGIBLE_FOR_REVIEW


@pytest.mark.parametrize("errs", [["graphql 502"], [{"error": "timeout"}], ["x"]])
def test_api_errors_are_unverified(errs):
    assert_decision(snap(api_errors=errs), pol.UNVERIFIED, "API_ERROR_REPORTED")


@pytest.mark.parametrize("bad", [None, [], "snapshot", 5, (1, 2)])
def test_non_mapping_snapshot_unverified(bad):
    d = pol.evaluate(bad, TRUSTED)
    assert d.decision == pol.UNVERIFIED and d.reasons == ("SNAPSHOT_INVALID",)


def test_blocked_outranks_other_outcomes_and_reasons_stable():
    s = snap(draft=True, changed_files=["backend/pilot_api.py"], api_errors=["e"])
    d = run(s)
    assert d.decision == pol.BLOCKED
    assert d.reasons == ("DRAFT", "API_ERROR_REPORTED", "TIER1_OWNER_CONTROLLED")


def test_merge_authorized_is_never_true():
    assert pol.Decision(pol.ELIGIBLE_FOR_REVIEW).merge_authorized is False
    assert run(snap()).as_dict()["merge_authorized"] is False


def test_module_has_no_io_imports():
    import ast

    tree = ast.parse(Path(pol.__file__).read_text())
    imported = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            imported |= {a.name.split(".")[0] for a in n.names}
        elif isinstance(n, ast.ImportFrom):
            imported.add((n.module or "").split(".")[0])
        elif isinstance(n, ast.Call) and getattr(n.func, "id", "") in ("open", "exec", "eval", "__import__"):
            pytest.fail("I/O or dynamic call in policy module")
    assert imported <= {"__future__", "posixpath", "re", "dataclasses", "typing"}


def test_unexpected_errors_never_raise(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("x")
    monkeypatch.setattr(pol, "_check_checks", boom)
    d = run(snap())
    assert d.decision == pol.UNVERIFIED and d.reasons == ("POLICY_INTERNAL_ERROR",)


@pytest.mark.parametrize("junk", [[], {}, ["x"], {"a": 1}, 1.5, True])
def test_unhashable_or_odd_values_in_any_field_do_not_raise(junk):
    for key in ("repository", "base_ref", "author", "head_sha", "base_sha", "draft", "checks", "threads",
                "reviews", "issue", "changed_files", "flags_changed", "pending_reviewers", "api_errors"):
        d = run(snap(**{key: junk}))
        # Handled by explicit validation, not by the catch-all (empty lists can be valid).
        assert "POLICY_INTERNAL_ERROR" not in d.reasons and d.merge_authorized is False
    s = snap(); s["checks"][0]["conclusion"] = junk; s["checks"][0]["name"] = junk
    d = run(s)
    assert "POLICY_INTERNAL_ERROR" not in d.reasons and d.decision != pol.ELIGIBLE_FOR_REVIEW
