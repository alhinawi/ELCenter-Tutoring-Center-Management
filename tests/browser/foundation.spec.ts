import { test, expect } from "@playwright/test";
test("desktop and Arabic mobile workflows persist", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase1-login-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Explore a private demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Headquarters overview" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase1-en-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Branches", exact: true }).click();
  await page.getByRole("button", { name: "New branch", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Fictional Delta Campus");
  await page
    .getByLabel("Code", { exact: true })
    .fill("D" + Date.now().toString().slice(-9));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Fictional Delta Campus" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Branches", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Fictional Delta Campus" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-phase1-ar-mobile-branches.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page.getByRole("button", { name: "نظرة عامة", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "نظرة عامة على المؤسسة" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase1-ar-mobile-dashboard.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "الوضع الداكن", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({
    path: "/downloads/elcenter-phase1-ar-dark-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page
    .getByRole("button", { name: "الأدوار والصلاحيات", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "الأدوار والصلاحيات", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
