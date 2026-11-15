# Review-thread handoff runbook (#305)

Problem: a PR can have green exact-head CI and an independent `APPROVE @ <sha>` yet stay GitHub-`blocked` because an inline review thread was replied to but never **resolved** (Protect Main requires thread resolution). This runbook makes the handoff explicit and observable. It does not change rulesets, reviewer attestation or the owner-only merge policy.

## States (`scripts/review_thread_handoff.py`)

| State | Meaning | Next actor |
|---|---|---|
| `FINDING_OPEN` | Unresolved thread, no `Fixed @ <head>` reply | Author fixes |
| `FIX_PENDING_VERIFICATION` | Unresolved thread answered `Fixed @ <head>` | Independent reviewer verifies, resolves the thread or posts `REQUEST CHANGES @ <sha>` |
| `APPROVAL_STALE` | Only verdicts at other SHAs | Reviewer re-reviews head |
| `CI_NOT_GREEN` | Required checks (`backend`, `frontend`) not successful at head | Author |
| `THREADS_RESOLVED_AWAITING_REVIEW` | Threads resolved, no independent `APPROVE` at head | Reviewer |
| `OWNER_MERGE_PENDING` | Threads resolved (GitHub flag), CI green at head, independent `APPROVE @ head` | Owner merges |
| `BLOCKED_UNVERIFIED` | Thread state unknown, ambiguous, paginated or head unknown | Use manual fallback; report blocker |

`OWNER MERGE READY` may be written only in `OWNER_MERGE_PENDING`.

## Responsibilities

- **Author:** after each push, reply on the exact thread `Fixed @ <head SHA>` plus the test/evidence. Then read GitHub's real `isResolved` flag (GraphQL `reviewThreads`, or the PR UI) at the current head. If any thread is still unresolved, post the handoff comment (below) addressed to the independent reviewer. An author never resolves a thread to claim reviewer approval and never impersonates the reviewer; resolving one's own answered thread is allowed only when the owner or AGENTS.md says so and must be labelled "author resolved, not an approval".
- **Reviewer:** on a fix plus green exact-head CI, verify the change and each original finding. If satisfied, resolve that specific thread (authorized account, no mass-resolve) and post `APPROVE @ <sha>`. If not, leave it open and post `REQUEST CHANGES @ <sha>`. If the reviewer account lacks resolve permission, say so and escalate to the owner; never treat it as resolved.
- **Scheduled workers (watchdog):** at the start of each run, for every PR labelled `status:review-ready`, run the classifier. Post at most one handoff comment per (PR, head, state, thread set): the script emits a `<!-- thread-handoff:<key> -->` marker and suppresses the message if the marker is already in the PR comments. No new always-on job exists; the existing scheduled runs are the mechanism.

## Running it

Offline (preferred in cloud sessions where GraphQL is blocked): build a snapshot JSON (`pr`, `threads` with `isResolved`, `threads_verified`, `checks` with `id`/`started_at`, `comments` with `user.login` and `created_at`) from the GitHub MCP tools (`get_review_comments` returns thread resolved flags) and run `python scripts/review_thread_handoff.py --snapshot snap.json`.

Online: `GITHUB_TOKEN=<read-only token> python scripts/review_thread_handoff.py --pr N` reads thread state only (GraphQL, read scope). The online mode does not fetch checks or comments, so it can never report `OWNER_MERGE_PENDING`; use a snapshot for that. Any API error, missing token or more than 100 threads gives `BLOCKED_UNVERIFIED` (exit 2).

## Manual fallback

If thread state cannot be read: open the PR "Conversation" tab, confirm there is no "unresolved conversation" banner, and record "threads verified manually @ <sha>" in a PR comment. Without that, report the blocker; never assume resolved.

## Handoff comment format

The script's `message` field: PR, head SHA, state, thread ids, reasons, and the instruction to verify and resolve or request changes. It is not an approval and gives no merge authorization.

## Fail-closed identity and ordering rules

- Only the latest verdict per reviewer at the head counts (by `created_at`); several verdicts from one reviewer without timestamps are unverified.
- A missing PR author login or a verdict comment with no commenter login blocks approval.
- Several runs of one required check at the head: the latest by `started_at`/`id` counts; ambiguous ordering is treated as not green.
