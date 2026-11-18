import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "student-profile-browser" },
});
test("student profile prints isolated private fields, omits sensitive extras and works in Arabic mobile", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "studentprofile-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Card Academy",
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
  const branch = (await api("/branches")).data[0].id;
  await api("/students", "POST", {
    name: "متعلم تجريبي / Fictional Learner",
    code: "CARD-UI",
    branch_id: branch,
    national_id: "EXCLUDED-PRIVATE-NATIONAL",
    phone: "FICTIONAL-PRINT-PHONE",
    notes: "EXCLUDED-PRIVATE-NOTE",
    status: "suspended",
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Students", exact: true }).click();
  await page
    .getByRole("button", { name: /متعلم تجريبي.*Fictional Learner/ })
    .click();
  await page
    .getByRole("button", { name: "Private student profile", exact: true })
    .click();
  await expect(page.locator("[data-student-profile-print]")).toBeVisible();
  await expect(page.locator("[data-student-profile-print]")).toContainText(
    "suspended",
  );
  await expect(page.locator("[data-student-profile-print]")).not.toContainText(
    "EXCLUDED-PRIVATE",
  );
  // Observe that the isolated frame invokes print, without opening an OS dialog in the test.
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
    .getByRole("button", { name: "Print profile / Save PDF", exact: true })
    .click();
  await expect(
    page.locator('iframe[title="ELCenter private student profile print"]'),
  ).toHaveAttribute("data-print-called", "true");
  const frame = page.frames().find((f) => f !== page.mainFrame())!;
  await expect(frame.locator("[data-student-profile-print]")).toBeVisible();
  await expect(frame.locator("button,input,nav,aside")).toHaveCount(0);
  expect(await frame.locator("body").innerText()).not.toContain(
    "EXCLUDED-PRIVATE",
  );
  await expect(frame.locator("body")).toContainText("Fictional Learner");
  const html = await frame.content(),
    preview = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  await preview.goto("/");
  await preview.setContent(html);
  await preview.evaluate(() => document.fonts.ready);
  await expect(preview.locator("[data-student-profile-print]")).toBeVisible();
  await preview.screenshot({
    path: "/downloads/elcenter-student-profile-print.png",
    fullPage: false,
  });
  await preview.pdf({
    path: "/downloads/elcenter-student-profile.pdf",
    format: "A4",
    printBackground: true,
  });
  await preview.close();
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("aside").evaluate((el) => el.getBoundingClientRect().left),
    )
    .toBeGreaterThanOrEqual(390);
  await page
    .getByRole("button", { name: /متعلم تجريبي.*Fictional Learner/ })
    .click();
  await page
    .getByRole("button", { name: "ملف الطالب الخاص", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "طباعة الملف / حفظ PDF",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-student-profile-ar-mobile.png",
    fullPage: true,
  });
});
