import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "family-attendance-browser" },
});
test("family attendance pages real records, filters status and retains independent correction controls", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "family-attendance-browser@example.invalid",
      password: "Testing-password-2026",
      organization: "Fictional Attendance Academy",
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
  async function make(p: string, name: string, extra: any = {}) {
    return (
      await api("/" + p, "POST", {
        name,
        code: crypto.randomUUID().slice(0, 8),
        branch_id: b,
        ...extra,
      })
    ).id;
  }
  const student = await make("students", "Fictional Attendance Learner"),
    teacher = await make("teachers", "Fictional Teacher"),
    room = await make("classrooms", "Fictional Room", { capacity: 20 }),
    course = await make("courses", "Fictional Course"),
    group = await make("groups", "Fictional Attendance Group", {
      teacher_id: teacher,
      classroom_id: room,
      course_id: course,
      capacity: 20,
      start_date: "2020-01-01",
      end_date: "2099-12-31",
    });
  await api("/groups/" + group + "/enrollments", "POST", {
    student_id: student,
    status: "active",
  });
  // The historical membership checks need enrollment before each session, so
  // construct the real sessions at the captured present second and submit once due.
  const now = Math.floor(Date.now() / 1000),
    sessionBody = {
      group_id: group,
      teacher_id: teacher,
      classroom_id: room,
      starts_at: now,
      ends_at: now + 1,
      status: "scheduled",
    };
  // Use distinct past milliseconds rounded to seconds would predate enrollment.
  // Consecutive one-second sessions stay in the present and wait only once.
  const ids: string[] = [];
  for (let i = 0; i < 21; i++) {
    const result = await api("/sessions", "POST", {
      ...sessionBody,
      starts_at: now + i,
      ends_at: now + i + 1,
      topic: "Fictional Attendance Session " + String(i).padStart(2, "0"),
    });
    ids.push(result.ids[0]);
  }
  await expect
    .poll(() => Math.floor(Date.now() / 1000), { timeout: 25000 })
    .toBeGreaterThanOrEqual(now + 20);
  for (const [i, id] of ids.entries())
    await api("/sessions/" + id + "/attendance", "POST", {
      rows: [
        {
          student_id: student,
          status: i % 2 ? "absent" : "present",
          arrival: i === 0 ? now : null,
          departure: i === 0 ? now + 1 : null,
          notes: "EXCLUDED INTERNAL NOTES",
        },
      ],
    });
  const role = (await api("/roles")).data.find(
    (r: any) => r.system_key === "student",
  ).id;
  await api("/users", "POST", {
    name: "Fictional Student Login",
    email: "attendance-history-student@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: b,
  });
  const account = (await api("/users")).data.find(
    (r: any) => r.email === "attendance-history-student@example.invalid",
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
      email: "attendance-history-student@example.invalid",
      password: "Testing-password-2026",
    },
  });
  await family.goto("/");
  const history = family.getByRole("region", {
    name: "Recorded attendance history",
    exact: true,
  });
  await expect(history.getByTestId("family-attendance-row")).toHaveCount(20);
  await expect(history).toContainText("Matching attendance records: 21");
  await expect(history).not.toContainText("EXCLUDED INTERNAL NOTES");
  await history
    .getByRole("button", { name: "Next attendance", exact: true })
    .click();
  await expect(history.getByTestId("family-attendance-row")).toHaveCount(1);
  await expect(history).toContainText("Fictional Attendance Session 00");
  await history.screenshot({
    path: "/downloads/elcenter-family-attendance-desktop.png",
    animations: "disabled",
  });
  await history
    .getByLabel("Attendance history status", { exact: true })
    .selectOption("absent");
  await expect(history.getByTestId("family-attendance-row")).toHaveCount(10);
  await expect(history).toContainText("Page 1");
  await history
    .getByRole("button", { name: "Request / history", exact: true })
    .first()
    .click();
  await expect(family.getByRole("dialog")).toBeVisible();
  await expect(
    family.getByLabel("Requested attendance status", { exact: true }),
  ).toBeVisible();
  await family.getByRole("button", { name: "Close", exact: true }).click();
  await history
    .getByLabel("Attendance history status", { exact: true })
    .selectOption("excused");
  await expect(history).toContainText("No matching recorded attendance.");
  await family.setViewportSize({ width: 390, height: 844 });
  await family.getByRole("button", { name: "العربية", exact: true }).click();
  const arabic = family.getByRole("region", {
    name: "سجل الحضور المسجل",
    exact: true,
  });
  await arabic
    .getByLabel("حالة سجل الحضور", { exact: true })
    .selectOption("present");
  await expect(arabic.getByTestId("family-attendance-row")).toHaveCount(11);
  // Narrow the screenshot to a single last-page historical row in Arabic.
  await arabic.getByLabel("حالة سجل الحضور", { exact: true }).selectOption("");
  await arabic
    .getByRole("button", { name: "الحضور التالي", exact: true })
    .click();
  await expect(arabic.getByTestId("family-attendance-row")).toHaveCount(1);
  expect(
    await family.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await arabic.screenshot({
    path: "/downloads/elcenter-family-attendance-ar-mobile.png",
    animations: "disabled",
  });
  await family.route("**/api/portal/students/*/attendance?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional attendance failed" }),
    }),
  );
  await arabic
    .getByRole("button", { name: "الحضور السابق", exact: true })
    .click();
  await expect(arabic.getByRole("alert")).toContainText(
    "Fictional attendance failed",
  );
  await expect(arabic.getByTestId("family-attendance-row")).toHaveCount(0);
  await context.close();
});
