import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test.use({ extraHTTPHeaders: { "cf-connecting-ip": "statement-browser" } });
test("audited complete account CSV contains opening, signed running balances and applied scope in both languages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Fictional Owner",
          email: "statement-browser@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Statement Academy",
        },
      })
    ).ok(),
  ).toBeTruthy();
  async function api(path: string, method = "GET", data?: any) {
    const me = (await (await page.request.get("/api/me")).json()).user;
    const r = await page.request.fetch("/api" + path, {
      method,
      headers: { "x-csrf-token": me.csrf },
      ...(data ? { data } : {}),
    });
    const j = await r.json();
    expect(r.ok(), JSON.stringify(j)).toBeTruthy();
    return j;
  }
  await api("/finance/initialize", "POST", { year: 2026 });
  const settings = await api("/finance/settings"),
    branch = (await api("/branches")).data[0].id,
    cash = settings.accounts.find((a: any) => a.system_key === "cash").id,
    equity = settings.accounts.find((a: any) => a.system_key === "equity").id;
  for (const [date, value] of [
    ["2026-10-31", 100],
    ["2026-11-01", -30],
    ["2026-11-02", 10],
    ["2026-11-15", 20],
  ] as const)
    await api("/finance/journals", "POST", {
      branch_id: branch,
      date,
      reference: "FICT-" + date,
      memo: "=Fictional spreadsheet-looking memo",
      lines: [
        {
          account: cash,
          debit: Math.max(value, 0),
          credit: Math.max(-value, 0),
        },
        {
          account: equity,
          debit: Math.max(-value, 0),
          credit: Math.max(value, 0),
        },
      ],
    });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Finance & payroll", exact: true })
    .click();
  await page.getByRole("button", { name: "Ledger", exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-11-01");
  await page.getByLabel("To", { exact: true }).fill("2026-11-30");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByText("Page 1 · 3 journals", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Statement account", exact: true })
    .selectOption(cash);
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export account statement CSV", exact: true })
    .click();
  const file = await waiting,
    local = await file.path(),
    csv = readFileSync(local!, "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('"Opening",100');
  expect(csv).toContain('"Closing",100');
  expect(csv).toContain('"Movements",3');
  expect(csv).toContain('"\'=Fictional spreadsheet-looking memo"');
  expect(csv).toContain("0,30,70");
  expect(csv).toContain("10,0,80");
  expect(csv).toContain("20,0,100");
  expect(file.suggestedFilename()).toBe(
    "elcenter-account-statement-2026-11-01-2026-11-30.csv",
  );
  await file.saveAs("/downloads/elcenter-account-statement.csv");
  await expect(page.getByRole("status")).toContainText(
    "Export prepared and audited: 3 movements",
  );
  await page
    .getByRole("heading", { name: "Account statement CSV", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/downloads/elcenter-account-statement-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "كشف حساب CSV", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "حساب الكشف", exact: true })
    .selectOption(equity);
  const wait2 = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "تصدير كشف الحساب CSV", exact: true })
    .click();
  const f2 = await wait2,
    text = readFileSync((await f2.path())!, "utf8");
  expect(text).toContain('"Opening",-100');
  expect(text).toContain('"Closing",-100');
  expect(text).not.toContain('"\'-100"');
  await expect(page.getByRole("status")).toContainText(
    "تم تجهيز وتسجيل التصدير: 3 حركة",
  );
  await page.screenshot({
    path: "/downloads/elcenter-account-statement-ar-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
