# Cloud sync + paid doctor sharing for Tirzepatide Log / TirzTrack

## Context
Both apps are local-first today (web `localStorage`, iOS SwiftData) and never upload data. Goal: optional account so web and iPhone show the same data, and a paid feature to share a read-only, non-expiring link with a doctor. Constraints: secure, no names stored, as cheap as possible, existing apps keep working offline and without an account.

## Verdict on "Cognito + AppSync"
Cognito: yes. AppSync: not needed. It would work, but it adds GraphQL, a realtime websocket and (on iOS) the Amplify library to a web app that is deliberately one file with no dependencies. Our sync is "a few small rows per day, two devices", so plain REST is simpler and cheaper:

**Cognito User Pool (managed login, PKCE) -> API Gateway HTTP API (native JWT authorizer, no authorizer Lambda) -> Lambda -> DynamoDB on-demand.**

Web uses `fetch` + the hosted login page (no SDK). iOS uses `ASWebAuthenticationSession` against the same hosted login and `URLSession`. Realtime push is not needed; sync on launch, on focus and after each save.

## Architecture (diagram: `docs/aws-sync-architecture.{html,png}`)
- **Auth:** Cognito User Pool, email + passkey/password. Email lives only in Cognito. All data is keyed by the Cognito `sub` (random id). Optional later: Sign in with Apple (private relay email).
- **Data:** DynamoDB single table, on-demand, encrypted at rest (AWS-owned key, free), PITR on.
  - `PK=USER#<sub>`, `SK=ENTRY#<ISO date>`: one item per day, the 13 CSV fields plus `updatedAt`, `deleted` (tombstone).
  - `SK=SETTINGS`: goal, baseline, dose day, heightIn, units. No report name, no photos.
  - `SK=PLAN`: entitlement (`pro`, Stripe ids), written only by the webhook Lambda.
  - `PK=SHARE#<token>`: `{sub, createdAt, revoked, options}`; GSI on `sub` to list/revoke a user's links.
- **Sync protocol:** `GET /sync?since=<updatedAt>` returns changed items; `PUT /entries` upserts a batch. Last-write-wins by `updatedAt`, merge by date (matches the web import "merge by date" rule). CSV import/export stays as is.
- **Doctor link (public, no login):** `https://www.phoe.be/share.html#<token>` (static page on the existing CloudFront/S3) calls public route `GET /share/{token}`. Token = 256-bit random, never expires, but the patient can revoke it (recommended; "won't expire" is kept, revoke is the only kill switch). Page renders the existing report code read-only. Live view of current data by default.
- **Payments:** Stripe Checkout + Customer Portal on web; webhook Lambda sets `PLAN`. Stripe secret in SSM Parameter Store (free) not Secrets Manager. Gate: creating share links and the cloud sync need `pro`; the local app stays free.
- **Hosting (GitHub independence), DONE 2026-10-06:** see CLAUDE.md. Original plan text follows.
- **Hosting (GitHub independence):** today `/tirzepatide-log/*` on CloudFront is proxied to GitHub Pages, so a GitHub outage can break the page for anyone without a cached copy. For the paid product, serve the app and `share.html` from our own S3 bucket behind the same CloudFront distribution (new origin/behavior replacing the GitHub Pages origin). `deploy.sh` becomes: push to GitHub (source only), `aws s3 sync` the static files, invalidate CloudFront. GitHub then only affects deploying changes, never users or doctors. Cost: cents per month. Keep the GitHub Pages URL as a fallback mirror. Cognito callback URLs and `share.html` live on the phoe.be origin only. Optional `api.phoe.be` custom domain on the HTTP API.
- **IaC:** Terraform (existing profile `kathyterraform`) in a **separate private repo** (this repo is public; keep account ids, ARNs and Stripe config out of it).

## Access control (invite-only for now, Stripe deferred)
- **Cognito sign-up disabled:** user pool set to admin-create-only (`allow_admin_create_user_only = true` in Terraform). The hosted login page then has no "Sign up" link and the self-sign-up API call is rejected. Only users you create (`aws cognito-idp admin-create-user`, which emails a temporary password) can ever log in.
- **Second lock in the API:** every Lambda also requires an `PLAN` item for the caller's `sub` (`status=allowed`). You create it by hand or with a small admin script when you invite someone. A Cognito user without it gets 403. This same item is where Stripe will write later, so adding payments changes who writes it, not the checks.
- Keep the app URL unlisted (already noindex); optional MFA/passkey for your own account; a Cognito pre-sign-up allowlist Lambda is only needed if self sign-up is ever opened.
- Doctor links need no login but are only creatable by an allowed user, and are revocable.

## Cost (rough, small scale)
Cognito free to 10k MAU; Lambda and DynamoDB inside free tier / pennies; HTTP API $1 per million requests; SSM free. Expect about $0 to $2/month for the first few hundred users. Avoid WAF ($5+/mo) and Secrets Manager; use API throttling on `/share` instead. Stripe fees (2.9% + 30c) and Apple's cut (below) are the real costs.

## Security and privacy
- TLS everywhere, encryption at rest, per-user authorisation by JWT `sub` in every Lambda (never trust a client-supplied user id).
- Never store names: no profile attributes beyond email; the report name stays on device. Free-text `comments`/`foodNotes` can contain names, so warn in UI and let the user exclude them from shared links.
- Account deletion endpoint deletes all `USER#` and `SHARE#` items and the Cognito user (GDPR style).
- Not HIPAA-covered by default; if it is ever sold to clinics, revisit (AWS BAA). Needs a privacy policy and terms before launch.
- Share links: unguessable, logged-minimum, revocable, rate-limited.

## Risks to settle before building
1. **Apple in-app purchase:** unlocking paid features inside the iPhone app generally requires StoreKit (15 to 30% cut); web Stripe purchases are fine, and external purchase links are allowed in the US. Cheapest compliant path: sell on the web, iOS just signs in and reads the entitlement ("reader"-style), but Apple review may push back. Decide early.
2. Data model: iOS `DoseEntry` has no id/`updatedAt`/tombstone; add them (SwiftData migration) and the same on web entries. Photos stay device-only (listed gap in `PARITY.md`).
3. First sync merge: user with data on both devices before signing in gets merge-by-date, with a preview and a local backup (CSV export) first.

## Phases
0. Diagram + this doc saved (below).
1. DONE 2026-10-06. Infra repo: Cognito, DynamoDB, HTTP API, sync Lambda, Terraform, tests.
2. DONE 2026-10-06. Web: sign-in (PKCE), sync engine over existing `save()`, settings section hidden behind `#cloud`, offline-first retained; Playwright tests with a fake API plus a live check against the real stack.
3. DONE 2026-10-06. iOS: same contract, `Support/Cloud/` in the iOS repo, matching tests, live test against the real API.
4. DONE 2026-10-06. Share links: the doctor view is the read-only mode of the app itself (`#share=<token>`) instead of a separate `share.html`, so it reuses the dashboard and the report as they are; create/copy/revoke in the web and iOS Cloud sync sections.
5. DEFERRED (no Stripe account yet): Stripe + billing Lambda + Apple IAP decision. Until then the `PLAN` entitlement is set manually for invited users.
6. Privacy policy, delete-account, launch.

## Deliverables of this planning step (executed after approval)
- Save this plan as `docs/aws-sync-plan.md` in the web repo (note: `.gitignore` has `*.png`, so the PNG needs `!docs/*.png` or `git add -f`).
- `docs/aws-sync-architecture.html` (inline SVG, light/dark) and `.png` (render with the repo's Playwright). Download the official AWS Architecture Icons asset package from aws.amazon.com/architecture/icons (Cognito, API Gateway, Lambda, DynamoDB, CloudFront, S3, Systems Manager) and embed those SVGs; match the style of the existing root `aws-diagram.png` (current CloudFront -> S3/GitHub Pages hosting; no icon pack is stored locally). Non-AWS boxes: browser, iPhone, doctor, Stripe, Apple.
- Add a one-line pointer in the web `CLAUDE.md` and a memory note so future sessions find the plan.

## Verification
- Diagram: open the HTML in a browser, check the PNG visually, icons match the official set.
- Later phases: `npm test` (web), iOS unit tests, contract test that both clients produce identical sync JSON, an end-to-end check that data entered on web appears on iOS, a revoked share link returns 404, a non-`pro` user gets 403 on share creation, and cross-user access attempts fail.

## Open decisions (defaults used if you do not say otherwise)
- Free = local only; Paid (later) = sync + web login + doctor links. For now: invite-only, no payments. Subscription (monthly/annual) rather than one-off.
- Doctor link shows live data and is revocable.
- Email login, no Sign in with Apple at first.
