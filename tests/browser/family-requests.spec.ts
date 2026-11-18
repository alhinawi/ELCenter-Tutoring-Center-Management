import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "family-request-browser" },
});
test("family request history pages private persisted submissions, status/type filters and Arabic mobile", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "family-request-browser@example.invalid",
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
    email: "request-history-student@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: b,
  });
  const account = (await api("/users")).data.find(
    (r: any) => r.email === "request-history-student@example.invalid",
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
      email: "request-history-student@example.invalid",
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
  await api("/portal-requests/" + ids[0] + "/decision", "POST", {
    status: "accepted",
    response:
      "Fictional center response, please confirm a time with reception.",
  });
  await family.reload();
  const history = family.getByRole("region", {
      name: "Your center request history",
      exact: true,
    }),
    rows = history.getByTestId("family-request-row");
  await expect(rows).toHaveCount(20);
  await expect(history).toContainText("Matching requests: 61");
  for (let i = 0; i < 3; i++)
    await history
      .getByRole("button", { name: "Next requests", exact: true })
      .click();
  await expect(rows).toHaveCount(1);
  await expect(history).toContainText("Page 4 / 4");
  await expect(
    history.getByRole("button", { name: "Next requests", exact: true }),
  ).toBeDisabled();
  await history
    .getByLabel("Request status filter", { exact: true })
    .selectOption("accepted");
  await expect(rows).toHaveCount(1);
  await expect(history).toContainText("Page 1 / 1");
  await expect(history).toContainText("Fictional center response");
  await expect(history).toContainText("2026-12-01");
  await history
    .getByLabel("Request type filter", { exact: true })
    .selectOption("contact");
  await expect(rows).toHaveCount(0);
  await expect(history).toContainText("No requests match");
  await history
    .getByLabel("Request type filter", { exact: true })
    .selectOption("meeting");
  await expect(rows).toHaveCount(1);
  await history.screenshot({
    path: "/downloads/elcenter-family-requests-desktop.png",
    animations: "disabled",
  });
  await family.setViewportSize({ width: 390, height: 844 });
  await family.getByRole("button", { name: "العربية", exact: true }).click();
  const arabic = family.getByRole("region", {
    name: "سجل طلباتك للمركز",
    exact: true,
  });
  await expect(arabic).toContainText("مقبول");
  expect(
    await family.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await arabic.screenshot({
    path: "/downloads/elcenter-family-requests-ar-mobile.png",
    animations: "disabled",
  });
  await family.route("**/api/portal/students/*/requests?**", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional request history unavailable" }),
    }),
  );
  await arabic
    .getByLabel("تصفية حالة الطلب", { exact: true })
    .selectOption("pending");
  await expect(arabic.getByRole("alert")).toContainText(
    "Fictional request history unavailable",
  );
  await expect(arabic.getByTestId("family-request-row")).toHaveCount(0);
  await expect(arabic).not.toContainText("Fictional center response");
  await context.close();
});
