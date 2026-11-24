import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "loan-payroll-browser" } });
test("employee payroll form deducts a disbursed loan and the reserved balance persists", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "loan-payroll@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Deduction Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
  async function api(p: string, m = "GET", data?: any, request = page.request) {
    const me = (await (await request.get("/api/me")).json()).user;
    const r = await request.fetch("/api" + p, {
      method: m,
      headers: { "x-csrf-token": me.csrf },
      ...(data ? { data } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  const branch = (await api("/branches")).data[0].id,
    today = (await api("/employee-loans/options")).today;
  await api("/finance/initialize", "POST", { year: Number(today.slice(0, 4)) });
  const account = (
    await api("/finance/accounts", "POST", {
      code: "1199",
      name: "Employee receivables",
      kind: "asset",
    })
  ).id;
  const employee = (
    await api("/operations/employees", "POST", {
      name: "Fictional Payroll Borrower",
      code: "EMP-LP",
      branch_id: branch,
      job_title: "Coordinator",
      hired_on: "2026-01-01",
      status: "active",
    })
  ).id;
  await api("/operations/contracts", "POST", {
    employee_id: employee,
    title: "Fixed",
    starts_on: "2020-01-01",
    ends_on: "2099-12-31",
    salary: 3100,
    hours_per_day: 8,
    workweek: "1,2,3,4,5,6,7",
    overtime_rate: 0,
  });
  for (let d = 1; d <= 28; d++)
    await api("/operations/employee_attendance", "POST", {
      employee_id: employee,
      date: `2026-02-${String(d).padStart(2, "0")}`,
      status: "present",
      arrival: "09:00",
      departure: "17:00",
    });
  const role = (await api("/roles")).data.find(
    (r: any) => r.name === "Business Owner",
  ).id;
  const ctx = [];
  for (const email of ["lp-review@example.invalid", "lp-pay@example.invalid"]) {
    await api("/users", "POST", {
      name: email,
      email,
      password: "Testing-password-2026",
      role_id: role,
      branch_id: null,
    });
    const c = await browser.newContext();
    expect(
      (
        await c.request.post("http://127.0.0.1:3000/api/auth/login", {
          data: { email, password: "Testing-password-2026" },
        })
      ).ok(),
    ).toBeTruthy();
    ctx.push(c);
  }
  const loan = (
    await api("/employee-loans", "POST", {
      employee_id: employee,
      kind: "loan",
      principal: 1000,
      receivable_account_id: account,
      requested_on: today,
      due_on: today,
      reason: "Fictional loan",
    })
  ).id;
  await api(
    `/employee-loans/${loan}/decision`,
    "POST",
    { decision: "approved", note: "ok" },
    ctx[0].request,
  );
  await api(
    `/employee-loans/${loan}/disburse`,
    "POST",
    { date: today, method: "bank" },
    ctx[1].request,
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "People & admissions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Employee payroll", exact: true })
    .click();
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Employee", exact: true })
    .selectOption({ label: "Fictional Payroll Borrower" });
  await page.getByLabel("Payroll month", { exact: true }).fill("2026-02");
  await page
    .getByRole("combobox", { name: /Loan or advance to deduct/ })
    .selectOption({ index: 1 });
  await page.getByLabel("Loan deduction amount", { exact: true }).fill("2000");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("p[role=alert]").first()).toContainText(
    "outstanding",
  );
  await page.getByLabel("Loan deduction amount", { exact: true }).fill("400");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText(/2,700/).first()).toBeVisible();
  await page.getByText("Calculation snapshot", { exact: true }).click();
  await expect(page.getByText("Loan / advance deduction")).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-loan-payroll-deduction.png",
    fullPage: true,
    animations: "disabled",
  });
  const detail = await api("/employee-loans/" + loan);
  expect(detail.data.deducted).toBe(400);
  expect(detail.deductions).toHaveLength(1);
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Employee loans", exact: true })
    .click();
  await expect(page.getByText(/Payroll deducted/)).toBeVisible();
});
