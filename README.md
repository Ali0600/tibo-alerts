# Tibo Alerts

An unofficial, open-source Codex reset watcher for [@thsottiaux](https://x.com/thsottiaux). It sends you an announcement, a reminder at a clearly stated reset time, or both, by email or browser push. There is no SMS, no paid source fallback, no X embeds, no analytics, and no access to your OpenAI account.

**Status: implemented; [private owner preview](https://tibo-alerts.a-hassan0600.chatgpt.site) published, awaiting live source and notification acceptance.** A green build, an HTTP 200, or a provider saying "accepted" does not prove that real posts or notifications arrive. Signup and normal delivery start switched off. Follow the [operations and launch checks](docs/OPERATIONS.md) before you switch them on.

## Features

- Works well on phones. Uses system fonts, follows your light/dark setting, and detects your IANA timezone (you can change it).
- Exact times and clear relative times are worked out from the original post's timestamp. Vague or approximate timing stays as words. Account eligibility deadlines never become reminders.
- Announced resets, completed resets, banked grants and cancellations are kept apart. A correction cancels the pending jobs it replaces. Reminder wording says “Scheduled Codex reset time.”
- No passwords: you confirm and manage email by link. Email and device sessions are separate. Push asks for permission explicitly, with guidance for adding the site to an iPhone Home Screen.
- Jobs live in SQL, so they survive restarts. Claims and email-attempt reservations are atomic, retries are capped, cancellations are checked, duplicates are dropped, and source freshness is tracked separately from delivery freshness.
- Two builds: a hosted one on Sites + D1, and a Docker one on Node + SQLite. Both use the same application core and worker.
- A strict 150,000-byte gzip budget for the first load. CI counts the whole homepage HTML plus its initial JS graph, including React and Vinext, so the number errs on the safe side.

## Run locally

Use Node **24.20.0** (Node 22.22.2 or later also works within Node 22). Docker Compose is optional for local development.

```sh
npm ci
npm run keys -- --write
```

The key generator writes a private, git-ignored `.env` and will not overwrite an existing one. For local development, set `DATABASE_PATH=data/tibo.sqlite` in `.env`, then:

```sh
npm run dev:node
```

Open http://localhost:3000. It shows an honest "not configured" state and does not make up example announcements. Local commands load `.env`. The standalone server needs its environment variables passed in explicitly.

## Self-host with Docker

```sh
npm run keys -- --write
docker compose up --build --wait app
```

Skip the first command if `.env` already exists. The app listens on localhost only. SQLite lives in the named `sqlite-data` volume, and migrations run on startup. If port 3000 is taken, use `APP_PORT=4318` and set `APP_ORIGIN` to the matching public origin. Remote users and push need an HTTPS reverse proxy in front; localhost development does not. You do not need to buy a domain.

Once you have verified the source and delivery:

```sh
docker compose --profile worker up --build --wait
```

The worker runs every five minutes and talks to `http://app:3000` inside the network. Public links still use `APP_ORIGIN`. Only the app mounts the database. Stop the containers with `docker compose down`; **adding `--volumes` deletes the SQLite database**. To back up, use SQLite’s backup API, or stop the app and copy the whole volume, including its WAL state.

The app runs as a non-root user on a read-only root filesystem. The separate source worker needs its own writable checkout, because the guarded harness is copied into its pinned RSSHub install. RSSHub needs its full frozen dependency set: one runtime import points at a package that upstream lists as a development dependency. This is background infrastructure and never reaches a visitor’s browser.

## Hosted setup

The Sites starter keeps `.openai/hosting.json`, the D1 binding `DB`, and generated migrations under `drizzle/`. Build with `npm run build` and publish with Sites. Share a private preview only after the launch checks pass. Set app values and secrets through Sites, never in the hosting manifest or client code. See the [configuration map](docs/OPERATIONS.md#configuration-map).

A public GitHub repository runs the scheduled worker from `.github/workflows/scanner.yml`. Create the `notifications` GitHub environment, restrict it to `main`, and add the documented secrets. Set the repository variable `WORKER_ENABLED=true` only once everything is configured. The workflow is off by default and never publishes the site on its own.

## Free service limits

Email is capped at **50 active subscribers** and **250 attempted sends per rolling 24 hours**: at most 200 alert attempts and 50 transactional attempts. Each retry uses up another attempt. Anything over the cap is marked skipped before Brevo is contacted; it is never knowingly pushed into Brevo’s delayed queue. Use a Brevo Free account that only this service sends from. Other senders on the same account eat into its provider quota. Brevo currently allows 300 emails/day. [Brevo Free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)

Ingesting a 100-post window takes at most ten SQL statements. If a burst would create more than 5,000 notification jobs, the transaction refuses it, leaves the source checkpoint where it was, and reports a degraded status. D1 Free also has its own read, write and storage limits. Watch those before you raise the app's limits. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

Browser push is capped at 1,000 active devices for the first beta. GitHub standard runners are free for public repositories, but scheduled runs can be late or dropped, and public-repository schedules switch themselves off after 60 days without activity. Announcement jobs expire 30 minutes after they are detected; reminders expire 15 minutes after their scheduled time. This is best-effort notification, not a precise alarm. [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

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

Tests run real SQLite migrations against made-up public-post fixtures, with the notification providers stubbed out. The mutation check works on isolated temporary copies, switches off critical guards, and requires their regression tests to fail. No test sends anything to a real person. The source import smoke test makes no requests to X and does not count as live source verification.

Current installation details are in [deployment notes](docs/DEPLOYMENT.md).

See [architecture](docs/ARCHITECTURE.md), [operations](docs/OPERATIONS.md), [decisions](docs/DECISIONS.md), [learning log](docs/learnings.md), and [remaining acceptance work](docs/PLAN.md). Contributions must come with the relevant tests and docs. Third-party GitHub Actions and Docker base images are pinned to exact, unchangeable revisions.

## Experience Gained

- Designed a notification pipeline with durable job leases, capped retries, atomic rolling quotas (50 active subscribers, 250 sends per rolling 24 hours) and explicit handling of uncertain provider outcomes.
- Built persistence that runs on 2 backends, Cloudflare D1 and containerized SQLite, from one application core, with versioned migrations and least-privilege runtime configuration.
- Implemented a guarded upstream adapter with identity checks, timeline continuity evidence and independent health signals; ingesting a 100-post window costs at most ten SQL statements.
- Set up CI for security checks, mutation testing (8 critical guard mutations must be caught by failing tests), a 150,000-byte gzip production bundle budget and clean container startup.

## License

[MIT](LICENSE). Tibo Alerts is not affiliated with or endorsed by OpenAI, Tibo, X, Brevo or RSSHub. Dependencies retain their own licenses.
