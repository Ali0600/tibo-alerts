# Decisions

## Backlog — alternatives worth trying later

- An always-on self-hosted worker, instead of GitHub scheduling, when an existing server is available. The included Docker worker is the implementation seam.
- A documented official X read API if a suitable genuinely free tier becomes available. Replace the collector behind the validated source-batch contract, preserving source proof and health gates.

## 2026-09-08 — Free notification channels

**Fork:** phone-number/SMS signup versus email and browser push.

- SMS: broadly familiar, but no sustainable no-cost public delivery path. **Rejected — conflicts with the user’s free-only plan.**
- Email and Web Push: free capped email plus device notifications without phone-number storage. **Chosen by the user in the implementation plan.**

**Revisit hook:** none in the current schema; channels deliberately allow only `email` and `push`. Adding SMS would require a new explicit product decision, provider and consent model.

## 2026-09-08 — Source access and scheduling

**Fork:** paid API/service, authenticated RSSHub adapter in public GitHub Actions, or an existing self-hosted runner.

- Paid API or commercial feed fallback: easier contracted access in some cases. **Rejected — additional cost is not allowed; no automatic fallback.**
- Operator-owned X session and guarded pinned RSSHub adapter, scheduled on public GitHub Actions: no additional service purchase, but fragile upstream access and best-effort timing. **Chosen by the user as the hosted planning default, subject to genuine source validation.**
- Existing always-on host: steadier execution without GitHub inactivity shutdown; requires infrastructure the operator already has. **Deferred — worth trying**, and supported by Docker.
- Official free X read access: cleaner documented boundary if available. **Deferred — worth trying**, contingent on verified access/cost.

**Revisit hook:** `scripts/source-check.mjs` returns a validated batch to the ingestion API; scheduling calls the same `worker/run.ts`.

## 2026-09-08 — Hosted and self-hosted persistence

**Fork:** one managed-only backend versus portable application logic with two SQL bindings.

- Managed-only service: simpler packaging, but prevents independent hosting. **Rejected — open-source self-hosting is a requirement.**
- D1 for Sites and SQLite for Docker, sharing migrations and domain code: **chosen in the approved plan**. Runtime wrappers handle transaction execution; the worker communicates over HTTP.

**Revisit hook:** `core/types.ts` Database interface and `runtime/` adapters. Schema changes must remain compatible with both databases.
