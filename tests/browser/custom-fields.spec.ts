import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "custom-fields-browser" } });
test("custom definitions and student values persist in English and Arabic mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "custom-fields-browser@example.invalid",
      password: "Test-only-browser-password-2026",
      organization: "Fictional Fields Academy",
    },
  });
  const me = await (await page.request.get("/api/me")).json(),
    branch = (await (await page.request.get("/api/branches")).json()).data[0];
  await page.request.post("/api/students", {
    headers: { "x-csrf-token": me.user.csrf },
    data: {
      branch_id: branch.id,
      name: "Fields Example Learner",
      code: "FIELDS-BROWSER",
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await page
    .getByLabel("Record type", { exact: true })
    .selectOption("students");
  await page.getByLabel("Field key", { exact: true }).fill("preferred_contact");
  await page
    .getByLabel("Field label", { exact: true })
    .fill("Preferred contact");
  await page.getByRole("button", { name: "Create field", exact: true }).click();
  await expect(
    page.getByText("preferred_contact", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-custom-field-settings.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Students", exact: true }).click();
  await page.getByRole("button", { name: /Fields Example Learner/ }).click();
  await page
    .getByLabel("Preferred contact", { exact: true })
    .fill("Guardian phone after 17:00");
  await page
    .getByRole("button", { name: "Save custom fields", exact: true })
    .click();
  await expect(
    page.getByText("Custom fields saved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: /Fields Example Learner/ }).click();
  await expect(
    page.getByLabel("Preferred contact", { exact: true }),
  ).toHaveValue("Guardian phone after 17:00");
  await page
    .getByRole("heading", { name: "Custom fields", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/downloads/elcenter-custom-field-record.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: /Fields Example Learner/ }).click();
  await page
    .getByRole("heading", { name: "حقول إضافية", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByLabel("Preferred contact", { exact: true }),
  ).toHaveValue("Guardian phone after 17:00");
  await page.screenshot({
    path: "/downloads/elcenter-custom-field-ar-mobile.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
