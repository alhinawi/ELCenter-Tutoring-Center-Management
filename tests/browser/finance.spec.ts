import { test, expect } from "@playwright/test";
test("finance demo, invoice persistence and reports work on desktop and Arabic mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore a private demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Headquarters overview" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Finance & payroll", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/DEMO-/).first()).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase4-finance-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: /DEMO-/ }).click();
  await expect(
    page.getByText("English Foundations · fictional tuition"),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase4-invoice-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Student", exact: true })
    .selectOption({ label: "Mariam Adel" });
  await page
    .getByRole("textbox", { name: "Invoice number", exact: true })
    .fill("UI-" + Date.now());
  await page
    .getByRole("textbox", { name: "Item description" })
    .fill("Fictional tuition");
  await page.getByRole("spinbutton", { name: "Unit price" }).fill("850");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/UI-/).first()).toBeVisible();
  await page.getByRole("button", { name: /UI-/ }).click();
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await page
    .getByRole("button", { name: "Issue & post invoice", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Issue & post invoice", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("spinbutton", { name: "Payment amount", exact: true })
    .fill("500");
  await page
    .getByRole("button", { name: "Record receipt", exact: true })
    .click();
  await expect(page.getByText(/Receipt ID:/)).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase4-invoice-paid.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Financial reports", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Trial balance", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Balanced", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase4-reports-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "الحسابات والمرتبات", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase4-reports-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "الفواتير", exact: true }).click();
  await expect(page.getByText(/UI-/).first()).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase4-invoices-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
