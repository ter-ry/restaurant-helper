"""Privileged, read-only ruleset observer. Its private key never enters the merger job."""
from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone

from cryptography.hazmat.primitives import serialization

try:
    from scripts.ruleset_attestation import sign
except ImportError:  # pragma: no cover
    from ruleset_attestation import sign


def _get(token: str, path: str):
    req = urllib.request.Request("https://api.github.com" + path, headers={
        "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "flowtally-ruleset-observer"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:  # noqa: S310 - fixed GitHub host
            return json.loads(response.read() or b"null")
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError) as exc:
        raise RuntimeError("observer_api_failed") from exc


def collect(repository: str, token: str) -> dict[str, object]:
    root, result = "/repos/" + repository, {}
    for branch in ("main", "develop"):
        rules = _get(token, f"{root}/rules/branches/{branch}")
        if not isinstance(rules, list) or not rules or len(rules) >= 100:
            raise RuntimeError("observer_rules_invalid")
        details = {}
        for rule in rules:
            rid = rule.get("ruleset_id") if isinstance(rule, dict) else None
            if not isinstance(rid, int) or isinstance(rid, bool):
                raise RuntimeError("observer_rules_invalid")
            if str(rid) in details:
                continue
            detail = _get(token, f"{root}/rulesets/{rid}")
            if not isinstance(detail, dict) or detail.get("enforcement") != "active" \
                    or not isinstance(detail.get("bypass_actors"), list) or detail["bypass_actors"]:
                raise RuntimeError("observer_bypass_or_ruleset_invalid")
            details[str(rid)] = detail
        result[branch] = {"rules": rules, "rulesets": details}
    return result


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--output", required=True); args = parser.parse_args()
    token, key_pem, repository, app_id = (os.environ.get(x, "") for x in (
        "FLOWTALLY_RULESET_OBSERVER_TOKEN", "FLOWTALLY_RULESET_OBSERVER_PRIVATE_KEY",
        "GITHUB_REPOSITORY", "FLOWTALLY_RULESET_OBSERVER_APP_ID"))
    if not token or not key_pem or not repository or not app_id.isdigit() or int(app_id) <= 0:
        raise SystemExit("observer_configuration_invalid")
    key = serialization.load_pem_private_key(key_pem.encode("ascii"), password=None)
    document = sign(repository=repository, observer_app_id=int(app_id), branches=collect(repository, token),
                    now=datetime.now(timezone.utc), private_key=key)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(document, handle, sort_keys=True, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
