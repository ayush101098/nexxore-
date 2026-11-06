// PR artefacts (CAPTURE=1 npx playwright test capture): screenshots at 1440x900, a 1280x800 fit
// check, and a console-clean load. Skipped in the normal e2e run.
import { expect, test, type Page } from "@playwright/test";
import { join, resolve } from "node:path";
import { freshWallet, installWallet, startEngine, stopEngine } from "./stack";

test.skip(!process.env.CAPTURE, "set CAPTURE=1 to produce PR screenshots");
const OUT = resolve(__dirname, "..", "..", "docs", "screenshots");

// The demo wallet (its profile comes with the frozen DB); `shoot` opens as a fresh wallet instead,
// to photograph the first-connect profile picker.
const installed = new WeakSet<Page>();
async function open(page: Page, shoot?: string) {
  if (!installed.has(page)) {
    installed.add(page);
    // A 3 s first prompt holds the stepper on "Signing 1 of 2" long enough to photograph it.
    if (shoot) { const w = freshWallet(); await installWallet(page, w.address, w.key); } else await installWallet(page, undefined, undefined, { firstSendDelayMs: 3_000 });
  }
  await page.goto("/riskpilot");
  const card = page.locator("[data-testid=profile-card][data-profile=moderate]");
  await Promise.race([card.waitFor({ timeout: 15_000 }), page.locator("[data-testid=opp-row]").first().waitFor({ timeout: 15_000 })]);
  if (await card.isVisible()) {
    if (shoot) await page.screenshot({ path: join(OUT, shoot) });
    await card.click();
  }
  await expect(page.locator("[data-testid=opp-row]")).toHaveCount(5);
  await expect(page.locator("#hook svg")).toBeVisible();
}

test("console is clean on load", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await open(page, "0-profile-picker.png"); // a fresh wallet: the picker, then it signs Moderate
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
  await page.getByTestId("profile-status").hover();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, "7-profile-derivation.png") });
  await page.locator("[data-testid=opp-row][data-label^='Call-like']").click();
  const steps = page.getByTestId("approve");
  await steps.click();
  await expect(steps).toHaveText(/^(Signing|Confirming) [12] of/);
  await page.screenshot({ path: join(OUT, "8-stepper.png") });
  await expect(page.getByTestId("confirmed")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: join(OUT, "9-confirmed.png") });
  await stopEngine("SIGKILL");
  await expect(page.locator("#opps")).toContainText("Source unavailable: engine", { timeout: 5_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "4-engine-down.png") });
  await startEngine();
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await page.screenshot({ path: join(OUT, "6-load-1280x800.png") });
});
