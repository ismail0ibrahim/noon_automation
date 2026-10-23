# Deep audit — 23 October 2026

## Outcome and boundaries

The maintained local automation was audited and repaired. **This is not a claim
that the eight live Noon flows currently pass.** Both public live checks failed
before homepage load; authenticated operations were deliberately not exercised
while basic connectivity was unavailable. No account credentials were submitted,
no cart/wishlist/profile/address was changed, and no payment or order was attempted.

The workspace has no Git repository. Before edits, a source-only snapshot was
saved to `private-artifacts/audit-2026-10-23/original/`; it excludes `.env`, session
files and media. Existing private sessions, ownership records and older media were
preserved. No dependency versions were changed.

## Actual project structure

- Node.js/TypeScript Playwright automation, not an application backend or frontend.
  Runtime observed: Node 22.20.0, npm 11.4.2; lockfile: Playwright 1.64.1, TS 5.9.3.
- `playwright.config.ts`: Chromium, one worker, zero retries, Arabic locale,
  bounded action/navigation timeouts, no raw account captures, blocked service workers.
- `tests/full-journey.spec.ts`: one opt-in account journey; helpers cover login,
  protected-session proof, product/search, wishlist, cart/card preview, profile and location.
- `tests/fixtures.ts` and `helpers/cleanup.ts`: recovery before context teardown;
  `helpers/profile.ts`: acknowledged save/reload verification without automatic resubmission.
- `tests/audit-regression.spec.ts`, `tests/safety.spec.ts`: isolated offline coverage.
  `tests/public.spec.ts`: independent unauthenticated live checks.
- `scripts/`: launchers, manual session capture, sanitized reporting/replay,
  privacy audit and synthetic privacy/recovery checks. The live path uses only
  maintained modules; it does not load the private exploratory utilities.
- `.auth/`, root/legacy storage-state JSONs, old screenshots/reports and
  `private-artifacts/` contain private historical artifacts. The 82 top-level
  exploratory JS/CJS scripts were inventoried and syntax-checked, not executed;
  they include debug/eval, raw inspection and mutation utilities. Nested snapshots
  are archives, not additional active test suites.

## Evidence-led repair sequence

1. Enumerated hidden/config/source files, commands, lockfile, tests, helpers,
   launch/capture/reporter paths and historical artifacts; checked for local instructions.
2. Ran baseline typecheck, existing safety test, credential audit and dependency audit.
3. Added three offline reproductions and observed all three fail before repairs.
4. Repaired payment/wishlist validation, then reran those reproductions successfully.
5. Consolidated the journey, added ownership/recovery and corrected report/demo semantics.
6. Expanded offline integration checks; tested actual Playwright cleanup after failure
   and timeout and actual reporter output with synthetic credentials.
7. Tried public live checks, compared HTTP/2-disabled navigation once, and retained
   the unresolved connectivity finding. Updated commands and documentation to match code.

## Findings and repairs

| Priority | Root cause and impact | Repair / evidence |
| --- | --- | --- |
| P1 | Payment guard used a short path denylist. POST `/payments/charge`, `/orders`, `/card/tokenize`, `/graphql` and an unknown write all reached the offline server. | Block every HTTP write during checkout, sensitive read paths and encoded variants; reject card population without a guard; disable remembering before entry. Regression changed from failing to passing. |
| P1 | Wishlist HTTP 200 with missing/invalid payload became an empty list. This could authorize an unsafe add/removal decision. | Require the expected collection/items/SKU schema; reject unknown responses. Malformed/null/non-JSON payloads are covered. Actual Noon schema remains unverified. |
| P1 | Membership used `JSON.stringify(items).includes(sku)`: a longer SKU or product title produced a false match. | Exact `item.sku` equality, with positive/negative/empty fixtures. Reproduction failed before and passed after. |
| P1 | Ownership was written as `added:true` before the add. Failed wishlist/cart steps had no reliable recovery. | Unique private journals record pending operations before dispatch; callbacks clean only additions absent before this run. Old ownership records are never overwritten or adopted. |
| P1 | Account cleanup shared the failed test's lifetime; cart cleanup/guard disposal occurred only after successful preview. | LIFO fixture cleanup with an independent 90-second budget; continue other tasks after a cleanup failure; preserve operation and recovery errors. Actual synthetic failure/timeout runs prove teardown executes. |
| P1 | Both journey specs enabled raw account/login video while messages claimed recording was off. A new-tab recording was also not a continuous eight-flow video. | Removed raw journey recording and pass-only-video claims. Optional demo is explicitly an offline status replay, with no live DOM or frame-file loading. Old videos are kept private and unverified. |
| P1 | Reporter only scrubbed action titles. Errors, stdout/stderr and Playwright-generated error-context text were outside that protection. | Sole sanitized reporter buffers split UTF-8 output, scrubs configured secrets and text attachments, and emits JSON/static escaped HTML. Synthetic failing child validates console, reports and error-context files. End-of-run redaction cannot protect abrupt-crash artifacts. |
| P2 | Two divergent journey specs plus an active temporary cart/checkout probe were discoverable together. Defaults required installed Chrome, live credentials and a headed desktop. | One maintained Chromium journey, removed duplicate/probe from active sources, local default test command, explicit live/session launchers, separate public checks. Original files are in the private snapshot. |
| P2 | Session reuse could be reported as successful sign-in; the demo inherited reuse flags and checked only process exit/video existence. | Distinguish automatic, human-assisted and reused-session modes; verify current run ID, non-skipped steps and final run status; explicit session flag; exclusive launcher lock. No live demo was generated in this audit. |
| P2 | Profile code could reload without an acknowledged response or retry a mutation. A later failure could mask the first error. | Single submission, accepted response before reload, boolean persistence assertion, preserved keyboard events, registered restoration and combined errors. Offline accepted/rejected-save integrations cover persistence/restoration and no resubmission. |
| P2 | Generic browser storage capture could retain unrelated Chrome cookies; capture cleanup was not guaranteed on navigation failure. | Shared protected-origin/logout proof, Noon-domain filtering, atomic state write and `finally` cleanup. A synthetic state test excludes unrelated/deceptive domains. No real session was recaptured. |
| P2 | Map dragging from an unknown center was described as selecting public Cairo coordinates. | Require a unique named Tahrir/Cairo autocomplete result; fail if unavailable; replace existing field text; explicit test phone required before real saving. Coordinate/persistence behavior still needs live validation. |
| P2 | Product URL checks accepted HTTP or embedded user credentials; a loose hostname substring was used in the duplicate social test. | Exact HTTPS origin/product path validation and exact Facebook host checks. Unsafe product URL cases fail before navigation. |
| P2 | Infinite login search waits, unvalidated modes, lingering login listeners, swallowed cart-removal failures and toggled wishlist retries obscured failures. | Bounded search, validated modes, detached listeners, explicit cart cleanup failure and a single wishlist toggle followed by polling. Unknown live selectors are reported as unverified. |
| P2 | README commands/results no longer described the active code; credential audit could pass with no configured secrets. | Rewrote commands and boundaries, marked prior findings historical, expanded text scans and reject missing credential variables. Added Node engine metadata; dependency versions unchanged. |

## Verification

Baseline: TypeScript passed, original one-test safety suite passed, credential audit
passed, and `npm audit --json` reported **0 vulnerabilities**. Three added
reproductions then failed for the documented reasons before the first fixes.

Final verification commands/results are also retained in the current local report:

- `npm run typecheck`: passed.
- `npm test`: **30 passed, 0 failed, 0 skipped**, with browser networking disabled
  and fixture responses intercepted locally.
- `npm run test:privacy`: passed; its child intentionally fails, while the wrapper
  verifies one failed test and zero synthetic credentials in retained outputs.
- `npm run test:recovery`: passed; intentional failure and timeout both run cleanup.
- `npm run audit:privacy`: passed for configured credentials in scanned text and
  decoded historical Playwright HTML ZIPs. It is not a PII/media/session certification.
- JS/CJS syntax checks: maintained scripts and 82 top-level private probes passed.
  Imported TypeScript and declarations are covered by the strict typecheck.
- Public live checks: **0 passed / 2 failed** at navigation with
  `net::ERR_HTTP2_PROTOCOL_ERROR`. Separate HTTP/2-disabled diagnostic:
  **0 passed / 2 failed**, 30-second navigation timeouts.
- Authenticated journey, address saving, card fields and full demo: **not run**.

## Remaining issues and operational limits

1. **Live connectivity unresolved.** Disabling HTTP/2 changed the error to a timeout
   and did not establish a repair. There is no evidence assigning responsibility
   to the site, network/proxy, browser, authentication or bot detection.
2. **Authenticated contracts unverified.** Wishlist item shape, collection navigation,
   current cart/card/address selectors and profile response routing must be checked
   in a dedicated test account after connectivity works. Strict schema validation
   intentionally stops if the external API differs. Historical passes are not reused.
3. **HTTP guard scope.** The fixture tests prove browser HTTP interception and form
   blocking for covered routes, frames and new pages. They do not certify unknown
   non-HTTP transports or arbitrary GET endpoints on a third-party production site.
   No supported payment sandbox was established; no payment-submit code was added.
4. **Recovery is best effort after external failure.** Process/browser death or rejected
   account writes can prevent restoration. Pending private journals and old ownership
   manifests require review; tests fail instead of silently claiming cleanup succeeded.
5. **Location saving remains an account write.** Default is preview; opt-in persistence
   is unverified, does not automatically delete the saved address and does not prove
   an exact latitude/longitude. Repeated saves may create duplicate test addresses.
6. **Private historical artifacts remain.** No old session/screenshot/video was shared,
   deleted or certified. Reporter redaction completes at run end; hard crashes can leave
   unsanitized text. Inspect private output and run the audit before sharing anything.
7. **Maintenance limits.** Some live helpers still depend on React-internal hydration
   properties, localized text, CSS fragments and bounded timing fallbacks. These are
   external UI contracts, not currently validated guarantees. Private debug/eval scripts
   are not part of the maintained execution path and must not be run blindly.

The next live validation should begin with the two public checks. Only after they
load reliably should the dedicated account journey be exercised with journal review.
