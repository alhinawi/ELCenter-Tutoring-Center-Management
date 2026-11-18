import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "group-roster-browser" } });
test("group roster exports selected complete rows and prints no surrounding private records", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "roster-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Roster Academy",
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
    teacher = (
      await api("/teachers", "POST", {
        name: "Fictional Teacher",
        code: "RT",
        branch_id: branch,
      })
    ).id,
    course = (
      await api("/courses", "POST", {
        name: "English Fictional",
        code: "RC",
        branch_id: branch,
      })
    ).id,
    room = (
      await api("/classrooms", "POST", {
        name: "Fictional Room",
        code: "RR",
        capacity: 30,
        branch_id: branch,
      })
    ).id,
    group = (
      await api("/groups", "POST", {
        name: "مجموعة تجريبية / Fictional Group",
        code: "RG",
        branch_id: branch,
        teacher_id: teacher,
        course_id: course,
        classroom_id: room,
        capacity: 30,
        start_date: "2026-01-01",
        end_date: "2026-12-31",
      })
    ).id;
  for (const [i, status] of ["active", "waiting"].entries()) {
    const s = (
      await api("/students", "POST", {
        name:
          i === 0
            ? "=Fictional formula learner"
            : "طالب تجريبي / Fictional Waiting",
        code: "ROSTER" + i,
        branch_id: branch,
        phone: "EXCLUDED-PRIVATE",
        national_id: "EXCLUDED-PRIVATE",
        notes: "EXCLUDED-PRIVATE",
      })
    ).id;
    await api("/groups/" + group + "/enrollments", "POST", {
      student_id: s,
      status,
    });
  }
  await page.goto("/");
  await page.getByRole("button", { name: "Groups", exact: true }).click();
  await page
    .getByRole("button", { name: /مجموعة تجريبية.*Fictional Group/ })
    .click();
  await page
    .getByRole("button", { name: "Prepare roster print", exact: true })
    .click();
  await expect(page.locator("[data-group-roster-print]")).toContainText(
    "=Fictional formula learner",
  );
  await expect(page.locator("[data-group-roster-print]")).not.toContainText(
    "Fictional Waiting",
  );
  await page
    .getByLabel("Roster enrollment status", { exact: true })
    .selectOption("all");
  await expect(page.locator("[data-group-roster-print]")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export roster CSV", exact: true })
    .click();
  const file = await download,
    csv = await readFile((await file.path())!, "utf8");
  expect(csv.startsWith("\ufeff")).toBeTruthy();
  expect(csv).toContain("'=Fictional formula learner");
  expect(csv).toContain("Fictional Waiting");
  expect(csv).not.toContain("EXCLUDED-PRIVATE");
  await file.saveAs("/downloads/elcenter-fictional-group-roster.csv");
  await page
    .getByRole("button", { name: "Prepare roster print", exact: true })
    .click();
  await expect(page.locator("[data-group-roster-print]")).toContainText(
    "Fictional Waiting",
  );
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
    .getByRole("button", { name: "Print roster / Save PDF", exact: true })
    .click();
  await expect(
    page.locator('iframe[title="ELCenter private group roster print"]'),
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
  await preview.screenshot({
    path: "/downloads/elcenter-group-roster-print.png",
    fullPage: true,
  });
  await preview.pdf({
    path: "/downloads/elcenter-group-roster.pdf",
    format: "A4",
    printBackground: true,
  });
  await preview.close();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page
    .getByRole("button", { name: /مجموعة تجريبية.*Fictional Group/ })
    .click();
  await page
    .getByRole("button", { name: "تجهيز طباعة القائمة", exact: true })
    .click();
  await expect(page.locator("[data-group-roster-print]")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-group-roster-ar-mobile.png",
    fullPage: true,
  });
});
