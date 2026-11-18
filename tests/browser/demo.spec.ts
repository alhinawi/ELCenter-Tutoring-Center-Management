import { test, expect } from "@playwright/test";
test("admin demo toggle populates and safely clears flagged sample records", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore a private demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Headquarters overview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Demo mode" })).toBeChecked();
  await page.screenshot({
    path: "/downloads/elcenter-demo-toggle-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("switch", { name: "Demo mode" }).click();
  await expect(
    page.getByRole("switch", { name: "Demo mode" }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Students", exact: true }).click();
  await expect(
    page.getByText("No matching records.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await page.getByRole("switch", { name: "Demo mode" }).click();
  await expect(page.getByRole("switch", { name: "Demo mode" })).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.screenshot({
    path: "/downloads/elcenter-demo-toggle-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page.getByRole("button", { name: "الطلبة", exact: true }).click();
  await expect(page.getByRole("button", { name: /Mariam Adel/ })).toBeVisible();
});
