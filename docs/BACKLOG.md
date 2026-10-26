# Backlog

The work items of the project, done and to do. The acceptance criteria are not repeated here: each item points to
the criteria in `docs/TRACEABILITY.md` (J0 to J8, taken from the brief) and to the decisions in `docs/DECISIONS.md`.
An item is done when its criteria are Covered there.

Risk levels: **high** (money, bids, settlement, authentication, permissions, migrations) needs both reviewers, a
mutation per rule and the owner's "pode mergear"; **normal** needs one reviewer and merges on green CI.

## Done

| Item | Criteria | Decisions | PRs |
|---|---|---|---|
| Walking skeleton: monorepo, CI, Supabase, Vercel deploy, per-minute scheduler | 8.2 | D1, D2 | #1 |
| Access and wallet: role guard, idempotent simulated deposit, append-only ledger | 0.1 to 0.5, 3.1 to 3.4 | D3, D9 | #2, #3 |
| Catalog search, lots and the public showcase | 1.1 to 1.3, 1.5, 1.6, 1.8, 2.1, 2.3, 2.4 | D17 | #4, #5, #9 |
| Bids, the live room and the hash-chained bid history | 1.9, 4.2, 4.4 to 4.8 | D4, D18 | #6, #7 |
| Quality bar and the traceability map | | | #8 |
| Settlement: due lots, receipts, on-demand triggers, refusal of a broken history | 5.1 to 5.5 | D6 | #10, #11 |
| Bid receipt with the chain head | 7.3 | D21 | #13 |
| Public anchor on GitHub: rules and publisher | 7.3 | D21 | #14, #15 |
| Public audit: route, first broken bid, anchor, receipt head, headline, page | 7.1 to 7.5 | D22 | #16 to #22 |
| Limit of 1,000 bids per lot | | D23 | #23 |
| Payment waits for the publication of the last bid | | D21 | #24 |
| Owner release of a lot whose history fails verification | 7.2 | D20 | #12, #25 |
| Decision: no read-back of the anchor before payment | | D21 | #26 |
| AO VIVO badge on live lots | 2.1 | | #27 |
| The Ao vivo dot only while a lot is open; test runs leave no open lot behind | 2.1, 2.5 | | #28 |
| "Meus arremates" and the shareable win receipt | 6.1 to 6.4 | high | #30 |
| Demo seed: one auctioneer, two funded bidders, one live lot with bids (D9c) | 8.1 | normal | #31 |
| Auctioneer panel: result of each ended lot and the total received | 1.7 | normal | #33 |
| End-to-end script against the published site (`make e2e-prod`) | 8.2 | normal | #36 |
| Receipt head wraps on phones (no sideways scroll in the live room) | | normal | #32 |
| Countdown in days when more than a day is left | | normal | #34 |
| Countdown from the server clock (clock arithmetic in pure functions, tested) | 4.1, 4.9 | normal | #39 (review and CI in progress) |
| CI on pull requests only, cancel superseded runs, skip tests for docs-only changes | | normal | #37 |
| Supabase image cache (added in #38, removed in #40: it missed on every new branch) | | normal | #38, #40 |
| Catalog down: the search shows the server's message on the screen (test with the API's 503 answer) | 1.4 | normal | #42 |
| Showcase card shows the current bid once there are bids (it always showed the starting bid); card fields and the error state with retry tested | 2.2, 2.5 | normal | #42 |
| Exact messages for "not started" and "ended" bid refusals are asserted (the messages were already sent) | 4.3 | normal | #43 |
| The Ao vivo dot goes off on its own when the only live lot ends with the page open (the test closes open lots in the local database first) | 2.1 | normal | #43 |
| README final review: steps and limits checked against the code; the intro no longer says bids and audit are coming | 8.3 | normal | #44 |
| The demo catalog has real variety: the seed adds six real Met objects of other kinds (clock, sword, chair, teapot, box), scheduled for tomorrow (B23) | 8.1 | normal | #46 |
| Brief gaps: seed test reads the active demo lot (B13); sign-up chooses bidder or auctioneer (B14, migration 11); demo sign-in shortcuts (B15); README with the site and the demo accounts (B16); seed with an ended lot and a tampered lot (B17, B18); cancel with refund (B19, optional); Docker Compose (B20, optional); theme switch (B21, optional); AI usage notes (B22) | 0.6 to 0.8, 8.1, 8.5, 9.1 to 9.3 | D24, D25, D26 | #45 (waiting for "pode mergear") |

## To do (by priority)

| # | Item | Criteria | Risk | Done when |
|---|---|---|---|---|
| B10 | Security headers (CSP and others): set in `vercel.json` in #44; still open until the browser console shows no CSP error on the site and the preview's API answers | | normal | the app answers with them and still works on Vercel |
| B11 | Daily live test of the public anchor: moved past the brief's deadline (29 October); declared as a known limit | | normal | planned in D21 |

Owner actions (not code): make the repository public after checking its history for secrets; protect the `main` branch of the anchor repository (checked on 2026-10-26: not protected).

## Waiting for a decision

| Item | What is needed |
|---|---|
| Owner alert when a lot waits more than 10 minutes for publication | The owner chooses the channel (e-mail or other) |
| Visual identity | The owner sends the references |
