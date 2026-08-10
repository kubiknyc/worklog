import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

// Adapted from PunchLog's website (PLW/app/privacy/page.tsx): same operator
// and structure, content rewritten for WorkLog's actual data practices.
// Notably NOT a straight port — WorkLog collects and *retains* photo GPS
// and capture time as evidentiary provenance (the app's dispute-grade PDF
// depends on it), the inverse of PunchLog's "metadata stripped, no location
// tracking" posture. See docs/PRD.md §"Privacy & data practices".

export const metadata: Metadata = {
  title: "WorkLog — Privacy Policy",
  description:
    "What WorkLog stores and why, in plain language: account details, daily report content, photo location/timestamp provenance, and notifications.",
};

const CONTACT_EMAIL = "kubiknyc@gmail.com";
const CONTROLLER_NAME = "Ilya Vidyaev";
const CONTROLLER_ADDRESS = "36 James St, Suite 5, Middletown, NY 10940, USA";

export default function PrivacyPage() {
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
        <h1>Privacy Policy</h1>
        <p className="updated">Last updated: August 10, 2026</p>

        <p>
          WorkLog is a construction daily-report app. This policy explains what the app stores
          and why, in plain language.
        </p>

        <h2>Who is responsible for your data</h2>
        <p>
          WorkLog is operated by <strong>{CONTROLLER_NAME}</strong>, {CONTROLLER_ADDRESS}{" "}
          (&quot;we&quot;, &quot;us&quot;). We are the <em>data controller</em> for everything
          described here — meaning we decide what is collected and why, and we
          are the party you can hold to it. You can reach us any time at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <h2>What we store</h2>
        <ul>
          <li>
            <strong>Account details you provide</strong> — email address, name, and optionally
            your phone number, company, and trade. Used to sign you in and show teammates who
            filed what.
          </li>
          <li>
            <strong>Daily report content you create</strong> — one report per project per day:
            weather, manpower, equipment, delays, incidents, notes, and the other report
            sections, plus the amendment history once a report is locked. This is the
            product&apos;s purpose: a legal record of what happened on site.
          </li>
          <li>
            <strong>Photos and their location/timestamp</strong> — when you capture a photo in
            the app, we record the time and, if you allow location access, the GPS coordinates
            at the moment of capture, as first-class fields alongside the photo. Unlike some
            apps, we do not strip this — it is printed on the report&apos;s exported PDF as the
            photo&apos;s provenance, which is the evidentiary point of the feature. If location
            is denied or unavailable, the photo still saves; the PDF prints &quot;location not
            recorded&quot; for it instead.
          </li>
          <li>
            <strong>A weather snapshot for your project</strong>, if you use auto-fetch weather:
            your device&apos;s approximate location at that moment is sent to our weather
            edge function to look up conditions, and the result is stored on the report. You can
            always enter weather manually instead.
          </li>
          <li>
            <strong>A profile photo</strong>, if you choose to add one.
          </li>
          <li>
            <strong>A push-notification token</strong>, if you enable notifications — used to
            tell a project&apos;s other superintendents and administrators when a report is
            submitted. You can turn notifications off in Settings; the token is cleared when you
            sign out.
          </li>
          <li>
            <strong>Crash reports and a launch ping</strong> — when the app crashes or hits an
            unexpected error, a diagnostic report is sent to Sentry, our error-monitoring
            provider. It contains the error and the code path that produced it, plus technical
            details about your device such as model, operating system version and app version.
            Sentry also receives a short session ping each time the app starts or returns to the
            foreground, so we can tell what share of launches are crash-free. Both carry a
            random identifier for your app installation — not your account, not your IP address,
            and not your email. We configure the crash reporter to leave out your content and
            network requests.
          </li>
          <li>
            <strong>An update check</strong> — on launch the app asks Expo&apos;s update service
            whether a newer version is available, sending the app version, release channel and a
            random installation identifier. No account data is involved.
          </li>
        </ul>
        <p>
          <strong>What we deliberately do not collect:</strong> voice dictation used for
          hands-free notes is processed on your device and is never recorded, stored, or sent
          anywhere — only the resulting text you keep becomes part of your report, exactly as if
          you had typed it.
        </p>

        <h2>Why we are allowed to use it</h2>
        <p>We name a reason for each use rather than leaving it implied. Ours are:</p>
        <ul>
          <li>
            <strong>To provide the service you signed up for</strong> — your account details and
            everything you create in the app. Without these there is no product. (Performance of
            a contract.)
          </li>
          <li>
            <strong>Because you asked for it</strong> — photo location and the weather snapshot
            are collected only when your device permission allows it, which the app asks for at
            the point you use the relevant feature, not at install. (Consent for the permission,
            then performance of a contract for the delivery.)
          </li>
          <li>
            <strong>To deliver the notifications the app is built around</strong> — your device
            asks whether to allow notifications, and only if you allow them is a push token
            registered so a &quot;report submitted&quot; alert can reach your project&apos;s
            other superintendents and administrators. (Consent for the permission, then
            performance of a contract for the delivery.)
          </li>
          <li>
            <strong>To keep the app working</strong> — crash reports, the launch ping, and the
            update check. We have a genuine need to fix faults, and we have kept the data
            involved to the minimum that serves it. (Legitimate interests.)
          </li>
        </ul>

        <h2>How long we keep it</h2>
        <ul>
          <li>
            <strong>Your account</strong> — until you delete it. Deleting it removes your
            sign-in and personal details immediately, as described below. One exception: if you
            are the only administrator left in a company that other people are still using, the
            app asks you to hand that role to someone else first, so the company is not stranded
            without anyone who can run it.
          </li>
          <li>
            <strong>Report content, once submitted</strong> — a submitted report locks and
            becomes part of the project&apos;s permanent record; we do not delete or edit it
            except through the app&apos;s audited amendment mechanism, which itself is
            permanent. This is deliberate: WorkLog&apos;s purpose is a legal record that survives
            scrutiny, and one person&apos;s account going away should not erase it. After you
            delete your account, your past reports and amendments remain but are attributed to
            &quot;Deleted user&quot; rather than to you. Draft (not yet submitted) reports can be
            edited or discarded freely before submission.
          </li>
          <li>
            <strong>Photo location and capture time</strong> — kept with the photo for as long
            as the report or amendment it belongs to exists, i.e. indefinitely, for the same
            evidentiary reason.
          </li>
          <li>
            <strong>Crash reports and launch pings</strong> — Sentry&apos;s default retention for
            these is about 90 days.
          </li>
          <li>
            <strong>Email we send you</strong> — Resend keeps a log of the messages it delivers
            on our behalf, including their contents, under its own retention schedule.
          </li>
        </ul>

        <h2>What we deliberately do not do</h2>
        <ul>
          <li>
            <strong>No background location.</strong> Location is only read at the moment you
            capture a photo or request a weather snapshot — never in the background, never
            continuously.
          </li>
          <li>
            <strong>No advertising, no ad trackers, no marketing analytics.</strong> We do not
            sell your data, share it for marketing, or build a profile of you.
          </li>
          <li>
            <strong>No product analytics.</strong> We do not record which screens you visit or
            how long you spend on any part of the app. The only exception is the launch ping
            described above.
          </li>
        </ul>

        <h2>Where your data lives</h2>
        <p>
          Data is stored with Supabase (Postgres and object storage), and the database itself
          enforces who can read what. Superintendents and other project members see the projects
          they are assigned to; a company administrator sees every project belonging to their
          company. Data is encrypted in transit (TLS) and at rest. A copy of your project data is
          cached on your device so the app works offline. Signing out clears your session and the
          record of which project you had open. The offline copy of the project data itself stays
          on the device until a different account signs in, at which point the app erases it
          before fetching anything — we keep it that long so that signing out and back in does not
          throw away work you captured with no signal. On a phone or tablet several people share,
          treat what is cached as visible to whoever holds the device.
        </p>

        <h2>Who else processes your data</h2>
        <p>
          We use the following providers, and we sell your data to no one. Most act purely on
          our instructions and receive nothing for their own purposes. Apple and Google are the
          exception: push notifications travel over their networks under their own platform
          terms, which they set and we do not.
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> — the database, file storage and sign-in behind the app.
          </li>
          <li>
            <strong>Open-Meteo</strong> — the weather lookup, if you use auto-fetch weather. It
            receives an approximate location and a timestamp, nothing that identifies you.
          </li>
          <li>
            <strong>Sentry</strong> — crash reports and the launch ping.
          </li>
          <li>
            <strong>Expo</strong> — app updates, and routing notifications to Apple and Google.
          </li>
          <li>
            <strong>Apple and Google</strong> — delivering push notifications to your device.
          </li>
          <li>
            <strong>Resend</strong> — sending our email: invitations, confirmations, and
            submitted-report notifications, which can carry report and project names.
          </li>
          <li>
            <strong>Vercel</strong> — hosting this website, including the set-password page for
            confirmation and password-reset emails.
          </li>
        </ul>
        <p>
          These providers process data in the United States. The ones your device talks to
          directly — Supabase, Open-Meteo, Sentry, Expo, Apple, Google and this website&apos;s
          host — see your IP address as an unavoidable part of making the connection, and we do
          not use it to identify you.
        </p>

        <h2>Your choices</h2>
        <ul>
          <li>Edit or remove your profile details and photo in Settings at any time.</li>
          <li>Control notifications in Settings.</li>
          <li>
            Delete your account directly in the app: <strong>Settings → Delete account</strong>.
            Two options are offered — deleting just your WorkLog data (your account, profile, and
            projects) while your submitted reports remain with the project as described above; or
            deleting your entire JobSight account across the whole suite. Either way, your
            sign-in, name, contact details, profile photo, and notification token are removed
            immediately. Crash reports and launch pings are not removed by account deletion,
            because they were never linked to your account in the first place; Sentry retains
            them under its own schedule — its default for these is about 90 days.
          </li>
        </ul>

        <h2>Your rights</h2>
        <p>
          Wherever you live, you can ask us to do any of the following, and we will not charge
          you or treat you differently for asking. Write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will respond within 30
          days.
        </p>
        <ul>
          <li>
            <strong>See what we hold</strong> about you, and get a copy of it in a portable
            format.
          </li>
          <li>
            <strong>Correct anything wrong.</strong> Most of it you can edit yourself in
            Settings.
          </li>
          <li>
            <strong>Delete your account</strong> — in the app, or by asking us. See the note
            above about what stays with the project.
          </li>
          <li>
            <strong>Object to, or ask us to pause, a particular use</strong> — including
            anything we do on the basis of legitimate interests.
          </li>
        </ul>
        <p>
          If you are in Canada and you think we have got this wrong, you can complain to the
          Office of the Privacy Commissioner of Canada, or to your province&apos;s privacy
          commissioner. We would rather you told us first so we can put it right.
        </p>
        <p>
          If you are in California: we do not sell your personal information, and we do not
          share it for cross-context behavioural advertising. We have never done either.
        </p>

        <h2>Children</h2>
        <p>
          WorkLog is a tool for people working on construction sites. It is not intended for
          anyone under 18, and we do not knowingly collect data from children. If you believe a
          child has created an account, write to us and we will remove it.
        </p>

        <h2>Contact</h2>
        <p>
          Questions, rights requests or deletion requests:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>
            <strong>{CONTACT_EMAIL}</strong>
          </a>
          <br />
          {CONTROLLER_NAME}, {CONTROLLER_ADDRESS}
        </p>
        <p>
          We will update this page if our practices change; the date above reflects the latest
          revision.
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
