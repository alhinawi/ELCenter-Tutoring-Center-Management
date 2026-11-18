import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "exam-pages-browser" } });
test("exam directory pages and filters persist real exams while failed requests clear stale cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "exam-page-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Exam Directory",
        },
      })
    ).ok(),
  ).toBeTruthy();
  async function api(p: string, m = "GET", data?: any) {
    const me = (await (await page.request.get("/api/me")).json()).user;
    const r = await page.request.fetch("/api" + p, {
      method: m,
      headers: { "x-csrf-token": me.csrf },
      ...(data ? { data } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  const b = (await api("/branches")).data[0].id,
    t = (
      await api("/teachers", "POST", {
        name: "Fictional Teacher",
        code: "PT",
        branch_id: b,
      })
    ).id,
    c = (
      await api("/courses", "POST", {
        name: "Fictional Course",
        code: "PC",
        branch_id: b,
      })
    ).id,
    room = (
      await api("/classrooms", "POST", {
        name: "Fictional Room",
        code: "PR",
        branch_id: b,
        capacity: 30,
      })
    ).id,
    g = (
      await api("/groups", "POST", {
        name: "Fictional Page Group",
        code: "PG",
        branch_id: b,
        teacher_id: t,
        course_id: c,
        classroom_id: room,
        capacity: 30,
        start_date: "2026-01-01",
        end_date: "2026-12-31",
      })
    ).id;
  for (let i = 0; i < 21; i++)
    await api("/exams", "POST", {
      name: i === 0 ? "Oldest distinctive exam" : "Fictional exam " + i,
      group_id: g,
      scheduled_at: 1800000000 + i,
      max_score: 100,
      pass_score: 50,
    });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Exams & performance", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open exam", exact: true }),
  ).toHaveCount(20);
  await page.getByRole("button", { name: "Next exams", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open exam", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Oldest distinctive exam", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search exams by name", { exact: true }).fill("Oldest");
  await expect(
    page.getByRole("status").filter({ hasText: "Matching exams" }),
  ).toContainText("Page 1 · Matching exams: 1");
  await page.reload();
  await page
    .getByRole("button", { name: "Exams & performance", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Exam status filter", exact: true })
    .selectOption("published");
  await expect(
    page.getByRole("button", { name: "Open exam", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Exam status filter", exact: true })
    .selectOption("draft");
  await expect(
    page.getByRole("button", { name: "Open exam", exact: true }),
  ).toHaveCount(20);
  await page.getByLabel("Search exams by name", { exact: true }).fill("Oldest");
  await expect(
    page.getByRole("heading", { name: "Oldest distinctive exam", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-exam-pagination-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.route("**/api/exams?**", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional directory temporary failure" }),
    }),
  );
  await page
    .getByLabel("Search exams by name", { exact: true })
    .fill("Changed");
  await expect(page.locator("p[role=alert]")).toContainText(
    "temporary failure",
  );
  await expect(
    page.getByRole("button", { name: "Open exam", exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/exams?**");
  await page.getByLabel("Search exams by name", { exact: true }).fill("Oldest");
  await expect(
    page.getByRole("heading", { name: "Oldest distinctive exam", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("aside").evaluate((e) => e.getBoundingClientRect().left),
    )
    .toBeGreaterThanOrEqual(390);
  await expect(
    page.getByRole("combobox", { name: "فلتر حالة الامتحان", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-exam-pagination-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});
