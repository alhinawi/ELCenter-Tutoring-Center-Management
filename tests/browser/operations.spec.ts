import { test, expect } from "@playwright/test";
test("HR, admissions, inbox and reception are real English and Arabic mobile workflows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore a private demo" }).click();
  await page
    .getByRole("button", { name: "People & admissions", exact: true })
    .click();
  await expect(page.getByText("Nour Hassan", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase5-people-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Admissions pipeline", exact: true })
    .click();
  await expect(page.getByText("Laila Mahmoud", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Register student", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Code", exact: true })
    .fill("CRM-" + Date.now());
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("registered", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase5-admissions-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "My inbox", exact: true }).click();
  await expect(
    page.getByText("Welcome to the team", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark as read", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mark as read", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reception & appointments", exact: true })
    .click();
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Check out", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "الفريق والتسجيل", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase5-reception-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "الموظفين", exact: true }).click();
  await expect(page.getByText("Nour Hassan", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "سجل جديد", exact: true }).click();
  await page.screenshot({
    path: "/downloads/elcenter-phase5-employee-form-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("employee payroll uses saved contract and attendance in the browser", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore a private demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Headquarters overview" }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/me")).json();
  const employees = await (
    await page.request.get("/api/operations/employees")
  ).json();
  const employee = employees.data[0];
  for (let day = 1; day <= 31; day++) {
    const date = "2026-10-" + String(day).padStart(2, "0"),
      weekday = new Date(date + "T12:00:00Z").getUTCDay();
    if ([0, 1, 2, 3, 4].includes(weekday)) {
      const r = await page.request.post("/api/operations/employee_attendance", {
        headers: { "x-csrf-token": me.user.csrf },
        data: {
          employee_id: employee.id,
          date,
          arrival: "09:00",
          departure: "17:00",
          status: "present",
        },
      });
      expect(r.status()).toBe(201);
    }
  }
  await page
    .getByRole("button", { name: "People & admissions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Employee payroll", exact: true })
    .click();
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Employee", exact: true })
    .selectOption({ label: "Nour Hassan" });
  await page.getByLabel("Payroll month", { exact: true }).fill("2026-10");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("6,500 EGP", { exact: true }).first(),
  ).toBeVisible();
  await page.getByText("Calculation snapshot", { exact: true }).click();
  await page.screenshot({
    path: "/downloads/elcenter-phase5-employee-payroll.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Approve & accrue", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Date", exact: true })
    .fill("2026-10-31");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "separate preparer",
  );
});
