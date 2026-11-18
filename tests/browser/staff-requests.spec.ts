import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "staff-request-browser" },
});
test("staff request review pages pending history and saves response with scoped complete filters", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "staff-request-browser@example.invalid",
      password: "Testing-password-2026",
      organization: "Fictional Request Academy",
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
      name: "Fictional Request Learner",
      code: "FIL",
      branch_id: b,
    })
  ).id;
  const role = (await api("/roles")).data.find(
    (r: any) => r.system_key === "student",
  ).id;
  await api("/users", "POST", {
    name: "Fictional Student Login",
    email: "staff-request-student@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: b,
  });
  const account = (await api("/users")).data.find(
    (r: any) => r.email === "staff-request-student@example.invalid",
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
      email: "staff-request-student@example.invalid",
      password: "Testing-password-2026",
    },
  });
  await family.goto("/");
  const csrf = (await (await family.request.get("/api/me")).json()).user.csrf;
  const ids: string[] = [];
  for (let i = 0; i < 61; i++) {
    const r = await family.request.post("/api/portal/requests", {
      headers: { "x-csrf-token": csrf },
      data: {
        student_id: student,
        kind: i === 0 ? "meeting" : "contact",
        subject: "Fictional Center Request " + String(i).padStart(2, "0"),
        body: "Fictional private message " + i,
        requested_on: i === 0 ? "2026-12-01" : "",
      },
    });
    expect(r.ok()).toBeTruthy();
    ids.push((await r.json()).id);
  }

  await page.goto("/");
  await page
    .getByRole("button", { name: "Portals & requests", exact: true })
    .click();
  const queue = page.getByRole("region", {
      name: "Family request review queue",
      exact: true,
    }),
    rows = queue.getByTestId("family-request-row");
  await expect(rows).toHaveCount(20);
  await expect(queue).toContainText("Matching requests: 61");
  for (let i = 0; i < 3; i++)
    await queue
      .getByRole("button", { name: "Next requests", exact: true })
      .click();
  await expect(rows).toHaveCount(1);
  await expect(queue).toContainText("Page 4 / 4");
  await rows
    .first()
    .getByRole("button", { name: "Respond", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Decision", { exact: true }).selectOption("accepted");
  await dialog
    .getByLabel("Response", { exact: true })
    .fill("Fictional approved center response");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await queue
    .getByLabel("Request status filter", { exact: true })
    .selectOption("accepted");
  await expect(rows).toHaveCount(1);
  await expect(queue).toContainText("Fictional approved center response");
  await expect(queue).toContainText("Page 1 / 1");
  await expect(
    queue.getByRole("button", { name: "Respond", exact: true }),
  ).toHaveCount(0);
  await queue.screenshot({
    path: "/downloads/elcenter-staff-requests-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  const arabic = page.getByRole("region", {
    name: "قائمة مراجعة طلبات الأسرة",
    exact: true,
  });
  await expect(arabic).toContainText("مقبول");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await arabic.screenshot({
    path: "/downloads/elcenter-staff-requests-ar-mobile.png",
    animations: "disabled",
  });
  await page.route("**/api/portal-requests?**", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional staff queue unavailable" }),
    }),
  );
  await arabic
    .getByLabel("تصفية حالة الطلب", { exact: true })
    .selectOption("pending");
  await expect(arabic.getByRole("alert")).toContainText(
    "Fictional staff queue unavailable",
  );
  await expect(arabic.getByTestId("family-request-row")).toHaveCount(0);
  await context.close();
});
