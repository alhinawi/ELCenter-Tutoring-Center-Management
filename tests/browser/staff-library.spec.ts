import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "staff-library-browser" },
});
test("staff loan pages reach old active loans and record authorized returns in Arabic mobile", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "staff-library-browser@example.invalid",
      password: "Testing-password-2026",
      organization: "Fictional Library Academy",
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
  const student = (
    await api("/students", "POST", {
      name: "Fictional Library Learner",
      code: "FIL",
      branch_id: b,
    })
  ).id;
  const role = (await api("/roles")).data.find(
    (r: any) => r.system_key === "student",
  ).id;
  await api("/users", "POST", {
    name: "Fictional Student Login",
    email: "staff-library-student@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: b,
  });
  const account = (await api("/users")).data.find(
    (r: any) => r.email === "staff-library-student@example.invalid",
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
      email: "staff-library-student@example.invalid",
      password: "Testing-password-2026",
    },
  });
  await family.goto("/");

  const book = (
    await api("/library/books", "POST", {
      title: "Fictional History Book",
      author: "Fictional Author",
      category: "Learning",
    })
  ).id;
  for (let i = 0; i < 21; i++) {
    const copy = (
        await api("/library/copies", "POST", {
          book_id: book,
          branch_id: b,
          barcode: "FAMILY-HISTORY-" + String(i).padStart(2, "0"),
        })
      ).id,
      loan = (
        await api("/library/loans", "POST", {
          copy_id: copy,
          student_id: student,
          borrowed_on: "2026-01-01",
          due_on: "2026-01-10",
          daily_penalty: 5,
          notes: "Fictional private staff note",
        })
      ).id;
  }

  await page.goto("/");
  await page
    .getByRole("button", { name: "Resources & service", exact: true })
    .click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page
    .getByRole("button", { name: "Borrowing & returns", exact: true })
    .click();
  const nav = page.getByRole("region", {
    name: "Staff loan navigation",
    exact: true,
  });
  await expect(nav).toContainText("Matching loans: 21");
  await expect(
    page.getByRole("button", { name: "Return copy", exact: true }),
  ).toHaveCount(20);
  await nav.getByRole("button", { name: "Next loans", exact: true }).click();
  await expect(nav).toContainText("Page 2 / 2");
  await expect(
    page.getByRole("button", { name: "Return copy", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Return copy", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Return date", { exact: true }).fill("2026-01-12");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await nav
    .getByLabel("Loan status filter", { exact: true })
    .selectOption("returned");
  await expect(nav).toContainText("Matching loans: 1");
  await expect(nav).toContainText("Page 1 / 1");
  await expect(
    page.getByRole("cell", { name: "10 EGP", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Return copy", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "/downloads/elcenter-staff-library-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  const arabic = page.getByRole("region", {
    name: "تنقل استعارات الموظفين",
    exact: true,
  });
  await expect(arabic).toContainText("الاستعارات المطابقة: 1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-staff-library-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.route("**/api/library/loans?**", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional staff loan queue unavailable" }),
    }),
  );
  await arabic
    .getByLabel("تصفية حالة الاستعارة", { exact: true })
    .selectOption("on_loan");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Fictional staff loan queue unavailable" }),
  ).toContainText("Fictional staff loan queue unavailable");
  await expect(
    page.getByRole("cell", { name: "Fictional History Book", exact: true }),
  ).toHaveCount(0);
  await context.close();
});
