import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "employee-fields-browser" },
});
test("employee detail persists typed custom values under HR controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "employee-fields-browser@example.invalid",
          password: "Test-only-password-2026",
          organization: "Fictional Staff Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
  const me = (await (await page.request.get("/api/me")).json()).user,
    branch = (await (await page.request.get("/api/branches")).json()).data[0]
      .id;
  expect(
    (
      await page.request.post("/api/operations/employees", {
        headers: { "x-csrf-token": me.csrf },
        data: {
          branch_id: branch,
          name: "Fictional Staff Member",
          code: "FIELDS-EMP",
          job_title: "Tutor",
          hired_on: "2026-01-01",
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await page
    .getByLabel("Record type", { exact: true })
    .selectOption("employees");
  await page.getByLabel("Field key", { exact: true }).fill("staff_badge_class");
  await page
    .getByLabel("Field label", { exact: true })
    .fill("Staff badge classification");
  await page.getByRole("button", { name: "Create field", exact: true }).click();
  await expect(
    page.getByText("staff_badge_class", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "People & admissions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Staff actions", exact: true })
    .click();
  await page
    .getByLabel("Staff badge classification", { exact: true })
    .fill("Permanent staff badge");
  await page
    .getByRole("button", { name: "Save custom fields", exact: true })
    .click();
  await expect(
    page.getByText("Custom fields saved", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-employee-fields-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Staff actions", exact: true })
    .click();
  await expect(
    page.getByLabel("Staff badge classification", { exact: true }),
  ).toHaveValue("Permanent staff badge");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page
    .getByRole("button", { name: "إجراءات الموظف", exact: true })
    .click();
  await expect(
    page.getByLabel("Staff badge classification", { exact: true }),
  ).toHaveValue("Permanent staff badge");
  await page.screenshot({
    path: "/downloads/elcenter-employee-fields-ar-mobile.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
