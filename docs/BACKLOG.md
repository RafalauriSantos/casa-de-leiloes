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
| AO VIVO badge on live lots (replaced by the brass "Ao vivo" label, D34) | 2.1 | | #27 |
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
| Catalog search pages through the Met's results, 12 at a time, up to its 10,000-result window, with the total and the page count (B24, D28) | 1.1 | normal | #47 |
| Redesign, slice 1: showcase with the featured live lot and the room in two columns, from the Claude Design canvas (copy unchanged; visual change) (D29) | 2.1, 2.2 | normal | #48 |
| Redesign, remaining screens in one pass: sign-in with its side panel, wallet with the balance bar and quick deposit amounts, my wins, the receipt with its seal and frame, the audit headline, the auctioneer panel (visual; copy kept) (D30) | 2.x, 6.x, 7.x, 1.x | normal | #49 |
| Brief gaps: seed test reads the active demo lot (B13); sign-up chooses bidder or auctioneer (B14, migration 11); demo sign-in shortcuts (B15); README with the site and the demo accounts (B16); seed with an ended lot and a tampered lot (B17, B18); cancel with refund (B19, optional); Docker Compose (B20, optional); theme switch (B21, optional); AI usage notes (B22) | 0.6 to 0.8, 8.1, 8.5, 9.1 to 9.3 | D24, D25, D26 | #45 (waiting for "pode mergear") |
| The app uses the approved canvas palette (white and graphite, dark gold accents, gold in the dark theme) and Jost | 2.x | D33 | #66 |
| The storefront follows the canvas: headline with search, featured live lot, list of lots with a small photo | 2.1, 2.2 | D34 | #67 |

## To do (by priority)

| # | Item | Criteria | Risk | Done when |
|---|---|---|---|---|
| B10 | Security headers (CSP and others): set in `vercel.json` in #44; still open until the browser console shows no CSP error on the site and the preview's API answers | | normal | the app answers with them and still works on Vercel |
| B11 | Daily live test of the public anchor: moved past the brief's deadline (29 October); declared as a known limit | | normal | planned in D21 |
| B27 | Visual v3, desktop: build the nine screens of the canvas page "Desktop" (`https://claude.ai/artifact/MnWiASFsu9vAdWfhNLJ4Qu`) exactly as drawn: positions, spacing, type, and one primary action per screen. One navigation bar with the brand once; no repeated brand card. Done so far: the storefront (#67, #72, #73), the palette (#66), the header (#69), the auctioneer panel and new lot (#70), the wallet and sign-in (#71) my wins and the receipt (this one); the audit screen and the states are left | Each screen matches its canvas artboard at 1280 px (side by side screenshots); the bidder's and auctioneer's flow links work from start to switching roles | normal | all nine screens reviewed side by side with the canvas and approved by the owner |
| B28 | Visual v3, phone: build the nine screens of the canvas page "Celular" (390 px) exactly as drawn | No horizontal overflow at 320, 360, 390, 768 and 1280 px; the same content order as the canvas on each width; screenshots at 320 and 390 px reviewed; the phone header is one line (logo at the left, the main link of the role and an account menu with the name and "Sair"), the theme switch is a 44 px icon button without underline, and the balance shows once. Done for the header in this slice (D35), the screens follow | normal | screenshots reviewed by the owner at 320, 360, 390 px and at 768 and 1280 px |
| B29 | Visual v3, dark theme: design and build the dark version of the nine screens (tokens and screens). The tokens and the canvas are done (#66, D33); the screens follow the other items | Contrast of text at 4.5:1 and of control borders at 3:1 in the dark theme; the theme switch keeps working | normal | dark screens reviewed by the owner |
| B30 | Auctioneer panel as the brief asks (Front-End, "Painel do leiloeiro"): summary at the top (total received, sold ended lots, active lots), "New lot" as the main action, "My lots" before the item search, the creation form after choosing an item, cancel is offered for a lot that has not ended (with bids it asks for confirmation and refunds the leader, D25), and the result of each ended lot. Creating a lot is a flow of steps (item, data, publish) with a way back; the catalog opens with search shortcuts (Relógio, Mapa, Vaso, Pintura, Espada) and calls the external API only on a tap or a search; start and end dates come filled (start five minutes ahead, because a lot must start in the future; end in seven days) and the values are filled, not placeholders | Each item of the brief's panel row is visible on the screen; the catalog is never an empty box; cancelling a lot with bids asks for confirmation and refunds the leader (test); the total received equals the sum of the winning bids of sold lots (test) | normal, money-adjacent (total and cancel) | a test covers the total, the cancel refund and the refusal to cancel an ended lot; the screen matches the canvas. Built in the branch `feat/app-panel-and-lot-flow` (D36) |
| B31 | Feedback states on every screen: loading, empty, error, and the refusal messages the brief lists (below the minimum, insufficient balance, already leading, lot not started, lot ended) | Each refusal message from the brief appears for its case (test per case); empty and loading states exist on the lists and the room; the storefront state tabs are a segmented control (this replaces the text buttons of D34) and an empty state offers an action (auctioneer: "Criar lote"; visitor: "Ver agendados"; both done in D38) | normal, money-adjacent (bid refusals) | one test per refusal message in the brief; states visible on the screens |
| B32 | Auction flow with the role switch: bidder and auctioneer accounts can switch at the sign-in screen, and the screens show only what the role can do | Logging out and in as the other role shows the right menu and screens (test); after sign-in the auctioneer lands on the panel (done, D35), and the lot room does not offer the bid action to the auctioneer (the brief: the auctioneer cannot bid; room done earlier, featured lot on the storefront done in D39) | normal | the flow in the canvas runs end to end on the deployed site |
| B33 | App icons: the gavel as the favicon and as PNG icons for the home screen (Android and iOS, `apple-touch-icon` and a web manifest) | Every screen shows the gavel in the browser tab; adding the site to the home screen shows the gavel, not a generic icon | normal | the owner confirms the tab icon and the home-screen icon on the phone |
| B34 | Wallet history ("Movimentações" on the canvas): list the bidder's deposits and committed bids, newest first. Needs a read endpoint over the ledger, so it is a money-path read (D37) | The list shows each deposit and each bid with date and amount; it never shows another user's rows (test) | high, money and access | a test per rule and the owner's "pode mergear" |

Owner actions (not code): make the repository public after checking its history for secrets; protect the `main` branch of the anchor repository (checked on 2026-10-26: not protected).

## Waiting for a decision

| Item | What is needed |
|---|---|
| Owner alert when a lot waits more than 10 minutes for publication | The owner chooses the channel (e-mail or other) |
| Visual identity | The owner sends the references |
