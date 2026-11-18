import { test, expect } from "@playwright/test";
test.use({
  extraHTTPHeaders: { "cf-connecting-ip": "resources-browser-test" },
});
test("inventory library document and support screens persist real records", async ({
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
  const me = (await (await page.request.get("/api/me")).json()).user;
  async function api(p: string, m = "GET", body?: any) {
    const r = await page.request.fetch("/api" + p, {
      method: m,
      headers: { "x-csrf-token": me.csrf },
      ...(body ? { data: body } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  const branch = (await api("/branches")).data[0],
    student = (await api("/students")).data.find(
      (s: any) => s.branch_id === branch.id,
    ),
    item = await api("/inventory/inventory_items", "POST", {
      sku: "BOOK-1",
      name: "English practice book",
      category: "Books",
      unit: "copy",
      unit_cost: 100,
      sale_price: 150,
      reorder_level: 2,
    });
  await api("/inventory/adjustments", "POST", {
    branch_id: branch.id,
    item_id: item.id,
    quantity: 5,
    reason: "Verified opening count",
    idempotency_key: crypto.randomUUID(),
  });
  await page
    .getByRole("button", { name: "Resources & service", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Resources & service desk" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "English practice book", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase7-stock-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Learning together");
  await page.getByLabel("Author", { exact: true }).fill("Fictional author");
  await page.getByLabel("Category", { exact: true }).fill("Study skills");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Learning together", exact: true }),
  ).toBeVisible();
  const book = (await api("/library/books")).data.find(
    (r: any) => r.title === "Learning together",
  );
  await api("/library/copies", "POST", {
    book_id: book.id,
    branch_id: branch.id,
    barcode: "COPY-01",
  });
  await page
    .getByRole("button", { name: "Physical copies", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "COPY-01", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase7-library-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page
    .getByRole("button", { name: "Upload document", exact: true })
    .click();
  await page.getByLabel("Branch", { exact: true }).selectOption(branch.id);
  await page
    .getByLabel("Target record", { exact: true })
    .selectOption(student.id);
  await page.getByLabel("Title", { exact: true }).fill("Enrollment record");
  await page.getByLabel("Category", { exact: true }).fill("Registration");
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "record.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(
      "%PDF-1.4\nFictional local verification fixture\n%%EOF",
    ),
  });
  await page
    .getByRole("button", { name: "Encrypt & save", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Enrollment record", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Versions / download", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "record.pdf", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase7-document-versions.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Cross-center reports" }),
  ).toBeVisible();
  await page.getByLabel("Branch", { exact: true }).selectOption(branch.id);
  await page.getByRole("button", { name: "Run report", exact: true }).click();
  await expect(page.locator("#resource-report")).toContainText("ELCenter");
  const xlsx = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  await (await xlsx).saveAs("/downloads/elcenter-phase7-report.xlsx");
  await page
    .getByRole("button", { name: "Print / Save PDF", exact: true })
    .click();
  const frame = page.frames().find((f) => f !== page.mainFrame());
  expect(frame).toBeTruthy();
  const printPage = await browser.newPage();
  await printPage.setContent(await frame!.content());
  await printPage.pdf({
    path: "/downloads/elcenter-phase7-report.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  await printPage.close();
  await page.screenshot({
    path: "/downloads/elcenter-phase7-report-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Support", exact: true }).click();
  await page
    .getByRole("button", { name: "New support ticket", exact: true })
    .click();
  await page.getByLabel("Branch", { exact: true }).selectOption(branch.id);
  await page
    .getByLabel("Subject", { exact: true })
    .fill("Course schedule question");
  await page
    .getByLabel("Describe the issue", { exact: true })
    .fill("Please confirm the next class time.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Course schedule question", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "Course schedule question" })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await expect(
    page.getByText("Please confirm the next class time.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add reply", exact: true }).click();
  await page
    .getByLabel("Reply", { exact: true })
    .fill("Reception will confirm the timetable.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Reception will confirm the timetable.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "الموارد وخدمة العملاء", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/downloads/elcenter-phase7-support-ar-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
