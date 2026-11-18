import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "report-bounds-browser" } });
test("failed oversized operational report clears old exportable results and explains limits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "reportbounds-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Report Bounds",
        },
      })
    ).ok(),
  ).toBeTruthy();
  const me = (await (await page.request.get("/api/me")).json()).user,
    branch = (await (await page.request.get("/api/branches")).json()).data[0]
      .id;
  await page.goto("/");
  await page
    .getByRole("button", { name: "Resources & service", exact: true })
    .click();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page.getByRole("button", { name: "Run report", exact: true }).click();
  await expect(page.locator("#resource-report")).toBeVisible();
  for (let i = 0; i < 301; i++) {
    const r = await page.request.post("/api/classrooms", {
      headers: { "x-csrf-token": me.csrf },
      data: {
        name: "Fictional Report Room " + i,
        code: "RPTUI-" + i,
        capacity: 30,
        branch_id: branch,
      },
    });
    expect(r.ok()).toBeTruthy();
  }
  await page.getByRole("button", { name: "Run report", exact: true }).click();
  await expect(
    page.getByText(/Report section rooms exceeds 300/),
  ).toBeVisible();
  await expect(page.locator("#resource-report")).toHaveCount(0);
  await page.screenshot({
    path: "/downloads/elcenter-report-bounds-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("aside").evaluate((el) => el.getBoundingClientRect().left),
    )
    .toBeGreaterThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-report-bounds-ar-mobile.png",
    fullPage: false,
  });
});
