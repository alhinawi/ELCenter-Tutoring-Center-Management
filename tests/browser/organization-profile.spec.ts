import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "profile-browser" } });
test("organization profile persists and display identity updates without changing legal name", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "profile-browser@example.invalid",
      password: "Test-only-browser-password-2026",
      organization: "Fictional Legal Academy",
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Fictional Learning House");
  await page.getByLabel("Tagline", { exact: true }).fill("Connected learning");
  await page
    .getByLabel("Contact email", { exact: true })
    .fill("contact@example.invalid");
  await page.getByLabel("Contact phone", { exact: true }).fill("01000000000");
  await page
    .getByLabel("Business address", { exact: true })
    .fill("Fictional campus, Cairo");
  await page
    .getByLabel("Website, HTTPS", { exact: true })
    .fill("https://example.invalid");
  await page
    .getByLabel("Financial year starts in month", { exact: true })
    .selectOption("9");
  await page
    .getByRole("button", { name: "Save profile settings", exact: true })
    .click();
  await expect(
    page
      .getByRole("banner")
      .getByText("Fictional Learning House", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Organization name", { exact: true }),
  ).toHaveValue("Fictional Legal Academy");
  await page.reload();
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await expect(page.getByLabel("Contact email", { exact: true })).toHaveValue(
    "contact@example.invalid",
  );
  await expect(
    page.getByLabel("Financial year starts in month", { exact: true }),
  ).toHaveValue("9");
  await page.screenshot({
    path: "/downloads/elcenter-organization-profile-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page
    .getByRole("heading", { name: "ملف المؤسسة", exact: true })
    .scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.locator("aside").evaluate((el) => el.getBoundingClientRect().left),
    )
    .toBeGreaterThanOrEqual(390);
  await page.screenshot({
    animations: "disabled",
    path: "/downloads/elcenter-organization-profile-ar-mobile.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
