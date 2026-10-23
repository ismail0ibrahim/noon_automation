# Historical investigation — 22 October 2026

This document preserves earlier observations. It is not evidence of the current
site state or current code behavior. See [AUDIT.md](AUDIT.md) and [RESULTS.md](RESULTS.md)
for the 23 October audit. Some implementations described below have since changed.
# Noon Egypt investigation — 22 October 2026

## Original project

Playwright Test 1.64.1 (package range was ^1.40.0), TypeScript, dotenv, Chromium.
There was no Git repository in this workspace. The active suite contained six tests:
wishlist add/remove were combined, login existed only in global setup, and a second
root spec was outside testDir. Global setup always attempted login, preventing
independent public tests from running after an authentication failure.

## Observed authentication failure

The original global setup was executed headed against the configured local account.
It filled both inputs, clicked Sign in, and timed out after 300000 ms at
`https://login.noon.com/egypt-ar/`. It did not reach the storefront.

A single instrumented attempt subsequently verified the DOM field values, submitted
once, observed an authentication POST returning HTTP **400**, and stayed on the login
page. Four browser console errors were counted; their messages and response bodies
were not collected. No recognized visible error was found. Authentication did not
succeed. No further automated credential submissions were made during this task.

The precise server-side reason for the earlier automated HTTP 400 is **unresolved**. There is insufficient evidence to
attribute HTTP 400 to a wrong password, CAPTCHA, OTP, rate limiting or bot detection.
Do not describe this as a verified credential or anti-bot error. A manual comparison
in the same browser and sanitized server validation evidence are still required.

Subsequently, a user-provided screenshot confirmed that a manual browser window
was visible and showed the exact Noon rejection `كلمة السر غير صالحة`
(Invalid password). This is evidence of an unsuccessful manual attempt, not an
authenticated session. It does not prove that the earlier automated HTTP 400 had
the same cause. The screenshot contains private input values and has not been
copied into the repository or reports. No credentials from it were transcribed.

The live form shows both fields together: `input[name=email]` (type text),
`input[name=password]` (type password), and a button named `تسجيل الدخول`.
The old text-input fallback did find the email field. An email-first intermediate
screen was not observed. Cookie presence or a redirect alone was never sufficient
authentication evidence; the old setup incorrectly relied on the redirect alone.

## Public UI findings

The storefront has two search inputs; the desktop input is `#search-input`.
Its React onChange/onKeyDown handlers may attach after the SSR input becomes visible.
In one inspection, an early fill/Enter did not navigate. Waiting for the observed
handlers made the Arabic term reach `/egypt-ar/search/?q=...` in a subsequent probe.
The test also waits for controlled state to reflect the term before pressing Enter.
This search timing evidence does **not** establish the authentication root cause.

A later no-submit probe populated the login form with explicit dummy strings:
both `fill()` and keyboard entry updated DOM and React controlled values correctly
for email and password. This further limits the evidence for a login input-event
bug. A manual-only sign-in window was subsequently opened with permission, but its
five-minute wait ended without an observed storefront redirect or verified session.

## Later successful manual session and comparisons

The user subsequently completed manual email/password login. Protected profile
fields and a visible logout control were observed at `account.noon.com/egypt-ar/profile/`.
Private session reuse passed independently in a new context. A profile update,
reload verification, restoration and second reload verification also passed.
Neither result passes the automated login test.

After the user confirmed that local `.env` was current, one independent automatic
attempt still received HTTP 400. Its JSON request had `email` and `password`, with
no other fields. A no-submit probe using the configured values verified both DOM
and React controlled state, reporting booleans only. No credential values were logged.

Fresh-context entry comparison observed that `https://login.noon.com/` redirects
to `/egypt-ar/`; both returned HTTP 200, exposed the same two inputs, and loaded the
same login build. No Noon CAPTCHA was visible in those probes. A separate automated
root-entry comparison failed without an observed authentication POST; that is a
submission-readiness failure, not another observed HTTP 400.

The user supplied evidence of a Google unusual-traffic CAPTCHA during search and
requested the search-first route. `npm run login:search` now opens a fresh visible
Google search for `login.noon.com`, with no credentials, recording or deadline.
The human must complete verification and select the genuine result. The Google
CAPTCHA does not establish the cause of Noon's HTTP 400. The backend rejection
reason remains unresolved, and further automatic credential retries are stopped.

Live product cards expose `data-qa=plp-product-box` and `product-box-name`, rather
than the old suite's `product-name`. Protected wishlist/profile/payment controls
could not be inspected without successful sign-in; semantic candidates are guarded
and these flows must not be considered validated implementations.

The genuine Facebook footer link is `https://www.facebook.com/noon/` and opens a
new tab. The location picker showed `إضافة عنوان جديد`, `استخدم موقعك الحالي`,
`طلبك هيوصل هنا`, and `تأكيد الموقع`. Nothing was confirmed or saved. The user
requires exact temporary Cairo address details and explicit saving approval.

## Privacy and payment

Playwright 1.64.1's automatic error-context accessibility snapshot included local
credential values during the diagnostic failure. They were not printed; the
generated report was replaced by later runs. `PLAYWRIGHT_NO_COPY_PROMPT=1` disables
that automatic snapshot in this installed version. Raw screenshots, video and
traces are also disabled. The credential audit decodes embedded HTML-report ZIPs.
Old session JSON files and old screenshots remain private and ignored; never add
them to Git. No real video was generated or verified.

Checkout is deliberately blocked pending inspection of the actual authenticated
transitions and confirmation that a supported dummy-card environment is available.
No order, card registration, payment or checkout confirmation is automated.
The requested card-population flow is incomplete, not passed.

