# Noon Egypt automation

Playwright + TypeScript tests for eight Noon Egypt flows. The maintained journey is
`tests/full-journey.spec.ts`; the default test command uses offline fixtures and
never signs in or modifies an account.

Current audit and limitations: [docs/AUDIT.md](docs/AUDIT.md).
Historical observations in `docs/INVESTIGATION.md` and the archived source snapshot
are not evidence that the current live site works.

## Setup

Node.js 20+ is required. This workspace was checked with Node 22.20.0,
Playwright 1.64.1 and TypeScript 5.9.3.

```powershell
npm ci
npx playwright install chromium
Copy-Item .env.example .env
```

Use a dedicated test account for live runs. Keep `.env`, `.auth/`, recordings,
reports and `private-artifacts/` private. Old storage states and screenshots in
this workspace are historical private artifacts; active tests do not read them.

## Verification commands

```powershell
npm run typecheck
npm test                 # offline regression and HTTP payment-guard tests
npm run test:privacy     # synthetic failing child; checks report/console redaction
npm run test:recovery    # synthetic failures/timeouts; checks fixture cleanup
npm run audit:privacy    # checks configured credentials in text source/reports
npm audit               # dependency advisory check
npm run test:public      # live, unauthenticated search and footer tests
npm run report           # sanitized local report, served only on localhost
```

Privacy/recovery smoke commands exit successfully only when their intentionally
failing child runs produce the expected safe result. Their evidence stays under
`private-artifacts/`. Credential auditing requires both credential variables;
without them it fails explicitly instead of claiming a scan passed.

Public tests depend on the external site and network. `NOON_DISABLE_HTTP2=1`
provides an optional diagnostic browser flag; the current audit did not establish
it as a fix for the observed connection failure.

## Live account journey

```powershell
npm run login:manual     # optional manual browser; type verify in terminal to save session
npm run test:full        # explicit opt-in; one automatic sign-in attempt by default
npm run test:session     # verifies saved session and flows 2-8; DOES NOT test sign-in
npm run demo             # full journey, then an offline status-card replay only
```

The launcher uses headed bundled Chromium, one worker, zero retries, a per-run
identifier, and an exclusive `.auth/journey.lock`. It refuses concurrent launcher
runs and refuses to call skipped/partial results a successful journey. After an
abrupt interruption, check running processes and the recovery journal before
removing a stale lock. Direct `playwright test` discovers the account journey but
skips it unless `NOON_RUN_LIVE=1`; use the launcher to obtain the concurrency lock.

`NOON_LOGIN_MODE=automatic|manual|disabled` controls sign-in. Manual mode types no
credentials. `NOON_MANUAL_AUTH=1` permits human CAPTCHA/OTP completion after the
single automatic submission. Human-assisted sign-in and session reuse are labelled
separately; neither establishes an unassisted automatic sign-in pass. Search entry
is optional (`NOON_LOGIN_ENTRY=search`), waits at most five minutes, and never solves
CAPTCHAs automatically. The default is direct entry.

The eight flows are:

1. Sign in, then verify the protected account origin, editable profile and logout.
2. Add an exact SKU to the wishlist, requiring absence before any mutation.
3. Remove only that owned addition and verify absence.
4. Prepare the cart, install the HTTP guard, inspect the dummy card form and leave
   checkout before removing the guard; clean only a cart item added by this run.
5. Save a temporary first name, verify after reload, restore and verify again.
6. Select a named Cairo autocomplete result and preview a completed address form.
7. Search for `سماعات` and verify query encoding and product results.
8. Open the genuine footer Facebook link and verify the exact destination host.

Wishlist membership rejects unknown API schemas and uses exact `sku` equality.
Selectors and the API schema still need authenticated live validation; successful
offline fixtures do not prove that Noon currently exposes those contracts.

## Payment and account recovery

Checkout inspection blocks **every HTTP write method** to every host, plus
sensitive card/payment/order GET routes. Service workers are blocked. Dummy card
fields refuse to populate without an active guard; remembering the card is turned
off before population. No confirm/save/pay/order action is implemented. Cart
preparation and cleanup run outside the blocked inspection phase. This is a tested
HTTP guard, not a verified production payment sandbox or proof about every possible
transport used by an external website. Unexpected requests can make the preview
fail safely; do not weaken the guard just to obtain a pass.

Account mutations are journaled **before** dispatch under `.auth/runs/<id>.json`.
Wishlist additions and profile restoration are registered for recovery; cart
recovery is registered before clicking Add. Cleanup runs in reverse order with a
separate 90-second fixture budget, attempts all tasks, and fails visibly if any
recovery fails. Successful recovery removes the private original profile name from
the journal. Browser/process crashes can prevent cleanup: inspect pending records
and the older `.auth/wishlist-item.json` manually; nothing automatically adopts or
removes items from an earlier run.

Address preview does not save by default. `NOON_SAVE_LOCATION=1` is explicit opt-in
to a real account write and requires an explicit valid `NOON_TEST_PHONE`. A named
Cairo result must be available; the test no longer guesses coordinates by dragging
from an unknown map center. Address persistence and cleanup remain unverified on
the live site. A saved test address is not automatically removed.

## Reports and media

Live authentication/account video, screenshots and traces are disabled. The sole
reporter buffers output, redacts configured credentials (including split chunks),
and writes sanitized `playwright-report/report.json` and `index.html`. It also
scrubs generated text attachments at the end of a completed run. Playwright's
`PLAYWRIGHT_NO_COPY_PROMPT=1` suppresses page snapshots, not all error-context text.
An abrupt crash before redaction can leave raw text artifacts; treat all artifacts
as private and run the credential audit before sharing. That audit does not inspect
images/video, every form of PII, encrypted content, or private session/archive data.

`npm run demo` creates an **offline replay of status cards** after the current
journey passes. It does not capture the live browser and is not visual evidence
that the eight flows occurred. Existing older recordings are not reverified or
deleted. The reporter is intentionally custom; `npm run report` opens its sanitized
report rather than the native Playwright HTML viewer.

Exploratory scripts in `private-artifacts/` are archival, include account mutation
and debug/eval utilities, and are excluded from the maintained test commands. Do
not execute them as a recovery procedure without reviewing their actual actions.
