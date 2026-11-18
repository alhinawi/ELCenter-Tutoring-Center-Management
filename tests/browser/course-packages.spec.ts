import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "package-browser" } });
test("package form enrolls all groups and creates one draft invoice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.request.post("/api/auth/demo", { data: {} });
  const me = await (await page.request.get("/api/me")).json(),
    headers = { "x-csrf-token": me.user.csrf };
  await page.request.post("/api/demo/academic-seed", { headers, data: {} });
  const base = (await (await page.request.get("/api/groups")).json()).data[0];
  const courseResponse = await page.request.post("/api/courses", {
    headers,
    data: {
      name: "Package science course",
      code: "PACKAGE-SCIENCE",
      branch_id: base.branch_id,
    },
  });
  expect(courseResponse.ok()).toBeTruthy();
  const course = (await courseResponse.json()).id;
  const gr = await page.request.post("/api/groups", {
    headers,
    data: {
      name: "Package science group",
      code: "PACKAGE-SCIENCE-G",
      branch_id: base.branch_id,
      course_id: course,
      teacher_id: base.teacher_id,
      classroom_id: base.classroom_id,
      capacity: 10,
      start_date: "2026-01-01",
      end_date: "2030-12-31",
    },
  });
  expect(gr.ok()).toBeTruthy();
  const group = (await gr.json()).id;
  const sr = await page.request.post("/api/students", {
    headers,
    data: {
      name: "Fictional Package Learner",
      code: "PACKAGE-LEARNER",
      branch_id: base.branch_id,
    },
  });
  expect(sr.ok()).toBeTruthy();
  const student = (await sr.json()).id;
  await page.goto("/");
  await page.getByRole("button", { name: "Courses", exact: true }).click();
  await page
    .getByRole("button", { name: "Course packages", exact: true })
    .click();
  await page
    .getByLabel("Package name", { exact: true })
    .fill("Fictional two-course package");
  await page
    .getByLabel("Package branch", { exact: true })
    .selectOption(base.branch_id);
  await page.getByLabel("Fixed package price", { exact: true }).fill("1500");
  const courseList = (await (await page.request.get("/api/courses")).json())
      .data,
    baseCourse = courseList.find((c: any) => c.id === base.course_id);
  await page.getByLabel(baseCourse.name, { exact: true }).check();
  await page.getByLabel("Package science course", { exact: true }).check();
  await page
    .getByRole("button", { name: "Create package", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Fictional two-course package",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enroll and draft invoice", exact: true })
    .click();
  await page
    .getByLabel("Package student", { exact: true })
    .selectOption(student);
  await page
    .getByLabel("Group for " + baseCourse.name, { exact: true })
    .selectOption(base.id);
  await page
    .getByLabel("Group for Package science course", { exact: true })
    .selectOption(group);
  await page
    .getByLabel("Package invoice number", { exact: true })
    .fill("PKG-BROWSER-001");
  await page
    .getByLabel("Package invoice date", { exact: true })
    .fill("2026-11-18");
  await page
    .getByLabel("Package invoice due date", { exact: true })
    .fill("2026-12-01");
  await page
    .getByRole("button", { name: "Confirm enrollment and draft", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/downloads/elcenter-course-package-enrollment.png",
    fullPage: false,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Confirm enrollment and draft", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "draft invoice created",
  );
  const invoice = (
    await (await page.request.get("/api/invoices")).json()
  ).data.find((i: any) => i.number === "PKG-BROWSER-001");
  expect(invoice.total).toBe(1500);
  expect(invoice.status).toBe("draft");
  for (const id of [base.id, group])
    expect(
      (
        await (
          await page.request.get("/api/groups/" + id + "/enrollments")
        ).json()
      ).data.some(
        (e: any) => e.student_id === student && e.status === "active",
      ),
    ).toBeTruthy();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page
    .getByRole("button", { name: "باقات الكورسات", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Fictional two-course package", exact: true })
    .scrollIntoViewIfNeeded();
  await page
    .getByRole("dialog")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.screenshot({
    path: "/downloads/elcenter-course-package-ar-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
