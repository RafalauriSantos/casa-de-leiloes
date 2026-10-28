import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { liveLotId, signInAs } from "./helpers";

// Automated WCAG check (axe) on the main screens: no critical or serious violation may remain.
async function serious(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    )
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "n/a"}): ${String(violation.nodes.length)} element(s)`,
    );
}

test("the storefront, sign-in and the lot pages have no critical or serious accessibility violation", async ({
  page,
  request,
}) => {
  const lot = await liveLotId(request);
  for (const path of ["/", "/entrar", `/lotes/${lot}`, `/auditoria/${lot}`]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    expect(await serious(page), path).toEqual([]);
  }
});

test("the wallet and the auctioneer panel have no critical or serious accessibility violation", async ({
  page,
}) => {
  await signInAs(page, "licitante 1");
  await page.goto("/carteira");
  expect(await serious(page), "/carteira").toEqual([]);
  await signInAs(page, "leiloeiro");
  await page.goto("/leiloeiro");
  expect(await serious(page), "/leiloeiro").toEqual([]);
});

// The account button keeps its name on phones and tablets, where the name is only visually hidden.
for (const width of [390, 768]) {
  test(`the account button has an accessible name at ${String(width)} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await signInAs(page, "licitante 1");
    await page.goto("/carteira");
    expect(await serious(page), `/carteira at ${String(width)} px`).toEqual([]);
    await expect(
      page.getByRole("button", { name: /licitante/i }),
    ).toBeVisible();
  });
}
