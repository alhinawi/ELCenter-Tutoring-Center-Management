import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "attendance-reminder-browser" },
});
test("low attendance rule delivers a private linked-student inbox notice", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "attendance-reminder-browser@example.invalid",
          password: "Test-only-password-2026",
          organization: "Fictional Attendance Academy",
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
    teacher = (
      await api("/teachers", "POST", {
        branch_id: branch,
        name: "Fictional Tutor",
        code: "ATREM-T",
      })
    ).id,
    course = (
      await api("/courses", "POST", {
        branch_id: branch,
        name: "English Practice",
        code: "ATREM-C",
      })
    ).id,
    room = (
      await api("/classrooms", "POST", {
        branch_id: branch,
        name: "Study Room",
        code: "ATREM-R",
        capacity: 30,
      })
    ).id;
  const group = (
    await api("/groups", "POST", {
      branch_id: branch,
      name: "Evening learners",
      code: "ATREM-G",
      teacher_id: teacher,
      course_id: course,
      classroom_id: room,
      capacity: 20,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
    })
  ).id;
  const student = (
    await api("/students", "POST", {
      branch_id: branch,
      name: "Fictional Attendance Learner",
      code: "ATREM-S",
    })
  ).id;
  await api("/groups/" + group + "/enrollments", "POST", {
    student_id: student,
    status: "active",
  });
  const sessionBase = Math.floor(Date.now() / 1000) + 1;
  for (let i = 0; i < 5; i++) {
    const start = sessionBase + i;
    const session = (
      await api("/sessions", "POST", {
        group_id: group,
        teacher_id: teacher,
        classroom_id: room,
        starts_at: start,
        ends_at: start + 1,
        topic: "Recorded practice",
      })
    ).ids[0];
    await expect
      .poll(() => Math.floor(Date.now() / 1000), { timeout: 10000 })
      .toBeGreaterThanOrEqual(start);
    await api("/sessions/" + session + "/attendance", "POST", {
      rows: [
        {
          student_id: student,
          status: i === 0 ? "present" : "absent",
          notes: "",
        },
      ],
    });
  }
  await expect
    .poll(() => Math.floor(Date.now() / 1000), { timeout: 10000 })
    .toBeGreaterThan(sessionBase + 5);
  const roles = (await api("/roles")).data,
    email = "attendance-family-browser@example.invalid",
    password = "Test-only-exam-family-2026";
  await api("/users", "POST", {
    name: "Fictional Attendance Learner",
    email,
    password,
    role_id: roles.find((r: any) => r.system_key === "student").id,
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
  await page.goto("/");
  await page
    .getByRole("button", { name: "Automation controls", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Low attendance for linked families",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", {
      name: "Low attendance for linked families",
      exact: true,
    })
    .check();
  await page
    .getByLabel("Attendance lookback days (7–90)", { exact: true })
    .fill("30");
  await page
    .getByRole("button", { name: "Save reminder rules", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  const settings = (await api("/system/automation")).rules;
  expect(settings.low_attendance).toBe(1);
  expect(settings.attendance_minimum).toBe(5);
  await api("/system/automation", "PUT", { enabled: false });
  expect((await api("/system/automation")).rules.attendance_days).toBe(30);
  const me = (await api("/me")).user;
  expect(
    (
      await page.request.put("/api/system/automation", {
        headers: { "x-csrf-token": me.csrf },
        data: { enabled: false, attendance_days: 91 },
      })
    ).status(),
  ).toBe(400);
  await page
    .getByRole("button", { name: "Run in-app reminders now", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  expect((await api("/notifications")).data).toHaveLength(0);
  await page
    .getByLabel("Attendance lookback days (7–90)", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/downloads/elcenter-attendance-reminder-settings.png",
    fullPage: true,
  });
  await page
    .getByRole("heading", { name: "Reminder rules", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/downloads/elcenter-attendance-reminder-rule-top.png",
    fullPage: false,
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ar-EG",
    }),
    sp = await context.newPage();
  sp.on("pageerror", (e) => errors.push(e.message));
  await sp.request.post("/api/auth/login", { data: { email, password } });
  await sp.goto("/");
  await sp.getByRole("button", { name: /الوارد/ }).click();
  await expect(
    sp.getByRole("heading", {
      name: "Attendance follow-up / متابعة الحضور",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    sp.getByText(/Fictional Attendance Learner · 1\/5/),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-attendance-reminder-owner.png",
    fullPage: true,
  });
  await sp.screenshot({
    path: "/downloads/elcenter-attendance-reminder-family-ar-mobile.png",
    fullPage: true,
  });
  expect(
    await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await context.close();
});
