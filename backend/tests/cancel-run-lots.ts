import { cancelLotsSince } from './helpers/cleanup-run';

// Run by `make test` after the suites: cancels the unsettled lots the run created, so the shared test database does
// not keep open lots that make the live views of later runs look live. The start time comes from make, taken before
// the run; a small margin covers clock differences.
const since = new Date(Date.parse(process.argv[2] ?? '') - 5_000);
if (Number.isNaN(since.getTime())) throw new Error('usage: cancel-run-lots.ts <run start, ISO time>');
await cancelLotsSince(process.env.DATABASE_URL, since);
