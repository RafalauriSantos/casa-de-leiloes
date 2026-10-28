import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  promoteToAuctioneer,
  signUpUser,
  type TestUser,
} from "../helpers/auth";
import { startTestServer, type TestServer } from "../helpers/server";

// One table for who may call what: every protected route, against an anonymous caller and each wrong role.
// A route that answers 200 to the wrong role, or 401/403 without the {code, message} shape, fails here.
let server: TestServer;
let bidder: TestUser;
let auctioneer: TestUser;

beforeAll(async () => {
  server = await startTestServer();
  bidder = await signUpUser();
  auctioneer = await signUpUser();
  await promoteToAuctioneer(server.db, auctioneer.id);
});
afterAll(async () => {
  await server.close();
});

type Caller = "anonymous" | "bidder" | "auctioneer";

const tokenOf = (caller: Caller): string | undefined =>
  caller === "anonymous"
    ? undefined
    : (caller === "bidder" ? bidder : auctioneer).token;

interface Route {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  /** The one role that may call it, or `any` signed-in user; every other caller is refused. */
  allowed: Exclude<Caller, "anonymous"> | "any";
}

const lot = randomUUID();
const routes: Route[] = [
  { method: "GET", path: "/api/me", allowed: "any" },
  { method: "GET", path: "/api/catalog/search?q=vase", allowed: "auctioneer" },
  { method: "GET", path: "/api/wallet", allowed: "bidder" },
  {
    method: "POST",
    path: "/api/wallet/deposits",
    body: { amountCents: 100_000 },
    allowed: "bidder",
  },
  { method: "GET", path: "/api/me/wins", allowed: "bidder" },
  {
    method: "POST",
    path: `/api/lots/${lot}/bids`,
    body: { amountCents: 50_000 },
    allowed: "bidder",
  },
  { method: "GET", path: "/api/auctioneer/lots", allowed: "auctioneer" },
  { method: "GET", path: "/api/auctioneer/summary", allowed: "auctioneer" },
  { method: "POST", path: "/api/lots", body: {}, allowed: "auctioneer" },
  {
    method: "PATCH",
    path: `/api/lots/${lot}`,
    body: {},
    allowed: "auctioneer",
  },
  { method: "POST", path: `/api/lots/${lot}/cancel`, allowed: "auctioneer" },
];

async function call(route: Route, caller: Caller): Promise<Response> {
  const token = tokenOf(caller);
  return fetch(`${server.url}${route.path}`, {
    method: route.method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(route.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      "Idempotency-Key": randomUUID(),
    },
    body: route.body === undefined ? undefined : JSON.stringify(route.body),
  });
}

describe.each(routes)("$method $path", (route) => {
  const allowed = route.allowed;
  it("refuses an anonymous caller with 401 and the error shape", async () => {
    const response = await call(route, "anonymous");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: expect.any(String) as string,
      message: expect.any(String) as string,
    });
  });

  const others =
    allowed === "any"
      ? []
      : (["bidder", "auctioneer"] as const).filter(
          (caller) => caller !== allowed,
        );
  it.each(others)("refuses a %s with 403 forbidden", async (caller) => {
    const response = await call(route, caller);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      "forbidden",
    );
  });

  if (allowed !== "any") {
    it(`lets the ${allowed} past the role check`, async () => {
      const response = await call(route, allowed);
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
      expect(response.status).toBeLessThan(500);
    });
  }
});
