# Operations and launch checks

The repository is an implementation, not a claim that X or notification delivery has been proven. Keep `ALERTS_ENABLED=false` until every enabled channel and the source pass the checks below. Do not paste secrets into chat, GitHub issues, commits or workflow logs.

## Configuration map

Generate independent keys with `npm run keys -- --write`. The `.env` file is ignored and created with owner-only permissions. Docker Compose passes an explicit subset to each service; it never gives the X session or sender key to the website.

| Setting                                                  | Website / Sites                                         | GitHub `notifications` environment or Docker worker |
| -------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| `APP_ORIGIN`                                             | Public HTTPS origin (localhost allowed for development) | Same public origin                                  |
| `DATA_KEY`                                               | Secret, 32 bytes encoded as base64; back it up securely | Not needed                                          |
| `SCANNER_SECRET`                                         | Secret, at least 32 characters                          | Matching secret                                     |
| `DELIVERY_SECRET`                                        | Different secret, at least 32 characters                | Matching secret                                     |
| `BREVO_WEBHOOK_SECRET`                                   | Different secret                                        | Not needed                                          |
| `EXPECTED_SOURCE_ID`                                     | Numeric Tibo ID established by source proof             | Same variable                                       |
| `TWITTER_AUTH_TOKEN`                                     | Never                                                   | Secret from operator-owned X session                |
| `BREVO_API_KEY`                                          | Never                                                   | Secret                                              |
| `EMAIL_FROM`                                             | Not needed                                              | Verified sender address                             |
| `VAPID_PUBLIC_KEY`                                       | Public variable                                         | Same variable                                       |
| `VAPID_PRIVATE_KEY`                                      | Never                                                   | Secret                                              |
| `VAPID_SUBJECT`                                          | Not needed                                              | Operator contact `mailto:` URL                      |
| `ALERTS_ENABLED`, `SOURCE_VERIFIED`, `DELIVERY_VERIFIED` | Initially `false`                                       | Not needed                                          |
| `EMAIL_ENABLED`, `PUSH_ENABLED`                          | Initially `false`; enable only tested channels          | Not needed                                          |
| `VERIFICATION_MODE`, `TEST_EMAIL`                        | Private acceptance tests only                           | CLI supplies opted-in recipient                     |

For Sites, use its environment-variable and secret controls; `.openai/hosting.json` stores only project/binding metadata. For local development use `.env`. For hosted GitHub delivery create an environment named `notifications`, restrict deployment branches to `main`, and set the credentials listed above as environment secrets. Put non-secret worker values in environment variables. Repository variable `WORKER_ENABLED` defaults absent/false; set it to `true` when ready. The workflow never needs GitHub write permissions.

Changing runtime settings requires restarting Docker services or applying a new Sites environment revision/deployment. Keep the existing `DATA_KEY`: replacing it without migrating ciphertext makes saved subscriptions unreadable. Never reuse scanner and delivery secrets.

## 1. Prove the source

1. Use an X account you operate and are permitted to use. Obtain its existing `auth_token` session value locally and save it only in the worker secret store. This is access to that account; revoke/rotate it through X if exposed. The website never asks visitors for an X session.
2. Run `npm run source:setup`. It installs RSSHub commit `865f1cf5af3973dffaa2cb8c2d73ee0538043c12`, checks a clean tracked checkout and preserves its lockfile. No fallback service is selected.
3. Run `npm run source:check -- --smoke`. This proves only that the pinned imports load without network access.
4. Run `npm run source:check`. It prints public post text/IDs/timestamps/reply targets and the source author ID, never the session. Check genuine X posts yourself, including a reply and a post with quoted content if available. If authentication, text, authorship or coverage cannot be verified, stop here and keep the source degraded.
5. Create a private fixture from what you manually verified. Do not generate the expected values from the reader being tested:

```json
{
  "authorId": "NUMERIC_ID_FROM_GENUINE_PROFILE",
  "posts": [
    {
      "id": "RECENT_POST_ID",
      "text": "Exact own text from X",
      "publishedAt": "2026-09-08T12:00:00Z",
      "replyToId": null
    },
    {
      "id": "RECENT_REPLY_ID",
      "text": "Exact reply text from X",
      "publishedAt": "2026-09-08T12:01:00Z",
      "replyToId": "PARENT_ID"
    }
  ]
}
```

The values above are placeholders, not source evidence. Choose posts present in the recent reply-inclusive window. Then run:

```sh
npm run verify:source -- --fixture=/private/expected-posts.json
```

This matches exact identity, own text, timestamps and reply targets on a fresh read, then verifies primary-window continuity on a second read. It saves non-secret evidence under `.artifacts/source-proof.json`; it does not switch launch gates. Pin `EXPECTED_SOURCE_ID` on the app and worker. Run the worker, then observe a newly published genuine source post reaching the site or persisted source window. Only after that observation and no unexplained coverage gap should `SOURCE_VERIFIED=true` be set.

A source change, authentication failure, malformed envelope, unreadable preview, changed existing post or missing primary-window sentinel must remain visible as failed/gap/stale. Do not label an empty HTTP 200 feed healthy. The guarded adapter is undocumented upstream behavior and may need maintenance when X changes.

## 2. Prove notification delivery

Keep ordinary alerts disabled. Set `VERIFICATION_MODE=true` on the app and `TEST_EMAIL` to an address whose owner explicitly opted in. Configure a verified Brevo sender, API key and VAPID contact/keys in the worker. Use a dedicated free transactional allowance; do not share its quota with unrelated senders.

For email:

```sh
npm run verify:delivery -- --email=your-opted-in-address@example.com
```

The app enqueues one scoped test, reserves quota, claims it and records the real transport result. Confirm actual arrival in the inbox (and check spam). Provider `201` or “accepted” alone does not pass acceptance. Verify sender identity, link correctness and local-time wording through a controlled subscribed test after source acceptance.

For push, open `/verify` on the intended device, explicitly enable notifications and download its private subscription JSON. On iPhone/iPad, install the site to the Home Screen and open it there first. Transfer the file securely to the operator, then:

```sh
npm run verify:delivery -- --push-file=/private/tibo-test-device.json
```

Confirm an actual notification appears, opens the intended site, and does not reappear from duplicate delivery. Remove the test device file afterward. The `/verify` page does not enroll public alerts. Never commit a push subscription: its endpoint and keys are a device capability.

Private tests are limited to five/hour and still count against the rolling email budget. Ordinary workers cannot claim tests. Turn `VERIFICATION_MODE=false` after acceptance. Set `DELIVERY_VERIFIED=true` only for channels you actually observed, and leave any untested channel disabled.

## 3. Launch and verify the subscriber journey

- Run CI, the production build and the bundle gate. Start the Docker app on a clean volume and verify it is healthy; restart it and verify persistence. The CI volume is disposable; a real deployment’s volume is not.
- After source and test delivery proof, on a private or controlled instance set the three launch flags and enable only tested channels. Verify email confirmation, management, preference changes, unsubscribe and push on opted-in recipients. Synthetic test posts belong only in an isolated local/test database, never the public feed.
- Confirm both source and delivery freshness update, then enable the hosted worker and publish public access when ready. An owner-private Sites page cannot be assumed reachable by a GitHub runner; verify reachability before turning on the schedule. The disabled private preview is for review.
- Do not call the service operational until genuine source evidence, actual channel delivery and clean Docker startup are all recorded.

## Failure handling

**Source failed:** delivery continues independently. Check the safe error code in the protected source checkpoint endpoint or the GitHub run. Restore the operator session if expired. Unknown shapes require a sanitized fixture and adapter review. Do not turn on debug logs in the credentialed reader.

**Source burst:** a batch that would enqueue more than 5,000 jobs fails as a whole before the checkpoint advances. Inspect the source and recipient load before retrying; never truncate the batch or manually advance past it. D1 Free can also reject work at its daily platform limits.

**Coverage gap:** the gap is sticky. Inspect the missing interval against genuine posts; identify whether any reset was missed and how to handle it. Then explicitly POST `/api/internal/source/ack-gap` with the scanner credential. This acknowledges the reviewed gap; it does not recreate missing posts. It should never be an automatic health-reset step.

**Delivery failed or stale:** inspect the worker run and private job states. `unknown` means a send may have happened; never mass-reset those jobs to pending. Provider 429 retries are bounded. Quota exhaustion skips before network submission. Public freshness does not assert inbox receipt.

**Bounces/complaints:** configure a Brevo transactional webhook to POST `/api/webhooks/brevo` with `Authorization: Bearer <BREVO_WEBHOOK_SECRET>` for hard bounces, spam, unsubscribe, blocked and invalid-email events. Authenticated suppression removes contacts and cancels queued jobs. A later delivered event cannot reactivate them. See [Brevo webhook authentication](https://developers.brevo.com/docs/transactional-webhooks).

**GitHub schedule:** runs are best effort and can be delayed/dropped. Public repository schedules disable after 60 days without activity; review the Actions page periodically and re-enable if necessary. A five-minute cron is not an exact-time SLA. [GitHub schedule docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

**Retention:** housekeeping runs when the worker claims delivery. Stopping the worker delays cleanup. Keep storage/secret backups together and protect both; test restore before relying on backups. SMTP self-hosting supports TLS on 465 or 587 only.

## Endpoint map

| Method    | Path                                                                    | Purpose / protection                                              |
| --------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| GET       | `/api/public`, `/api/events?id=…`                                       | Public events and distinct health signals                         |
| GET       | `/api/health`                                                           | Database/process check, no secrets                                |
| POST      | `/api/subscriptions`                                                    | Email/push signup; consent, Origin, limits and launch gates       |
| POST      | `/api/confirm`                                                          | Explicit one-time email confirmation                              |
| POST      | `/api/manage/session`, `/api/manage/request`                            | Management capability / generic email recovery                    |
| GET/PATCH | `/api/subscriptions/me?channel=email` or `push`                         | Scoped management cookie                                          |
| POST      | `/api/unsubscribe?channel=…`                                            | Scoped cookie and Origin                                          |
| POST      | `/api/unsubscribe/one-click?token=…`                                    | Narrow email unsubscribe capability                               |
| POST      | `/api/webhooks/brevo`                                                   | Separate webhook bearer credential                                |
| GET       | `/api/internal/source/checkpoint`                                       | Scanner credential                                                |
| POST      | `/api/internal/source/ingest`, `/failure`, `/ack-gap`                   | Scanner credential                                                |
| POST      | `/api/internal/jobs/claim`, `/authorize`, `/ack`, `/heartbeat`, `/test` | Delivery credential; tests also require private verification mode |

Do not embed operator bearer credentials in browser URLs. Subscription link tokens use fragments, are cleared from the visible URL, and are stored only as HttpOnly management cookies or hashed server-side capabilities.
