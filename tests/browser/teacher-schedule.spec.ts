import { test, expect } from "@playwright/test";
import { Temporal } from "@js-temporal/polyfill";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "teacher-schedule-browser" },
});
test("teacher schedule uses actual replacement assignment, complete windows and attendance controls", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "teacher-schedule-browser@example.invalid",
      password: "Testing-password-2026",
      organization: "Fictional Schedule Academy",
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
  const student = await make("students", "Fictional Schedule Learner"),
    teacher = await make("teachers", "Fictional Original Teacher"),
    replacement = await make("teachers", "Fictional Replacement Teacher"),
    room = await make("classrooms", "Fictional Room", { capacity: 20 }),
    course = await make("courses", "Fictional Course"),
    group = await make("groups", "Fictional Schedule Group", {
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
  const today = Temporal.Now.plainDateISO("Africa/Cairo"),
    one = today.add({ days: 1 }),
    two = today.add({ days: 2 });
  for (const [day, topic, t, status] of [
    [one, "Fictional Tomorrow Session", replacement, "scheduled"],
    [two, "Fictional Replacement Canceled", replacement, "cancelled"],
    [
      two.add({ days: 1 }),
      "Fictional Other Teacher Session",
      teacher,
      "scheduled",
    ],
  ] as const) {
    const starts =
      Number(
        day.toZonedDateTime({ timeZone: "Africa/Cairo", plainTime: "12:00" })
          .epochMilliseconds,
      ) / 1000;
    await api("/sessions", "POST", {
      group_id: group,
      teacher_id: t,
      classroom_id: room,
      starts_at: starts,
      ends_at: starts + 3600,
      status,
      topic,
    });
  }
  const role = (await api("/roles")).data.find(
    (r: any) => r.system_key === "teacher",
  ).id;
  await api("/users", "POST", {
    name: "Fictional Student Login",
    email: "schedule-window-teacher@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: b,
  });
  const user = (await api("/users")).data.find(
    (r: any) => r.email === "schedule-window-teacher@example.invalid",
  );
  await api("/portal-links", "POST", {
    user_id: user.user_id,
    kind: "teacher",
    profile_id: replacement,
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    family = await context.newPage();
  await family.request.post("/api/auth/login", {
    data: {
      email: "schedule-window-teacher@example.invalid",
      password: "Testing-password-2026",
    },
  });
  await family.goto("/");
  const schedule = family.getByRole("region", {
      name: "Teacher schedule window",
      exact: true,
    }),
    from = schedule.getByLabel("Schedule from date", { exact: true }),
    through = schedule.getByLabel("Schedule through date", { exact: true });
  await expect(schedule.getByTestId("family-schedule-row")).toHaveCount(2);
  await expect(schedule).not.toContainText("Fictional Other Teacher Session");
  await from.fill(one.toString());
  await expect(schedule.getByTestId("family-schedule-row")).toHaveCount(0);
  await through.fill(one.toString());
  await schedule
    .getByRole("button", { name: "Apply schedule dates", exact: true })
    .click();
  await expect(schedule.getByTestId("family-schedule-row")).toHaveCount(1);
  await expect(schedule).toContainText("Fictional Tomorrow Session");
  await expect(schedule).not.toContainText("Fictional Replacement Canceled");
  await schedule
    .getByRole("button", { name: "Record attendance", exact: true })
    .click();
  await expect(
    family.getByRole("dialog", { name: "Class attendance", exact: true }),
  ).toBeVisible();
  await family.getByRole("button", { name: "Close", exact: true }).click();
  await from.fill(two.toString());
  await through.fill(two.toString());
  await schedule
    .getByRole("button", { name: "Apply schedule dates", exact: true })
    .click();
  await expect(schedule).toContainText("Fictional Replacement Teacher");
  await expect(schedule).toContainText("Cancelled");
  await schedule.screenshot({
    path: "/downloads/elcenter-teacher-schedule-desktop.png",
    animations: "disabled",
  });
  await family.setViewportSize({ width: 390, height: 844 });
  await family.getByRole("button", { name: "العربية", exact: true }).click();
  const arabic = family.getByRole("region", {
    name: "فترة جدول المدرّس",
    exact: true,
  });
  await expect(arabic).toContainText("ملغي");
  expect(
    await family.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await arabic.screenshot({
    path: "/downloads/elcenter-teacher-schedule-ar-mobile.png",
    animations: "disabled",
  });
  await context.close();
});
