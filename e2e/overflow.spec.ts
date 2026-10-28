import { expect, test } from "@playwright/test";
import { liveLotId, signInAs } from "./helpers";

// B28: no page scrolls sideways at the widths the canvas is checked at.
const WIDTHS = [320, 360, 390, 768, 1280];

for (const width of WIDTHS) {
  test(`no screen scrolls sideways at ${String(width)} px`, async ({
    page,
    request,
  }) => {
    const lot = await liveLotId(request);
    await page.setViewportSize({ width, height: 800 });
    await signInAs(page, "licitante 1");
    for (const path of [
      "/",
      "/carteira",
      "/arremates",
      `/lotes/${lot}`,
      `/auditoria/${lot}`,
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("main")).toBeVisible();
      const measured = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const wider = [...document.querySelectorAll("body *")]
          .filter(
            (element) =>
              element.getBoundingClientRect().width > 0 &&
              element.getBoundingClientRect().right > width + 1,
          )
          .slice(0, 3)
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}.${element.className}`,
          );
        return {
          overflow: document.documentElement.scrollWidth - width,
          wider,
        };
      });
      expect(
        measured.overflow,
        `${path} at ${String(width)} px, wider: ${measured.wider.join(", ")}`,
      ).toBeLessThanOrEqual(0);
    }
  });
}
