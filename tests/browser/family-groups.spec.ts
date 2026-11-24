import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "family-groups-browser" },
});
test("family groups page every active enrollment, filter status and fit Arabic mobile", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "family-groups-browser@example.invalid",
      password: "Testing-password-2026",
      organization: "Fictional Groups Academy",
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
      name: "Fictional Groups Learner",
      code: "FGL",
      branch_id: b,
    })
  ).id;
  const role = (await api("/roles")).data.find(
    (r: any) => r.system_key === "student",
  ).id;
  await api("/users", "POST", {
    name: "Fictional Student Login",
    email: "groups-history-student@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: b,
  });
  const account = (await api("/users")).data.find(
    (r: any) => r.email === "groups-history-student@example.invalid",
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
      email: "groups-history-student@example.invalid",
      password: "Testing-password-2026",
    },
  });
  await family.goto("/");

  const teacher = (
      await api("/teachers", "POST", {
        name: "Fictional Group Teacher",
        code: "FGT",
        branch_id: b,
      })
    ).id,
    room = (
      await api("/classrooms", "POST", {
        name: "Fictional Room",
        code: "FGR",
        branch_id: b,
        capacity: 20,
      })
    ).id,
    course = (
      await api("/courses", "POST", {
        name: "Fictional Course",
        code: "FGC",
        branch_id: b,
      })
    ).id;
  for (let i = 0; i < 21; i++) {
    const group = (
      await api("/groups", "POST", {
        name: "Fictional Pager Group " + String(i).padStart(2, "0"),
        code: "FPG" + i,
        branch_id: b,
        teacher_id: teacher,
        classroom_id: room,
        course_id: course,
        capacity: 20,
        start_date: "2020-01-01",
        end_date: "2099-12-31",
      })
    ).id;
    await api("/groups/" + group + "/enrollments", "POST", {
      student_id: student,
      status: "active",
    });
  }
  await family.reload();
  const panel = family.getByRole("region", {
      name: "Enrolled groups",
      exact: true,
    }),
    rows = panel.getByTestId("family-group-row");
  await expect(rows).toHaveCount(20);
  await expect(panel).toContainText("Matching groups: 21");
  await expect(rows.first()).toContainText("Fictional Pager Group 00");
  await panel.getByRole("button", { name: "Next groups", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(panel).toContainText("Page 2 / 2");
  await expect(rows.first()).toContainText("Fictional Pager Group 20");
  await panel
    .getByLabel("Enrollment status filter", { exact: true })
    .selectOption("completed");
  await expect(rows).toHaveCount(0);
  await expect(panel).toContainText("No groups match this filter.");
  await panel
    .getByLabel("Enrollment status filter", { exact: true })
    .selectOption("active");
  await expect(rows).toHaveCount(20);
  await panel.screenshot({
    path: "/downloads/elcenter-family-groups-desktop.png",
    animations: "disabled",
  });
  await family.getByRole("button", { name: "العربية", exact: true }).click();
  await family.evaluate(() => document.fonts.ready);
  for (const width of [390, 375, 360, 320]) {
    await family.setViewportSize({ width, height: 844 });
    expect(
      await family.evaluate(() => document.documentElement.scrollWidth),
      `Arabic document at ${width}px`,
    ).toBeLessThanOrEqual(width);
  }
  await family.setViewportSize({ width: 390, height: 844 });
  const arabic = family.getByRole("region", {
    name: "المجموعات المسجلة",
    exact: true,
  });
  await expect(arabic).toContainText("المجموعات المطابقة");
  await arabic.screenshot({
    path: "/downloads/elcenter-family-groups-ar-mobile.png",
    animations: "disabled",
  });
  await family.route("**/api/portal/groups/*?**", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional groups unavailable" }),
    }),
  );
  await arabic
    .getByLabel("تصفية حالة التسجيل", { exact: true })
    .selectOption("");
  await expect(arabic.getByRole("alert")).toContainText(
    "Fictional groups unavailable",
  );
  await expect(arabic.getByTestId("family-group-row")).toHaveCount(0);
  await context.close();
});
