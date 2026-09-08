# Implementation and acceptance

## Implemented

- [x] Sites TypeScript UI, mobile layout, dark/light appearance and timezone selection.
- [x] Email and browser-push signup, explicit confirmation, separate management sessions, preferences and unsubscribe.
- [x] D1/SQLite schema, encrypted destinations, durable jobs and independent credentials.
- [x] Conservative recognition, relative/explicit time conversion, deadline separation and correction revisions.
- [x] Authenticated pinned source harness with reply/quote handling, source diagnostic and sticky primary-window coverage gaps.
- [x] Brevo/Web Push/SMTP transports, rolling quotas, bounded claims/retries and expiration.
- [x] Private scoped delivery-test tooling and device preparation page.
- [x] Docker packaging, pinned CI and disabled-by-default scheduled worker.
- [x] MIT license, setup/operations documentation and decision/learning logs.

## Validation

- [x] SQLite integration, parser, source and transport tests pass without real sends.
- [x] Eight critical guard mutations are caught by failing tests.
- [x] Source reader imports without network access, locally and in Docker.
- [x] Hosted Worker/D1 migrations, maximum-window ingestion, deduplication and transaction rollback pass locally.
- [x] Both runtime bundle checks include all initial JavaScript plus HTML and stay below 150,000 gzip bytes.
- [x] Clean Docker app startup, database health and exact data persistence across container recreation observed locally.
- [x] Mobile/browser UI and WebMCP valid/invalid timezone checks completed.
- [ ] Final production builds, bundle gate and remote CI green on the merged source.
- [ ] Private Sites version published successfully.

## Operator acceptance — required before public operation

- [ ] Connect an operator-owned X session; manually verify genuine authorship/text/timestamps/replies and observe a newly published post reaching the scanner.
- [ ] Verify a Brevo sender and actual email delivery to an opted-in recipient.
- [ ] Verify actual browser-push delivery, including the intended iPhone/Home Screen setup if that device is supported.
- [ ] Verify the live confirmation/preferences/unsubscribe journey on the controlled deployment.
- [ ] Configure hosted runtime secrets and the GitHub notifications environment, then enable tested channels and public access.

No paid fallback is planned. A coverage or authentication failure remains degraded until reviewed.
