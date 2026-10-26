# Traceability: brief criteria to tests

Each criterion of the brief's journeys (defined in phase 2 of the delivery process; the notes are kept outside the repository) maps to the tests that prove it. A criterion with no test is listed as open, never omitted.

## J0: access (slice 1)

| Criterion | Tests | Status |
|---|---|---|
| 0.1 bidder sign-up | `frontend/src/features/auth/auth.test.tsx` ("creates a real account and opens a session"); `backend/tests/integration/me.test.ts` ("creates the profile and an empty wallet on sign-up") | Covered |
| 0.2 login with one generic error | `auth.test.tsx` ("shows one generic message for a wrong login"); `frontend/src/features/auth/api.test.ts` ("gives one generic refusal for any sign-up error") | Covered |
| 0.3 logout | `frontend/src/journey.test.tsx` ("signs up, sees an empty wallet, deposits once even on a double click, signs out and back in") | Covered |
| 0.4 role guards on screen and API (401/403) | 401/403 cases in `catalog.test.ts`, `lots.test.ts`, `wallet.test.ts`, `bidding.test.ts`; `frontend/src/features/lots/lots.test.tsx` ("shows the role message to a bidder who opens it"); `journey.test.tsx` ("has no wallet: no menu entry ...") | Covered |
| 0.5 identity only from the token | `me.test.ts` ("returns the identity taken from the token"); `auth-claims.test.ts` | Covered |
| 0.6 sign-up asks "Quero comprar" or "Quero vender" and the account gets that role (B14) | `me.test.ts` ("gives the role chosen at sign-up ..."); `journey.test.tsx` ("signs up choosing \"Quero vender\" and gets the auctioneer panel, not a wallet") | Covered |
| 0.7 only those two roles are accepted at sign-up, and the role cannot change after it (B14) | `me.test.ts` ("accepts no other role at sign-up, and the role cannot change after it"), with two hand mutations (D24) | Covered |
| 0.8 the login screen offers the demo accounts, and a shortcut is a real sign-in (B15) | `auth.test.tsx` ("offers the demo accounts, and a shortcut is a real sign-in"); the failed sign-in reuses the generic refusal path of 0.2 | Covered |

## J1: auctioneer (slice 2)

| Criterion | Tests | Status |
|---|---|---|
| 1.1 search an item in the external API | `catalog.test.ts` ("returns the public-domain items with an image ..."); `lots.test.tsx` ("publishes a lot from a catalog item and manages it") | Covered |
| 1.2 create a lot with validations | `backend/tests/integration/lots.test.ts` (creation and refusals); `backend/src/modules/lots/rules.test.ts`; `lots.test.tsx` ("refuses inverted times with the reason ...") | Covered |
| 1.3 item data copied into the database | `lots.test.ts` ("keeps the copy: the lot keeps its item even if the catalog later fails") | Covered |
| 1.4 search with the API down shows a clear error | `catalog.test.ts` (503 `catalog_unavailable` cases); `frontend/src/features/lots/catalog-states.test.tsx` ("a failed item search says so on the screen, and a new search recovers") | Covered |
| 1.5 edit only before the start and without bids | `lots.test.ts` (edit cases, 409 `lot_not_editable`); `rules.test.ts` | Covered |
| 1.6 cancel a lot that has not ended; one with bids refunds the leader (9.1) | `lots.test.ts` (cancel cases); `rules.test.ts`; `cancel-refund.test.ts` | Covered |
| 1.7 result of each ended lot and the total received | `backend/tests/integration/auctioneer-results.test.ts` (sold for how much, no bids, pending settlement, the total without other auctioneers' lots, 403 for a bidder); `frontend/src/features/lots/results.test.tsx` ("shows what each ended lot sold for, its no-bids state, and the total received") | Covered |
| 1.8 only their own lots | `lots.test.ts` ("lists only the auctioneer's ...", "refuses to edit another auctioneer's ...", "refuses to cancel another auctioneer's ...") | Covered |
| 1.9 an auctioneer cannot bid | `bidding.test.ts` ("refuses an anonymous visitor with 401 and an auctioneer with 403"); `frontend/src/features/lots/bidding.test.tsx` ("an auctioneer sees the room and is told they cannot bid") | Covered |

## J2: public showcase (slice 2)

| Criterion | Tests | Status |
|---|---|---|
| 2.1 live, scheduled and ended tabs; cancelled hidden | `lots.test.ts` ("lists lots by state and hides cancelled ones"); `frontend/src/features/lots/showcase.test.tsx` ("turns off on its own, without a reload, once the only live lot ends"); `LotCard.test.tsx` | Covered |
| 2.2 card with image, title, current bid and time | `frontend/src/features/lots/showcase.test.tsx` ("shows the starting bid until a bid arrives, then the current bid"); `lots.test.tsx` ("lists a published lot under its state ...") | Covered |
| 2.3 search and filter | `lots.test.ts` ("searches by title, ignoring case ..."; "refuses an unknown status filter with 422") | Covered |
| 2.4 works with the external API down | `catalog.test.ts` ("keeps working for everything else when the catalog is down") | Covered |
| 2.5 loading, empty and error states | `lots.test.tsx` ("shows the showcase loading and an empty state ...", "answers a missing lot with a message, not a blank page"); `catalog-states.test.tsx` ("a failed list shows the error with a retry, and the retry shows the list again") | Covered |

## J3: wallet (slice 1)

| Criterion | Tests | Status |
|---|---|---|
| 3.1 total, committed, available and deposit | `frontend/src/features/wallet/wallet.test.tsx` ("shows total, committed and available in reais"); `journey.test.tsx` | Covered |
| 3.2 available = total - committed, never negative | `backend/src/modules/wallet/rules.test.ts`; `wallet.test.ts` ("refuses committed above total even when written directly", "refuses a negative balance when written directly") | Covered |
| 3.3 deposit limits and validation | `wallet.test.ts` ("accepts exactly the minimum and the maximum deposit"); `journey.test.tsx` ("refuses a deposit below the minimum ...") | Covered |
| 3.4 simultaneous deposits add up | `wallet.test.ts` ("sums simultaneous deposits with different keys", "credits exactly once when many identical requests race with the same key") | Covered |

## J4: live room and bids (slice 3)

| Criterion | What it requires | Tests | Status |
|---|---|---|---|
| 4.1 | Live room: current bid, history, position, countdown, leading or outbid, no reload | `frontend/src/features/lots/bidding.test.tsx` ("a bidder leads, and the room tells them without a reload when someone else outbids them"); `backend/tests/integration/bidding.test.ts` ("is public and shows no user ids, and marks my position only when I am signed in"; "still says \"outbid\" to someone who bid long before the last 50 bids") | Partial: the countdown is not tested (see 4.9) |
| 4.2 | Bids only in a live lot; first at least the starting bid; later at least current plus increment | `rules.test.ts` ("lot state gates the bid", "minimum amount"); `bidding.test.ts` ("refuses a first bid below the starting bid ...", "requires the next bid ...") | Covered |
| 4.3 | Refusals with the exact reason: below minimum, insufficient funds, already leading, not started, ended | Messages asserted: `backend/tests/integration/bidding.test.ts` ("refuses a first bid below the starting bid with the exact minimum", "refuses a bid above the available balance with the exact available amount, and changes nothing", "refuses the leader bidding again with already_leading, and a double click does not double the bid"); `frontend/src/features/lots/bidding.test.tsx` ("a refused bid shows the exact reason and keeps the amount typed"). Messages asserted too: "refuses a lot that has not started with lot_not_started" and "refuses a lot that has ended with lot_ended" in `bidding.test.ts`; the codes also in `backend/src/modules/bidding/rules.test.ts` | Covered |
| 4.4 | The leader cannot cover their own bid | `rules.test.ts` ("refuses the current leader with already_leading"); `bidding.test.ts` ("refuses the leader bidding again with already_leading, and a double click does not double the bid") | Covered |
| 4.5 | Committed money while leading, released when outbid | `rules.test.ts` ("the outbid leader is released"); `bidding.test.ts` ("requires the next bid ... releases the previous leader"; "20 bidders at the same instant: the accepted bids form one contiguous, increasing chain" (checks that committed money equals the leader's amount)) | Covered |
| 4.6 | Anti-sniping: a bid in the last two minutes extends the end by two minutes | `rules.test.ts` ("anti-sniping ..." block, 6 cases); `bidding.test.ts` ("a lot ending in 90 seconds gets exactly two more minutes") | Covered |
| 4.7 | Two bids at the same time: only one leads | `bidding.test.ts` ("one bidder firing ten requests at once ..."; "20 bidders at the same instant ...") | Covered |
| 4.8 | Same balance in two lots at the same time never goes negative | `bidding.test.ts` ("one balance in two lots at once ..."; "bids crossing between two lots ...") | Covered |
| 4.9 | Server clock: the countdown uses the server's time, not the browser's | `frontend/src/features/lots/clock.test.ts` (the offset from the server time and the request midpoint; a browser clock an hour off still shows 10 minutes left; zero or less once the server says it ended). The sign was checked by mutation | Covered |

## J5: closing and settlement (slice 4)

| Criterion | Test | Status |
|---|---|---|
| 5.1 closes at its time with nobody looking | `backend/tests/integration/settlement.test.ts`, "5.1" (cron call settles an ended lot, leaves a running one) | Covered (cron trigger), plus on-demand in `settlement-on-demand.test.ts` |
| 5.2 winner pays, auctioneer is credited, outbid money released, receipt written | `settlement.test.ts`, "5.2" | Covered |
| 5.3 no bids closes without a winner | `settlement.test.ts`, "5.3" | Covered |
| 5.4 settles once under parallel triggers | `settlement.test.ts`, "5.4" (ten parallel cron calls) | Covered |
| 5.5 the money only moves, the lot's ledger nets to zero | `settlement.test.ts`, "5.5" | Covered |
| Settlement refuses a head copy that does not match the chain (D6) | `settlement.test.ts`, "a settlement that cannot prove its history" | Covered |

## J6: my wins and the win receipt

| Criterion | Tests | Status |
|---|---|---|
| 6.1 list the lots bid on and won, with the receipt | `backend/tests/integration/receipts.test.ts` ("lists the lots a bidder bid on: a won lot with its receipt code, a lost one without"; "shows the highest amount the bidder offered, not the first one"); `backend/src/modules/receipts/rules.test.ts` (every outcome: won, cancelled, leading, settling, outbid, lost); `frontend/src/features/wins/wins.test.tsx` ("a winner sees the lot in Meus arremates ..."; "says so when the bidder has not bid on any lot yet") | Covered. Declared limit: the list shows at most 100 lots, with no note when there are more |
| 6.2 shareable link with a random code, no login | `receipts.test.ts` ("opens the receipt by its code without login ..."); `wins.test.tsx` (the same link opens signed out) | Covered |
| 6.3 the receipt shows only pseudonyms | `receipts.test.ts` ("opens the receipt by its code without login ..." asserts the winner's id and e-mail are absent, and that the label is the one the public audit shows for the winner's last bid) | Covered |
| 6.4 nobody sees someone else's receipt | `receipts.test.ts` ("keeps a receipt behind its code and a list with its owner": 404 for a random or malformed code, 401 without token, 403 for an auctioneer, another bidder's list has no receipt) | Covered |

## J7: public audit (D22)

| Criterion | Tests | Status |
|---|---|---|
| 7.1 full history with pseudonyms | `backend/tests/integration/audit.test.ts` ("is public, lists every bid oldest first with its hash ...", "shows the same pseudonym as the live room ..."); `frontend/src/features/audit/audit.test.tsx` | Covered |
| 7.2 intact or tampered, and where it breaks | `audit.test.ts` ("names ..." cases); `audit.test.tsx` ("shows the tampered headline in an alert, with where the chain breaks") | Covered |
| 7.3 detects an edited value, a bid removed in the middle, the last bid removed, an inserted bid, a swapped order, a direct database change | `audit.test.ts` ("names an edited amount, bidder and time", "names the seq expected where a bid was removed from the middle", "names the head_seq when the last bid was removed ...", "names a forged bid added at the end", "names two bids whose order was swapped"); `backend/src/shared/bid-chain.test.ts` | Covered, with a declared limit: a last bid removed with the head rewritten before its publication is caught only by the bidder's receipt (README, D22) |
| 7.4 no personal data, not even indirect | `audit.test.ts` ("exposes no name, e-mail, user id or secret", "truncates every time to the second") | Covered |
| 7.5 the technique explained in the README | README, "Histórico de lances" and "Auditoria pública" | Covered (documentation, no test) |

## J8: cross-cutting

| Criterion | Tests | Status |
|---|---|---|
| 8.1 seeds: one auctioneer, two bidders, one live lot with bids, credentials in the README | `backend/tests/integration/seed.test.ts` ("creates an auctioneer, two funded bidders and one live lot with bids"; "running it again creates nothing new"); the README lists the accounts | Covered. The end-to-end run against the deployed URL is criterion 8.2 |
| 8.2 public deploy | `make e2e-prod` (`backend/scripts/e2e-deployed.ts`) walks sign-up, deposit, the live lot, a refused and an accepted bid, "Meus arremates" and the public audit on the published URL; it passed on the production site (6 of 6). The receipt step needs the lot to end, so it is not in the script | Covered for the published site; the receipt is covered by the integration tests |
| 8.3 README with the steps and the unexpected behaviors | README | Partial: the final review is pending |
| 8.4 one error shape, never a fake success | `failures.test.ts`; `catalog.test.ts` (503 cases); the `code` assertions across the integration tests | Covered |
| 8.5 the demo data also holds an ended lot with a receipt and a tampered lot (B17, B18) | `seed.test.ts` ("also leaves an ended lot with a winner and a receipt, and a settled lot whose history was changed"; "running it again creates nothing new") | Covered locally; the hosted run is pending (D9c) |

## J9: optionals of the brief (section 05)

| Criterion | Tests | Status |
|---|---|---|
| Search and filter of lots | see 2.3 | Covered |
| Automated tests | `make ci` | Covered |
| 9.1 cancelling a lot with bids refunds the committed money automatically (B19) | `backend/tests/integration/cancel-refund.test.ts`; `frontend/src/features/lots/results.test.tsx` ("asks to confirm, says the leader is refunded ..."); hand mutation in D25 | Covered |
| 9.2 Docker Compose runs the app (B20) | Checked by hand on 2026-10-26 (Linux): `make compose` built the image and served the site (200), `/api/health` (200, database ok) directly and through the site's proxy, and `/api/me` with a token from the local Auth (200). No automated test: it would need Docker inside the CI job (D26) | Covered by a manual check |
| 9.3 light and dark theme, with a switch (B21) | `frontend/src/app/theme.test.tsx` ("switches to dark and back, and the choice survives a reload"); the colors are checked on screen | Covered |
