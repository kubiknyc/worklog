import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

// Adapted from PunchLog's website (PLW/app/terms/page.tsx): same operator,
// same plain-language structure, content rewritten for WorkLog's actual
// function (daily construction reports, not punch lists).

export const metadata: Metadata = {
  title: "WorkLog — Terms of Service",
  description:
    "The terms for using WorkLog: company accounts, invite-only teams, your daily reports, and how the locked-report and amendment record works.",
};

const CONTACT_EMAIL = "kubiknyc@gmail.com";

export default function TermsPage() {
  return (
    <div className="wrap">
      <header className="site-header">
        <Link href="/" className="brand">
          <Image src="/brand-mark.svg" alt="" width={34} height={34} />
          <span>WorkLog</span>
        </Link>
        <nav>
          <Link className="btn btn-ghost" href="/">
            Home
          </Link>
        </nav>
      </header>

      <main className="legal">
        <h1>Terms of Service</h1>
        <p className="updated">Last updated: August 10, 2026</p>

        <p>
          WorkLog is a construction daily-report app operated by Ilya Vidyaev, 36 James St,
          Suite 5, Middletown, NY 10940, USA (&quot;we&quot;,
          &quot;us&quot;). By creating an account or using the app, you agree to these terms.
          They are written in plain language on purpose — there is no fine print hiding
          anywhere else.
        </p>

        <h2>Your account</h2>
        <p>
          WorkLog is built around company accounts. A company is registered by its first
          administrator, and everyone else joins by invitation from someone in that company.
          You are responsible for keeping your sign-in credentials private and for what happens
          under your account. If you believe someone else is using your account, change your
          password and tell us.
        </p>

        <h2>Your reports</h2>
        <p>
          The daily reports, sections, notes, and photos you create in WorkLog are yours and
          your company&apos;s. You are responsible for the content you enter — make sure it is
          accurate to the best of your knowledge. A report you submit is meant to be a truthful
          account of what happened on site that day.
        </p>
        <p>
          You give us a limited license to store, display, and transmit your content solely to
          operate the service — syncing it to your teammates&apos; devices, generating PDFs,
          sending the notifications you asked for, and keeping backups. We claim no other
          rights to it, and we do not use it for advertising or sell it to anyone.
        </p>

        <h2>A shared company record</h2>
        <p>
          A daily report is a legal record of a construction project, not a personal notebook.
          Once you submit a report, it locks: further changes go through an audited amendment
          rather than a silent edit, and both the original and the amendment trail stay with
          the project. Reports, amendments, and photos you add become part of your
          company&apos;s project record and are visible to teammates according to their role. If
          you delete your account, that record stays with the project, attributed to
          &quot;Deleted user&quot; — see our <Link href="/privacy">privacy policy</Link> for
          details.
        </p>

        <h2>Acceptable use</h2>
        <p>
          WorkLog is for keeping an accurate, dispute-grade record of construction work. Do not
          enter content in a report that you know to be false; do not use the app to harass,
          threaten, or discriminate against any person; and do not attempt to break, probe, or
          overload the service or access another company&apos;s data.
        </p>

        <h2>Removal and termination</h2>
        <p>
          We may suspend or terminate the account of a user who violates these terms, without
          prior notice. Because a locked report is a legal record, we do not remove submitted
          report content on request except to correct a genuine error, which we do through the
          same amendment mechanism available in the app. If you encounter misuse of the service,
          write to us at the email below and we will look into it.
        </p>

        <h2>The service</h2>
        <p>
          We work hard to keep WorkLog fast, reliable, and available offline, but we provide it
          &quot;as is&quot; — we cannot promise it will always be uninterrupted or error-free.
          WorkLog is a documentation tool: it does not replace your professional judgment,
          inspections, or contractual obligations on a job. To the extent the law allows, our
          liability to you is limited to the amount you paid us for the service.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          If we make meaningful changes to these terms, we will update this page and the date
          above. Continuing to use WorkLog after a change means you accept the updated terms.
        </p>

        <h2>Governing terms</h2>
        <p>
          These plain-language terms are the whole agreement between you and us for using
          WorkLog. If any part of them turns out to be unenforceable, the rest still applies.
        </p>

        <h2>App store terms</h2>
        <p>
          If you got WorkLog from Apple&apos;s App Store or Google Play, a few extra points
          apply. This agreement is between you and us — not Apple or Google. Neither has any
          obligation to provide support or maintenance for the app, and neither is responsible
          for warranty claims, product claims, or claims that the app infringes someone&apos;s
          intellectual property — those are on us. You confirm that you will comply with
          applicable export laws and that you are not located in an embargoed country or on any
          restricted-parties list. Apple, Google, and their subsidiaries are third-party
          beneficiaries of these terms where their respective platform terms say so, and may
          enforce them against you.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>
            <strong>{CONTACT_EMAIL}</strong>
          </a>
        </p>
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
