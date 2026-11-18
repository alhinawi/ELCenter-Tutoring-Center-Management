import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "student-performance-browser" },
});
test("performance pages real students and weighted finalized metrics with Arabic and cleared fetch errors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "performance-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Performance Academy",
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
  const students = [];
  for (let i = 0; i < 21; i++)
    students.push(
      await make(
        "students",
        "Fictional Learner " + String(i).padStart(2, "0"),
        { status: i === 20 ? "inactive" : "active" },
      ),
    );
  const teacher = await make("teachers", "Fictional Teacher"),
    room = await make("classrooms", "Fictional Room", { capacity: 30 }),
    course = await make("courses", "Fictional Course"),
    group = await make("groups", "Fictional Group", {
      teacher_id: teacher,
      classroom_id: room,
      course_id: course,
      capacity: 30,
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    });
  await api("/groups/" + group + "/enrollments", "POST", {
    student_id: students[0],
    status: "active",
  });
  const examTime = Math.floor(Date.now() / 1000) + 1;
  for (const [max, score] of [
    [50, 50],
    [150, 0],
  ]) {
    const exam = (
      await api("/exams", "POST", {
        name: "Fictional Weighted " + max,
        group_id: group,
        scheduled_at: examTime,
        max_score: max,
        pass_score: 0,
        status: "draft",
      })
    ).id;
    await api("/exams/" + exam, "PUT", {
      name: "Fictional Weighted " + max,
      group_id: group,
      scheduled_at: examTime,
      max_score: max,
      pass_score: 0,
      status: "published",
    });
    await expect
      .poll(() => Math.floor(Date.now() / 1000))
      .toBeGreaterThanOrEqual(examTime);
    await api("/exams/" + exam + "/results", "POST", {
      student_id: students[0],
      score,
      feedback: "Fictional feedback, not in overview",
    });
  }
  await page.goto("/");
  await page
    .getByRole("button", { name: "Exams & performance", exact: true })
    .click();
  await page.getByRole("button", { name: "Performance", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Student performance",
    exact: true,
  });
  await expect(dialog.getByTestId("student-performance-row")).toHaveCount(20);
  const first = dialog
    .getByTestId("student-performance-row")
    .filter({ hasText: "Fictional Learner 00" });
  await expect(first).toContainText("25%");
  await expect(first).toContainText("Final results: 2");
  await expect(first).toContainText("Attendance: —");
  await page.screenshot({
    path: "/downloads/elcenter-student-performance-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Next performance page", exact: true })
    .click();
  await expect(dialog.getByTestId("student-performance-row")).toHaveCount(1);
  await expect(dialog).toContainText("Fictional Learner 20");
  await dialog
    .getByLabel("Performance student status", { exact: true })
    .selectOption("active");
  await expect(dialog.getByTestId("student-performance-row")).toHaveCount(20);
  await dialog
    .getByLabel("Search performance by student name", { exact: true })
    .fill("Fictional Learner 00");
  await expect(dialog.getByTestId("student-performance-row")).toHaveCount(1);
  await expect(dialog).toContainText("25%");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: "المستوى", exact: true }).click();
  const arabic = page.getByRole("dialog", {
    name: "مستوى الطلبة",
    exact: true,
  });
  await arabic
    .getByLabel("ابحث في المستوى باسم الطالب", { exact: true })
    .fill("Fictional Learner 00");
  await expect(arabic.getByTestId("student-performance-row")).toHaveCount(1);
  await expect(arabic).toContainText("25%");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-student-performance-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.route("**/api/academic/performance?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fictional performance fetch failed" }),
    }),
  );
  await arabic
    .getByLabel("ابحث في المستوى باسم الطالب", { exact: true })
    .fill("Fictional Learner 01");
  await expect(arabic.getByRole("alert")).toContainText(
    "Fictional performance fetch failed",
  );
  await expect(arabic.getByTestId("student-performance-row")).toHaveCount(0);
  let releaseOld: (() => void) | undefined,
    releaseNew: (() => void) | undefined,
    oldSeen = false;
  const oldGate = new Promise<void>((r) => (releaseOld = r)),
    newGate = new Promise<void>((r) => (releaseNew = r));
  await page.unroute("**/api/academic/performance?**");
  await page.route("**/api/academic/performance?**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q === "Old race") {
      oldSeen = true;
      await oldGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "old",
              name: "STALE PERFORMANCE",
              code: "old",
              attendance_percent: 100,
              exam_percent: 100,
            },
          ],
          total: 1,
        }),
      });
    } else {
      await newGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], total: 0 }),
      });
    }
  });
  await arabic
    .getByLabel("ابحث في المستوى باسم الطالب", { exact: true })
    .fill("Old race");
  await expect.poll(() => oldSeen).toBeTruthy();
  await arabic
    .getByLabel("ابحث في المستوى باسم الطالب", { exact: true })
    .fill("New race");
  releaseNew!();
  await expect(
    arabic.getByText("مفيش طلبة مطابقين", { exact: true }),
  ).toBeVisible();
  releaseOld!();
  await expect(
    arabic.getByText("STALE PERFORMANCE", { exact: true }),
  ).toHaveCount(0);
});
