import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "reservation-pages-browser" },
});
test("staff reservation pages reach newest waiting record behind closed history and cancel safely", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "reservation-pages-browser@example.invalid",
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
    email: "reservation-pages-student@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: b,
  });
  const account = (await api("/users")).data.find(
    (r: any) => r.email === "reservation-pages-student@example.invalid",
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
      email: "reservation-pages-student@example.invalid",
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
    // Production timestamps use whole seconds. Put the final waiting row after every closed row.
    if (i === 20) await new Promise((resolve) => setTimeout(resolve, 1100));
    const r = await api("/library/reservations", "POST", {
      book_id: book,
      student_id: student,
    });
    if (i < 20)
      await api("/library/reservations/" + r.id + "/cancel", "POST", {});
  }
  await page.goto("/");
  await page
    .getByRole("button", { name: "Resources & service", exact: true })
    .click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Reservations", exact: true }).click();
  const nav = page.getByRole("region", {
    name: "Staff reservation navigation",
    exact: true,
  });
  await expect(nav).toContainText("Matching reservations: 21");
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  await nav
    .getByRole("button", { name: "Next reservations", exact: true })
    .click();
  await expect(nav).toContainText("Page 2 / 2");
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(1);
  await nav
    .getByLabel("Reservation status filter", { exact: true })
    .selectOption("waiting");
  await expect(nav).toContainText("Matching reservations: 1");
  await expect(nav).toContainText("Page 1 / 1");
  await page.screenshot({
    path: "/downloads/elcenter-reservations-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  const arabic = page.getByRole("region", {
    name: "تنقل حجوزات المكتبة",
    exact: true,
  });
  await expect(arabic).toContainText("الحجوزات المطابقة: 1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-reservations-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "إلغاء", exact: true }).click();
  await expect(arabic).toContainText("الحجوزات المطابقة: 0");
  await expect(
    page.getByRole("button", { name: "إلغاء", exact: true }),
  ).toHaveCount(0);
  await arabic
    .getByLabel("تصفية حالة الحجز", { exact: true })
    .selectOption("cancelled");
  await expect(arabic).toContainText("الحجوزات المطابقة: 21");
  await page.route("**/api/library/reservations?**", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Fictional reservation queue unavailable",
      }),
    }),
  );
  await arabic.getByLabel("تصفية حالة الحجز", { exact: true }).selectOption("");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Fictional reservation queue unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Fictional History Book", exact: true }),
  ).toHaveCount(0);
  await context.close();
});
