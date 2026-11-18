import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "family-invoice-browser" },
});
test("family invoice history pages issued records with real partial receipt/refund, void and detail print access", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "family-invoice-browser@example.invalid",
      password: "Testing-password-2026",
      organization: "Fictional Invoice Academy",
    },
  });
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
  const b = (await api("/branches")).data[0].id;
  await api("/finance/initialize", "POST", { year: 2026 });
  const student = (
      await api("/students", "POST", {
        name: "Fictional Invoice Learner",
        code: "FIL",
        branch_id: b,
      })
    ).id,
    ids: string[] = [];
  for (let i = 0; i < 21; i++) {
    const invoice = (
      await api("/invoices", "POST", {
        student_id: student,
        number: "FAMILY-INVOICE-" + String(i).padStart(2, "0"),
        date: "2026-11-01",
        due_date: "2026-11-30",
        items: [
          { description: "Fictional tuition", quantity: 1, unit_price: 100 },
        ],
      })
    ).id;
    await api("/invoices/" + invoice + "/issue", "POST", {});
    ids.push(invoice);
  }
  const receipt = (
    await api("/invoices/" + ids[0] + "/payments", "POST", {
      date: "2026-11-18",
      amount: 60,
      method: "cash",
      reference: "Fictional recorded cash",
      idempotency_key: crypto.randomUUID(),
    })
  ).id;
  await api("/payments/" + receipt + "/refund", "POST", {
    date: "2026-11-18",
    amount: 20,
    reason: "Fictional partial refund",
    idempotency_key: crypto.randomUUID(),
  });
  await api("/invoices/" + ids[1] + "/void", "POST", {
    date: "2026-11-18",
    reason: "Fictional cancellation",
  });
  const role = (await api("/roles")).data.find(
    (r: any) => r.system_key === "student",
  ).id;
  await api("/users", "POST", {
    name: "Fictional Student Login",
    email: "invoice-history-student@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: b,
  });
  const account = (await api("/users")).data.find(
    (r: any) => r.email === "invoice-history-student@example.invalid",
  );
  await api("/portal-links", "POST", {
    user_id: account.user_id,
    kind: "student",
    profile_id: student,
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    family = await context.newPage();
  await family.request.post("/api/auth/login", {
    data: {
      email: "invoice-history-student@example.invalid",
      password: "Testing-password-2026",
    },
  });
  await family.goto("/");
  const history = family.getByRole("region", {
    name: "Family invoice history",
    exact: true,
  });
  await expect(history.getByTestId("family-invoice-row")).toHaveCount(20);
  await expect(history).toContainText("Matching invoices: 21");
  await history
    .getByRole("button", { name: "Next invoices", exact: true })
    .click();
  await expect(history.getByTestId("family-invoice-row")).toHaveCount(1);
  await history
    .getByRole("button", { name: "View invoice", exact: true })
    .click();
  await expect(family.getByRole("dialog")).toBeVisible();
  await expect(
    family.getByRole("button", { name: "Print / Save PDF", exact: true }),
  ).toBeVisible();
  await family.getByRole("button", { name: "Close", exact: true }).click();
  await history
    .getByLabel("Invoice history status", { exact: true })
    .selectOption("void");
  await expect(history.getByTestId("family-invoice-row")).toHaveCount(1);
  await expect(history).toContainText("FAMILY-INVOICE-01");
  await expect(history).toContainText("Outstanding: 0 EGP");
  await expect(history).toContainText("Page 1");
  await history.screenshot({
    path: "/downloads/elcenter-family-invoices-desktop.png",
    animations: "disabled",
  });
  await history
    .getByLabel("Invoice history status", { exact: true })
    .selectOption("issued");
  await expect(history.getByTestId("family-invoice-row")).toHaveCount(20);
  const paid = history
    .getByTestId("family-invoice-row")
    .filter({ hasText: "FAMILY-INVOICE-00" });
  await expect(paid).toContainText("Recorded net paid: 40 EGP");
  await expect(paid).toContainText("Outstanding: 60 EGP");
  await family.setViewportSize({ width: 390, height: 844 });
  await family.getByRole("button", { name: "العربية", exact: true }).click();
  const arabic = family.getByRole("region", {
    name: "سجل فواتير الأسرة",
    exact: true,
  });
  await arabic
    .getByLabel("حالة سجل الفواتير", { exact: true })
    .selectOption("void");
  await expect(arabic.getByTestId("family-invoice-row")).toHaveCount(1);
  expect(
    await family.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await arabic.screenshot({
    path: "/downloads/elcenter-family-invoices-ar-mobile.png",
    animations: "disabled",
  });
  await family.route("**/api/portal/students/*/invoices?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional invoice history failed" }),
    }),
  );
  await arabic
    .getByLabel("حالة سجل الفواتير", { exact: true })
    .selectOption("issued");
  await expect(arabic.getByRole("alert")).toContainText(
    "Fictional invoice history failed",
  );
  await expect(arabic.getByTestId("family-invoice-row")).toHaveCount(0);
  await context.close();
});
