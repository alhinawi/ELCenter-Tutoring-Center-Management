import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "calendar-bounds-browser" },
});
test("failed calendar fetch clears prior sessions and late old requests cannot refill changed filters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore a private demo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Timetable & attendance", exact: true })
    .click();
  await expect(
    page.getByText("Conversation practice", { exact: false }).first(),
  ).toBeVisible();
  const me = (await (await page.request.get("/api/me")).json()).user;
  const groups = (await (await page.request.get("/api/groups")).json()).data;
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  let oldResolve: (() => void) | null = null,
    newResolve: (() => void) | null = null,
    oldSeen = false;
  const oldGate = new Promise<void>((r) => {
      oldResolve = r;
    }),
    newGate = new Promise<void>((r) => {
      newResolve = r;
    });
  await page.route("**/api/sessions?**", async (route) => {
    const group = new URL(route.request().url()).searchParams.get("group");
    if (group) {
      oldSeen = true;
      await oldGate;
      const now = Math.floor(Date.now() / 1000);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: crypto.randomUUID(),
              group_name: "STALE-FILTER-SESSION",
              topic: "STALE-FILTER-SESSION",
              starts_at: now,
              ends_at: now + 3600,
              status: "scheduled",
            },
          ],
        }),
      });
    } else {
      await newGate;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "Calendar exceeds 1000 sessions; narrow the visible date range or group. No partial calendar was returned.",
        }),
      });
    }
  });
  await page
    .getByLabel("Group filter", { exact: true })
    .selectOption(groups[0].id);
  await expect.poll(() => oldSeen).toBeTruthy();
  await expect(
    page.getByText("Conversation practice", { exact: false }),
  ).toHaveCount(0);
  await page.getByLabel("Group filter", { exact: true }).selectOption("");
  newResolve!();
  await expect(page.locator("p[role=alert]")).toContainText(
    "Calendar exceeds 1000",
  );
  oldResolve!();
  await expect(
    page.getByText("STALE-FILTER-SESSION", { exact: false }),
  ).toHaveCount(0);
  await expect(page.locator(".fc-event")).toHaveCount(0);
  await page.screenshot({
    path: "/downloads/elcenter-calendar-completeness-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("aside").evaluate((e) => e.getBoundingClientRect().left),
    )
    .toBeGreaterThanOrEqual(390);
  await expect(page.getByText(/مش بنعرض تقويم ناقص/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-calendar-completeness-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});
