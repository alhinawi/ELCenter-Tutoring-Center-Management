import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "timetable-filter-browser" },
});
test("teacher and classroom timetable filters use persisted session replacements and combine safely", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "timetable-filter-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Schedule Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
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
  const teacher = await make("teachers", "Fictional Primary Teacher"),
    replacement = await make("teachers", "Fictional Replacement Teacher"),
    room = await make("classrooms", "Fictional Primary Room", { capacity: 20 }),
    newRoom = await make("classrooms", "Fictional Replacement Room", {
      capacity: 20,
    }),
    course = await make("courses", "Fictional Science"),
    group = await make("groups", "Fictional Science Group", {
      teacher_id: teacher,
      classroom_id: room,
      course_id: course,
      capacity: 20,
      start_date: "2020-01-01",
      end_date: "2099-12-31",
    });
  const now = new Date(),
    start = Math.floor(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 10) / 1000,
    );
  for (const [topic, t, r, delta] of [
    ["Original session resources", teacher, room, 0],
    ["Replacement session resources", replacement, newRoom, 7200],
  ] as [string, string, string, number][]) {
    await api("/sessions", "POST", {
      group_id: group,
      teacher_id: t,
      classroom_id: r,
      starts_at: start + delta,
      ends_at: start + delta + 3600,
      topic,
      status: "cancelled",
    });
  }
  await page.goto("/");
  await page
    .getByRole("button", { name: "Timetable & attendance", exact: true })
    .click();
  await expect(
    page.getByText("Original session resources", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Replacement session resources", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByLabel("Teacher filter", { exact: true })
    .selectOption(replacement);
  await expect(
    page.getByText("Original session resources", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Replacement session resources", { exact: false }).first(),
  ).toBeVisible();
  await page.getByLabel("Classroom filter", { exact: true }).selectOption(room);
  await expect(page.locator(".fc-event")).toHaveCount(0);
  await page
    .getByLabel("Classroom filter", { exact: true })
    .selectOption(newRoom);
  await page.getByLabel("Group filter", { exact: true }).selectOption(group);
  await expect(
    page.getByText("Replacement session resources", { exact: false }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-timetable-filters-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(page.getByLabel("فلتر المدرّس", { exact: true })).toHaveValue(
    replacement,
  );
  await expect(page.getByLabel("فلتر القاعة", { exact: true })).toHaveValue(
    newRoom,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-timetable-filters-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  // A failed changed-resource request must not leave the prior resource's events.
  await page.route("**/api/sessions?**", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional resource request failed" }),
    }),
  );
  await page.getByLabel("فلتر المدرّس", { exact: true }).selectOption(teacher);
  await expect(page.locator("p[role=alert]")).toContainText(
    "Fictional resource request failed",
  );
  await expect(page.locator(".fc-event")).toHaveCount(0);
});
