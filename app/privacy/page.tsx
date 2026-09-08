import Link from 'next/link';
export default function Privacy() {
  return (
    <main className="site-shell content-page">
      <Link prefetch={false} className="back-link" href="/">
        ← Tibo Alerts
      </Link>
      <h1>
        A small service.
        <br />A small data footprint.
      </h1>
      <p>
        Updated September 8, 2026. Tibo Alerts is an independent community
        project, not affiliated with OpenAI or X.
      </p>
      <h2>What we save</h2>
      <p>
        For email alerts: your email address, confirmation and consent dates,
        timezone, preferences, and delivery status. For browser push: the
        device’s push subscription, consent date, timezone, and preferences.
        Contact details and push endpoints are encrypted in the database.
      </p>
      <p>
        We use an essential management cookie to let you change your alerts. We
        do not use advertising trackers or analytics. Your IP address is hashed
        for short-lived request limits; these records expire automatically.
      </p>
      <h2>Where notifications go</h2>
      <p>
        The hosted service uses Brevo to send email and your browser’s push
        service to send device notifications. Protected GitHub Actions jobs
        process delivery, and Sites/Cloudflare hosts the application and
        database. Those providers process the information needed to operate
        their services. A self-hosted installation’s operator may choose a
        different email provider.
      </p>
      <h2>Keeping and deleting information</h2>
      <p>
        Unconfirmed subscriptions expire after two days. Delivery records are
        retained for up to 30 days; collected public posts for up to 90 days.
        Unsubscribing immediately removes the saved contact or push details and
        cancels queued alerts. A suppression fingerprint remains for up to 30
        days to prevent accidental re-enrollment. Cleanup runs with the
        background worker; a stopped worker delays cleanup.
      </p>
      <h2>Your choices</h2>
      <p>
        <Link prefetch={false} href="/manage">
          Manage or unsubscribe from your alerts
        </Link>
        . Email links give access to your subscription, so keep them private.
        Browser notifications can also be revoked in your device’s settings. We
        never request your OpenAI credentials or access your personal usage
        balance.
      </p>
      <h2>Contact and source code</h2>
      <p>
        Report service or privacy concerns through{' '}
        <a href="https://github.com/Ali0600/tibo-alerts/issues">
          the project’s issue tracker
        </a>
        . Please do not post email addresses, private links, session cookies, or
        secrets in public issues.
      </p>
    </main>
  );
}
