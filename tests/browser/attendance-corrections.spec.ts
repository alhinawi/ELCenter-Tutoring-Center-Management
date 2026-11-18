import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "correction-browser" } });
test("attendance correction stays pending until another reviewer approves", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.request.post("/api/auth/demo", { data: {} });
  const me = await (await page.request.get("/api/me")).json();
  for (const p of ["/api/demo/academic-seed", "/api/settings/demo/learning"])
    expect(
      (
        await page.request.post(p, {
          headers: { "x-csrf-token": me.user.csrf },
          data: {},
        })
      ).ok(),
    ).toBeTruthy();
  await page.request.post("/api/users", {
    headers: { "x-csrf-token": me.user.csrf },
    data: {
      name: "Fictional Independent Reviewer",
      email: "correction-browser@example.invalid",
      password: "Test-only-browser-password-2026",
      role_id: me.user.role_id,
      branch_id: null,
    },
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Timetable & attendance", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Attendance English · Evening A" })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Request correction", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Corrected status", { exact: true })
    .selectOption("excused");
  await page
    .getByLabel("Corrected notes", { exact: true })
    .fill("Reviewed fictional absence evidence");
  await page
    .getByLabel("Reason for correction", { exact: true })
    .fill("Guardian supplied signed excuse");
  await page.screenshot({
    path: "/downloads/elcenter-attendance-correction-request.png",
    fullPage: false,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Submit correction request", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", {
      name: "Attendance correction requests",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("cell", { name: "pending", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review request", exact: true })
    .click();
  await page
    .getByLabel("Review note", { exact: true })
    .fill("Trying self approval");
  await page
    .getByRole("button", { name: "Save independent decision", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Independent reviewer required",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  expect(
    (
      await page.request.post("/api/auth/login", {
        data: {
          email: "correction-browser@example.invalid",
          password: "Test-only-browser-password-2026",
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await page
    .getByRole("button", { name: "Timetable & attendance", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Attendance correction requests",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Review request", exact: true })
    .click();
  await page
    .getByLabel("Review note", { exact: true })
    .fill("Verified signed source evidence");
  await page.screenshot({
    path: "/downloads/elcenter-attendance-correction-review.png",
    fullPage: false,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Save independent decision", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "approved", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "موافق عليه", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-attendance-correction-ar-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
