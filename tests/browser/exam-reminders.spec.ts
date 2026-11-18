import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "exam-reminder-browser" } });
test("upcoming published exam rule delivers a private linked-student inbox notice", async ({
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
          email: "exam-reminder-browser@example.invalid",
          password: "Test-only-password-2026",
          organization: "Fictional Exam Academy",
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
        code: "EXAM-T",
      })
    ).id,
    course = (
      await api("/courses", "POST", {
        branch_id: branch,
        name: "English Practice",
        code: "EXAM-C",
      })
    ).id,
    room = (
      await api("/classrooms", "POST", {
        branch_id: branch,
        name: "Study Room",
        code: "EXAM-R",
        capacity: 30,
      })
    ).id;
  const group = (
    await api("/groups", "POST", {
      branch_id: branch,
      name: "Evening learners",
      code: "EXAM-G",
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
      name: "Fictional Exam Learner",
      code: "EXAM-S",
    })
  ).id;
  await api("/groups/" + group + "/enrollments", "POST", {
    student_id: student,
    status: "active",
  });
  const payload = {
    group_id: group,
    name: "Progress check",
    scheduled_at: Math.floor(Date.now() / 1000) + 86400,
    max_score: 100,
    pass_score: 50,
    status: "draft",
  };
  const exam = (await api("/exams", "POST", payload)).id;
  await api("/exams/" + exam + "/questions", "POST", {
    type: "short_answer",
    prompt: "Write hello",
    correct_answer: "hello",
    points: 100,
    options: [],
  });
  await api("/exams/" + exam, "PUT", { ...payload, status: "published" });
  const roles = (await api("/roles")).data,
    email = "exam-family-browser@example.invalid",
    password = "Test-only-exam-family-2026";
  await api("/users", "POST", {
    name: "Fictional Exam Learner",
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
      name: "Upcoming exams for linked families",
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", {
      name: "Upcoming exams for linked families",
      exact: true,
    })
    .check();
  await page.getByLabel("Exam notice days (1–14)", { exact: true }).fill("3");
  await page
    .getByRole("button", { name: "Save reminder rules", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  const settings = (await api("/system/automation")).rules;
  expect(settings.upcoming_exams).toBe(1);
  expect(settings.exam_days).toBe(3);
  await api("/system/automation", "PUT", { enabled: false });
  expect((await api("/system/automation")).rules.exam_days).toBe(3);
  const me = (await api("/me")).user;
  expect(
    (
      await page.request.put("/api/system/automation", {
        headers: { "x-csrf-token": me.csrf },
        data: { enabled: false, exam_days: 15 },
      })
    ).status(),
  ).toBe(400);
  await page
    .getByRole("button", { name: "Run in-app reminders now", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  expect((await api("/notifications")).data).toHaveLength(0);
  await page.screenshot({
    path: "/downloads/elcenter-exam-reminder-settings.png",
    fullPage: true,
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
      name: "Upcoming exam / امتحان قريب",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    sp.getByText(/Fictional Exam Learner · Progress check/),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-exam-reminder-owner.png",
    fullPage: true,
  });
  await sp.screenshot({
    path: "/downloads/elcenter-exam-reminder-family-ar-mobile.png",
    fullPage: true,
  });
  expect(
    await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await context.close();
});
