import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "receipt-number-browser" },
});
test("receipt sequence persists, prints and reaches only the linked family in Arabic", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "receipt-number-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Receipt Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
  async function api(path: string, method = "GET", data?: any) {
    const me = (await (await page.request.get("/api/me")).json()).user;
    const r = await page.request.fetch("/api" + path, {
      method,
      headers: { "x-csrf-token": me.csrf },
      ...(data ? { data } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  const branch = (await api("/branches")).data[0].id,
    student = (
      await api("/students", "POST", {
        name: "Fictional Receipt Learner",
        code: "RCPT-S",
        branch_id: branch,
      })
    ).id;
  await api("/finance/initialize", "POST", { year: 2026 });
  const invoice = (
    await api("/invoices", "POST", {
      student_id: student,
      number: "RCPT-VISUAL-1",
      date: "2026-11-01",
      due_date: "2026-11-30",
      items: [
        { description: "Fictional tuition", quantity: 1, unit_price: 100 },
      ],
    })
  ).id;
  await api("/invoices/" + invoice + "/issue", "POST", {});
  await page.goto("/");
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Finance settings", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Use automatic receipt numbers",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", {
      name: "Use automatic receipt numbers",
      exact: true,
    })
    .check();
  await page.getByLabel("Receipt number prefix", { exact: true }).fill("DESK-");
  await page
    .getByLabel("Next receipt sequence number", { exact: true })
    .fill("42");
  await page
    .getByRole("button", { name: "Save receipt numbering", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Receipt numbering saved");
  await page
    .getByRole("heading", { name: "Receipt numbering", exact: true })
    .scrollIntoViewIfNeeded();
  await page
    .getByRole("heading", { name: "Receipt numbering", exact: true })
    .evaluate((el) => el.closest("div")!.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: "/downloads/elcenter-receipt-number-settings.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "Invoices", exact: true }).click();
  await page.getByRole("button", { name: /RCPT-VISUAL-1/ }).click();
  await page
    .getByRole("spinbutton", { name: "Payment amount", exact: true })
    .fill("60");
  await page
    .getByRole("button", { name: "Record receipt", exact: true })
    .click();
  await expect(page.getByText(/Receipt number: DESK-000042/)).toBeVisible();
  await page.getByText(/Receipt number: DESK-000042/).scrollIntoViewIfNeeded();
  await page
    .locator('[role="dialog"]')
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.screenshot({
    path: "/downloads/elcenter-receipt-number-desktop.png",
    fullPage: false,
  });
  expect((await api("/finance/receipt-numbering")).data.next_number).toBe(43);
  await page
    .getByRole("button", { name: "Print invoice and receipts", exact: true })
    .click();
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  const frame = page.frames().find((f) => f !== page.mainFrame())!;
  await expect(frame.getByText(/Receipt number: DESK-000042/)).toBeAttached();
  const preview = await browser.newPage({
    viewport: { width: 900, height: 1100 },
  });
  await preview.setContent(await frame.content());
  await preview.pdf({
    path: "/downloads/elcenter-receipt-number-print.pdf",
    format: "A4",
    printBackground: true,
  });
  await preview.close();
  const role = (await api("/roles")).data.find(
      (r: any) => r.system_key === "student",
    ).id,
    email = "receipt-family-browser@example.invalid",
    password = "Testing-password-2026";
  await api("/users", "POST", {
    name: "Fictional Receipt Learner",
    email,
    password,
    role_id: role,
    branch_id: branch,
  });
  const user = (await api("/users")).data.find(
    (r: any) => r.email === email,
  ).user_id;
  await api("/portal-links", "POST", {
    user_id: user,
    kind: "student",
    profile_id: student,
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ar-EG",
    }),
    sp = await context.newPage();
  await sp.request.post("/api/auth/login", { data: { email, password } });
  await sp.goto("/");
  await sp.getByRole("button", { name: "عرض الفاتورة", exact: true }).click();
  await expect(
    sp.getByRole("cell", { name: "DESK-000042", exact: true }),
  ).toBeVisible();
  await sp
    .getByRole("cell", { name: "DESK-000042", exact: true })
    .scrollIntoViewIfNeeded();
  await sp.screenshot({
    path: "/downloads/elcenter-receipt-number-family-ar-mobile.png",
    fullPage: false,
  });
  expect(
    await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await context.close();
  expect(errors).toEqual([]);
});
