import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "family-library-browser" },
});
test("family library pages persisted loans, returned penalties and Arabic mobile", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "family-library-browser@example.invalid",
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
    email: "library-history-student@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: b,
  });
  const account = (await api("/users")).data.find(
    (r: any) => r.email === "library-history-student@example.invalid",
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
      email: "library-history-student@example.invalid",
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
    if (i % 2 === 0)
      await api("/library/loans/" + loan + "/return", "POST", {
        returned_on: "2026-01-12",
      });
  }
  await family
    .getByRole("button", { name: "Library history", exact: true })
    .click();
  const history = family.getByRole("region", {
      name: "Family borrowing history",
      exact: true,
    }),
    rows = history.getByTestId("family-loan-row");
  await expect(rows).toHaveCount(20);
  await expect(history).toContainText("Matching loans: 21");
  await expect(history).not.toContainText("Fictional private staff note");
  await history
    .getByRole("button", { name: "Next loans", exact: true })
    .click();
  await expect(rows).toHaveCount(1);
  await expect(history).toContainText("Page 2 / 2");
  await history
    .getByLabel("Loan status filter", { exact: true })
    .selectOption("returned");
  await expect(rows).toHaveCount(11);
  await expect(history).toContainText("Page 1 / 1");
  await expect(rows.first()).toContainText("Recorded penalty amount10");
  await expect(rows.first()).toContainText("Recorded late days2");
  await history.screenshot({
    path: "/downloads/elcenter-family-library-desktop.png",
    animations: "disabled",
  });
  await family.setViewportSize({ width: 390, height: 844 });
  await family.getByRole("button", { name: "العربية", exact: true }).click();
  const arabic = family.getByRole("region", {
    name: "سجل استعارات الأسرة",
    exact: true,
  });
  await expect(arabic).toContainText("تم الإرجاع");
  expect(
    await family.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await arabic.screenshot({
    path: "/downloads/elcenter-family-library-ar-mobile.png",
    animations: "disabled",
  });
  await arabic
    .getByLabel("تصفية حالة الاستعارة", { exact: true })
    .selectOption("on_loan");
  await expect(arabic.getByTestId("family-loan-row")).toHaveCount(10);
  await expect(arabic.getByTestId("family-loan-row").first()).toContainText(
    "لسه مرجعش",
  );
  await family.route("**/api/portal/library/*?**", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional loan history unavailable" }),
    }),
  );
  await arabic
    .getByLabel("تصفية حالة الاستعارة", { exact: true })
    .selectOption("");
  await expect(arabic.getByRole("alert")).toContainText(
    "Fictional loan history unavailable",
  );
  await expect(arabic.getByTestId("family-loan-row")).toHaveCount(0);
  await context.close();
});
