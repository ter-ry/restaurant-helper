---
name: flowtally-acceptance
description: Check a Flowtally change against its issue's acceptance criteria and owner decisions - business calculations, errors, tenant isolation, UI behaviour on mobile and desktop - and report only genuine remaining gaps. Use when asked whether a PR or issue is done, ready for review, or accepted, or when writing or reviewing acceptance evidence.
---

# Flowtally acceptance

Invariants and the review protocol are in `AGENTS.md`; scope is in `docs/RELEASE_PLAN.md`. This skill is the checking sequence. Read-only: it changes code only if the user asked you to fix gaps.

## 1. Criteria

Read the issue (`issue_read` body and comments) and the PR description. List acceptance criteria as a checklist. Collect every `OWNER DECISION:` comment; they override assumptions. If a criterion depends on an unrecorded owner decision, that is `BLOCKED`, not a gap you invent an answer for.

## 2. Map criteria to code and tests

For each criterion find the implementation and the test that exercises it (`git diff origin/main...HEAD`, Grep). A criterion is covered only if a test runs the real path (endpoint/service, flag on, PostgreSQL where RLS or locking matters), not a mock of it. Run the specific tests via `flowtally-verify`; do not trust a green CI badge alone.

## 3. Check what applies

- **Calculations:** recompute one expected value by hand (units, weighted-average cost, rounding, taxes); ledger movements reconcile to on-hand; replay/retry is idempotent.
- **Errors:** invalid input, duplicate submit, upstream (POS/OCR) failure, partial failure rollback; user-visible messages, no silent mutations.
- **Tenant isolation:** every new query/endpoint is organization/location scoped; a second-tenant test proves no read or write across it; RLS policy and migration present for new tables; no Square change while working on Clover.
- **UI:** states for loading, success, failure and disabled-during-submit; data re-fetched afterwards. Run `npm run dev`, then check the affected routes (see `AGENTS.md`) at about 390x844 and 1280x800 with the preinstalled Playwright (`require('playwright')`, `chromium.launch()`): no horizontal scroll, tap targets usable, nothing clipped. Screenshots for your own checking use scale 1.

## 4. Classify evidence honestly

Use the status vocabulary of `docs/RELEASE_STATUS.md`. Local automated tests, local browser checks and mocked provider responses are **Automated tests passed**. **Sandbox or Showcase verified** requires a real Square/Clover Sandbox or the Showcase environment, which needs owner approval and credentials; agents do not do it from a cloud session. State it as an owner action, not as a failure, and never claim it from local results.

## 5. Report

Output per criterion: met (evidence: test/file or command) / gap / blocked-on-owner. List only genuine gaps with file, observed vs expected and a suggested test. Do not pad with style nits or already-resolved items. End with exact head SHA reviewed. If you are not the PR author, you may post `APPROVE`/`REQUEST CHANGES`/`BLOCKED @ <sha>` per `AGENTS.md`; never for your own PR.
