import { Temporal } from "@js-temporal/polyfill";
import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "seasonal-package-browser" },
});
test("seasonal package windows save, block closed enrollment and preserve inclusive-day draft billing", async ({
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
  const clock = await (await page.request.get("/api/course-packages")).json(),
    today = clock.enrollment_day,
    tomorrow = Temporal.PlainDate.from(today).add({ days: 1 }).toString();
  const future = await page.request.post("/api/course-packages", {
    headers,
    data: {
      name: "Fictional future package",
      branch_id: base.branch_id,
      price: 100,
      course_ids: [base.course_id, course],
      enrollment_opens_on: tomorrow,
    },
  });
  expect(future.ok()).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "Courses", exact: true }).click();
  await page
    .getByRole("button", { name: "Course packages", exact: true })
    .click();
  await page
    .getByLabel("Package name", { exact: true })
    .fill("Fictional seasonal package");
  await page
    .getByLabel("Package branch", { exact: true })
    .selectOption(base.branch_id);
  await page.getByLabel("Fixed package price", { exact: true }).fill("1500");
  await page
    .getByLabel("Package enrollment opens on", { exact: true })
    .fill(today);
  await page
    .getByLabel("Package enrollment closes on", { exact: true })
    .fill(today);
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
      name: "Fictional seasonal package",
      exact: true,
    }),
  ).toBeVisible();
  const futureCard = page
    .getByRole("heading", { name: "Fictional future package", exact: true })
    .locator("xpath=ancestor::section[1]");
  await expect(
    futureCard.getByRole("button", {
      name: "Enroll and draft invoice",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(futureCard.getByText(/Window not open/)).toBeVisible();
  const activeCard = page
    .getByRole("heading", { name: "Fictional seasonal package", exact: true })
    .locator("xpath=ancestor::section[1]");
  await expect(activeCard.getByText(/Window open/)).toBeVisible();
  await page
    .getByRole("dialog")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.screenshot({
    path: "/downloads/elcenter-seasonal-package-desktop.png",
    fullPage: false,
  });
  await activeCard
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
    .fill("SEASON-BROWSER-001");
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
    path: "/downloads/elcenter-seasonal-package-enrollment.png",
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
  ).data.find((i: any) => i.number === "SEASON-BROWSER-001");
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
    .getByRole("heading", { name: "Fictional seasonal package", exact: true })
    .scrollIntoViewIfNeeded();
  await page
    .getByRole("dialog")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.screenshot({
    path: "/downloads/elcenter-seasonal-package-ar-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
