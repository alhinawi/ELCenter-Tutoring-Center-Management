import { test, expect } from "@playwright/test";
import { Temporal } from "@js-temporal/polyfill";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "family-schedule-browser" },
});
test("family schedule applies local inclusive dates, clears old windows and preserves status/resource labels", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "family-schedule-browser@example.invalid",
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
    [one, "Fictional Tomorrow Session", teacher, "scheduled"],
    [two, "Fictional Replacement Canceled", replacement, "cancelled"],
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
    (r: any) => r.system_key === "student",
  ).id;
  await api("/users", "POST", {
    name: "Fictional Student Login",
    email: "schedule-window-student@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: b,
  });
  const user = (await api("/users")).data.find(
    (r: any) => r.email === "schedule-window-student@example.invalid",
  );
  await api("/portal-links", "POST", {
    user_id: user.user_id,
    kind: "student",
    profile_id: student,
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    family = await context.newPage();
  await family.request.post("/api/auth/login", {
    data: {
      email: "schedule-window-student@example.invalid",
      password: "Testing-password-2026",
    },
  });
  await family.goto("/");
  const schedule = family.getByRole("region", {
      name: "Family schedule window",
      exact: true,
    }),
    from = schedule.getByLabel("Schedule from date", { exact: true }),
    through = schedule.getByLabel("Schedule through date", { exact: true });
  await expect(schedule.getByTestId("family-schedule-row")).toHaveCount(2);
  await from.fill(one.toString());
  await expect(schedule.getByTestId("family-schedule-row")).toHaveCount(0);
  await through.fill(one.toString());
  await schedule
    .getByRole("button", { name: "Apply schedule dates", exact: true })
    .click();
  await expect(schedule.getByTestId("family-schedule-row")).toHaveCount(1);
  await expect(schedule).toContainText("Fictional Tomorrow Session");
  await expect(schedule).not.toContainText("Fictional Replacement Canceled");
  await from.fill(two.toString());
  await through.fill(two.toString());
  await schedule
    .getByRole("button", { name: "Apply schedule dates", exact: true })
    .click();
  await expect(schedule).toContainText("Fictional Replacement Teacher");
  await expect(schedule).toContainText("Cancelled");
  await schedule.screenshot({
    path: "/downloads/elcenter-family-schedule-desktop.png",
    animations: "disabled",
  });
  await family.setViewportSize({ width: 390, height: 844 });
  await family.getByRole("button", { name: "العربية", exact: true }).click();
  const arabic = family.getByRole("region", {
    name: "فترة جدول الأسرة",
    exact: true,
  });
  await expect(arabic).toContainText("ملغي");
  expect(
    await family.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await arabic.screenshot({
    path: "/downloads/elcenter-family-schedule-ar-mobile.png",
    animations: "disabled",
  });
  await family.route("**/api/portal/students/*/schedule?**", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error:
          "Family schedule exceeds1000 sessions. Narrow the dates; no partial schedule was returned.",
      }),
    }),
  );
  await arabic
    .getByRole("button", { name: "طبّق تواريخ الجدول", exact: true })
    .click();
  await expect(arabic.getByRole("alert")).toContainText("exceeds1000");
  await expect(arabic.getByTestId("family-schedule-row")).toHaveCount(0);

  await family.unroute("**/api/portal/students/*/schedule?**");
  let releaseOld: (() => void) | undefined,
    seen = false;
  const gate = new Promise<void>((r) => (releaseOld = r));
  await family.route("**/api/portal/students/*/schedule?**", async (route) => {
    const from = new URL(route.request().url()).searchParams.get("from");
    if (from === one.toString()) {
      seen = true;
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "old",
              topic: "STALE SCHEDULE",
              starts_at: 1800000000,
              status: "scheduled",
            },
          ],
          timezone: "Africa/Cairo",
          from: one.toString(),
          to: one.toString(),
        }),
      });
    } else
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          timezone: "Africa/Cairo",
          from: two.toString(),
          to: two.toString(),
        }),
      });
  });
  await arabic
    .getByLabel("تاريخ بداية الجدول", { exact: true })
    .fill(one.toString());
  await arabic
    .getByLabel("تاريخ نهاية الجدول", { exact: true })
    .fill(one.toString());
  await arabic
    .getByRole("button", { name: "طبّق تواريخ الجدول", exact: true })
    .click();
  await expect.poll(() => seen).toBeTruthy();
  await arabic
    .getByLabel("تاريخ بداية الجدول", { exact: true })
    .fill(two.toString());
  await arabic
    .getByLabel("تاريخ نهاية الجدول", { exact: true })
    .fill(two.toString());
  await arabic
    .getByRole("button", { name: "طبّق تواريخ الجدول", exact: true })
    .click();
  await expect(arabic).toContainText("مفيش حصص في الفترة دي.");
  releaseOld!();
  await expect(arabic.getByText("STALE SCHEDULE", { exact: true })).toHaveCount(
    0,
  );
  await context.close();
});
