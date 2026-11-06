// PR artefacts (CAPTURE=1 npx playwright test capture): screenshots at 1440x900, a 1280x800 fit
// check, and a console-clean load. Skipped in the normal e2e run.
import { expect, test, type Page } from "@playwright/test";
import { join, resolve } from "node:path";
import { startEngine, stopEngine } from "./stack";

test.skip(!process.env.CAPTURE, "set CAPTURE=1 to produce PR screenshots");
const OUT = resolve(__dirname, "..", "..", "docs", "screenshots");

async function open(page: Page) {
  await page.goto("/riskpilot");
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(5);
  await expect(page.locator("#hook svg")).toBeVisible();
}

test("console is clean on load", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await open(page);
  await page.waitForTimeout(3_000);
  expect(problems).toEqual([]);
});

test("fits without scrolling at 1440x900 and 1280x800", async ({ page }) => {
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    await open(page);
    for (const sel of ["#status", "#opps", "#approve"]) {
      const box = await page.locator(sel).boundingBox();
      expect(box!.y + box!.height, `${sel} bottom at ${size.width}x${size.height}`).toBeLessThanOrEqual(size.height);
    }
    const dec = await page.locator("#decision").boundingBox();
    expect(dec!.y + dec!.height, `decision panel bottom at ${size.width}x${size.height}`).toBeLessThanOrEqual(size.height);
  }
});

test("screenshots", async ({ page }) => {
  await open(page);
  await page.screenshot({ path: join(OUT, "1-load.png") });
  await page.locator("[data-testid=opp-row][data-label^='Call-like']").click();
  await page.screenshot({ path: join(OUT, "2-approve-selected.png") });
  await page.locator("[data-testid=opp-row][data-label^='Put-like']").click();
  await page.screenshot({ path: join(OUT, "3-reject-selected.png") });
  await page.locator("[data-testid=opp-row][data-label^='Call-like']").click();
  await page.getByRole("button", { name: "View API" }).click();
  await expect(page.getByTestId("api-request")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "5-api-drawer.png") });
  await page.getByRole("button", { name: "Close" }).click();
  await stopEngine();
  await expect(page.locator("#opps")).toContainText("Source unavailable: engine", { timeout: 5_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "4-engine-down.png") });
  await startEngine();
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await page.screenshot({ path: join(OUT, "6-load-1280x800.png") });
});
