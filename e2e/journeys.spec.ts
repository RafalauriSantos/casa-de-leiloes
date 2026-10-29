import { expect, test } from "@playwright/test";
import { liveLotId, signInAs } from "./helpers";

test("a visitor sees the storefront and can switch its state tabs", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Leilões ao vivo" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Agendados" }).click();
  await expect(page.getByRole("button", { name: "Agendados" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a bidder sees the wallet and the deposit form", async ({ page }) => {
  await signInAs(page, "licitante 1");
  await page.goto("/carteira");
  await expect(page.getByText("Disponível para lances")).toBeVisible();
  await expect(page.getByRole("button", { name: "Depositar" })).toBeVisible();
});

test("a bidder who bids too low is told why, on the lot room", async ({
  page,
  request,
}) => {
  const lot = await liveLotId(request);
  await signInAs(page, "licitante 1");
  await page.goto(`/lotes/${lot}`);
  const form = page.getByRole("form", { name: "Dar lance" });
  const leading = page.getByText("Você está ganhando.");
  await expect(form.or(leading)).toBeVisible();
  // The leader gets no bid form, so when bidder 1 leads the lot, bidder 2 places the low bid.
  if (await leading.isVisible()) {
    await signInAs(page, "licitante 2");
    await page.goto(`/lotes/${lot}`);
  }
  await expect(form).toBeVisible();
  await form.getByLabel("Seu lance (R$)").fill("1,00");
  await form.getByRole("button", { name: /^Dar lance/ }).click();
  // The server's reason, whichever it is for this demo state: below the minimum, already leading, or no funds.
  await expect(form.getByRole("alert")).toHaveText(
    /O lance mínimo agora é|Você já está ganhando este lote|Saldo disponível insuficiente/,
  );
});

test("an auctioneer lands on the panel and can start a new lot", async ({
  page,
}) => {
  await signInAs(page, "leiloeiro");
  await expect(
    page.getByRole("heading", { name: "Painel do leiloeiro" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Novo lote" }).click();
  await page.getByRole("button", { name: "Vaso" }).click();
  await expect(
    page.getByRole("button", { name: "Usar este item" }).first(),
  ).toBeVisible();
});

test("the public audit page shows a verdict and the bids of the seeded lot", async ({
  page,
  request,
}) => {
  const lot = await liveLotId(request);
  await page.goto(`/auditoria/${lot}`);
  await expect(page.getByRole("region", { name: "Lances" })).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Auditoria do lote" }),
  ).toBeVisible();
});
