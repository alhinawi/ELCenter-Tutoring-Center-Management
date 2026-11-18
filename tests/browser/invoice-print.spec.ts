import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "invoice-print-browser" } });
test("issue-time print identity remains unchanged in invoice, print document and family portal", async ({
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
          email: "invoice-print-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Registered Print Academy",
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
        name: "Fictional Print Learner",
        code: "PRINT-S",
        branch_id: branch,
      })
    ).id;
  await api("/finance/initialize", "POST", { year: 2026 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Finance settings", exact: true })
    .click();
  await page
    .getByLabel("Invoice issuer name", { exact: true })
    .fill("Fictional Learning Center");
  await page
    .getByLabel("Printed contact details", { exact: true })
    .fill("Fictional campus\n01000000000");
  await page
    .getByLabel("Invoice footer note", { exact: true })
    .fill("Keep this invoice. <script>not executable</script>");
  await page
    .getByLabel("Receipt footer note", { exact: true })
    .fill("Recorded receipt only.");
  await page.getByLabel("Print accent", { exact: true }).selectOption("teal");
  await page
    .getByRole("button", { name: "Save print settings", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Print settings saved");
  await page.screenshot({
    path: "/downloads/elcenter-print-settings-desktop.png",
    fullPage: true,
  });
  const invoice = (
    await api("/invoices", "POST", {
      student_id: student,
      number: "PRINT-VISUAL-1",
      date: "2026-11-01",
      due_date: "2026-11-30",
      items: [
        { description: "Fictional tuition", quantity: 1, unit_price: 100 },
      ],
    })
  ).id;
  await api("/invoices/" + invoice + "/issue", "POST", {});
  await api("/invoices/" + invoice + "/payments", "POST", {
    amount: 60,
    date: "2026-11-01",
    method: "cash",
    reference: "Fictional recorded receipt",
    idempotency_key: crypto.randomUUID(),
  });
  await api("/finance/print-settings", "PUT", {
    issuer_name: "New identity for later invoices",
    contact_text: "",
    invoice_footer: "New text",
    receipt_footer: "New receipt text",
    accent: "blue",
  });
  await page.getByRole("button", { name: "Invoices", exact: true }).click();
  await page.getByRole("button", { name: /PRINT-VISUAL-1/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Fictional Learning Center",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Keep this invoice. <script>not executable</script>", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Recorded receipt only.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-print-identity] script")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Print invoice and receipts", exact: true })
    .click();
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  const frame = page.frames().find((f) => f !== page.mainFrame())!;
  await expect(frame.locator("[data-print-identity]")).toBeAttached();
  const html = await frame.content();
  const preview = await browser.newPage({
    viewport: { width: 900, height: 1100 },
  });
  await preview.setContent(html);
  await expect(
    preview.getByRole("heading", {
      name: "Fictional Learning Center",
      exact: true,
    }),
  ).toBeVisible();
  await preview.screenshot({
    path: "/downloads/elcenter-invoice-print-preview.png",
    fullPage: true,
  });
  await preview.pdf({
    path: "/downloads/elcenter-invoice-print-preview.pdf",
    format: "A4",
    printBackground: true,
  });
  await preview.close();
  const role = (await api("/roles")).data.find(
      (r: any) => r.system_key === "student",
    ).id,
    email = "print-family-browser@example.invalid",
    password = "Testing-password-2026";
  await api("/users", "POST", {
    name: "Fictional Print Learner",
    email,
    password,
    role_id: role,
    branch_id: branch,
  });
  const user = (await api("/users")).data.find(
    (u: any) => u.email === email,
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
  await sp.getByRole("button", { name: /يومي/ }).click();
  await sp.getByRole("button", { name: "عرض الفاتورة", exact: true }).click();
  await expect(
    sp.getByRole("heading", { name: "Fictional Learning Center", exact: true }),
  ).toBeVisible();
  await expect(
    sp.getByText("Recorded receipt only.", { exact: true }),
  ).toBeVisible();
  await sp.screenshot({
    path: "/downloads/elcenter-invoice-print-family-ar-mobile.png",
    fullPage: true,
  });
  expect(
    await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await context.close();
});
