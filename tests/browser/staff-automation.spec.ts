import { test, expect } from "@playwright/test";
import { Temporal } from "@js-temporal/polyfill";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "staff-reminder-browser" },
});
test("configurable staff reminders persist rules and deliver only in-app", async ({
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
          email: "staff-reminders-browser@example.invalid",
          password: "Test-only-password-2026",
          organization: "Fictional Reminder Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
  const me = (await (await page.request.get("/api/me")).json()).user;
  async function api(p: string, m = "GET", data?: any) {
    const r = await page.request.fetch("/api" + p, {
      method: m,
      headers: { "x-csrf-token": me.csrf },
      ...(data ? { data } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  const branch = (await api("/branches")).data[0].id,
    today = Temporal.Now.plainDateISO("Africa/Cairo").toString();
  await api("/operations/leads", "POST", {
    branch_id: branch,
    name: "Fictional follow-up prospect",
    source: "phone",
    assigned_to: me.user_id,
    follow_up_on: today,
  });
  const employee = (
    await api("/operations/employees", "POST", {
      branch_id: branch,
      name: "Fictional Contract Tutor",
      code: "REM-EMP",
      job_title: "Teacher",
      hired_on: today,
      status: "active",
    })
  ).id;
  await api("/operations/contracts", "POST", {
    employee_id: employee,
    title: "Fictional teaching contract",
    starts_on: today,
    ends_on: today,
    salary: 1000,
  });
  const item = (
    await api("/inventory/inventory_items", "POST", {
      sku: "REM-BOOK",
      name: "Fictional Practice Book",
      category: "Books",
      unit: "copy",
      unit_cost: 10,
      sale_price: 20,
      reorder_level: 2,
    })
  ).id;
  await api("/inventory/adjustments", "POST", {
    branch_id: branch,
    item_id: item,
    quantity: 1,
    reason: "Verified fictional opening balance",
    idempotency_key: crypto.randomUUID(),
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Automation controls", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Assigned lead follow-ups",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", { name: "Assigned lead follow-ups", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Contract expiry for HR", exact: true })
    .check();
  await page
    .getByRole("checkbox", {
      name: "Low stock for inventory staff",
      exact: true,
    })
    .check();
  await page
    .getByLabel("Contract notice days (1–90)", { exact: true })
    .fill("14");
  await page
    .getByRole("button", { name: "Save reminder rules", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  const rules = (await api("/system/automation")).rules;
  expect(rules).toMatchObject({
    lead_followups: 1,
    contract_expiry: 1,
    low_stock: 1,
    contract_days: 14,
    upcoming_exams: 0,
    exam_days: 7,
  });
  await api("/system/automation", "PUT", { enabled: false });
  expect((await api("/system/automation")).rules).toEqual(rules);
  expect(
    (
      await page.request.put("/api/system/automation", {
        headers: { "x-csrf-token": me.csrf },
        data: { enabled: false, contract_days: 0 },
      })
    ).status(),
  ).toBe(400);
  await page
    .getByRole("button", { name: "Run in-app reminders now", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  expect((await api("/notifications")).data).toHaveLength(3);
  await page.screenshot({
    path: "/downloads/elcenter-staff-reminder-rules.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "People & admissions", exact: true })
    .click();
  await page.getByRole("button", { name: "My inbox", exact: true }).click();
  await expect(
    page.getByText("Lead follow-up / متابعة عميل", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Contract expiration / انتهاء عقد", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Low stock / مخزون منخفض", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-staff-reminder-inbox.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page
    .getByRole("button", { name: "إعدادات الأتمتة", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "متابعة العملاء للمسؤول", exact: true }),
  ).toBeChecked();
  await page.getByRole("dialog").evaluate((el) => (el.scrollTop = 240));
  await page.screenshot({
    path: "/downloads/elcenter-staff-reminder-ar-mobile.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
