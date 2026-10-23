# Design decisions

Each decision records what was chosen, why, and the tradeoff accepted.
Status: approved in phase 3 (design).

## D1. Stack and hosting
- **Chosen:** React + Vite + TypeScript (front); Node.js + TypeScript + Hono (back); Postgres and Auth on Supabase; one Vercel project serving the static site and the API on the same origin (`/api/*`); `pg` as driver through the Supabase transaction pooler (port 6543).
- **Why:** the brief requires "NodeJS or Python" and leaves the framework open. Node on Vercel is the native runtime. One language on both sides.
- **Tradeoff:** Hono is less known than Express; only `routes` depends on it, so swapping it is cheap. Cloudflare Workers was rejected: it is not literally Node.js and the brief says NodeJS.
- **Layout on Vercel:** one project using Vercel Services in `vercel.json`: `frontend/` as the site, `backend/` as the API, rewrite `/api/(.*)` to the backend and everything else to the frontend (documented by Vercel). The Hono app is exported with `export default app` from a supported entry file.
- **Pooler rules:** the transaction pooler (port 6543) does not support prepared statements and shares connections between clients, so code uses only `BEGIN/COMMIT` and `SET LOCAL`, never session-level `SET`. `pg` sends unnamed queries by default, which is compatible.
- **Proven in the walking skeleton (slice 0):** the Vercel Services layout with Hono (the service keeps the original `/api/...` path), the Supabase transaction pooler with a 20-way row-lock test, signup then `/api/me` on the deployed site, and `pg_cron` + `pg_net` on the free plan. Still to observe over days: whether the free project is paused for inactivity.
- **TLS to the pooler:** Node's `pg` treats `sslmode=require` as full verification, and the Supabase pooler chain is signed by Supabase's own root. The backend embeds the public Supabase Root 2021 CA (fingerprint recorded in `shared/supabase-ca.ts`, checked against the chain the pooler serves) and verifies the server instead of disabling checks.
- **Vercel build:** the frontend builds with `vite build` only and the backend has no build script (Vercel builds it); type checking stays in `make ci`, because Vercel installs only the service's dependencies and has no `tsc` there.

## D2. Architecture: modular monolith with a functional core
- **Chosen:** one deployable, split by feature (`bidding`, `wallet`, `lots`, `settlement`, `audit`, `catalog`, `identity`). Each module has `rules.ts` (pure functions, the clock is a parameter), `service.ts` (transaction + SQL) and `routes.ts` (HTTP). A module exposes only its `index.ts`.
- **Enforced in `make ci`:** ESLint `no-restricted-imports` blocks reaching into another module's internals and blocks `pg`, `fetch` and `Date` inside `rules.ts`.
- **Why:** the money guarantee lives in Postgres locks and constraints. A repository interface would hide the lock order and, since fakes are banned (D12), no test would use it.
- **Tradeoff:** services are coupled to Postgres on purpose; changing database means rewriting SQL.

## D3. Data model
- `profiles(id = auth.users.id, role auctioneer|bidder, display_name)`; role comes from this table, never from user-editable metadata. A trigger creates profile and wallet on sign-up.
- `wallets(user_id, total_cents, committed_cents)` with `CHECK (committed_cents >= 0 AND total_cents >= committed_cents)`; available = total - committed.
- `wallet_ledger(user_id, kind deposit|lot_debit|lot_credit, amount_cents, lot_id, idempotency_key)`; unique `(lot_id, kind)` for settlement kinds and unique `(user_id, idempotency_key)` for deposits.
- `lots`: auctioneer, status `active|cancelled|settled`, outcome `sold|no_bids`, item snapshot, `starts_at`, `ends_at`, `starting_bid_cents`, `increment_cents`, plus `current_amount_cents`, `leader_id`, `bid_count`, `head_seq`, `head_hash`, `settled_at`. "Scheduled" and "live" are derived from the clock, not stored.
- `bids(lot_id, seq, bidder_id, amount_cents, placed_at, prev_hash, hash)` unique `(lot_id, seq)`; a trigger rejects UPDATE/DELETE (defence in depth, not security).
- `receipts(code, lot_id unique, winner_id, amount_cents, head_seq, head_hash, closed_at)`; `code` is random.
- RLS enabled on every table with no policies: Supabase's REST layer exposes nothing; only our API reads the database.
- **Tradeoff:** `lots` duplicates the current bid for fast reads; it is written in the same transaction as the bid, and a test recomputes it from `bids`.

## D4. Tamper-evident bid history (keyed hash chain)
- **Chosen:** `hash_n = HMAC(SECRET, "v1|lot_id|seq|bidder_id|amount|placed_at_utc|hash_(n-1)")`; first `prev_hash = HMAC(SECRET, "genesis|lot_id")`. `AUDIT_HMAC_SECRET` lives only in the server environment. The receipt stores the final `head_seq` and `head_hash`.
- **Detection by recomputing the chain:** edited value or author (hash differs at that seq), deleted in the middle (seq gap and broken `prev_hash`), inserted (no secret, no valid hash), reordered (seq and `prev_hash` stop matching).
- **Last bid removed:** the rest of the chain stays valid, so it is caught by the head (`lots.head_*`), by ledger entries and by the receipt's `head_hash`.
- **Known limit (stated in the README):** someone with full database access can delete the last bid and rewrite `lots.head_*` to the previous valid state. Only a copy of the head outside the database (the winner's receipt, `?head=` on the audit page) exposes it.
- **Tradeoff:** it is keyed, so third parties cannot verify on their own; the server verifies. Rotating the secret makes every existing chain look tampered, so there is no rotation.

## D5. Concurrency of bids and committed balance
- **Chosen:** one transaction per bid: `SELECT ... FOR UPDATE` on the lot (serializes bids of the same lot), then lock the bidder's and the previous leader's wallets in `user_id` order (avoids deadlock across lots), read the database clock after the locks, validate, release the previous leader, commit the new one, append the bid with its hash, update the lot, apply anti-sniping.
- **Anti-sniping:** if `ends_at - now <= 2 min` then `ends_at = max(ends_at, now + 2 min)`. A bid at exactly `ends_at` is refused. Extensions are unbounded (README).
- **Proof:** parallel HTTP requests against real Postgres; afterwards seqs are contiguous, the chain is valid, `committed` equals the recomputed value and nobody is negative. The `CHECK` is the second barrier.

## D6. Closing and settlement
- **Chosen:** `settleLot(lot_id)` in one transaction: lock the lot; if `settled_at` is set or `now < ends_at`, do nothing (idempotent); no bids means `no_bids`; otherwise debit the winner (total and committed), credit the auctioneer, write two ledger rows and create the receipt. Outbid bidders were already released when they lost the lead.
- **Triggers:** on demand (reading a lot, bidding, reading the wallet or wins settles the due lots involved) so correctness never depends on a scheduler; plus Supabase `pg_cron` + `pg_net` calling `POST /api/internal/close-due` every minute with `CRON_SECRET`, so lots close with nobody looking.
- `pg_net` is asynchronous and its request timeout defaults to 2000 ms, so the job sets `timeout_milliseconds` explicitly and ignores the response; the endpoint itself is idempotent.
- The per-minute call is also application traffic to the database, which counts as activity against Supabase's free-plan inactivity pause (to be observed, not assumed).
- **Fallback if `pg_cron` fails in slice 0:** GitHub Actions every 5 minutes.
- **Tradeoff:** extra moving parts (two extensions, one secret) for punctuality only.

## D7. Real-time: polling
- **Chosen:** `GET /api/lots/{id}/live` every 3 s, a single query, returns `server_now` so the countdown uses the server clock; pauses when the tab is hidden; backs off on errors and shows a connection warning instead of faking "live".
- **Why not Supabase Realtime / WebSocket / SSE:** Realtime would expose tables to clients (privacy, RLS); WebSocket and SSE fight serverless time limits.

## D8. External API and snapshot
- **Chosen:** Met Museum Collection API (`/v1.1/search`, `hasImages=true&isPublicDomain=true`). Search returns only ids; the server fetches the first 12 details in parallel (5 s timeout) and skips failures. The Art Institute of Chicago was rejected: automated requests got a 403 Cloudflare challenge.
- **Snapshot:** the client sends only `external_id`; the server refetches and copies title, artist, date, medium, department, source link and image URL into `lots.item_*`. Never trust item data sent by the client. After creation nothing depends on the API (image is stored as a URL; a placeholder shows if it fails to load).
- **Outage:** search returns `503 catalog_unavailable`; no half-created lot; showcase, rooms, audit and receipts keep working.
- **Tradeoff:** images are hotlinked, so the lot loses its picture if the museum's image host is down.

## D9. API contract and the single error shape
- Error body is always `{ "code": "...", "message": "..." }`; framework validation errors are mapped to it.
- Codes: `validation_error` 422, `bid_below_minimum` 422, `unauthenticated` 401, `forbidden` 403, `not_found` 404, `insufficient_funds` 409, `already_leading` 409, `lot_not_started` 409, `lot_ended` 409, `lot_not_editable` 409, `catalog_unavailable` 503, `internal_error` 500 (no stack or database message leaks).
- Public: `GET /api/lots?status=&q=`, `GET /api/lots/{id}`, `GET /api/lots/{id}/live`, `GET /api/lots/{id}/audit`, `GET /api/receipts/{code}`.
- Bidder: `GET /api/me`, `POST /api/wallet/deposits` (requires `Idempotency-Key`), `POST /api/lots/{id}/bids`, `GET /api/me/wins`.
- Auctioneer: `GET /api/catalog/search?q=`, `POST /api/lots`, `PATCH /api/lots/{id}`, `POST /api/lots/{id}/cancel`, `GET /api/auctioneer/lots`, `GET /api/auctioneer/summary`.
- Internal: `POST /api/internal/close-due` (Bearer `CRON_SECRET`).
- Identity always comes from the JWT; ownership is checked on every auctioneer route.

## D10. Privacy
- Pseudonym = `HMAC(SECRET, "pseudonym|lot_id|user_id")` shortened: stable inside a lot, different across lots. Never name, email or id; the logged-in user sees "you".
- Public bid times are shown truncated to the second (the hash uses the exact value; the server verifies). Documented in the README as the indirect-identification tradeoff.
- Receipt `code` is random (128 bits); the receipt shows the pseudonym only.

## D11. Auth
- Supabase Auth; the backend validates the JWT against the project's JWKS (`jose`, issuer and `authenticated` audience checked). Supabase's default signing is HS256, which the JWKS endpoint cannot verify, so asymmetric signing keys must be enabled in the hosted project (and checked in local `supabase start`) in slice 0; email confirmation is off, both locally (default) and in the hosted project (Confirm email toggle; the hosted default is on and the built-in mailer allows only a few messages per hour, so sign-up fails with `over_email_send_rate_limit` until it is off; hosted Auth also rejects reserved domains such as `example.com` in e-mails); profile and wallet are created by a trigger. Session stays in `localStorage` (Supabase default; XSS exposure declared, CSP headers set).

## D12. Tests: real, no mocks or fakes
- Real Postgres (`supabase start`) with the real migrations, real Supabase Auth, real HTTP server called with `fetch`, real parallel requests, real clock (short lots of 2-3 s; anti-sniping uses a lot ending in 90 s). Seed goes through the same services.
- The Met is the only external system: in CI the production client reads responses captured from the real API and served by a local HTTP server; outage is a closed port. `make e2e-live` hits the real Met (not in `make ci`; run before each deploy and before submitting).
- A full-journey script runs against the deployed URL after each deploy, with disposable `e2e-` users.
- `make ci` runs lint, typecheck, tests and build, and is exactly what GitHub Actions runs.

## D13. Time
- Everything is `timestamptz` in UTC; the UI sends an explicit zone and shows America/Sao_Paulo. The server clock only (`clock_timestamp()` after the lock).

## D14. Money and deposits
- Integer cents (`bigint` in the database, `number` in code, far below 2^53). Simulated deposit: min R$ 1,00, max R$ 100.000,00 per deposit.

## D15. Seeds
- `make seed` is a separate CLI, idempotent, dates relative to now: 1 auctioneer, 2 bidders with balance, one live lot lasting 30 days with a bid history, one scheduled lot, one settled lot with receipt, and one lot deliberately tampered directly in the database to show the "tampered" verdict. Bids go through the real services, so the chain is valid.

## D16. File organization
- npm workspaces: `frontend/`, `backend/`, `packages/contracts/` (error codes, `{code, message}` shape and endpoint DTOs, types only, so front and back cannot drift); `supabase/migrations/` (one migration per concern, never edited after being applied); `docs/`.
- Backend: `src/create-app.ts` (builds the Hono app; not named `app.ts` because Vercel would pick that name as the entry point) and `src/index.ts` (the Vercel entry, default export), `src/config.ts` (the only place that reads env vars, fails on startup, no default secrets), `src/shared/` (`db`, `errors`, `auth`, `money`), `src/modules/<feature>/` with `index.ts`, `routes.ts`, `schemas.ts`, `service.ts`, `rules.ts`. Unit tests sit next to the code (`rules.test.ts`); integration and end-to-end tests live in `backend/tests/`.
- Frontend: `app/` (router, providers), `pages/` (thin, compose features), `features/<name>/` (components, hooks, `api.ts`, `index.ts`), `components/ui/`, `lib/`, `styles/`. A feature imports another only through its `index.ts`.
- Conventions: `kebab-case` files (React components in `PascalCase.tsx`), split a file past ~200 lines, no catch-all `utils.ts`, SQL only in `service.ts`, `@/` import alias in the frontend only; the backend uses short relative imports (Vercel bundles the function itself, and the module-boundary lint rule keeps imports shallow).
- Tradeoff: three workspaces and one shared package add setup in slice 0 in exchange for one source of truth for the API contract.

## What stays simulated (declared in the README)
Deposits (no real payment), email confirmation off, polling instead of push.
