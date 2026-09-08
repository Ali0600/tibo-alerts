# Tibo Alerts

An unofficial, open-source Codex reset watcher for [@thsottiaux](https://x.com/thsottiaux). Get an announcement, a reminder at a clearly stated reset time, or both — by email or browser push. No SMS, paid source fallback, X embeds, analytics, or OpenAI account access.

**Status: implemented, awaiting live source and notification acceptance.** A build, HTTP 200 or provider acceptance is not proof that genuine posts or notifications arrive. Signup and ordinary delivery start disabled. Follow [operations and launch checks](docs/OPERATIONS.md) before enabling them.

## Features

- Mobile-friendly English interface with system fonts, automatic light/dark colors and editable IANA timezone detection.
- Explicit times and clear relative times use the original post timestamp. Ambiguous and approximate timing stays as wording; account eligibility deadlines never become reminders.
- Separate announced resets, completed resets, banked grants and cancellations. A correction cancels superseded pending jobs. Reminder wording says “Scheduled Codex reset time.”
- Passwordless email confirmation and management, separate email/device sessions, explicit push permission and iPhone Home Screen guidance.
- Durable SQL jobs, atomic claims and email-attempt reservations, bounded retries, cancellation checks, deduplication and separate source/delivery freshness.
- Sites + D1 hosted build; Node + SQLite Docker build using the same application core and worker.
- A strict 150,000-byte gzip initial budget. CI conservatively includes the entire homepage HTML as well as its initial JS graph, including React and Vinext.

## Run locally

Use Node **24.20.0** (also supported: 22.22.2+ within Node 22). Docker Compose is optional for local development.

```sh
npm ci
npm run keys -- --write
```

The key generator writes a private, ignored `.env` and refuses to overwrite it. For local development set `DATABASE_PATH=data/tibo.sqlite` in `.env`, then:

```sh
npm run dev:node
```

Open http://localhost:3000. It shows an honest unconfigured state; it does not fabricate example announcements. Local commands load `.env`; the standalone server needs environment variables explicitly passed in.

## Self-host with Docker

```sh
npm run keys -- --write
docker compose up --build --wait app
```

Skip the first command if `.env` already exists. The app binds to localhost only. SQLite lives in the named `sqlite-data` volume and migrations run on startup. Use `APP_PORT=4318` if port 3000 is occupied; set `APP_ORIGIN` to the matching public origin. An existing HTTPS reverse proxy is required for remote users and push; localhost development is exempt. No domain purchase is required.

After completing source and delivery verification:

```sh
docker compose --profile worker up --build --wait
```

The worker runs every five minutes and uses `http://app:3000` internally. Public links still use `APP_ORIGIN`. Only the app mounts the database. Stop containers with `docker compose down`; **adding `--volumes` deletes the SQLite database**. Back up the database with SQLite’s backup API or stop the app before copying the entire volume, including WAL state.

The app runs as a nonroot user with a read-only root filesystem. The separate source worker needs a writable isolated checkout because the guarded harness is copied into its pinned RSSHub installation. RSSHub’s full frozen dependency set is needed: one runtime import references a package classified upstream as a development dependency. It is background infrastructure, never shipped to a visitor’s browser.

## Hosted setup

The Sites starter retains `.openai/hosting.json`, D1 binding `DB` and generated migrations under `drizzle/`. Build with `npm run build` and publish with Sites. A private preview can be shared only after the launch checks pass. Configure app values and secrets through Sites, never in the hosting manifest or client code. See the [configuration map](docs/OPERATIONS.md#configuration-map).

A public GitHub repository supplies the scheduled worker in `.github/workflows/scanner.yml`. Create the `notifications` GitHub environment, restrict it to `main`, and add the documented secrets. Set repository variable `WORKER_ENABLED=true` only after configuration. The workflow is disabled by default and never publishes the site automatically.

## Free service limits

Email is capped at **50 active subscribers** and **250 attempted sends per rolling 24 hours**: at most 200 alert attempts and 50 transactional attempts. Each retry consumes another attempt. Overflow is marked skipped before contacting Brevo; it is never intentionally submitted to Brevo’s delayed queue. Use a Brevo Free account whose transactional allowance is dedicated to this service; other senders sharing the account can consume its provider quota. Brevo currently allows 300 emails/day. [Brevo Free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)

Ingestion uses at most ten SQL statements for a 100-post window. A transaction refuses a burst that would expand beyond 5,000 notification jobs, leaving the source checkpoint unchanged and reporting degraded status. D1 Free also enforces platform read/write/storage limits; monitor these before raising application limits. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

Browser push is capped at 1,000 active devices for the initial beta. GitHub standard runners are free for public repositories, but scheduled runs can be late or dropped, and public-repository schedules automatically disable after 60 days of inactivity. Announcement jobs expire 30 minutes after detection; reminders expire 15 minutes after their scheduled time. This is best-effort notification, not a precise alarm. [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## Development and verification

```sh
npm run typecheck
npm run lint
npm test
npm run test:mutations
npm run build:node
npm run verify:bundle
npm run build
npm run verify:hosted
npm run source:setup
npm run source:check -- --smoke
```

Tests use real SQLite migrations and synthetic public-post fixtures, with stubbed notification providers. The mutation check makes isolated temporary copies, disables critical guards, and requires their regression tests to fail. No test sends to a real person. The source import smoke makes no X requests and does not count as live source verification.

See [architecture](docs/ARCHITECTURE.md), [operations](docs/OPERATIONS.md), [decisions](docs/DECISIONS.md), [learning log](docs/learnings.md), and [remaining acceptance work](PLAN.md). Contributions must include relevant tests and docs. Third-party GitHub Actions and Docker base images are pinned to immutable revisions.

## Experience Gained

- Designed a notification pipeline with durable job leases, bounded retries, atomic rolling quotas and explicit handling of uncertain provider outcomes.
- Built portable persistence across Cloudflare D1 and containerized SQLite, with versioned migrations and least-privilege runtime configuration.
- Implemented a guarded upstream adapter with identity validation, timeline continuity evidence and independent operational health signals.
- Established CI for security checks, mutation testing, production bundle budgets and clean container startup.

## License

[MIT](LICENSE). Tibo Alerts is not affiliated with or endorsed by OpenAI, Tibo, X, Brevo or RSSHub. Dependencies retain their own licenses.
