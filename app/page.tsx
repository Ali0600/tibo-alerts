import Link from 'next/link';
import {
  RefreshCw,
  ArrowUpRight,
  Check,
  ShieldCheck,
  Code,
} from 'lucide-react';
import { AlertApp } from './alert-app';
export default function Page() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Link
          prefetch={false}
          className="wordmark"
          href="/"
          aria-label="Tibo Alerts home"
        >
          <RefreshCw size={20} strokeWidth={2.4} />
          <span>
            tibo<span className="muted">alerts</span>
            <span className="wordmark-dot">.</span>
          </span>
        </Link>
        <nav>
          <a href="#how-it-works">How it works</a>
          <Link prefetch={false} href="/self-host">
            Self-host <ArrowUpRight size={14} />
          </Link>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="eyebrow">
            <span className="status-dot" /> LESS REFRESHING. MORE BUILDING.
          </div>
          <h1>
            A fresh start.
            <br />
            <span>Without refreshing X.</span>
          </h1>
          <p className="hero-copy">
            When Tibo announces a Codex reset, get a heads-up.
            <br className="desktop-break" /> Straight to your inbox or phone.
            Always in your time.
          </p>
          <div className="hero-meta">
            <span>
              <Check size={14} /> Free to use
            </span>
            <span>
              <Check size={14} /> Open source
            </span>
            <span>
              <Check size={14} /> No account needed
            </span>
          </div>
        </section>
        <AlertApp />
        <section className="how-it-works" id="how-it-works">
          <div className="section-kicker">A LITTLE LESS TAB-CHECKING</div>
          <div className="steps">
            <div>
              <span className="step-number">01</span>
              <h3>Tibo posts.</h3>
              <p>
                We check his posts and replies for Codex resets and banked reset
                grants.
              </p>
            </div>
            <div>
              <span className="step-number">02</span>
              <h3>We do the time math.</h3>
              <p>
                A clear time becomes your local time. If it’s uncertain, we say
                so.
              </p>
            </div>
            <div>
              <span className="step-number">03</span>
              <h3>You get back to building.</h3>
              <p>
                Receive the alerts you picked. Scheduled checks run about every
                five minutes and can be delayed.
              </p>
            </div>
          </div>
        </section>
        <section className="open-source">
          <div>
            <ShieldCheck size={23} />
            <div>
              <h3>Your alerts. Your infrastructure.</h3>
              <p>Read the code, run your own copy, or make it better.</p>
            </div>
          </div>
          <Link prefetch={false} className="source-button" href="/self-host">
            <Code size={16} /> Explore self-hosting <ArrowUpRight size={14} />
          </Link>
        </section>
      </main>
      <footer>
        <span>Built for the next fresh start.</span>
        <div>
          <Link prefetch={false} href="/manage">
            Manage alerts
          </Link>
          <Link prefetch={false} href="/privacy">
            Privacy
          </Link>
          <span>Unofficial. Not affiliated with OpenAI.</span>
        </div>
      </footer>
    </div>
  );
}
