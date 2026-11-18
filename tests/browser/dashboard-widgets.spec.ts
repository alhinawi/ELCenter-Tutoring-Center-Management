import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "dashboard-widgets-browser" },
});
test("dashboard widget visibility order save/reset persists and Arabic mobile stays usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "widgets-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Widget Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await expect(page.locator("[data-dashboard-widget]")).toHaveCount(7);
  await page
    .getByRole("button", { name: "Customize dashboard", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "Welcome", exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Move up: Recent activity", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move up: Recent activity", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Dashboard preferences saved",
  );
  await expect(page.locator("[data-dashboard-widget=welcome]")).toHaveCount(0);
  const order = await page
    .locator("[data-dashboard-widget=activity]")
    .evaluate((e) => String([...e.parentElement!.children].indexOf(e)));
  expect(order).toBe("3");
  await page.reload();
  await expect(page.locator("[data-dashboard-widget]")).toHaveCount(6);
  expect(
    await page
      .locator("[data-dashboard-widget=activity]")
      .evaluate((e) => String([...e.parentElement!.children].indexOf(e))),
  ).toBe("3");
  await page
    .getByRole("button", { name: "Customize dashboard", exact: true })
    .click();
  await page.screenshot({
    path: "/downloads/elcenter-dashboard-widgets-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Reset to defaults", exact: true })
    .click();
  await expect(page.locator("[data-dashboard-widget]")).toHaveCount(7);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page
    .getByRole("button", { name: "تخصيص لوحة المتابعة", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "الترحيب", exact: true }).uncheck();
  await page
    .getByRole("button", { name: "حفظ لوحة المتابعة", exact: true })
    .click();
  await expect(page.locator("[data-dashboard-widget=welcome]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "تخصيص لوحة المتابعة", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-dashboard-widgets-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  while (await page.locator("input[type=checkbox]:checked").count())
    await page.locator("input[type=checkbox]:checked").first().uncheck();
  await page
    .getByRole("button", { name: "حفظ لوحة المتابعة", exact: true })
    .click();
  await expect(page.locator("[data-dashboard-widget]")).toHaveCount(0);
  await expect(page.getByText(/مفيش بطاقات مختارة/)).toBeVisible();
  await page
    .getByRole("button", { name: "تخصيص لوحة المتابعة", exact: true })
    .click();
  await page
    .getByRole("button", { name: "رجّع الافتراضي", exact: true })
    .click();
  await expect(page.locator("[data-dashboard-widget]")).toHaveCount(7);
});
