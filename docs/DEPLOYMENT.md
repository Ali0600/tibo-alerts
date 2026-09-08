# Initial deployment — 2026-09-08

- Site: https://tibo-alerts.a-hassan0600.chatgpt.site — owner-only access.
- Public source: https://github.com/Ali0600/tibo-alerts; implementation merged through PR #1.
- Published implementation: `f4b7289394b2ae83db1a6b5400efad8cfe0f8284`, Sites version 1, runtime environment revision 2.
- All launch and channel flags remain false. No genuine X session, Brevo account credentials, opted-in recipient or delivered push has been connected/proven.

## Already configured

Sites holds `APP_ORIGIN`, repository URL, public VAPID key and secret `DATA_KEY`, `SCANNER_SECRET`, `DELIVERY_SECRET`, `BREVO_WEBHOOK_SECRET`. Matching scanner/delivery credentials and the VAPID private key are in the GitHub `notifications` environment. That environment accepts only the `main` branch. Its non-secret values are `APP_ORIGIN`, `VAPID_PUBLIC_KEY`, and `VAPID_SUBJECT` (the project URL). Repository variable `WORKER_ENABLED=false` keeps scheduling disabled.

A local Docker test app remains available at http://localhost:4318 with no scanner running. The original checkout’s ignored `.env` records that port/origin; clones use the documented defaults.

The generated key backup is the ignored, owner-readable `.env` in the original local checkout. Do not regenerate `DATA_KEY` after storing subscriptions. Clones need their own generated keys; no keys are committed.

For this installation, the operator still needs to add `TWITTER_AUTH_TOKEN`, `BREVO_API_KEY` and verified sender `EMAIL_FROM`, establish `EXPECTED_SOURCE_ID` through genuine-source proof, and complete the opted-in delivery checks in [OPERATIONS.md](OPERATIONS.md). Internal credentials alone do not bypass Sites owner-only access; GitHub/API reachability must be validated before public operation.

## Verified evidence

[Implementation CI](https://github.com/Ali0600/tibo-alerts/actions/runs/34241990594) passed 64 tests, eight intentional guard failures, type checking, linting, dependency audit, both production builds, Docker app startup/recreation and the source-worker import check. Hosted initial JavaScript plus the entire compressed homepage was 149,887 bytes in CI, below the 150,000-byte gate.

The hosted runtime check used actual workerd/D1, migrations, 100-post synthetic ingestion, deduplication and atomic rollback. Docker retained an exact database timestamp across container replacement. Local mobile UI and valid/invalid WebMCP timezone changes were checked. These are implementation checks, not live source or notification acceptance.
