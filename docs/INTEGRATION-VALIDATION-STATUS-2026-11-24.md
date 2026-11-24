# Mainline integration validation snapshot — 2026-11-24

This document records the purpose and validation boundaries of the temporary mainline integration candidate.

## Scope

- AI discovery and site-quality shadow stack previously developed in the integration branch.
- Crawl source registry, persistent queue, worker leases/retries/dead letters, candidate review and domain-family quality governance.
- AI moderation engine, persisted moderation policy, decision ledger, blinded gold annotation and independent adjudication.
- Offline gold evaluation, automated model evaluation, quality alerts, stratified sampling, per-case diagnostics, leaderboard and regression-pack export.
- PostgreSQL/SQLite migration coverage, route registration, admin UI and generated route-policy entries.

## Safety boundaries

- AI moderation remains advisory/Shadow only. No automatic approve, reject, publish, delete or domain merge.
- Model evaluation is administrator-triggered; this integration does not launch bulk paid model calls.
- Search gold data must come from real de-identified queries, human privacy review, two independent annotators and an independent adjudicator. Synthetic test fixtures are not production gold data.
- Regression exports contain structured IDs/labels only, not original URLs or page bodies.

## Validation status

The previous CI run was attached to an earlier head and is not evidence for this snapshot. The current head must pass the repository's SQLite, PostgreSQL, TypeScript, frontend lint/build, Playwright, ISR, route-policy, overlay and patch-coverage checks before this integration is eligible for splitting into small main-targeted PRs.

This file contains no real user queries, website content, credentials or model outputs.
