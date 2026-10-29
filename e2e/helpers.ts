import type { Page, APIRequestContext } from "@playwright/test";

/** The demo accounts the login screen offers as shortcuts (real sign-ins, seeded locally). */
export type Demo = "licitante 1" | "licitante 2" | "leiloeiro";

export async function signInAs(page: Page, demo: Demo): Promise<void> {
  // A signed-in session is redirected away from the sign-in screen, so the session is cleared first.
  await page.goto("/entrar");
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.goto("/entrar");
  const label =
    demo === "leiloeiro"
      ? "Entrar como leiloeiro"
      : `Entrar como ${demo}`;
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL((url) => url.pathname !== "/entrar");
}

/** The id of the seeded live lot, read from the public list. */
export async function liveLotId(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/lots?status=live");
  const lots = (await response.json()) as Array<{ id: string }>;
  const [lot] = lots;
  if (!lot) throw new Error("the seed has no live lot");
  return lot.id;
}
