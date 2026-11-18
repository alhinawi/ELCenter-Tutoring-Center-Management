import { test, expect } from "@playwright/test";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "student-card-browser" } });
test("student card uses audited current snapshot and prints only the card with loaded QR and Arabic font", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "studentcard-browser@example.invalid",
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
    national_id: "PRIVATE-CARD-NATIONAL",
    phone: "PRIVATE-CARD-PHONE",
    notes: "PRIVATE-CARD-NOTE",
    status: "suspended",
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Students", exact: true }).click();
  await page
    .getByRole("button", { name: /متعلم تجريبي.*Fictional Learner/ })
    .click();
  await page
    .getByRole("button", { name: "Student ID card", exact: true })
    .click();
  await expect(page.locator("[data-student-id-card]")).toBeVisible();
  await expect(page.locator("[data-student-id-card]")).toContainText(
    "suspended",
  );
  await expect(page.locator("[data-student-id-card]")).not.toContainText(
    "PRIVATE-CARD",
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
    .getByRole("button", { name: "Print student card / Save PDF", exact: true })
    .click();
  await expect(
    page.locator('iframe[title="ELCenter student card print"]'),
  ).toHaveAttribute("data-print-called", "true");
  const frame = page.frames().find((f) => f !== page.mainFrame())!;
  await expect(frame.locator("[data-student-id-card]")).toBeVisible();
  await expect(frame.locator("button,input,nav,aside")).toHaveCount(0);
  expect(await frame.locator("body").innerText()).not.toContain("PRIVATE-CARD");
  expect(
    await frame
      .locator("img")
      .evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0),
  ).toBeTruthy();
  const html = await frame.content(),
    preview = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  await preview.goto("/");
  await preview.setContent(html);
  await preview.evaluate(() => document.fonts.ready);
  await expect(preview.locator("[data-student-id-card]")).toBeVisible();
  await preview.screenshot({
    path: "/downloads/elcenter-student-card-print.png",
    fullPage: false,
  });
  await preview.pdf({
    path: "/downloads/elcenter-student-card.pdf",
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
  await page.getByRole("button", { name: "كارت الطالب", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "طباعة كارت الطالب / حفظ PDF",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/downloads/elcenter-student-card-ar-mobile.png",
    fullPage: true,
  });
});
