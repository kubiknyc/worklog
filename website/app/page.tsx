import Image from "next/image";
import Link from "next/link";

// Adapted from PunchLog's website (PLW/app/page.tsx) — trimmed to the
// minimal landing this task's scope calls for (no /register, /support,
// /download, /delete-account routes exist here yet).

export default function Home() {
  return (
    <div className="wrap">
      <header className="site-header">
        <div className="brand">
          <Image src="/brand-mark.svg" alt="" width={34} height={34} />
          <span>WorkLog</span>
        </div>
      </header>

      <main>
        <section className="home-hero">
          <h1>The daily record of what happened on site.</h1>
          <p className="sub">
            One report per project per day — draft, submit, lock. Amendments keep a full audit
            trail, and every report exports as a dispute-grade branded PDF.
          </p>
          <div className="home-links">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>WorkLog</span>
        <nav className="footer-links" aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
        <span>Built for the people who build.</span>
      </footer>
    </div>
  );
}
