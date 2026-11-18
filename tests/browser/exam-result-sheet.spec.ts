import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "exam-sheet-browser" } });
test("final exam result sheet downloads private CSV and prints isolated scores in both languages", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "sheet-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Exam Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
  async function api(p: string, m = "GET", data?: any) {
    const me = (await (await page.request.get("/api/me")).json()).user;
    const r = await page.request.fetch("/api" + p, {
      method: m,
      headers: { "x-csrf-token": me.csrf },
      ...(data ? { data } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  const branch = (await api("/branches")).data[0].id,
    t = (
      await api("/teachers", "POST", {
        name: "Fictional Teacher",
        code: "ET",
        branch_id: branch,
      })
    ).id,
    c = (
      await api("/courses", "POST", {
        name: "Fictional Course",
        code: "EC",
        branch_id: branch,
      })
    ).id,
    room = (
      await api("/classrooms", "POST", {
        name: "Fictional Room",
        code: "ER",
        capacity: 30,
        branch_id: branch,
      })
    ).id,
    g = (
      await api("/groups", "POST", {
        name: "Fictional Exam Group",
        code: "EG",
        branch_id: branch,
        teacher_id: t,
        course_id: c,
        classroom_id: room,
        capacity: 30,
        start_date: "2026-01-01",
        end_date: "2026-12-31",
      })
    ).id;
  const examTime = Math.floor(Date.now() / 1000) + 2;
  const students = [];
  for (let i = 0; i < 3; i++) {
    const id = (
      await api("/students", "POST", {
        name:
          i === 0 ? "=Fictional Top" : "طالب تجريبي / Fictional Learner " + i,
        code: "SHEET" + i,
        branch_id: branch,
        national_id: "EXCLUDED-PRIVATE",
        phone: "EXCLUDED-PRIVATE",
      })
    ).id;
    students.push(id);
    await api("/groups/" + g + "/enrollments", "POST", {
      student_id: id,
      status: "active",
    });
  }
  const exam = (
    await api("/exams", "POST", {
      name: "امتحان تجريبي / Fictional Exam",
      group_id: g,
      scheduled_at: examTime,
      max_score: 100,
      pass_score: 50,
      status: "draft",
    })
  ).id;
  await api("/exams/" + exam + "/questions", "POST", {
    type: "essay",
    prompt: "EXCLUDED-PRIVATE-QUESTION",
    points: 100,
    position: 0,
  });
  await api("/exams/" + exam, "PUT", {
    name: "امتحان تجريبي / Fictional Exam",
    group_id: g,
    scheduled_at: examTime,
    max_score: 100,
    pass_score: 50,
    status: "published",
  });
  await expect
    .poll(() => Math.floor(Date.now() / 1000))
    .toBeGreaterThanOrEqual(examTime);
  for (const [i, score] of [90, 90, 40].entries())
    await api("/exams/" + exam + "/results", "POST", {
      student_id: students[i],
      score,
      feedback: "EXCLUDED-PRIVATE",
    });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Exams & performance", exact: true })
    .click();
  await page.getByRole("button", { name: "Open exam", exact: true }).click();
  await page
    .getByRole("button", { name: "Prepare result sheet", exact: true })
    .click();
  const sheet = page.locator("[data-exam-result-sheet]");
  await expect(sheet).toContainText("Final / pending review: 3 / 0");
  await expect(sheet).not.toContainText("EXCLUDED-PRIVATE");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export final results CSV", exact: true })
    .click();
  const file = await download,
    csv = await readFile((await file.path())!, "utf8");
  expect(csv.startsWith("\ufeff")).toBeTruthy();
  expect(csv).toContain("'=Fictional Top");
  expect(csv).not.toContain("EXCLUDED-PRIVATE");
  await file.saveAs("/downloads/elcenter-fictional-exam-results.csv");
  await page
    .getByRole("button", { name: "Prepare result sheet", exact: true })
    .click();
  await page.evaluate(() => {
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (
      this: Document,
      ...args: any[]
    ) {
      const element = (create as any).apply(this, args);
      if (String(args[0]).toLowerCase() === "iframe")
        queueMicrotask(() => {
          if (element.contentWindow)
            element.contentWindow.print = () => {
              element.dataset.printCalled = "true";
            };
        });
      return element;
    } as any;
  });
  await page
    .getByRole("button", { name: "Print result sheet / Save PDF", exact: true })
    .click();
  await expect(
    page.locator('iframe[title="ELCenter private final exam results print"]'),
  ).toHaveAttribute("data-print-called", "true");
  const frame = page.frames().find((f) => f !== page.mainFrame())!;
  await expect(frame.locator("button,input,select,nav,aside")).toHaveCount(0);
  expect(await frame.locator("body").innerText()).not.toContain(
    "EXCLUDED-PRIVATE",
  );
  const preview = await browser.newPage({
    viewport: { width: 900, height: 1000 },
  });
  await preview.goto("/");
  await preview.setContent(await frame.content());
  await preview.evaluate(() => document.fonts.ready);
  await preview.pdf({
    path: "/downloads/elcenter-exam-result-sheet.pdf",
    format: "A4",
    printBackground: true,
  });
  await preview.close();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.getByRole("button", { name: "فتح الامتحان", exact: true }).click();
  await page
    .getByRole("button", { name: "تجهيز كشف النتيجة", exact: true })
    .click();
  await expect(sheet).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await sheet.screenshot({
    path: "/downloads/elcenter-exam-result-sheet-ar-mobile.png",
    animations: "disabled",
  });
});
