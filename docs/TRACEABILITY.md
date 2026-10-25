# Traceability: brief criteria to tests

Each criterion of the brief's journeys (defined in phase 2 of the delivery process; the notes are kept outside the repository) maps to the tests that prove it. A criterion with no test is listed as open, never omitted.

## J4: live room and bids (slice 3)

| Criterion | What it requires | Tests | Status |
|---|---|---|---|
| 4.1 | Live room: current bid, history, position, countdown, leading or outbid, no reload | `frontend/src/features/lots/bidding.test.tsx` ("a bidder leads, and the room tells them without a reload when someone else outbids them"); `backend/tests/integration/bidding.test.ts` ("is public and shows no user ids, and marks my position only when I am signed in"; "still says \"outbid\" to someone who bid long before the last 50 bids") | Partial: the countdown is not tested (see 4.9) |
| 4.2 | Bids only in a live lot; first at least the starting bid; later at least current plus increment | `rules.test.ts` ("lot state gates the bid", "minimum amount"); `bidding.test.ts` ("refuses a first bid below the starting bid ...", "requires the next bid ...") | Covered |
| 4.3 | Refusals with the exact reason: below minimum, insufficient funds, already leading, not started, ended | Messages asserted: `backend/tests/integration/bidding.test.ts` ("refuses a first bid below the starting bid with the exact minimum", "refuses a bid above the available balance with the exact available amount, and changes nothing", "refuses the leader bidding again with already_leading, and a double click does not double the bid"); `frontend/src/features/lots/bidding.test.tsx` ("a refused bid shows the exact reason and keeps the amount typed"). Codes only, message not asserted: "refuses a lot that has not started with lot_not_started" and "refuses a lot that has ended with lot_ended" in `bidding.test.ts`, and the matching cases in `backend/src/modules/bidding/rules.test.ts` | Partial: codes are tested for not started and ended, messages are not |
| 4.4 | The leader cannot cover their own bid | `rules.test.ts` ("refuses the current leader with already_leading"); `bidding.test.ts` ("refuses the leader bidding again with already_leading, and a double click does not double the bid") | Covered |
| 4.5 | Committed money while leading, released when outbid | `rules.test.ts` ("the outbid leader is released"); `bidding.test.ts` ("requires the next bid ... releases the previous leader"; "20 bidders at the same instant: the accepted bids form one contiguous, increasing chain" (checks that committed money equals the leader's amount)) | Covered |
| 4.6 | Anti-sniping: a bid in the last two minutes extends the end by two minutes | `rules.test.ts` ("anti-sniping ..." block, 6 cases); `bidding.test.ts` ("a lot ending in 90 seconds gets exactly two more minutes") | Covered |
| 4.7 | Two bids at the same time: only one leads | `bidding.test.ts` ("one bidder firing ten requests at once ..."; "20 bidders at the same instant ...") | Covered |
| 4.8 | Same balance in two lots at the same time never goes negative | `bidding.test.ts` ("one balance in two lots at once ..."; "bids crossing between two lots ...") | Covered |
| 4.9 | Server clock: the countdown uses the server's time, not the browser's | None directly. The offset arithmetic in `frontend/src/features/lots/components/LiveRoom.tsx` (`remainingMs`, midpoint offset) has no test | **Open** |

## J5: closing and settlement (slice 4)

| Criterion | Test | Status |
|---|---|---|
| 5.1 closes at its time with nobody looking | `backend/tests/integration/settlement.test.ts`, "5.1" (cron call settles an ended lot, leaves a running one) | Covered (cron trigger), plus on-demand in `settlement-on-demand.test.ts` |
| 5.2 winner pays, auctioneer is credited, outbid money released, receipt written | `settlement.test.ts`, "5.2" | Covered |
| 5.3 no bids closes without a winner | `settlement.test.ts`, "5.3" | Covered |
| 5.4 settles once under parallel triggers | `settlement.test.ts`, "5.4" (ten parallel cron calls) | Covered |
| 5.5 the money only moves, the lot's ledger nets to zero | `settlement.test.ts`, "5.5" | Covered |
| Settlement refuses a head copy that does not match the chain (D6) | `settlement.test.ts`, "a settlement that cannot prove its history" | Covered |
