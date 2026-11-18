import { test, expect } from "@playwright/test";
import { Temporal } from "@js-temporal/polyfill";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "zero-payroll-browser" } });
test("zero payroll closes without a payout in teacher and employee screens", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore a private demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Headquarters overview", exact: true }),
  ).toBeVisible();
  const owner = (await (await page.request.get("/api/me")).json()).user;
  async function api(path: string, method = "GET", data?: any, pg = page) {
    const me = (await (await pg.request.get("/api/me")).json()).user;
    const r = await pg.request.fetch("/api" + path, {
      method,
      headers: { "x-csrf-token": me.csrf },
      ...(data ? { data } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  const month = Temporal.Now.plainDateISO("Africa/Cairo")
      .subtract({ months: 1 })
      .toPlainYearMonth(),
    start = month.toPlainDate({ day: 1 }),
    end = start.add({ months: 1 }).subtract({ days: 1 }).toString();
  const suffix = Date.now(),
    password = "Test-only-zero-payroll-2026",
    approveEmail = "zero-approve-" + suffix + "@example.invalid",
    closeEmail = "zero-close-" + suffix + "@example.invalid";
  for (const email of [approveEmail, closeEmail])
    await api("/users", "POST", {
      name: email === approveEmail ? "Fictional Approver" : "Fictional Closer",
      email,
      password,
      role_id: owner.role_id,
      branch_id: null,
    });
  const context = await browser.newContext(),
    ap = await context.newPage();
  await ap.request.post("/api/auth/login", {
    data: { email: approveEmail, password },
  });
  const teacher = (await api("/teachers")).data[0];
  await api("/payroll/compensation", "POST", {
    teacher_id: teacher.id,
    type: "fixed",
    base: 0,
    rate: 0,
    percent: 0,
  });
  const teacherPay = (
    await api("/payroll", "POST", {
      teacher_id: teacher.id,
      month: month.toString(),
    })
  ).id;
  await api("/payroll/" + teacherPay + "/approve", "POST", {}, ap);
  const branch = (await api("/branches")).data[0].id,
    emp = (
      await api("/operations/employees", "POST", {
        branch_id: branch,
        name: "Fictional Unpaid Tutor",
        code: "ZERO-BROWSER",
        job_title: "Tutor",
        hired_on: start.toString(),
        status: "active",
      })
    ).id;
  await api("/operations/contracts", "POST", {
    employee_id: emp,
    title: "Fictional zero-pay contract",
    starts_on: start.toString(),
    ends_on: end,
    salary: 0,
    workweek: "1,2,3,4,5",
    hours_per_day: 8,
  });
  for (
    let day = start;
    Temporal.PlainDate.compare(day, end) <= 0;
    day = day.add({ days: 1 })
  )
    if (day.dayOfWeek <= 5)
      await api("/operations/employee_attendance", "POST", {
        employee_id: emp,
        date: day.toString(),
        arrival: "09:00",
        departure: "17:00",
        status: "present",
      });
  const staffPay = (
    await api("/staff-payroll", "POST", {
      employee_id: emp,
      month: month.toString(),
      bonus: 0,
      deduction: 0,
      reason: "",
    })
  ).id;
  await api(
    "/staff-payroll/" + staffPay + "/approve",
    "POST",
    { date: end },
    ap,
  );
  await page.request.post("/api/auth/login", {
    data: { email: closeEmail, password },
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await page.getByRole("button", { name: "Payroll", exact: true }).click();
  const card = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: teacher.name, exact: true }),
    })
    .last();
  await card
    .getByRole("button", { name: "Close with no payment", exact: true })
    .click();
  await page.getByLabel("Closure date", { exact: true }).fill(end);
  await page
    .getByLabel("No-payment reason", { exact: true })
    .fill("Checked zero teacher calculation; nothing is payable.");
  await page
    .getByRole("button", { name: "Confirm no-payment closure", exact: true })
    .click();
  await expect(
    page.getByText("Closed / no payment", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-zero-payroll-teacher.png",
    fullPage: true,
  });
  expect(
    (await api("/payroll")).data.find((p: any) => p.id === teacherPay).status,
  ).toBe("approved");
  expect(
    (await api("/payroll")).data.find((p: any) => p.id === teacherPay)
      .zero_closed_on,
  ).toBe(end);
  await page
    .getByRole("button", { name: "People & admissions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Employee payroll", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close with no payment", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page
    .getByRole("button", { name: "إغلاق بدون صرف", exact: true })
    .click();
  await page.getByLabel("تاريخ الإغلاق", { exact: true }).fill(end);
  await page
    .getByLabel("سبب عدم الصرف", { exact: true })
    .fill("الحسبة المعتمدة صفر ومفيش مبلغ مستحق للصرف.");
  await page.screenshot({
    path: "/downloads/elcenter-zero-payroll-ar-mobile.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "تأكيد الإغلاق بدون صرف", exact: true })
    .click();
  await expect(
    page.getByText("مغلق / بدون صرف", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-zero-payroll-staff.png",
    fullPage: true,
  });
  const stored = (await api("/staff-payroll")).data.find(
    (p: any) => p.id === staffPay,
  );
  expect(stored.status).toBe("approved");
  expect(stored.paid_by).toBeNull();
  expect(stored.zero_closed_on).toBe(end);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await context.close();
});
