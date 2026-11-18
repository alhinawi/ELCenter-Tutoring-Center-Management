import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "dashboard-records-browser" },
});
test("dashboard active records show real module counts and can be hidden in both languages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "counts-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Count Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
  async function api(p: string, m = "GET", data?: any) {
    const me = (await (await page.request.get("/api/me")).json()).user;
    const r = await page.request.fetch("/api" + p, {
      method: m,
      headers: { "x-csrf-token": me.csrf },
      ...(data ? { data } : {}),
    });
    expect(r.ok()).toBeTruthy();
    return r.json();
  }
  const b = (await api("/branches")).data[0].id;
  for (let i = 0; i < 3; i++)
    await api("/students", "POST", {
      name: "Fictional Student " + i,
      code: "DASH" + i,
      branch_id: b,
      status: i === 2 ? "suspended" : "active",
    });
  await api("/teachers", "POST", {
    name: "Fictional Teacher",
    code: "DT",
    branch_id: b,
  });
  await page.goto("/");
  const widget = page.locator("[data-dashboard-widget=active_records]");
  await expect(widget).toBeVisible();
  await expect(
    widget
      .locator("div")
      .filter({ has: page.getByText("Active students", { exact: true }) })
      .last(),
  ).toContainText("2");
  await expect(widget).toContainText("Employee count excludes onboarding");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/downloads/elcenter-dashboard-recordcounts-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Customize dashboard", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Current active records", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await expect(widget).toHaveCount(0);
  await page.reload();
  await expect(widget).toHaveCount(0);
  await page
    .getByRole("button", { name: "Customize dashboard", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Current active records", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await expect(widget).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(widget).toContainText("الطلاب النشطين");
  await expect
    .poll(() =>
      page.locator("aside").evaluate((e) => e.getBoundingClientRect().left),
    )
    .toBeGreaterThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/downloads/elcenter-dashboard-recordcounts-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});
