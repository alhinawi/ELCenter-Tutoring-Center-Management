import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "roster-paging-browser" },
});
test("teacher class roster pages every student", async ({ page, browser }) => {
  await page.request.post("/api/auth/register", {
    data: {
      name: "Fictional Owner",
      email: "roster-paging-browser@example.invalid",
      password: "Testing-password-2026",
      organization: "Fictional Roster Academy",
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
  const role = (await api("/roles")).data.find(
    (r: any) => r.system_key === "teacher",
  ).id;
  await api("/users", "POST", {
    name: "Fictional Teacher Login",
    email: "roster-paging-login@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: b,
  });
  const account = (await api("/users")).data.find(
    (r: any) => r.email === "roster-paging-login@example.invalid",
  );
  const teacher = (
      await api("/teachers", "POST", {
        name: "Fictional Group Teacher",
        code: "RGT",
        branch_id: b,
      })
    ).id,
    room = (
      await api("/classrooms", "POST", {
        name: "Fictional Room",
        code: "RGR",
        branch_id: b,
        capacity: 60,
      })
    ).id,
    course = (
      await api("/courses", "POST", {
        name: "Fictional Course",
        code: "RGC",
        branch_id: b,
      })
    ).id;
  await api("/portal-links", "POST", {
    user_id: account.user_id,
    kind: "teacher",
    profile_id: teacher,
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    family = await context.newPage();
  await family.request.post("/api/auth/login", {
    data: {
      email: "roster-paging-login@example.invalid",
      password: "Testing-password-2026",
    },
  });
  await family.goto("/");

  const group = (
    await api("/groups", "POST", {
      name: "Fictional Roster Group",
      code: "RPG",
      branch_id: b,
      teacher_id: teacher,
      classroom_id: room,
      course_id: course,
      capacity: 60,
      start_date: "2020-01-01",
      end_date: "2099-12-31",
    })
  ).id;
  for (let i = 0; i < 55; i++) {
    const st = (
      await api("/students", "POST", {
        name: "Fictional Roster Learner " + String(i).padStart(2, "0"),
        code: "RL" + i,
        branch_id: b,
      })
    ).id;
    await api("/groups/" + group + "/enrollments", "POST", {
      student_id: st,
      status: "active",
    });
  }
  await family.goto("/");
  await family
    .getByRole("button", { name: "Learning space", exact: true })
    .click();
  await family.getByRole("button", { name: "Open class", exact: true }).click();
  await family
    .getByRole("button", { name: "Class roster", exact: true })
    .click();
  const dialog = family.getByRole("dialog");
  await expect(dialog).toContainText("Students: 55");
  await expect(dialog).toContainText("Page 1 / 2");
  await expect(dialog.getByRole("row")).toHaveCount(51);
  await expect(dialog).toContainText("Fictional Roster Learner 00");
  await dialog
    .getByRole("button", { name: "Next students", exact: true })
    .click();
  await expect(dialog).toContainText("Page 2 / 2");
  await expect(dialog.getByRole("row")).toHaveCount(6);
  await expect(dialog).toContainText("Fictional Roster Learner 54");
  await expect(
    dialog.getByRole("button", { name: "Next students", exact: true }),
  ).toBeDisabled();
  await dialog.screenshot({
    path: "/downloads/elcenter-roster-page2.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await family.getByRole("button", { name: "العربية", exact: true }).click();
  await family.evaluate(() => document.fonts.ready);
  await family.setViewportSize({ width: 390, height: 844 });
  await family
    .getByRole("button", { name: "مساحة التعلم", exact: true })
    .click();
  const open = family.getByRole("button", {
    name: "فتح المجموعة",
    exact: true,
  });
  if (await open.isVisible()) await open.click();
  await family
    .getByRole("button", { name: "قائمة الطلاب", exact: true })
    .click();
  const ar = family.getByRole("dialog");
  await expect(ar).toContainText("الطلاب: 55");
  await expect(ar.getByText("نشط").first()).toBeVisible();
  await expect(ar).not.toContainText("active");
  await expect(
    ar.getByRole("region", { name: "مرر جانبيا لعرض كل الأعمدة" }),
  ).toBeVisible();
  await ar
    .getByRole("button", { name: "الطلاب التاليون", exact: true })
    .click();
  await expect(ar).toContainText("صفحة 2 / 2");
  for (const width of [390, 360, 320]) {
    await family.setViewportSize({ width, height: 844 });
    expect(
      await family.evaluate(() => document.documentElement.scrollWidth),
      "document " + width,
    ).toBeLessThanOrEqual(width);
    await ar.evaluate((e) => (e.scrollTop = 0));
    for (const [label, loc] of [
      ["title", ar.getByRole("heading", { name: "قائمة الطلاب" })],
      ["close", ar.getByRole("button", { name: "Close", exact: true })],
      ["hint", ar.getByText("مرر جانبيا لعرض كل الأعمدة")],
    ] as const) {
      const b = (await loc.boundingBox())!;
      expect(b.y, label + " top " + width).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, label + " bottom " + width).toBeLessThanOrEqual(
        844,
      );
      expect(b.x, label + " left " + width).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, label + " right " + width).toBeLessThanOrEqual(
        width,
      );
    }
    await family.screenshot({
      path: `/downloads/elcenter-roster-ar-top-${width}.png`,
      animations: "disabled",
    });
    await ar.evaluate((e) => (e.scrollTop = e.scrollHeight));
    const box = async (l: any) => (await l.boundingBox())!;
    const status = await box(ar.getByRole("status")),
      prev = await box(
        ar.getByRole("button", { name: "الطلاب السابقون", exact: true }),
      ),
      next = await box(
        ar.getByRole("button", { name: "الطلاب التاليون", exact: true }),
      ),
      panel = await box(ar);
    expect(
      status.y + status.height,
      "status above buttons " + width,
    ).toBeLessThanOrEqual(prev.y + 1);
    for (const b of [prev, next, status]) {
      expect(b.x, "inside left " + width).toBeGreaterThanOrEqual(panel.x);
      expect(b.x + b.width, "inside right " + width).toBeLessThanOrEqual(
        panel.x + panel.width + 1,
      );
    }
    const apart =
      prev.y + prev.height <= next.y ||
      next.y + next.height <= prev.y ||
      prev.x + prev.width <= next.x + 1 ||
      next.x + next.width <= prev.x + 1;
    expect(apart, "buttons do not overlap " + width).toBe(true);
    expect(next.y + next.height, "next reachable " + width).toBeLessThanOrEqual(
      844,
    );
    expect(prev.y, "prev reachable " + width).toBeGreaterThanOrEqual(0);
    await family.screenshot({
      path: `/downloads/elcenter-roster-ar-${width}.png`,
      animations: "disabled",
    });
  }
  await context.close();
});
