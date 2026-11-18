import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "family-results-browser" },
});
test("guardian pages finalized results and switching children resets history without stale grades", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "family-results-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Family Academy",
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
  const one = await make("students", "Fictional Child Alpha"),
    two = await make("students", "Fictional Child Beta"),
    guardian = await make("guardians", "Fictional Guardian", {
      phone: "01000000000",
    }),
    teacher = await make("teachers", "Fictional Teacher"),
    room = await make("classrooms", "Fictional Room", { capacity: 20 }),
    course = await make("courses", "Fictional Course"),
    group = await make("groups", "Fictional Group", {
      teacher_id: teacher,
      classroom_id: room,
      course_id: course,
      capacity: 20,
      start_date: "2020-01-01",
      end_date: "2099-12-31",
    });
  for (const student of [one, two]) {
    await api("/students/" + student + "/guardians", "POST", {
      guardian_id: guardian,
      relationship: "parent",
    });
    await api("/groups/" + group + "/enrollments", "POST", {
      student_id: student,
      status: "active",
    });
  }
  const time = Math.floor(Date.now() / 1000) + 1;
  for (let i = 0; i < 21; i++) {
    const body = {
      name: "Fictional Family Exam " + String(i).padStart(2, "0"),
      group_id: group,
      scheduled_at: time,
      max_score: 100,
      pass_score: 50,
      status: "draft",
    };
    const exam = (await api("/exams", "POST", body)).id;
    await api("/exams/" + exam, "PUT", { ...body, status: "published" });
    await expect
      .poll(() => Math.floor(Date.now() / 1000))
      .toBeGreaterThanOrEqual(time);
    await api("/exams/" + exam + "/results", "POST", {
      student_id: one,
      score: 80,
      feedback: "Alpha final feedback",
    });
    if (i === 0)
      await api("/exams/" + exam + "/results", "POST", {
        student_id: two,
        score: 40,
        feedback: "Beta final feedback",
      });
  }
  const role = (await api("/roles")).data.find(
    (r: any) => r.system_key === "parent_guardian",
  ).id;
  await api("/users", "POST", {
    name: "Fictional Guardian Login",
    email: "family-history-guardian@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: null,
  });
  const account = (await api("/users")).data.find(
    (r: any) => r.email === "family-history-guardian@example.invalid",
  );
  await api("/portal-links", "POST", {
    user_id: account.user_id,
    kind: "guardian",
    profile_id: guardian,
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    family = await context.newPage();
  await family.request.post("/api/auth/login", {
    data: {
      email: "family-history-guardian@example.invalid",
      password: "Testing-password-2026",
    },
  });
  await family.goto("/");
  const history = family.getByRole("region", {
    name: "Final result history",
    exact: true,
  });
  await expect(history.getByTestId("family-result-row")).toHaveCount(20);
  await expect(history).toContainText("Final results: 21");
  await history
    .getByRole("button", { name: "Next results", exact: true })
    .click();
  await expect(history.getByTestId("family-result-row")).toHaveCount(1);
  await expect(history).toContainText("Page 2");
  await history.scrollIntoViewIfNeeded();
  await history.screenshot({
    path: "/downloads/elcenter-family-result-history-desktop.png",
    animations: "disabled",
  });
  // Change to the other linked child. The new component starts at page one.
  const chooser = family.getByRole("combobox").first();
  await chooser.selectOption(two);
  await expect(history.getByTestId("family-result-row")).toHaveCount(1);
  await expect(history).toContainText("Fictional Child Beta");
  await expect(history).toContainText("Page 1");
  await expect(history).toContainText("40 / 100");
  await expect(history).not.toContainText("Alpha final feedback");
  await family.setViewportSize({ width: 390, height: 844 });
  await family.getByRole("button", { name: "العربية", exact: true }).click();
  const arabic = family.getByRole("region", {
    name: "سجل النتايج النهائية",
    exact: true,
  });
  await expect(arabic).toContainText("Beta final feedback");
  await arabic.scrollIntoViewIfNeeded();
  expect(
    await family.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await arabic.screenshot({
    path: "/downloads/elcenter-family-result-history-ar-mobile.png",
    animations: "disabled",
  });
  // A failure fetching the new child's page cannot leave the previous child's grades.
  await family.route("**/api/portal/students/*/results?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional final history failed" }),
    }),
  );
  await chooser.selectOption(one);
  await expect(arabic.getByRole("alert")).toContainText(
    "Fictional final history failed",
  );
  await expect(arabic.getByTestId("family-result-row")).toHaveCount(0);

  await family.unroute("**/api/portal/students/*/results?**");
  const betaSnapshot = await (
    await family.request.get("/api/portal/students/" + two)
  ).json();
  let releaseOld: (() => void) | undefined,
    oldSeen = false;
  const oldGate = new Promise<void>((r) => (releaseOld = r));
  await family.route("**/api/portal/students/" + two, async (route) => {
    oldSeen = true;
    await oldGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(betaSnapshot),
    });
  });
  await chooser.selectOption(two);
  await expect.poll(() => oldSeen).toBeTruthy();
  await chooser.selectOption(one);
  await expect(arabic).toContainText("Fictional Child Alpha");
  await expect(arabic.getByTestId("family-result-row")).toHaveCount(20);
  releaseOld!();
  await expect(arabic).not.toContainText("Beta final feedback");
  await expect(arabic).toContainText("Fictional Child Alpha");
  await context.close();
});
