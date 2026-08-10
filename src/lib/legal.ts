/**
 * Public legal URLs (App Store 5.1.1(i) / EULA requirement).
 *
 * Absolute URLs against the deployed marketing site so the app never depends
 * on which routes happen to exist in this checkout. They open in the system
 * browser — the app is not a web view for them.
 *
 * Submission gate: check:submission (package.json) live-checks these URLs —
 * see spec A4. Flip LEGAL_PAGES_PUBLISHED only after both return 200.
 */
export const TERMS_URL = 'https://worklog-site.vercel.app/terms';
export const PRIVACY_URL = 'https://worklog-site.vercel.app/privacy';

/**
 * Mechanical submission gate. Verified 2026-08-10: production deploy
 * (`vercel deploy --prod`) plus `curl` returning 200 on both /terms and
 * /privacy at the URLs above. `check:submission` live-checks both URLs
 * before a store build ships (spec A4). If the pages ever come down, this
 * constant goes back to `false`.
 */
export const LEGAL_PAGES_PUBLISHED = true;
