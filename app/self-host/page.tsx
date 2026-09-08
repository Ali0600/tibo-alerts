import Link from 'next/link';
export default function SelfHost() {
  return (
    <main className="site-shell content-page">
      <Link prefetch={false} className="back-link" href="/">
        ← Tibo Alerts
      </Link>
      <h1>
        Run your own
        <br />
        fresh-start signal.
      </h1>
      <p>
        The complete application is open source under the MIT license. Run the
        same site, reset parser, subscriptions, and notification worker on your
        own infrastructure.
      </p>
      <h2>One application, two ways to run it</h2>
      <p>
        The hosted site uses D1. Docker self-hosting uses a persistent SQLite
        database. Email and browser push work in both; there is no SMS
        integration.
      </p>
      <h2>What you’ll need</h2>
      <ul>
        <li>A server or computer with Docker, and HTTPS for browser push.</li>
        <li>
          An operator-owned X session for the free source reader. X changes or
          session expiry can interrupt scanning.
        </li>
        <li>
          A verified email sender for email alerts, or standard Web Push keys
          for push notifications.
        </li>
      </ul>
      <p>
        Self-hosting does not include free infrastructure. You can use existing
        hardware and free provider allowances. The application does not
        automatically enable paid services.
      </p>
      <h2>Start with the source</h2>
      <p>
        <a href="https://github.com/Ali0600/tibo-alerts">
          Open the repository and setup guide →
        </a>
      </p>
      <p>
        Live alerts stay off until you verify the source and test delivery. The
        guide covers Docker, secret configuration, quotas, backups, and recovery
        from missed scans.
      </p>
      <h2>Keep the limits visible</h2>
      <p>
        Scheduled checks normally run every five minutes, with possible delays.
        Public GitHub schedules may stop after 60 days of repository inactivity.
        Uncertain reset times never become exact reminders.
      </p>
    </main>
  );
}
