import { test, expect, type Page } from "@playwright/test";
test("student, guardian and teacher use linked portals and real coursework", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore a private demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Headquarters overview" }),
  ).toBeVisible();
  const owner = (await (await page.request.get("/api/me")).json()).user;
  async function api(p: string, m = "GET", d?: any, pg = page) {
    const me = await (await pg.request.get("/api/me")).json();
    const r = await pg.request.fetch("/api" + p, {
      method: m,
      headers: { "x-csrf-token": me.user.csrf },
      ...(d ? { data: d } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  const g = (await api("/groups")).data[0],
    students = (await api("/groups/" + g.id + "/enrollments")).data,
    studentId = (
      students.find((x: any) => x.name === "Mariam Adel") ?? students[0]
    ).student_id,
    guardianId = (await api("/students/" + studentId)).guardians[0].id,
    roles = (await api("/roles")).data;
  const suffix = Date.now(),
    password = "Browser-test-only-2026";
  async function account(key: string, profile: string) {
    const email = key + "-" + suffix + "@example.invalid";
    await api("/users", "POST", {
      name:
        key === "student"
          ? "Mariam Adel"
          : key === "teacher"
            ? "Nour Hassan"
            : "Mariam’s family",
      email,
      password,
      role_id: roles.find((r: any) => r.system_key === key).id,
      branch_id: null,
    });
    const u = (await api("/users")).data.find((r: any) => r.email === email);
    await api("/portal-links", "POST", {
      user_id: u.user_id,
      kind: key === "parent_guardian" ? "guardian" : key,
      profile_id: profile,
    });
    return email;
  }
  const studentEmail = await account("student", studentId),
    teacherEmail = await account("teacher", g.teacher_id),
    guardianEmail = await account("parent_guardian", guardianId);
  await page
    .getByRole("button", { name: "Learning space", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A space to keep growing" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase6-lms-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  const sc = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    sp = await sc.newPage();
  sp.on("pageerror", (e) => errors.push(e.message));
  await sp.request.post("/api/auth/login", {
    data: { email: studentEmail, password },
  });
  await sp.goto("/");
  await expect(sp.getByText("Student portal", { exact: true })).toBeVisible();
  await expect(
    sp.getByRole("heading", { name: "Welcome back, Mariam Adel" }),
  ).toBeVisible();
  await sp.screenshot({
    path: "/downloads/elcenter-phase6-student-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await sp.getByRole("button", { name: "View invoice", exact: true }).click();
  await expect(sp.getByRole("dialog")).toBeVisible();
  await sp
    .getByRole("button", { name: "Print / Save PDF", exact: true })
    .click();
  const printFrame = sp.frames().find((f) => f !== sp.mainFrame());
  expect(printFrame).toBeTruthy();
  const printPage = await browser.newPage();
  await printPage.setContent(await printFrame!.content());
  await printPage.pdf({
    path: "/downloads/elcenter-phase6-family-invoice.pdf",
    format: "A4",
    printBackground: true,
  });
  await printPage.close();
  await sp.getByRole("button", { name: "Close", exact: true }).click();
  await sp
    .getByRole("button", { name: "Request / history", exact: true })
    .first()
    .click();
  await expect(sp.getByRole("dialog")).toBeVisible();
  await sp
    .getByLabel("Requested attendance status", { exact: true })
    .selectOption("excused");
  await sp
    .getByLabel("Reason for correction", { exact: true })
    .fill("Student asks the school to check the signed absence excuse.");
  await sp
    .getByRole("button", { name: "Submit correction request", exact: true })
    .click();
  await expect(sp.getByRole("status")).toContainText(
    "Request submitted for independent review.",
  );
  await sp.screenshot({
    path: "/downloads/elcenter-portal-correction-student.png",
    fullPage: true,
  });
  const correction = (await api("/attendance-corrections")).data.find(
    (r: any) => r.reason.startsWith("Student asks"),
  );
  expect(correction).toBeTruthy();
  await api("/attendance-corrections/" + correction.id + "/decision", "POST", {
    decision: "approved",
    note: "School verified the signed absence excuse.",
  });
  await sp.getByRole("button", { name: "Close", exact: true }).click();
  await sp.getByRole("button", { name: "Learning space", exact: true }).click();
  await sp.getByRole("button", { name: "Open class", exact: true }).click();
  await sp
    .getByRole("button", {
      name: "Welcome to your learning space",
      exact: false,
    })
    .click();
  await expect(sp.getByRole("dialog")).toBeVisible();
  await sp.getByRole("button", { name: "Mark complete", exact: true }).click();
  await expect(sp.getByRole("dialog")).toHaveCount(0);
  await expect(sp.getByText("Completed lessons: 1 / 2")).toBeVisible();
  await sp
    .getByRole("button", { name: "Introduce yourself", exact: false })
    .click();
  await sp.getByRole("button", { name: "Submit once", exact: true }).click();
  await sp
    .getByLabel("Your work", { exact: true })
    .fill("I am Mariam. My goal is to speak with confidence.");
  await sp.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    sp.getByText("Awaiting feedback", { exact: true }),
  ).toBeVisible();
  await sp.getByRole("button", { name: "Close", exact: true }).click();
  const tc = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    tp = await tc.newPage();
  tp.on("pageerror", (e) => errors.push(e.message));
  await tp.request.post("/api/auth/login", {
    data: { email: teacherEmail, password },
  });
  await tp.goto("/");
  await expect(
    tp.getByText("Teacher workspace", { exact: true }),
  ).toBeVisible();
  await tp.getByRole("button", { name: "Learning space", exact: true }).click();
  await tp.getByRole("button", { name: "Open class", exact: true }).click();
  await tp
    .getByRole("button", { name: "Upload document", exact: true })
    .click();
  await tp.getByLabel("Title", { exact: true }).fill("Class reading sheet");
  await tp.getByLabel("Category", { exact: true }).fill("Learning material");
  await tp
    .getByLabel("Share with the linked student, family or class portal", {
      exact: false,
    })
    .check();
  await tp.getByLabel("File", { exact: true }).setInputFiles({
    name: "reading.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nFictional class attachment\n%%EOF"),
  });
  await tp.getByRole("button", { name: "Encrypt & save", exact: true }).click();
  await expect(
    tp.getByRole("cell", { name: "Class reading sheet", exact: true }),
  ).toBeVisible();
  await tp
    .getByRole("button", { name: "Introduce yourself", exact: false })
    .click();
  await expect(
    tp.getByText("I am Mariam. My goal is to speak with confidence.", {
      exact: true,
    }),
  ).toBeVisible();
  await tp
    .getByRole("button", { name: "Grade & feedback", exact: true })
    .click();
  await tp.getByLabel("Score", { exact: true }).fill("19");
  await tp
    .getByLabel("Feedback", { exact: true })
    .fill("Clear goal and a strong start.");
  await tp.getByRole("button", { name: "Save", exact: true }).click();
  await expect(tp.getByText("19 / 20", { exact: true })).toBeVisible();
  await tp.getByRole("button", { name: "Close", exact: true }).click();
  await tp
    .getByRole("button", { name: "New announcement", exact: true })
    .click();
  await tp.getByLabel("Title", { exact: true }).fill("Before our next class");
  await tp
    .getByLabel("Message", { exact: true })
    .fill("Bring one question about this week’s practice.");
  await tp.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    tp.getByRole("heading", { name: "Before our next class" }),
  ).toBeVisible();
  await tp.getByRole("button", { name: "Draft exam", exact: true }).click();
  await tp
    .getByLabel("Exam name", { exact: true })
    .fill("Independent checkpoint");
  await tp.getByLabel("Start time", { exact: true }).fill("2026-11-18T12:00");
  await tp.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    tp.getByRole("dialog", { name: "Independent checkpoint", exact: true }),
  ).toBeVisible();
  await tp.getByRole("button", { name: "Add question", exact: true }).click();
  await tp.getByLabel("Type", { exact: true }).selectOption("short_answer");
  await tp.getByLabel("Question text", { exact: true }).fill("What is 2 + 2?");
  await tp
    .getByLabel("Correct answer / JSON key (optional)", { exact: true })
    .fill("4");
  await tp.getByLabel("Points", { exact: true }).fill("10");
  await tp.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    tp.getByText("1. What is 2 + 2?", { exact: false }),
  ).toBeVisible();
  await tp.getByRole("button", { name: "Publish exam", exact: true }).click();
  await expect(
    tp.getByRole("button", { name: "Close submissions", exact: true }),
  ).toBeVisible();
  await tp.getByRole("button", { name: "Close", exact: true }).click();
  await sp.reload();
  await sp.getByRole("button", { name: "Learning space", exact: true }).click();
  await sp.getByRole("button", { name: "Open class", exact: true }).click();
  await expect(
    sp.getByRole("cell", { name: "Class reading sheet", exact: true }),
  ).toBeVisible();
  await expect(
    sp.getByRole("button", { name: "Upload document", exact: true }),
  ).toHaveCount(0);
  const row = sp.getByRole("row").filter({ hasText: "Independent checkpoint" });
  await row.getByRole("button", { name: "Open exam", exact: true }).click();
  await sp.getByLabel("Your answer", { exact: true }).fill("4");
  await sp
    .getByRole("button", { name: "Submit final answers once", exact: true })
    .click();
  await expect(
    sp.getByText("Your score: 10 / 10", { exact: true }),
  ).toBeVisible();
  await sp.screenshot({
    path: "/downloads/elcenter-phase6-quiz-result.png",
    fullPage: true,
    animations: "disabled",
  });
  await sp.getByRole("button", { name: "Close", exact: true }).click();
  await tp.getByRole("button", { name: "My day", exact: true }).click();
  await tp
    .getByRole("button", { name: "Record attendance", exact: true })
    .first()
    .click();
  await expect(
    tp.getByRole("dialog", { name: "Class attendance", exact: true }),
  ).toBeVisible();
  await expect(
    tp.getByRole("button", { name: "Save new attendance", exact: true }),
  ).toBeDisabled();
  await tp
    .getByRole("button", { name: "Request correction / history", exact: true })
    .first()
    .click();
  await tp
    .getByLabel("Requested attendance status", { exact: true })
    .selectOption("late");
  await tp
    .getByLabel("Reason for correction", { exact: true })
    .fill("Teacher checked the signed class register.");
  await tp
    .getByRole("button", { name: "Submit correction request", exact: true })
    .click();
  await expect(tp.getByRole("status")).toContainText(
    "Request submitted for independent review.",
  );
  await tp.screenshot({
    path: "/downloads/elcenter-portal-correction-teacher.png",
    fullPage: true,
  });
  await tp.getByRole("button", { name: "Close", exact: true }).click();
  await expect(tp.getByRole("dialog")).toHaveCount(0);
  await tp.getByRole("button", { name: "Learning space", exact: true }).click();
  await tp.getByRole("button", { name: "Open class", exact: true }).click();
  await tp.screenshot({
    path: "/downloads/elcenter-phase6-teacher-lms.png",
    fullPage: true,
    animations: "disabled",
  });
  await sp.reload();
  await sp.getByRole("button", { name: /Inbox/ }).click();
  await expect(
    sp.getByRole("heading", { name: "Before our next class" }),
  ).toBeVisible();
  await sp.getByRole("button", { name: "My day", exact: true }).click();
  await sp.setViewportSize({ width: 390, height: 844 });
  await sp.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(sp.getByText("بوابة الطالب", { exact: true })).toBeVisible();
  await sp.screenshot({
    path: "/downloads/elcenter-phase6-student-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await sp
    .getByRole("button", { name: "طلب / السجل", exact: true })
    .first()
    .click();
  await expect(
    sp.getByText("School verified the signed absence excuse.", {
      exact: false,
    }),
  ).toBeVisible();
  await sp.screenshot({
    path: "/downloads/elcenter-portal-correction-family-ar-mobile.png",
    fullPage: false,
  });
  await sp.getByRole("button", { name: "Close", exact: true }).click();
  await sp.getByRole("button", { name: "مساحة التعلم", exact: true }).click();
  await sp.getByRole("button", { name: "فتح المجموعة", exact: true }).click();
  await expect(
    sp.getByRole("heading", { name: "مناقشة المجموعة", exact: true }),
  ).toBeVisible();
  await sp.screenshot({
    path: "/downloads/elcenter-phase6-class-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  const gc = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ar-EG",
    }),
    gp = await gc.newPage();
  gp.on("pageerror", (e) => errors.push(e.message));
  await gp.request.post("/api/auth/login", {
    data: { email: guardianEmail, password },
  });
  await gp.goto("/");
  await expect(gp.getByText("بوابة ولي الأمر", { exact: true })).toBeVisible();
  await gp.getByRole("button", { name: "طلب جديد", exact: true }).click();
  await gp.getByLabel("الموضوع", { exact: true }).fill("مراجعة التقدم الدراسي");
  await gp
    .getByLabel("الرسالة", { exact: true })
    .fill("أرغب في مقابلة لمناقشة مستوى الطالب.");
  await gp.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(
    gp.getByText("مراجعة التقدم الدراسي", { exact: true }),
  ).toBeVisible();
  await gp.screenshot({
    path: "/downloads/elcenter-phase6-guardian-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await gp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await sc.close();
  await tc.close();
  await gc.close();
});
